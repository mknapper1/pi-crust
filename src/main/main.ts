import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  shell,
} from 'electron';
import log from 'electron-log';
import type {
  AppPreferences,
  BootstrapState,
  ConversationSummary,
  CredentialStatus,
  DiscoverPackage,
  ExtensionResourceType,
  ExtensionUIResponse,
  PackageInventory,
  PackageMutationResult,
  ProjectInspection,
  ProjectSessionState,
} from '../shared/contracts';
import { ipcChannels } from '../shared/ipc';
import {
  expectBoolean,
  expectExternalUrl,
  expectPath,
  expectProvider,
  expectRecord,
  expectSidebarWidth,
  expectString,
  expectTheme,
  expectThinkingLevel,
} from '../shared/validation';
import { AgentUtilityClient } from './agent-utility-client';
import MenuBuilder from './menu';
import { CredentialVault, PreferencesStore } from './persistence';
import { resolveHtmlPath } from './util';
import { prepareAttachment } from './attachments';
import { expectAttachmentPaths } from '../shared/attachments';
import { expectSidebarLayout } from '../shared/sidebar';

// Keep the original data location after the user-facing rename so existing
// preferences and encrypted credentials remain available.
app.setPath(
  'userData',
  process.env.PI_DESKTOP_USER_DATA_DIR ??
    path.join(app.getPath('appData'), 'Pi Desktop'),
);

app.enableSandbox();
app.setName('Crust');

let mainWindow: BrowserWindow | null = null;
let preferencesStore: PreferencesStore;
let credentialVault: CredentialVault;

const runtime = new AgentUtilityClient((event) => {
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send(ipcChannels.agentEvent, event);
  }
});

if (process.env.NODE_ENV === 'production') {
  process.setSourceMapsEnabled(true);
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  const window = mainWindow;
  if (!window || event.sender.id !== window.webContents.id) {
    throw new Error('IPC sender is not the application window');
  }
  if (event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('IPC is only available to the top-level application frame');
  }
  const senderUrl = new URL(event.senderFrame.url);
  const trusted = app.isPackaged
    ? senderUrl.protocol === 'file:'
    : senderUrl.protocol === 'http:' && senderUrl.hostname === 'localhost';
  if (!trusted) throw new Error('IPC sender origin is not trusted');
}

function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, input: unknown) => unknown,
) {
  ipcMain.handle(channel, async (event, input) => {
    assertTrustedSender(event);
    return listener(event, input);
  });
}

