import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
  CreateAgentSessionRuntimeFactory,
  DefaultPackageManager,
  ExtensionError,
  SessionInfo,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentUiEvent,
  ConversationSummary,
  ExtensionResourceType,
  ExtensionUIResponse,
  ModelOption,
  PackageMutationResult,
  ProjectInspection,
  ProjectSessionState,
  ThinkingLevel,
  ToolTimelineItem,
  UtilityCommand,
  UtilityResponse,
} from '../shared/contracts';
import {
  expectPath,
  expectProvider,
  expectRecord,
  expectString,
  expectThinkingLevel,
} from '../shared/validation';
import {
  safeDisplayValue,
  serializeMessage,
  serializeTimeline,
} from './serialize';
import { appendPiDesktopCommunicationStyle } from './communication-style';
import { attachmentPrompt } from './attachment-prompt';
import { expectAttachmentPaths } from '../shared/attachments';
import { ExtensionUIAdapter } from './extension-ui-adapter';
import {
  createPackageManager,
  discoverPackages,
  packageInventory,
  removePackageSetting,
  setPackageEnabled,
  setPackageResourceEnabled,
  withPackageEnvironment,
} from './package-management';

const parentPort = process.parentPort;
if (!parentPort) throw new Error('Pi utility process has no parent port');

let piSdk: typeof import('@earendil-works/pi-coding-agent');

let runtime: AgentSessionRuntime | undefined;
let unsubscribe: (() => void) | undefined;
let runtimeKeys: Record<string, string> = {};
const trustByProject = new Map<string, boolean>();
let runState: ProjectSessionState['runState'] = 'idle';
let composerText = '';
let packageMutationBusy = false;
const awaitingPackageReload = new Set<string>();
const extensionRuntimeErrors = new Map<string, string[]>();

function post(message: UtilityResponse) {
  parentPort?.postMessage(message);
}

function emit(event: AgentUiEvent) {
  post({ kind: 'event', event });
}

const extensionUI = new ExtensionUIAdapter({
  emit,
  getComposerText: () => composerText,
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function assertDirectory(projectPath: string) {
  const info = await stat(projectPath);
  if (!info.isDirectory())
    throw new Error('The selected project is not a folder');
}

function inspectTrust(projectPath: string) {
  const hasProtectedResources =
    piSdk.hasTrustRequiringProjectResources(projectPath);
  const saved = hasProtectedResources
    ? new piSdk.ProjectTrustStore(piSdk.getAgentDir()).get(projectPath)
    : true;
  return {
    hasProtectedResources,
    requiresDecision: hasProtectedResources && saved === null,
    trusted: hasProtectedResources ? saved : true,
  };
}

async function inspectProject(projectPath: string): Promise<ProjectInspection> {
  await assertDirectory(projectPath);
  return {
    path: projectPath,
    name: path.basename(projectPath),
    trust: inspectTrust(projectPath),
  };
}

function conversationTitle(info: SessionInfo) {
  const title = info.name?.trim() || info.firstMessage.trim();
  if (!title) return 'New conversation';
  const firstLine = title.split(/\r?\n/, 1)[0];
  return firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
}

function toConversation(info: SessionInfo): ConversationSummary {
  return {
    id: info.id,
    path: info.path,
    cwd: info.cwd,
    title: conversationTitle(info),
    createdAt: info.created.toISOString(),
    modifiedAt: info.modified.toISOString(),
    messageCount: info.messageCount,
  };
}

async function listConversations(projectPath: string) {
  await assertDirectory(projectPath);
  return (await piSdk.SessionManager.list(projectPath)).map(toConversation);
}

function availableModels(): ModelOption[] {
  if (!runtime) return [];
  return runtime.services.modelRuntime.getAvailableSnapshot().map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    reasoning: Boolean(model.reasoning),
  }));
}

