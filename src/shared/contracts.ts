export type ThemePreference = 'system' | 'light' | 'dark';

export type RunState = 'idle' | 'starting' | 'working' | 'stopping' | 'error';

export type ThinkingLevel =
  'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface AppPreferences {
  theme: ThemePreference;
  sidebarWidth: number;
  recentProjects: RecentProject[];
  archivedSessionPaths: string[];
  sidebarLayout: SidebarLayout;
}

export type SidebarSectionId = 'projects' | 'recent';
export type SidebarPanel = 'projects' | 'chats' | 'archive';
export interface SidebarLayout {
  panel: SidebarPanel;
  hidden: boolean;
  sections: SidebarSectionId[];
  hiddenSections: SidebarSectionId[];
  collapsedSections: SidebarSectionId[];
}

export interface CredentialStatus {
  protectedStorageAvailable: boolean;
  savedProviders: string[];
}

export interface BootstrapState {
  preferences: AppPreferences;
  credentials: CredentialStatus;
  platform: NodeJS.Platform;
  appVersion: string;
}

export interface ProjectTrustState {
  hasProtectedResources: boolean;
  requiresDecision: boolean;
  trusted: boolean | null;
}

export interface ProjectInspection {
  path: string;
  name: string;
  trust: ProjectTrustState;
}

export interface ConversationSummary {
  id: string;
  path: string;
  cwd: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  messageCount: number;
}

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export type ExtensionResourceType =
  'extensions' | 'skills' | 'prompts' | 'themes';

export interface SlashCommandOption {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
  packageSource: string;
  scope: 'user' | 'project' | 'temporary';
}

export interface ExtensionResourceInfo {
  id: string;
  type: ExtensionResourceType;
  name: string;
  path: string;
  enabled: boolean;
}

export type PackageState =
  'loaded' | 'disabled' | 'blocked' | 'failed' | 'awaiting-reload';

export type DesktopCompatibility =
  'desktop-tested' | 'partial' | 'terminal-only' | 'unknown';

export interface InstalledPackage {
  key: string;
  name: string;
  source: string;
  sourceType: 'npm' | 'git' | 'local';
  requestedVersion?: string;
  version?: string;
  ref?: string;
  scope: 'user' | 'project';
  installedPath?: string;
  homepage?: string;
  documentation?: string;
  resources: ExtensionResourceInfo[];
  state: PackageState;
  errors: string[];
  compatibility: DesktopCompatibility;
  filtered: boolean;
}

export interface PackageCapabilities {
  npm: { available: boolean; detail: string };
  git: { available: boolean; detail: string };
}

export interface PackageInventory {
  packages: InstalledPackage[];
  capabilities: PackageCapabilities;
  projectPath?: string;
  projectTrusted: boolean;
}

export interface PackageMutationResult {
  inventory: PackageInventory;
  installedSuccessfully: boolean;
  loadedSuccessfully: boolean;
}

export interface PackageProgress {
  type: 'start' | 'progress' | 'complete' | 'error';
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull' | 'reload';
  source: string;
  message?: string;
}

export interface DiscoverPackage {
  name: string;
  source: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  compatibility: DesktopCompatibility;
}

export type ExtensionUIDialogRequest =
  | {
      id: string;
      method: 'select';
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      id: string;
      method: 'confirm';
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      id: string;
      method: 'input';
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      id: string;
      method: 'editor';
      title: string;
      prefill?: string;
      timeout?: number;
    };

export type ExtensionUIResponse =
  | { id: string; cancelled: true }
  | { id: string; value: string }
  | { id: string; confirmed: boolean };

export interface ChatAttachment {
  path: string;
  name: string;
  preview?: string;
}