function registerIpcHandlers() {
  handle(ipcChannels.bootstrap, async () => {
    const state: BootstrapState = {
      preferences: await preferencesStore.read(),
      credentials: await credentialVault.status(),
      platform: process.platform,
      appVersion: app.getVersion(),
    };
    return state;
  });

  handle(ipcChannels.chooseProject, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a project',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open project',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return runtime.request<ProjectInspection>({
      type: 'project:inspect',
      payload: { path: result.filePaths[0] },
    });
  });

  handle(ipcChannels.choosePackageFolder, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a local Pi package',
      properties: ['openDirectory'],
      buttonLabel: 'Use package',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle(ipcChannels.inspectProject, (_event, input) =>
    runtime.request<ProjectInspection>({
      type: 'project:inspect',
      payload: { path: expectPath(input) },
    }),
  );

  handle(ipcChannels.listProjectSessions, (_event, input) =>
    runtime.request<ConversationSummary[]>({
      type: 'project:list-sessions',
      payload: { path: expectPath(input) },
    }),
  );

  handle(ipcChannels.openProject, async (_event, input) => {
    const payload = expectRecord(input);
    const projectPath = expectPath(payload.path);
    const inspection = await runtime.request<ProjectInspection>({
      type: 'project:inspect',
      payload: { path: projectPath },
    });
    const trusted =
      payload.trusted === undefined
        ? undefined
        : expectBoolean(payload.trusted, 'trusted');
    const rememberTrust =
      payload.rememberTrust === undefined
        ? undefined
        : expectBoolean(payload.rememberTrust, 'rememberTrust');
    const sessionPath =
      payload.sessionPath === undefined
        ? undefined
        : expectPath(payload.sessionPath, 'sessionPath');
    const state = await runtime.request<ProjectSessionState>({
      type: 'project:open',
      payload: {
        path: projectPath,
        ...(trusted === undefined ? {} : { trusted }),
        ...(rememberTrust === undefined ? {} : { rememberTrust }),
        ...(sessionPath === undefined ? {} : { sessionPath }),
      },
    });
    await preferencesStore.touchProject(projectPath, inspection.name);
    return state;
  });

  handle(ipcChannels.newConversation, () =>
    runtime.request<ProjectSessionState>({
      type: 'session:new',
      payload: {},
    }),
  );

  handle(ipcChannels.openConversation, (_event, input) =>
    runtime.request<ProjectSessionState>({
      type: 'session:open',
      payload: { path: expectPath(input) },
    }),
  );

  handle(ipcChannels.renameConversation, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<ConversationSummary[]>({
      type: 'session:rename',
      payload: {
        path: expectPath(payload.path),
        title: expectString(payload.title, 'title', { max: 120 }),
      },
    });
  });

  handle(ipcChannels.archiveConversation, async (_event, input) => {
    const payload = expectRecord(input);
    const sessionPath = expectPath(payload.path);
    const archived = expectBoolean(payload.archived, 'archived');
    return preferencesStore.update((current) => ({
      ...current,
      archivedSessionPaths: archived
        ? [...new Set([...current.archivedSessionPaths, sessionPath])]
        : current.archivedSessionPaths.filter((value) => value !== sessionPath),
    }));
  });

  handle(ipcChannels.prepareAttachment, (_event, input) =>
    prepareAttachment(input, path.join(app.getPath('userData'), 'attachments')),
  );
  handle(ipcChannels.sendMessage, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<void>({
      type: 'chat:send',
      payload: {
        text: expectString(payload.text, 'message', { min: 0, max: 200_000 }),
        attachmentPaths: expectAttachmentPaths(payload.attachmentPaths),
      },
    });
  });

  handle(ipcChannels.stopRun, () =>
    runtime.request<void>({ type: 'chat:stop', payload: {} }),
  );

  handle(ipcChannels.syncComposer, (_event, input) =>
    runtime.request<void>({
      type: 'composer:sync',
      payload: {
        text: expectString(input, 'composer text', { min: 0, max: 200_000 }),
      },
    }),
  );

  handle(ipcChannels.respondToExtensionUI, (_event, input) => {
    const payload = expectRecord(input);
    const id = expectString(payload.id, 'dialog id', { max: 200 });
    let response: ExtensionUIResponse;
    if (payload.cancelled === true) response = { id, cancelled: true };
    else if (typeof payload.confirmed === 'boolean')
      response = { id, confirmed: payload.confirmed };
    else
      response = {
        id,
        value: expectString(payload.value, 'dialog value', {
          min: 0,
          max: 200_000,
        }),
      };
    return runtime.request<void>({
      type: 'extension-ui:respond',
      payload: response,
    });
  });

  const packageScope = (value: unknown) => {
    if (value !== 'user' && value !== 'project')
      throw new Error('package scope is invalid');
    return value;
  };
  const packageResourceType = (value: unknown): ExtensionResourceType => {
    if (
      value !== 'extensions' &&
      value !== 'skills' &&
      value !== 'prompts' &&
      value !== 'themes'
    )
      throw new Error('resource type is invalid');
    return value;
  };
  const packageSource = (value: unknown) =>
    expectString(value, 'package source', { max: 4096 }).trim();

  handle(ipcChannels.listPackages, () =>
    runtime.request<PackageInventory>({ type: 'packages:list', payload: {} }),
  );

  handle(ipcChannels.installPackage, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<PackageMutationResult>({
      type: 'packages:install',
      payload: {
        source: packageSource(payload.source),
        scope: packageScope(payload.scope),
      },
    });
  });

  handle(ipcChannels.updatePackage, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<PackageMutationResult>({
      type: 'packages:update',
      payload: {
        source: packageSource(payload.source),
        scope: packageScope(payload.scope),
      },
    });
  });

  handle(ipcChannels.removePackage, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<PackageMutationResult>({
      type: 'packages:remove',
      payload: {
        source: packageSource(payload.source),
        scope: packageScope(payload.scope),
      },
    });
  });

  handle(ipcChannels.setPackageEnabled, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<PackageMutationResult>({
      type: 'packages:set-enabled',
      payload: {
        source: packageSource(payload.source),
        scope: packageScope(payload.scope),
        enabled: expectBoolean(payload.enabled, 'enabled'),
      },
    });
  });

  handle(ipcChannels.setPackageResourceEnabled, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<PackageMutationResult>({
      type: 'packages:set-resource',
      payload: {
        source: packageSource(payload.source),
        scope: packageScope(payload.scope),
        resourceType: packageResourceType(payload.resourceType),
        path: expectPath(payload.path, 'resource path'),
        enabled: expectBoolean(payload.enabled, 'enabled'),
      },
    });
  });

  handle(ipcChannels.discoverPackages, (_event, input) =>
    runtime.request<DiscoverPackage[]>({
      type: 'packages:discover',
      payload: {
        query: expectString(input, 'search query', { min: 0, max: 200 }),
      },
    }),
  );

  handle(ipcChannels.setModel, (_event, input) => {
    const payload = expectRecord(input);
    return runtime.request<ProjectSessionState>({
      type: 'model:set',
      payload: {
        provider: expectProvider(payload.provider),
        id: expectString(payload.id, 'model id', { max: 240 }),
      },
    });
  });

  handle(ipcChannels.setThinkingLevel, (_event, input) =>
    runtime.request<ProjectSessionState>({
      type: 'thinking:set',
      payload: { level: expectThinkingLevel(input) },
    }),
  );

  handle(ipcChannels.saveApiKey, async (_event, input) => {
    const payload = expectRecord(input);
    const provider = expectProvider(payload.provider);
    const key = expectString(payload.key, 'API key', { max: 8192 });
    if (!(await credentialVault.isAvailable())) {
      throw new Error(
        'Protected credential storage is unavailable. Crust will not save this key as plaintext.',
      );
    }
    const status = await credentialVault.set(provider, key);
    const entries = await credentialVault.decryptAll();
    runtime.setCredentials(entries);
    await runtime.request({
      type: 'auth:set-runtime',
      payload: { provider, key },
    });
    return status satisfies CredentialStatus;
  });

  handle(ipcChannels.removeApiKey, async (_event, input) => {
    const provider = expectProvider(input);
    const status = await credentialVault.remove(provider);
    const entries = await credentialVault.decryptAll();
    runtime.setCredentials(entries);
    await runtime.request({
      type: 'auth:remove-runtime',
      payload: { provider },
    });
    return status satisfies CredentialStatus;
  });

  handle(ipcChannels.updatePreferences, async (_event, input) => {
    const payload = expectRecord(input);
    return preferencesStore.update((current) => {
      const next: AppPreferences = { ...current };
      if (payload.theme !== undefined) next.theme = expectTheme(payload.theme);
      if (payload.sidebarLayout !== undefined)
        next.sidebarLayout = expectSidebarLayout(payload.sidebarLayout);
      if (payload.sidebarWidth !== undefined) {
        next.sidebarWidth = expectSidebarWidth(payload.sidebarWidth);
      }
      return next;
    });
  });

  handle(ipcChannels.openExternal, async (_event, input) => {
    await shell.openExternal(expectExternalUrl(input));
  });

  handle(ipcChannels.revealPath, async (_event, input) => {
    const error = await shell.openPath(expectPath(input));
    if (error) throw new Error(error);
  });
}