function availableCommands() {
  if (!runtime) return [];
  const session = runtime.session;
  const extensionCommands = session.extensionRunner
    .getRegisteredCommands()
    .map((command) => ({
      name: command.invocationName,
      description: command.description,
      source: 'extension' as const,
      packageSource: command.sourceInfo.source,
      scope: command.sourceInfo.scope,
    }));
  const prompts = session.promptTemplates.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    source: 'prompt' as const,
    packageSource: prompt.sourceInfo.source,
    scope: prompt.sourceInfo.scope,
  }));
  const skills = session.resourceLoader.getSkills().skills.map((skill) => ({
    name: `skill:${skill.name}`,
    description: skill.description,
    source: 'skill' as const,
    packageSource: skill.sourceInfo.source,
    scope: skill.sourceInfo.scope,
  }));
  return [...extensionCommands, ...prompts, ...skills].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function snapshot(): Promise<ProjectSessionState> {
  if (!runtime) throw new Error('Open a project first');
  const session = runtime.session;
  const conversations = await listConversations(runtime.cwd);
  const currentPath = session.sessionFile;
  const currentInfo = currentPath
    ? conversations.find((conversation) => conversation.path === currentPath)
    : undefined;
  const project = await inspectProject(runtime.cwd);

  return {
    project: {
      ...project,
      trust: {
        ...project.trust,
        trusted: trustByProject.get(runtime.cwd) ?? project.trust.trusted,
        requiresDecision: false,
      },
    },
    conversations,
    activeConversationPath: currentPath,
    activeConversationId: session.sessionId,
    activeConversationTitle:
      session.sessionName || currentInfo?.title || 'New conversation',
    timeline: serializeTimeline(session.messages),
    models: availableModels(),
    selectedModel: session.model
      ? { provider: session.model.provider, id: session.model.id }
      : undefined,
    thinkingLevel: session.thinkingLevel,
    availableThinkingLevels:
      session.getAvailableThinkingLevels() as ThinkingLevel[],
    runState,
    diagnostics: [
      ...runtime.diagnostics.map((diagnostic) => diagnostic.message),
      ...(runtime.modelFallbackMessage ? [runtime.modelFallbackMessage] : []),
    ],
    commands: availableCommands(),
  };
}

function setRunState(state: ProjectSessionState['runState'], error?: string) {
  runState = state;
  emit({ type: 'run-state', state, ...(error ? { error } : {}) });
}

function bindSession(session: AgentSession) {
  unsubscribe?.();
  let activeAssistantId: string | undefined;
  const toolInputs = new Map<string, string>();

  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'agent_start') {
      setRunState('working');
      return;
    }

    if (event.type === 'message_start' && event.message.role === 'user') {
      const item = serializeMessage(event.message, session.messages.length);
      if (item) emit({ type: 'message-start', item });
      return;
    }

    if (event.type === 'message_start' && event.message.role === 'assistant') {
      const timestamp = event.message.timestamp ?? Date.now();
      activeAssistantId = `assistant-${timestamp}-${session.messages.length}`;
      emit({
        type: 'message-start',
        item: {
          kind: 'message',
          id: activeAssistantId,
          role: 'assistant',
          text: '',
          timestamp,
          status: 'streaming',
        },
      });
      return;
    }

    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta' &&
      activeAssistantId
    ) {
      emit({
        type: 'message-delta',
        id: activeAssistantId,
        delta: event.assistantMessageEvent.delta,
      });
      return;
    }

    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const item = serializeMessage(event.message, session.messages.length - 1);
      if (item) {
        emit({
          type: 'message-complete',
          item: {
            ...item,
            id: activeAssistantId ?? item.id,
            status: item.status ?? 'complete',
          },
        });
      }
      activeAssistantId = undefined;
      return;
    }

    if (event.type === 'tool_execution_start') {
      const item: ToolTimelineItem = {
        kind: 'tool',
        id: `tool-${event.toolCallId}`,
        toolCallId: event.toolCallId,
        name: event.toolName,
        input: safeDisplayValue(event.args),
        timestamp: Date.now(),
        status: 'running',
      };
      toolInputs.set(event.toolCallId, item.input);
      emit({ type: 'tool-start', item });
      return;
    }

    if (event.type === 'tool_execution_update') {
      emit({
        type: 'tool-update',
        id: `tool-${event.toolCallId}`,
        output: safeDisplayValue(event.partialResult),
      });
      return;
    }

    if (event.type === 'tool_execution_end') {
      const item: ToolTimelineItem = {
        kind: 'tool',
        id: `tool-${event.toolCallId}`,
        toolCallId: event.toolCallId,
        name: event.toolName,
        input: toolInputs.get(event.toolCallId) ?? '',
        output: safeDisplayValue(event.result),
        timestamp: Date.now(),
        status: event.isError ? 'failed' : 'completed',
      };
      toolInputs.delete(event.toolCallId);
      emit({ type: 'tool-complete', item });
      return;
    }

    if (event.type === 'agent_settled') {
      setRunState('idle');
      void snapshot()
        .then((state) => emit({ type: 'snapshot', state }))
        .catch((error: unknown) => setRunState('error', errorMessage(error)));
    }
  });
}