export interface MessageTimelineItem {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: { data: string; mimeType: string }[];
  usage?: TokenUsage;
  timestamp: number;
  status?: 'streaming' | 'complete' | 'cancelled' | 'failed';
  error?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface ToolTimelineItem {
  kind: 'tool';
  id: string;
  toolCallId: string;
  name: string;
  input: string;
  output?: string;
  timestamp: number;
  status: 'running' | 'completed' | 'failed';
}

export type TimelineItem = MessageTimelineItem | ToolTimelineItem;

export interface ProjectSessionState {
  project: ProjectInspection;
  conversations: ConversationSummary[];
  activeConversationPath?: string;
  activeConversationId?: string;
  activeConversationTitle?: string;
  timeline: TimelineItem[];
  models: ModelOption[];
  selectedModel?: Pick<ModelOption, 'provider' | 'id'>;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  runState: RunState;
  diagnostics: string[];
  commands: SlashCommandOption[];
}

export type AgentUiEvent =
  | { type: 'run-state'; state: RunState; error?: string }
  | { type: 'message-start'; item: MessageTimelineItem }
  | { type: 'message-delta'; id: string; delta: string }
  | { type: 'message-complete'; item: MessageTimelineItem }
  | { type: 'tool-start'; item: ToolTimelineItem }
  | { type: 'tool-update'; id: string; output: string }
  | { type: 'tool-complete'; item: ToolTimelineItem }
  | { type: 'snapshot'; state: ProjectSessionState }
  | { type: 'extension-ui-request'; request: ExtensionUIDialogRequest }
  | { type: 'extension-ui-dismiss'; id: string }
  | {
      type: 'extension-notification';
      id: string;
      message: string;
      notificationType: 'info' | 'warning' | 'error';
    }
  | {
      type: 'extension-status';
      key: string;
      text?: string;
    }
  | {
      type: 'extension-widget';
      key: string;
      lines?: string[];
      placement: 'aboveEditor' | 'belowEditor';
    }
  | {
      type: 'extension-composer';
      text: string;
      behavior: 'replace' | 'insert';
    }
  | { type: 'extension-title'; title?: string }
  | { type: 'extension-ui-reset' }
  | {
      type: 'extension-error';
      packageSource: string;
      extensionPath: string;
      event: string;
      error: string;
    }
  | { type: 'package-progress'; progress: PackageProgress }
  | { type: 'runtime-crash'; error: string };

export type UtilityCommand =
  | {
      id: string;
      type: 'auth:hydrate';
      payload: { entries: Record<string, string> };
    }
  | {
      id: string;
      type: 'auth:set-runtime';
      payload: { provider: string; key: string };
    }
  | { id: string; type: 'auth:remove-runtime'; payload: { provider: string } }
  | { id: string; type: 'project:inspect'; payload: { path: string } }
  | { id: string; type: 'project:list-sessions'; payload: { path: string } }
  | {
      id: string;
      type: 'project:open';
      payload: {
        path: string;
        trusted?: boolean;
        rememberTrust?: boolean;
        sessionPath?: string;
      };
    }
  | { id: string; type: 'session:new'; payload: Record<string, never> }
  | { id: string; type: 'session:open'; payload: { path: string } }
  | {
      id: string;
      type: 'session:rename';
      payload: { path: string; title: string };
    }
  | {
      id: string;
      type: 'chat:send';
      payload: { text: string; attachmentPaths: string[] };
    }
  | { id: string; type: 'chat:stop'; payload: Record<string, never> }
  | { id: string; type: 'composer:sync'; payload: { text: string } }
  | {
      id: string;
      type: 'extension-ui:respond';
      payload: ExtensionUIResponse;
    }
  | { id: string; type: 'packages:list'; payload: Record<string, never> }
  | {
      id: string;
      type: 'packages:install';
      payload: { source: string; scope: 'user' | 'project' };
    }
  | {
      id: string;
      type: 'packages:update';
      payload: { source: string; scope: 'user' | 'project' };
    }
  | {
      id: string;
      type: 'packages:remove';
      payload: { source: string; scope: 'user' | 'project' };
    }
  | {
      id: string;
      type: 'packages:set-enabled';
      payload: {
        source: string;
        scope: 'user' | 'project';
        enabled: boolean;
      };
    }
  | {
      id: string;
      type: 'packages:set-resource';
      payload: {
        source: string;
        scope: 'user' | 'project';
        resourceType: ExtensionResourceType;
        path: string;
        enabled: boolean;
      };
    }
  | {
      id: string;
      type: 'packages:discover';
      payload: { query: string };
    }
  | {
      id: string;
      type: 'model:set';
      payload: { provider: string; id: string };
    }
  | {
      id: string;
      type: 'thinking:set';
      payload: { level: ThinkingLevel };
    }
  | { id: string; type: 'shutdown'; payload: Record<string, never> };

export type UtilityResponse =
  | { kind: 'response'; id: string; ok: true; value: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }
  | { kind: 'event'; event: AgentUiEvent };

export interface PiDesktopApi {
  bootstrap: () => Promise<BootstrapState>;
  chooseProject: () => Promise<ProjectInspection | null>;
  inspectProject: (path: string) => Promise<ProjectInspection>;
  listProjectSessions: (path: string) => Promise<ConversationSummary[]>;
  openProject: (input: {
    path: string;
    trusted?: boolean;
    rememberTrust?: boolean;
    sessionPath?: string;
  }) => Promise<ProjectSessionState>;
  newConversation: () => Promise<ProjectSessionState>;
  openConversation: (path: string) => Promise<ProjectSessionState>;
  renameConversation: (
    path: string,
    title: string,
  ) => Promise<ConversationSummary[]>;
  archiveConversation: (
    path: string,
    archived: boolean,
  ) => Promise<AppPreferences>;
  prepareAttachment: (file: File) => Promise<ChatAttachment>;
  sendMessage: (text: string, attachmentPaths?: string[]) => Promise<void>;
  stopRun: () => Promise<void>;
  syncComposer: (text: string) => Promise<void>;
  respondToExtensionUI: (response: ExtensionUIResponse) => Promise<void>;
  listPackages: () => Promise<PackageInventory>;
  installPackage: (
    source: string,
    scope: 'user' | 'project',
  ) => Promise<PackageMutationResult>;
  updatePackage: (
    source: string,
    scope: 'user' | 'project',
  ) => Promise<PackageMutationResult>;
  removePackage: (
    source: string,
    scope: 'user' | 'project',
  ) => Promise<PackageMutationResult>;
  setPackageEnabled: (
    source: string,
    scope: 'user' | 'project',
    enabled: boolean,
  ) => Promise<PackageMutationResult>;
  setPackageResourceEnabled: (input: {
    source: string;
    scope: 'user' | 'project';
    resourceType: ExtensionResourceType;
    path: string;
    enabled: boolean;
  }) => Promise<PackageMutationResult>;
  discoverPackages: (query: string) => Promise<DiscoverPackage[]>;
  choosePackageFolder: () => Promise<string | null>;
  revealPath: (path: string) => Promise<void>;
  setModel: (provider: string, id: string) => Promise<ProjectSessionState>;
  setThinkingLevel: (level: ThinkingLevel) => Promise<ProjectSessionState>;
  saveApiKey: (provider: string, key: string) => Promise<CredentialStatus>;
  removeApiKey: (provider: string) => Promise<CredentialStatus>;
  updatePreferences: (
    patch: Partial<
      Pick<AppPreferences, 'theme' | 'sidebarWidth' | 'sidebarLayout'>
    >,
  ) => Promise<AppPreferences>;
  openExternal: (url: string) => Promise<void>;
  onAgentEvent: (listener: (event: AgentUiEvent) => void) => () => void;
}