const createWindow = async () => {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets');

  mainWindow = new BrowserWindow({
    show: false,
    width: 1260,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    title: 'Crust',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition:
      process.platform === 'darwin' ? { x: 15, y: 15 } : undefined,
    backgroundColor: '#f5f5f2',
    icon: path.join(resourcesPath, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(expectExternalUrl(url));
    } catch {
      // Invalid external URLs stay blocked.
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  new MenuBuilder(mainWindow).buildMenu();
  await mainWindow.loadURL(resolveHtmlPath('index.html'));
};

function reportWindowError(error: unknown) {
  log.error('Failed to create the application window', error);
  mainWindow?.destroy();
  mainWindow = null;
}

function onActivate() {
  if (mainWindow === null) void createWindow().catch(reportWindowError);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void runtime.stop().catch((error: unknown) => {
    log.error('Failed to stop the Pi runtime cleanly', error);
  });
});

app
  .whenReady()
  .then(async () => {
    preferencesStore = new PreferencesStore(app.getPath('userData'));
    credentialVault = new CredentialVault(app.getPath('userData'));
    runtime.setCredentials(await credentialVault.decryptAll());
    registerIpcHandlers();
    await runtime.start();
    await createWindow();
    app.on('activate', onActivate);
    return undefined;
  })
  .catch((error: unknown) => {
    reportWindowError(error);
    app.quit();
  });