function assertCanSwitch() {
  if (runtime && !runtime.session.isIdle) {
    throw new Error(
      'Stop the current run before switching projects or conversations',
    );
  }
}

function extensionSource(error: ExtensionError) {
  const extension = runtime?.services.resourceLoader
    .getExtensions()
    .extensions.find(
      (candidate) =>
        candidate.path === error.extensionPath ||
        candidate.resolvedPath === error.extensionPath,
    );
  return {
    source: extension?.sourceInfo.source ?? error.extensionPath,
    scope: extension?.sourceInfo.scope === 'project' ? 'project' : 'user',
  } as const;
}

function reportExtensionError(error: ExtensionError) {
  const owner = extensionSource(error);
  const key = `${owner.scope}:${owner.source}`;
  extensionRuntimeErrors.set(key, [
    ...(extensionRuntimeErrors.get(key) ?? []),
    `${error.event}: ${error.error}`,
  ]);
  emit({
    type: 'extension-error',
    packageSource: owner.source,
    extensionPath: error.extensionPath,
    event: error.event,
    error: error.error,
  });
}

async function bindExtensionSession(session: AgentSession) {
  await session.bindExtensions({
    uiContext: extensionUI.context,
    mode: 'rpc',
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      newSession: async (options) => {
        if (!runtime) return { cancelled: true };
        return runtime.newSession(options);
      },
      fork: async (entryId, options) => {
        if (!runtime) return { cancelled: true };
        const result = await runtime.fork(entryId, options);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, options);
        return { cancelled: result.cancelled };
      },
      switchSession: async (sessionPath, options) => {
        if (!runtime) return { cancelled: true };
        return runtime.switchSession(sessionPath, options);
      },
      reload: async () => {
        extensionRuntimeErrors.clear();
        await session.reload({ beforeSessionStart: () => extensionUI.reset() });
        emit({ type: 'snapshot', state: await snapshot() });
      },
    },
    abortHandler: () => {
      void session.abort();
    },
    shutdownHandler: () => {
      void handle({ id: 'extension-shutdown', type: 'shutdown', payload: {} });
    },
    onError: reportExtensionError,
  });
}

function currentPackageContext(): {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  resourceLoader?: AgentSessionRuntime['services']['resourceLoader'];
  projectTrusted: boolean;
} {
  if (runtime) {
    return {
      cwd: runtime.cwd,
      agentDir: runtime.services.agentDir,
      settingsManager: runtime.services.settingsManager,
      resourceLoader: runtime.services.resourceLoader,
      projectTrusted: runtime.services.settingsManager.isProjectTrusted(),
    };
  }
  const cwd = process.cwd();
  const agentDir = piSdk.getAgentDir();
  return {
    cwd,
    agentDir,
    settingsManager: piSdk.SettingsManager.create(cwd, agentDir, {
      projectTrusted: false,
    }),
    projectTrusted: false,
  };
}

async function reloadAfterPackageChange(key: string) {
  if (!runtime) return false;
  extensionRuntimeErrors.clear();
  try {
    await runtime.session.reload({
      beforeSessionStart: () => extensionUI.reset(),
    });
    awaitingPackageReload.delete(key);
    emit({ type: 'snapshot', state: await snapshot() });
    const reloadedPackage = (
      await packageInventory(
        currentPackageContext(),
        awaitingPackageReload,
        extensionRuntimeErrors,
      )
    ).packages.find((item) => item.key === key);
    return reloadedPackage?.state !== 'failed';
  } catch (error) {
    const message = `Reload failed: ${errorMessage(error)}`;
    extensionRuntimeErrors.set(key, [message]);
    emit({
      type: 'extension-notification',
      id: `reload-${Date.now()}`,
      message,
      notificationType: 'error',
    });
    return false;
  }
}

async function mutatePackage(
  source: string,
  scope: 'user' | 'project',
  operation: (
    packageManager: DefaultPackageManager,
    local: boolean,
    context: ReturnType<typeof currentPackageContext>,
  ) => Promise<void>,
): Promise<PackageMutationResult> {
  if (packageMutationBusy) throw new Error('Another package change is running');
  if (runState !== 'idle' || (runtime && !runtime.session.isIdle))
    throw new Error('Wait for Pi to finish before changing packages');
  const context = currentPackageContext();
  if (scope === 'project' && !context.projectTrusted) {
    throw new Error('Trust the open project before changing project packages');
  }
  packageMutationBusy = true;
  try {
    const { packageManager, packageRuntime } = await createPackageManager(
      context,
      emit,
    );
    const beforeSources = new Set(
      packageManager
        .listConfiguredPackages()
        .filter((item) => item.scope === scope)
        .map((item) => item.source),
    );
    await withPackageEnvironment(packageRuntime, () =>
      operation(packageManager, scope === 'project', context),
    );
    await context.settingsManager.flush();
    const configuredAfter = packageManager
      .listConfiguredPackages()
      .filter((item) => item.scope === scope);
    const persistedSource =
      configuredAfter.find((item) => item.source === source)?.source ??
      configuredAfter.find(
        (item) =>
          item.installedPath &&
          path.isAbsolute(source) &&
          path.resolve(item.installedPath) === path.resolve(source),
      )?.source ??
      configuredAfter.find((item) => !beforeSources.has(item.source))?.source ??
      source;
    const key = `${scope}:${persistedSource}`;
    awaitingPackageReload.add(key);
    const loadedSuccessfully = await reloadAfterPackageChange(key);
    return {
      inventory: await packageInventory(
        currentPackageContext(),
        awaitingPackageReload,
        extensionRuntimeErrors,
      ),
      installedSuccessfully: true,
      loadedSuccessfully,
    };
  } finally {
    packageMutationBusy = false;
  }
}

function expectPackageScope(value: unknown) {
  if (value !== 'user' && value !== 'project')
    throw new Error('package scope is invalid');
  return value;
}

function expectResourceType(value: unknown): ExtensionResourceType {
  if (
    value !== 'extensions' &&
    value !== 'skills' &&
    value !== 'prompts' &&
    value !== 'themes'
  )
    throw new Error('resource type is invalid');
  return value;
}

function expectExtensionUIResponse(payload: Record<string, unknown>) {
  const id = expectString(payload.id, 'dialog id', { max: 200 });
  if (payload.cancelled === true)
    return { id, cancelled: true } satisfies ExtensionUIResponse;
  if (typeof payload.confirmed === 'boolean')
    return { id, confirmed: payload.confirmed } satisfies ExtensionUIResponse;
  return {
    id,
    value: expectString(payload.value, 'dialog value', {
      min: 0,
      max: 200_000,
    }),
  } satisfies ExtensionUIResponse;
}

async function applyRuntimeKeys(target: AgentSessionRuntime['services']) {
  const diagnostics: string[] = [];
  for (const [provider, key] of Object.entries(runtimeKeys)) {
    try {
      await target.modelRuntime.setRuntimeApiKey(provider, key);
    } catch (error) {
      diagnostics.push(
        `Could not activate ${provider} credentials: ${errorMessage(error)}`,
      );
    }
  }
  return diagnostics;
}

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const projectTrusted =
    trustByProject.get(cwd) ??
    (!piSdk.hasTrustRequiringProjectResources(cwd) ||
      new piSdk.ProjectTrustStore(agentDir).get(cwd) === true);
  const settingsManager = piSdk.SettingsManager.create(cwd, agentDir, {
    projectTrusted,
  });
  const services = await piSdk.createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      // Keep Pi's core prompt and every user/project append source intact; this
      // product-level guidance is the final addendum for Crust sessions.
      appendSystemPromptOverride: appendPiDesktopCommunicationStyle,
    },
  });
  const credentialDiagnostics = await applyRuntimeKeys(services);
  const result = await piSdk.createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
  });
  return {
    ...result,
    services,
    diagnostics: [
      ...services.diagnostics,
      ...credentialDiagnostics.map((message) => ({
        type: 'warning' as const,
        message,
      })),
    ],
  };
};

async function replaceRuntime(
  projectPath: string,
  sessionPath: string | undefined,
) {
  assertCanSwitch();
  unsubscribe?.();
  if (runtime) await runtime.dispose();
  const agentDir = piSdk.getAgentDir();
  const sessionManager = sessionPath
    ? piSdk.SessionManager.open(sessionPath, undefined, projectPath)
    : piSdk.SessionManager.create(projectPath);
  runtime = await piSdk.createAgentSessionRuntime(createRuntime, {
    cwd: projectPath,
    agentDir,
    sessionManager,
  });
  runtime.setBeforeSessionInvalidate(() => extensionUI.reset());
  runtime.setRebindSession(async (session) => {
    await bindExtensionSession(session);
    bindSession(session);
  });
  await bindExtensionSession(runtime.session);
  bindSession(runtime.session);
  runState = 'idle';
  return snapshot();
}

async function handle(command: UtilityCommand): Promise<unknown> {
  const payload = expectRecord(command.payload);

  switch (command.type) {
    case 'auth:hydrate': {
      const entries = expectRecord(payload.entries, 'credential entries');
      runtimeKeys = Object.fromEntries(
        Object.entries(entries).map(([provider, key]) => [
          expectProvider(provider),
          expectString(key, 'API key', { max: 8192 }),
        ]),
      );
      return null;
    }
    case 'auth:set-runtime': {
      const provider = expectProvider(payload.provider);
      const key = expectString(payload.key, 'API key', { max: 8192 });
      runtimeKeys[provider] = key;
      if (runtime)
        await runtime.services.modelRuntime.setRuntimeApiKey(provider, key);
      if (runtime) emit({ type: 'snapshot', state: await snapshot() });
      return runtime ? snapshot() : null;
    }
    case 'auth:remove-runtime': {
      const provider = expectProvider(payload.provider);
      delete runtimeKeys[provider];
      if (runtime)
        await runtime.services.modelRuntime.removeRuntimeApiKey(provider);
      if (runtime) emit({ type: 'snapshot', state: await snapshot() });
      return runtime ? snapshot() : null;
    }
    case 'project:inspect':
      return inspectProject(expectPath(payload.path));
    case 'project:list-sessions':
      return listConversations(expectPath(payload.path));
    case 'project:open': {
      const projectPath = expectPath(payload.path);
      const inspection = await inspectProject(projectPath);
      let trusted = inspection.trust.trusted;
      if (inspection.trust.requiresDecision) {
        if (typeof payload.trusted !== 'boolean') {
          throw new Error(
            'Choose whether to trust this project before opening it',
          );
        }
        trusted = payload.trusted;
        if (payload.rememberTrust === true) {
          new piSdk.ProjectTrustStore(piSdk.getAgentDir()).set(
            projectPath,
            trusted,
          );
        }
      }
      trustByProject.set(projectPath, trusted === true);
      const sessionPath =
        payload.sessionPath === undefined
          ? undefined
          : expectPath(payload.sessionPath, 'session path');
      return replaceRuntime(projectPath, sessionPath);
    }
    case 'session:new': {
      if (!runtime) throw new Error('Open a project first');
      assertCanSwitch();
      const result = await runtime.newSession();
      if (result.cancelled)
        throw new Error('The new conversation was cancelled');
      return snapshot();
    }
    case 'session:open': {
      if (!runtime) throw new Error('Open a project first');
      assertCanSwitch();
      const result = await runtime.switchSession(expectPath(payload.path));
      if (result.cancelled)
        throw new Error('The conversation switch was cancelled');
      return snapshot();
    }
    case 'session:rename': {
      const sessionPath = expectPath(payload.path);
      const title = expectString(payload.title, 'title', { max: 120 }).trim();
      if (!title) throw new Error('title cannot be empty');
      if (runtime?.session.sessionFile === sessionPath) {
        runtime.session.setSessionName(title);
      } else {
        const manager = piSdk.SessionManager.open(sessionPath);
        manager.appendSessionInfo(title);
        return listConversations(manager.getCwd());
      }
      return listConversations(runtime.cwd);
    }
    case 'chat:send': {
      if (!runtime) throw new Error('Open a project first');
      if (!runtime.session.isIdle) throw new Error('Pi is already working');
      const text = expectString(payload.text, 'message', {
        min: 0,
        max: 200_000,
      }).trim();
      const prompt = await attachmentPrompt(
        text,
        expectAttachmentPaths(payload.attachmentPaths),
      );
      if (!prompt.text) throw new Error('message cannot be empty');
      setRunState('starting');
      void (async () => {
        try {
          await runtime?.session.prompt(prompt.text, { images: prompt.images });
          if (runtime?.session.isIdle) {
            setRunState('idle');
            emit({ type: 'snapshot', state: await snapshot() });
          }
        } catch (error) {
          setRunState('error', errorMessage(error));
          try {
            emit({ type: 'snapshot', state: await snapshot() });
          } catch {
            // The original prompt failure is the useful diagnostic.
          }
        }
      })();
      return null;
    }
    case 'chat:stop': {
      if (!runtime || runtime.session.isIdle) return null;
      setRunState('stopping');
      await runtime.session.abort();
      return null;
    }
    case 'composer:sync': {
      composerText = expectString(payload.text, 'composer text', {
        min: 0,
        max: 200_000,
      });
      return null;
    }
    case 'extension-ui:respond': {
      extensionUI.respond(expectExtensionUIResponse(payload));
      return null;
    }
    case 'packages:list':
      return packageInventory(
        currentPackageContext(),
        awaitingPackageReload,
        extensionRuntimeErrors,
      );
    case 'packages:install': {
      const source = expectString(payload.source, 'package source', {
        max: 4096,
      }).trim();
      const scope = expectPackageScope(payload.scope);
      return mutatePackage(source, scope, (packageManager, local) =>
        packageManager.installAndPersist(source, { local }),
      );
    }
    case 'packages:update': {
      const source = expectString(payload.source, 'package source', {
        max: 4096,
      }).trim();
      const scope = expectPackageScope(payload.scope);
      return mutatePackage(source, scope, (packageManager) =>
        packageManager.update(source),
      );
    }
    case 'packages:remove': {
      const source = expectString(payload.source, 'package source', {
        max: 4096,
      }).trim();
      const scope = expectPackageScope(payload.scope);
      return mutatePackage(
        source,
        scope,
        async (packageManager, local, context) => {
          const configured = packageManager
            .listConfiguredPackages()
            .find((item) => item.scope === scope && item.source === source);
          const managedSource =
            /^(npm:|git:|github:|https?:\/\/|ssh:|git@)/i.test(source);
          const operationSource =
            !managedSource && configured?.installedPath
              ? configured.installedPath
              : source;
          await packageManager.remove(operationSource, { local });
          const removed = removePackageSetting(
            context.settingsManager,
            source,
            scope,
          );
          if (!removed)
            throw new Error(`No matching package found for ${source}`);
        },
      );
    }
    case 'packages:set-enabled': {
      const source = expectString(payload.source, 'package source', {
        max: 4096,
      }).trim();
      const scope = expectPackageScope(payload.scope);
      const enabled = payload.enabled;
      if (typeof enabled !== 'boolean')
        throw new Error('enabled must be a boolean');
      return mutatePackage(
        source,
        scope,
        async (_packageManager, _local, target) => {
          setPackageEnabled(target.settingsManager, source, scope, enabled);
        },
      );
    }
    case 'packages:set-resource': {
      const source = expectString(payload.source, 'package source', {
        max: 4096,
      }).trim();
      const scope = expectPackageScope(payload.scope);
      const resourceType = expectResourceType(payload.resourceType);
      const resourcePath = expectPath(payload.path, 'resource path');
      const enabled = payload.enabled;
      if (typeof enabled !== 'boolean')
        throw new Error('enabled must be a boolean');
      return mutatePackage(
        source,
        scope,
        async (_packageManager, _local, target) => {
          await setPackageResourceEnabled(
            target,
            source,
            scope,
            resourceType,
            resourcePath,
            enabled,
          );
        },
      );
    }
    case 'packages:discover':
      return discoverPackages(
        expectString(payload.query, 'search query', {
          min: 0,
          max: 200,
        }),
      );
    case 'model:set': {
      if (!runtime) throw new Error('Open a project first');
      if (!runtime.session.isIdle)
        throw new Error('Stop the current run first');
      const provider = expectProvider(payload.provider);
      const modelId = expectString(payload.id, 'model id', { max: 240 });
      const model = runtime.services.modelRuntime.getModel(provider, modelId);
      if (!model) throw new Error('That model is no longer available');
      await runtime.session.setModel(model);
      return snapshot();
    }
    case 'thinking:set': {
      if (!runtime) throw new Error('Open a project first');
      if (!runtime.session.isIdle)
        throw new Error('Stop the current run first');
      runtime.session.setThinkingLevel(expectThinkingLevel(payload.level));
      return snapshot();
    }
    case 'shutdown': {
      extensionUI.reset();
      unsubscribe?.();
      if (runtime) await runtime.dispose();
      runtime = undefined;
      return null;
    }
    default:
      throw new Error('Unknown utility command');
  }
}

async function startUtility() {
  // Electron's packaged utility process is not Pi's single-executable build.
  // Force the SDK onto its normal filesystem-backed Jiti loader so extension
  // modules can resolve from the packaged node_modules tree.
  Reflect.set(globalThis, 'PI_BUNDLED_NODE', false);
  const [sdk, oauth] = await Promise.all([
    import('@earendil-works/pi-coding-agent'),
    import('@earendil-works/pi-ai/bun-oauth'),
  ]);
  piSdk = sdk;
  // Pi keeps OAuth implementations behind variable imports. Register its
  // official static loaders before accepting requests from the main process.
  oauth.registerBunOAuthFlows();

  parentPort.on('message', (event) => {
    const command = event.data as UtilityCommand;
    void handle(command)
      .then((value) => {
        post({ kind: 'response', id: command.id, ok: true, value });
        return undefined;
      })
      .catch((error: unknown) => {
        post({
          kind: 'response',
          id: command.id,
          ok: false,
          error: errorMessage(error),
        });
        return undefined;
      });
  });
}

void startUtility().catch((error: unknown) => {
  throw new Error(`Could not start the Pi runtime: ${errorMessage(error)}`);
});
