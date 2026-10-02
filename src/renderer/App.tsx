import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  CaretRight,
  ChartPieSlice,
  ChatCircle,
  DotsThree,
  FolderOpen,
  Gear,
  Key,
  LockKey,
  PaperPlaneRight,
  PencilSimple,
  Plus,
  PuzzlePiece,
  ShieldCheck,
  Stop,
  TerminalWindow,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type {
  AppPreferences,
  BootstrapState,
  ChatAttachment,
  ConversationSummary,
  ProjectInspection,
  ProjectSessionState,
  ThemePreference,
  SidebarLayout,
  SidebarPanel,
} from '../shared/contracts';
import Markdown from './Markdown';
import ModelControls from './ModelControls';
import SidebarSections from './SidebarSections';
import { defaultSidebarLayout } from '../shared/sidebar';
import TurnActivity from './TurnActivity';
import CopySessionButton from './CopySessionButton';
import ExtensionsView from './ExtensionsView';
import {
  ExtensionActivity,
  ExtensionDialogHost,
  ExtensionNotifications,
} from './ExtensionSurfaces';
import {
  applyExtensionSurfaceEvent,
  emptyExtensionSurface,
} from './extension-surface';
import {
  invokesExtensionCommand,
  matchingSlashCommands,
} from './slash-commands';
import { groupPromptTurns } from './turns';
import { applyAgentEvent } from './state';
import './signal.tokens.css';
import './signal.components.css';
import './App.css';

interface TrustRequest {
  inspection: ProjectInspection;
  sessionPath?: string;
}

interface RenameRequest {
  conversation: ConversationSummary;
  title: string;
}

interface ComposerProposal {
  draftKey: string;
  text: string;
}

const providerOptions = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'openrouter', label: 'OpenRouter' },
];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function displayProjectPath(projectPath: string) {
  const parts = projectPath.split('/').filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : projectPath;
}

function isRunActive(state: ProjectSessionState | undefined) {
  return Boolean(
    state && state.runState !== 'idle' && state.runState !== 'error',
  );
}

function ConversationRow({
  conversation,
  active,
  disabled,
  onOpen,
  onRename,
  onArchive,
}: {
  conversation: ConversationSummary;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className={`conversation-row ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className="conversation-select"
        onClick={onOpen}
        disabled={disabled}
        title={conversation.title}
      >
        <ChatCircle size={15} weight={active ? 'fill' : 'regular'} />
        <span>{conversation.title}</span>
      </button>
      <button
        type="button"
        className="icon-button conversation-actions-button"
        aria-label={`Actions for ${conversation.title}`}
        aria-expanded={actionsOpen}
        onClick={() => setActionsOpen((value) => !value)}
        disabled={disabled}
      >
        <DotsThree size={17} weight="bold" />
      </button>
      {actionsOpen && (
        <div className="conversation-menu">
          <button type="button" onClick={onRename}>
            <PencilSimple size={14} /> Rename
          </button>
          <button type="button" onClick={onArchive}>
            <Archive size={14} /> Archive
          </button>
        </div>
      )}
    </div>
  );
}

export function Timeline({
  state,
  onOpenProject,
  onOpenSettings,
}: {
  state: ProjectSessionState | undefined;
  onOpenProject: () => void;
  onOpenSettings: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    followingRef.current = true;
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    if (followingRef.current) scrollToLatest();
  }, [state?.timeline, scrollToLatest]);

  const empty = !state || state.timeline.length === 0;
  const turns = groupPromptTurns(state?.timeline ?? []);
  return (
    <div
      className="timeline"
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        const isFollowing =
          element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        followingRef.current = isFollowing;
        setShowJump(!isFollowing);
      }}
    >
      {empty && (
        <div className="empty-state sg-empty">
          {!state ? (
            <>
              <div className="empty-mark">
                <FolderOpen size={22} />
              </div>
              <h1>Open a project to begin</h1>
              <p>
                Choose a folder. Pi will use it as the working directory for
                tools and project instructions.
              </p>
              <button
                className="primary-button sg-button sg-button--primary"
                type="button"
                onClick={onOpenProject}
              >
                <FolderOpen size={16} /> Open project
              </button>
            </>
          ) : state.models.length === 0 ? (
            <>
              <div className="empty-mark">
                <Key size={22} />
              </div>
              <h1>Configure a provider</h1>
              <p>
                Pi did not find an available model. Use existing Pi credentials
                or add an API key in Settings.
              </p>
              <button
                className="primary-button sg-button sg-button--primary"
                type="button"
                onClick={onOpenSettings}
              >
                <Gear size={16} /> Open settings
              </button>
            </>
          ) : (
            <>
              <div className="empty-mark">
                <TerminalWindow size={22} />
              </div>
              <h1>What should Pi work on?</h1>
              <p>
                Ask about the codebase, request a change, or start with a
                focused investigation.
              </p>
              <div
                className="prompt-suggestions"
                aria-label="Prompt suggestions"
              >
                <span>Explain this project</span>
                <span>Find the main entry points</span>
                <span>Run the test suite</span>
              </div>
            </>
          )}
        </div>
      )}
      {turns.map((turn, turnIndex) => (
        <div className="prompt-turn" key={turn.id}>
          {turn.messages
            .filter((item) => item.text || item.images?.length || item.error)
            .map((item) => (
              <article key={item.id} className={`message message-${item.role}`}>
                <div className="message-label">
                  {item.role === 'user' ? 'You' : 'Pi'}
                  {item.status === 'cancelled' && <span>Stopped</span>}
                  {item.status === 'failed' && <span>Failed</span>}
                </div>
                <Markdown>{item.text || ' '}</Markdown>
                {item.images?.map((image, index) => (
                  <img
                    key={index}
                    className="message-attachment"
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Attachment ${index + 1}`}
                  />
                ))}
                {item.error && (
                  <div className="message-error">{item.error}</div>
                )}
              </article>
            ))}
          <TurnActivity
            turn={turn}
            running={turnIndex === turns.length - 1 && isRunActive(state)}
          />
        </div>
      ))}
      {showJump && (
        <button type="button" className="jump-latest" onClick={scrollToLatest}>
          <ArrowDown size={15} /> Jump to latest
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>();
  const [state, setState] = useState<ProjectSessionState>();
  const [projectSessions, setProjectSessions] = useState<
    Record<string, ConversationSummary[]>
  >({});
  const [view, setView] = useState<'chat' | 'extensions' | 'settings'>('chat');
  const [sidebarSaving, setSidebarSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<
    Record<string, ChatAttachment[]>
  >({});
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const attachmentBusy = useRef(false);
  const [trustRequest, setTrustRequest] = useState<TrustRequest>();
  const [rememberTrust, setRememberTrust] = useState(true);
  const [renameRequest, setRenameRequest] = useState<RenameRequest>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [extensionSurface, setExtensionSurface] = useState(
    emptyExtensionSurface,
  );
  const [composerProposal, setComposerProposal] = useState<ComposerProposal>();
  const [commandIndex, setCommandIndex] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const sidebarWidthRef = useRef(286);
  const rememberTrustRef = useRef(true);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const draftKeyRef = useRef('unbound');
  const draftsRef = useRef(drafts);
  const currentTheme = bootstrap?.preferences.theme;
  const platform = bootstrap?.platform;

  const active = isRunActive(state);
  const draftKey =
    state?.activeConversationPath ||
    (state ? `new:${state.project.path}` : 'unbound');
  const draft = drafts[draftKey] ?? '';
  const draftAttachments = attachments[draftKey] ?? [];
  const draftRunsExtensionCommand = invokesExtensionCommand(
    draft,
    state?.commands ?? [],
  );

  useLayoutEffect(() => {
    draftKeyRef.current = draftKey;
    draftsRef.current = drafts;
  }, [draftKey, drafts]);

  const commandMatches = useMemo(() => {
    return matchingSlashCommands(draft, state?.commands ?? []);
  }, [draft, state?.commands]);
  const selectedCommandIndex = Math.min(
    commandIndex,
    Math.max(0, commandMatches.length - 1),
  );
  const handleExtensionsError = useCallback(
    (extensionsError: unknown) => setError(messageOf(extensionsError)),
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.piDesktop.syncComposer(draft).catch(() => {
        // Runtime crashes are delivered through the event channel with a useful error.
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [draft, draftKey]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return undefined;
    // Attachments increase the pinned composer's height; keep the last message above it.
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--composer-clearance',
        `${Math.max(180, composer.offsetHeight + 24)}px`,
      );
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, [view, state?.project.path]);

  const refreshSessionLists = useCallback(
    async (preferences: AppPreferences) => {
      const entries = await Promise.all(
        preferences.recentProjects.map(
          async (project) =>
            [
              project.path,
              await window.piDesktop
                .listProjectSessions(project.path)
                .catch(() => []),
            ] as const,
        ),
      );
      setProjectSessions(Object.fromEntries(entries));
    },
    [],
  );

  const refreshBootstrap = useCallback(async () => {
    const next = await window.piDesktop.bootstrap();
    setBootstrap(next);
    sidebarWidthRef.current = next.preferences.sidebarWidth;
    document.documentElement.style.setProperty(
      '--sidebar-width',
      `${next.preferences.sidebarWidth}px`,
    );
    await refreshSessionLists(next.preferences);
    return next;
  }, [refreshSessionLists]);

  const openProject = useCallback(
    async (request: TrustRequest, trust?: boolean) => {
      setLoading(true);
      setError(undefined);
      try {
        const next = await window.piDesktop.openProject({
          path: request.inspection.path,
          sessionPath: request.sessionPath,
          ...(trust === undefined
            ? {}
            : {
                trusted: trust,
                rememberTrust: rememberTrustRef.current,
              }),
        });
        setState(next);
        setView('chat');
        setTrustRequest(undefined);
        await refreshBootstrap();
      } catch (openError) {
        setError(messageOf(openError));
      } finally {
        setLoading(false);
      }
    },
    [refreshBootstrap],
  );

  const requestProjectOpen = useCallback(
    async (inspection: ProjectInspection, sessionPath?: string) => {
      if (active) {
        setError('Stop the current run before switching projects');
        return;
      }
      const request = { inspection, sessionPath };
      if (inspection.trust.requiresDecision) {
        setTrustRequest(request);
        return;
      }
      await openProject(request);
    },
    [active, openProject],
  );

  const chooseProject = useCallback(async () => {
    try {
      const inspection = await window.piDesktop.chooseProject();
      if (!inspection) return;
      const conversations = await window.piDesktop.listProjectSessions(
        inspection.path,
      );
      setProjectSessions((current) => ({
        ...current,
        [inspection.path]: conversations,
      }));
      await requestProjectOpen(inspection, conversations[0]?.path);
    } catch (chooseError) {
      setError(messageOf(chooseError));
    }
  }, [requestProjectOpen]);

  useEffect(() => {
    const unsubscribe = window.piDesktop.onAgentEvent((event) => {
      setExtensionSurface((current) =>
        applyExtensionSurfaceEvent(current, event),
      );
      if (event.type === 'extension-composer') {
        const key = draftKeyRef.current;
        const existing = draftsRef.current[key] ?? '';
        if (event.behavior === 'insert' || !existing) {
          setDrafts((current) => ({
            ...current,
            [key]:
              event.behavior === 'insert'
                ? `${current[key] ?? ''}${event.text}`
                : event.text,
          }));
        } else if (existing !== event.text) {
          setComposerProposal({ draftKey: key, text: event.text });
        }
      }
      if (event.type === 'extension-error') {
        setError(
          `${event.packageSource} failed during ${event.event}: ${event.error}`,
        );
      }
      if (event.type === 'extension-title') {
        document.title = event.title || 'Crust';
      }
      setState((current) => {
        const next = applyAgentEvent(current, event);
        if (event.type === 'snapshot') {
          setProjectSessions((projects) => ({
            ...projects,
            [event.state.project.path]: event.state.conversations,
          }));
        }
        if (event.type === 'runtime-crash') setError(event.error);
        return next;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const initial = await refreshBootstrap();
        const recent = initial.preferences.recentProjects[0];
        if (!recent || cancelled) return;
        const conversations = await window.piDesktop.listProjectSessions(
          recent.path,
        );
        if (cancelled) return;
        const inspection = await window.piDesktop.inspectProject(recent.path);
        if (cancelled) return;
        if (inspection.trust.requiresDecision) {
          setTrustRequest({ inspection, sessionPath: conversations[0]?.path });
        } else {
          await openProject({
            inspection,
            sessionPath: conversations[0]?.path,
          });
        }
      } catch (initialError) {
        if (!cancelled) setError(messageOf(initialError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openProject, refreshBootstrap]);

  useEffect(() => {
    if (!currentTheme || !platform) return;
    document.documentElement.dataset.theme = currentTheme;
    document.documentElement.dataset.platform = platform;
  }, [currentTheme, platform]);

  useEffect(() => {
    if (renameRequest) renameInputRef.current?.focus();
  }, [renameRequest]);

  const openConversation = async (conversation: ConversationSummary) => {
    if (active || conversation.path === state?.activeConversationPath) return;
    setLoading(true);
    setError(undefined);
    try {
      if (conversation.cwd !== state?.project.path) {
        const inspection = await window.piDesktop.inspectProject(
          conversation.cwd,
        );
        await requestProjectOpen(inspection, conversation.path);
      } else {
        setState(await window.piDesktop.openConversation(conversation.path));
        setView('chat');
      }
    } catch (conversationError) {
      setError(messageOf(conversationError));
    } finally {
      setLoading(false);
    }
  };

  const newConversation = async () => {
    if (!state) {
      await chooseProject();
      return;
    }
    if (active) return;
    setLoading(true);
    try {
      setState(await window.piDesktop.newConversation());
      setView('chat');
    } catch (newError) {
      setError(messageOf(newError));
    } finally {
      setLoading(false);
    }
  };

  const archiveConversation = async (conversation: ConversationSummary) => {
    try {
      const preferences = await window.piDesktop.archiveConversation(
        conversation.path,
        true,
      );
      setBootstrap((current) =>
        current ? { ...current, preferences } : current,
      );
    } catch (archiveError) {
      setError(messageOf(archiveError));
    }
  };

  const restoreConversation = async (conversation: ConversationSummary) => {
    const preferences = await window.piDesktop.archiveConversation(
      conversation.path,
      false,
    );
    setBootstrap((current) =>
      current ? { ...current, preferences } : current,
    );
  };

  const renameConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameRequest) return;
    try {
      await window.piDesktop.renameConversation(
        renameRequest.conversation.path,
        renameRequest.title,
      );
      setRenameRequest(undefined);
      if (bootstrap) await refreshSessionLists(bootstrap.preferences);
      if (renameRequest.conversation.path === state?.activeConversationPath) {
        setState((current) =>
          current
            ? {
                ...current,
                activeConversationTitle: renameRequest.title.trim(),
              }
            : current,
        );
      }
    } catch (renameError) {
      setError(messageOf(renameError));
    }
  };

  const attachFiles = async (files: File[]) => {
    if (!state || attachmentBusy.current || sending) return;
    if (files.length + draftAttachments.length > 20) {
      setError('Attach up to 20 files per message');
      return;
    }
    attachmentBusy.current = true;
    setAttaching(true);
    try {
      // Keep successful files if another file in the same drop cannot be read.
      for (const file of files) {
        const attachment = await window.piDesktop.prepareAttachment(file);
        setAttachments((current) => ({
          ...current,
          [draftKey]: [...(current[draftKey] ?? []), attachment],
        }));
      }
    } catch (attachmentError) {
      setError(messageOf(attachmentError));
    } finally {
      attachmentBusy.current = false;
      setAttaching(false);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (
      (!text && !draftAttachments.length) ||
      active ||
      attaching ||
      sending ||
      (!state?.selectedModel && !draftRunsExtensionCommand)
    )
      return;
    setSending(true);
    try {
      await window.piDesktop.sendMessage(
        text,
        draftAttachments.map((attachment) => attachment.path),
      );
      setDrafts((current) => ({ ...current, [draftKey]: '' }));
      setAttachments((current) => ({ ...current, [draftKey]: [] }));
    } catch (sendError) {
      setError(messageOf(sendError));
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMatches.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandIndex((selectedCommandIndex + 1) % commandMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandIndex(
          (selectedCommandIndex - 1 + commandMatches.length) %
            commandMatches.length,
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrafts((current) => ({ ...current, [draftKey]: '' }));
        return;
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        const command =
          commandMatches[selectedCommandIndex] ?? commandMatches[0];
        if (command) {
          setDrafts((current) => ({
            ...current,
            [draftKey]: `/${command.name} `,
          }));
        }
        return;
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const resizeSidebar = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.min(
        420,
        Math.max(220, startWidth + moveEvent.clientX - startX),
      );
      sidebarWidthRef.current = width;
      document.documentElement.style.setProperty(
        '--sidebar-width',
        `${width}px`,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void window.piDesktop
        .updatePreferences({ sidebarWidth: sidebarWidthRef.current })
        .then((preferences) =>
          setBootstrap((current) =>
            current ? { ...current, preferences } : current,
          ),
        );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const selectedModel = state?.models.find(
    (model) =>
      model.provider === state.selectedModel?.provider &&
      model.id === state.selectedModel?.id,
  );

  const archivedConversations = useMemo(() => {
    const archived = new Set(bootstrap?.preferences.archivedSessionPaths ?? []);
    return Object.values(projectSessions)
      .flat()
      .filter((conversation) => archived.has(conversation.path));
  }, [bootstrap?.preferences.archivedSessionPaths, projectSessions]);

  const updateTheme = async (theme: ThemePreference) => {
    const preferences = await window.piDesktop.updatePreferences({ theme });
    setBootstrap((current) =>
      current ? { ...current, preferences } : current,
    );
  };

  const saveApiKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey) return;
    try {
      const credentials = await window.piDesktop.saveApiKey(provider, apiKey);
      setApiKey('');
      setBootstrap((current) =>
        current ? { ...current, credentials } : current,
      );
    } catch (keyError) {
      setError(messageOf(keyError));
    }
  };

  const removeApiKey = async (providerId: string) => {
    try {
      const credentials = await window.piDesktop.removeApiKey(providerId);
      setBootstrap((current) =>
        current ? { ...current, credentials } : current,
      );
    } catch (keyError) {
      setError(messageOf(keyError));
    }
  };

  const preferences = bootstrap?.preferences;
  const archived = new Set(preferences?.archivedSessionPaths ?? []);
  const sidebarLayout = preferences?.sidebarLayout ?? defaultSidebarLayout;
  const recentChats = Object.values(projectSessions)
    .flat()
    .filter((conversation) => !archived.has(conversation.path))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 20);
  const updateSidebar = async (layout: SidebarLayout) => {
    if (sidebarSaving) return;
    setSidebarSaving(true);
    try {
      const updated = await window.piDesktop.updatePreferences({
        sidebarLayout: layout,
      });
      setBootstrap((current) =>
        current ? { ...current, preferences: updated } : current,
      );
    } catch (sidebarError) {
      setError(messageOf(sidebarError));
    } finally {
      setSidebarSaving(false);
    }
  };
  const selectSidebarPanel = (panel: SidebarPanel) => {
    const hidden =
      view !== 'settings' && sidebarLayout.panel === panel
        ? !sidebarLayout.hidden
        : false;
    setView('chat');
    void updateSidebar({ ...sidebarLayout, panel, hidden });
  };

  return (
    <div
      className={`app-shell ${sidebarLayout.hidden ? 'is-sidebar-hidden' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = state && !sending ? 'copy' : 'none';
          setDraggingFiles(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDraggingFiles(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDraggingFiles(false);
        void attachFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="titlebar" aria-hidden="true">
        <div className="window-title">Crust</div>
      </div>
      <nav className="activity-bar" aria-label="Sidebar views">
        <div className="activity-bar-views">
          {(
            [
              ['projects', 'Projects', FolderOpen],
              ['chats', 'Chats', ChatCircle],
              ['archive', 'Archive', Archive],
            ] as const
          ).map(([panel, label, Icon]) => (
            <button
              key={panel}
              type="button"
              className="activity-bar-button"
              aria-label={label}
              title={`${label} · Click again to toggle sidebar`}
              aria-pressed={
                view === 'chat' &&
                !sidebarLayout.hidden &&
                sidebarLayout.panel === panel
              }
              disabled={sidebarSaving}
              onClick={() => selectSidebarPanel(panel)}
            >
              <Icon size={21} />
            </button>
          ))}
        </div>
        <div className="activity-bar-tools">
          <button
            type="button"
            className="activity-bar-button"
            aria-label="Extensions"
            title="Extensions"
            aria-pressed={view === 'extensions'}
            onClick={() => setView('extensions')}
          >
            <PuzzlePiece size={21} />
          </button>
          <button
            type="button"
            className="activity-bar-button"
            aria-label="Settings"
            title="Settings"
            aria-pressed={view === 'settings'}
            onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
          >
            <Gear size={21} />
          </button>
        </div>
      </nav>
      <aside className="sidebar" ref={sidebarRef}>
        <div className="sidebar-header">
          <div className="brand-mark" aria-hidden="true">
            <ChartPieSlice size={17} weight="fill" />
          </div>
          <span>Crust</span>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            className="primary-button sg-button sg-button--primary sidebar-primary"
            onClick={() => void newConversation()}
            disabled={active || loading}
          >
            <Plus size={16} weight="bold" /> New chat
          </button>
          <button
            type="button"
            className="secondary-button sg-button sidebar-secondary"
            onClick={() => void chooseProject()}
            disabled={active || loading}
          >
            <FolderOpen size={16} /> Open project
          </button>
        </div>
        {sidebarLayout.panel === 'archive' ? (
          <>
            <div className="sidebar-panel-heading">
              <span>Archive</span>
            </div>
            <div className="sidebar-scroll">
              {archivedConversations.length ? (
                archivedConversations.map((conversation) => (
                  <div className="sidebar-archive-row" key={conversation.path}>
                    <span title={conversation.title}>{conversation.title}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Restore ${conversation.title}`}
                      title="Restore chat"
                      disabled={active || loading}
                      onClick={() => void restoreConversation(conversation)}
                    >
                      <ArrowCounterClockwise size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="sidebar-empty">No archived chats</p>
              )}
            </div>
          </>
        ) : (
          <SidebarSections
            layout={sidebarLayout}
            disabled={sidebarSaving}
            onChange={(layout) => void updateSidebar(layout)}
            content={{
              projects: (
                <>
                  {preferences?.recentProjects.length ? (
                    preferences.recentProjects.map((project) => {
                      const isCurrent = project.path === state?.project.path;
                      const conversations = (
                        projectSessions[project.path] ?? []
                      ).filter(
                        (conversation) => !archived.has(conversation.path),
                      );
                      return (
                        <section className="project-group" key={project.path}>
                          <button
                            type="button"
                            className={`project-button ${isCurrent ? 'is-current' : ''}`}
                            disabled={active || loading}
                            onClick={() => {
                              void window.piDesktop
                                .inspectProject(project.path)
                                .then((inspection) =>
                                  requestProjectOpen(
                                    inspection,
                                    conversations[0]?.path,
                                  ),
                                )
                                .catch((projectError: unknown) =>
                                  setError(messageOf(projectError)),
                                );
                            }}
                          >
                            <CaretRight
                              size={13}
                              className={isCurrent ? 'project-caret-open' : ''}
                            />
                            <span>{project.name}</span>
                          </button>
                          {(isCurrent || conversations.length > 0) && (
                            <div className="conversation-list">
                              {conversations.map((conversation) => (
                                <ConversationRow
                                  key={conversation.path}
                                  conversation={conversation}
                                  active={
                                    conversation.path ===
                                    state?.activeConversationPath
                                  }
                                  disabled={active || loading}
                                  onOpen={() =>
                                    void openConversation(conversation)
                                  }
                                  onRename={() =>
                                    setRenameRequest({
                                      conversation,
                                      title: conversation.title,
                                    })
                                  }
                                  onArchive={() =>
                                    void archiveConversation(conversation)
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })
                  ) : (
                    <p className="sidebar-empty">No recent projects</p>
                  )}
                </>
              ),
              recent: (
                <>
                  {recentChats.length ? (
                    recentChats.map((conversation) => (
                      <ConversationRow
                        key={conversation.path}
                        conversation={conversation}
                        active={
                          conversation.path === state?.activeConversationPath
                        }
                        disabled={active || loading}
                        onOpen={() => void openConversation(conversation)}
                        onRename={() =>
                          setRenameRequest({
                            conversation,
                            title: conversation.title,
                          })
                        }
                        onArchive={() => void archiveConversation(conversation)}
                      />
                    ))
                  ) : (
                    <p className="sidebar-empty">No recent chats</p>
                  )}
                </>
              ),
            }}
          />
        )}
        <div
          className="sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={preferences?.sidebarWidth ?? 286}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
              return;
            event.preventDefault();
            const width =
              event.key === 'Home'
                ? 220
                : event.key === 'End'
                  ? 420
                  : Math.max(
                      220,
                      Math.min(
                        420,
                        sidebarWidthRef.current +
                          (event.key === 'ArrowLeft' ? -10 : 10),
                      ),
                    );
            sidebarWidthRef.current = width;
            document.documentElement.style.setProperty(
              '--sidebar-width',
              `${width}px`,
            );
            void window.piDesktop
              .updatePreferences({ sidebarWidth: width })
              .then((updated) =>
                setBootstrap((current) =>
                  current ? { ...current, preferences: updated } : current,
                ),
              )
              .catch((resizeError: unknown) =>
                setError(messageOf(resizeError)),
              );
          }}
          onPointerDown={resizeSidebar}
        />
      </aside>

      <main className="main-panel">
        {view === 'settings' ? (
          <div className="settings-view">
            <header className="content-header settings-header">
              <div>
                <h1>Settings</h1>
                <p>Local preferences and provider credentials</p>
              </div>
              <button
                className="secondary-button sg-button"
                type="button"
                onClick={() => setView('chat')}
              >
                Done
              </button>
            </header>
            <div className="settings-content">
              <section className="settings-section">
                <h2>Appearance</h2>
                <p>Choose how Crust follows your system.</p>
                <div
                  className="segmented-control sg-segments"
                  aria-label="Theme"
                >
                  {(['system', 'light', 'dark'] as ThemePreference[]).map(
                    (theme) => (
                      <button
                        key={theme}
                        type="button"
                        aria-pressed={preferences?.theme === theme}
                        className={`sg-segment ${
                          preferences?.theme === theme ? 'is-selected' : ''
                        }`}
                        onClick={() => void updateTheme(theme)}
                      >
                        {theme[0].toUpperCase() + theme.slice(1)}
                      </button>
                    ),
                  )}
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <h2>Provider API key</h2>
                    <p>Existing Pi credentials are used automatically.</p>
                  </div>
                  <LockKey size={20} />
                </div>
                {bootstrap?.credentials.protectedStorageAvailable ? (
                  <form className="credential-form" onSubmit={saveApiKey}>
                    <label className="sg-label" htmlFor="provider">
                      Provider
                    </label>
                    <select
                      className="sg-input"
                      id="provider"
                      value={provider}
                      onChange={(event) => setProvider(event.target.value)}
                    >
                      {providerOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <label className="sg-label" htmlFor="api-key">
                      API key
                    </label>
                    <div className="credential-row">
                      <input
                        className="sg-input"
                        id="api-key"
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="Paste a key"
                      />
                      <button
                        className="primary-button sg-button sg-button--primary"
                        type="submit"
                        disabled={!apiKey}
                      >
                        Save key
                      </button>
                    </div>
                    <p className="form-helper">
                      Keys are encrypted with the operating system key store and
                      never sent to the renderer again.
                    </p>
                  </form>
                ) : (
                  <div className="inline-warning sg-alert sg-alert--warning">
                    <WarningCircle size={18} />
                    <span>
                      Protected storage is unavailable. Configure credentials
                      with Pi instead; this app will not store a plaintext key.
                    </span>
                  </div>
                )}
                {bootstrap?.credentials.savedProviders.map((providerId) => (
                  <div className="saved-credential" key={providerId}>
                    <div>
                      <ShieldCheck size={16} />
                      <span>{providerId}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeApiKey(providerId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </section>
              <section className="settings-section">
                <h2>Archived conversations</h2>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  {showArchived
                    ? 'Hide archived'
                    : `Show archived (${archivedConversations.length})`}
                </button>
                {showArchived && (
                  <div className="archived-list">
                    {archivedConversations.length ? (
                      archivedConversations.map((conversation) => (
                        <div key={conversation.path} className="archived-row">
                          <span>{conversation.title}</span>
                          <button
                            type="button"
                            onClick={() =>
                              void restoreConversation(conversation)
                            }
                          >
                            <ArrowCounterClockwise size={14} /> Restore
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="settings-empty">
                        No archived conversations.
                      </p>
                    )}
                  </div>
                )}
              </section>
              <section className="settings-section security-note">
                <h2>Execution boundary</h2>
                <p>
                  Selecting a project sets Pi’s working directory. It is not an
                  operating system sandbox. Tools and extensions run with your
                  user account permissions.
                </p>
              </section>
              <div className="about-line">
                Crust {bootstrap?.appVersion} · Pi SDK 1.0.0
              </div>
            </div>
          </div>
        ) : view === 'extensions' ? (
          <ExtensionsView
            key={`${state?.project.path ?? 'personal'}:${state?.project.trust.trusted === true}`}
            projectPath={state?.project.path}
            projectTrusted={state?.project.trust.trusted === true}
            agentActive={active}
            progress={extensionSurface.packageProgress}
            error={error}
            onDone={() => setView('chat')}
            onError={handleExtensionsError}
            onDismissError={() => setError(undefined)}
          />
        ) : (
          <>
            <header className="content-header chat-header">
              <div className="chat-title">
                <h1>{state?.activeConversationTitle || 'Crust'}</h1>
                <p>
                  {state
                    ? displayProjectPath(state.project.path)
                    : 'No project open'}
                </p>
              </div>
              {state && (
                <div className="session-header-actions">
                  <CopySessionButton
                    key={state.activeConversationId || state.project.path}
                    state={state}
                  />
                  {!active && (
                    <div
                      className={`run-status sg-status status-${state.runState}`}
                    >
                      <span>
                        {state.runState === 'idle' ? 'Ready' : state.runState}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </header>
            {error && (
              <div className="error-banner" role="alert">
                <WarningCircle size={17} />
                <span>{error}</span>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setError(undefined)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <Timeline
              state={state}
              onOpenProject={() => void chooseProject()}
              onOpenSettings={() => setView('settings')}
            />
            <div
              className={`composer-area ${draggingFiles ? 'is-file-drop' : ''}`}
              ref={composerRef}
            >
              <ExtensionActivity
                surface={extensionSurface}
                placement="aboveEditor"
              />
              {composerProposal?.draftKey === draftKey && (
                <div className="composer-proposal" role="status">
                  <PuzzlePiece size={15} />
                  <span>An extension wants to replace your current draft.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafts((current) => ({
                        ...current,
                        [draftKey]: `${current[draftKey] ?? ''}${
                          current[draftKey] ? '\n' : ''
                        }${composerProposal.text}`,
                      }));
                      setComposerProposal(undefined);
                    }}
                  >
                    Append
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafts((current) => ({
                        ...current,
                        [draftKey]: composerProposal.text,
                      }));
                      setComposerProposal(undefined);
                    }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss composer suggestion"
                    onClick={() => setComposerProposal(undefined)}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {(draftAttachments.length > 0 || attaching || draggingFiles) && (
                <div className="composer-attachments" aria-label="Attachments">
                  {draftAttachments.map((attachment, index) => (
                    <div
                      className="attachment-chip"
                      key={`${attachment.path}-${index}`}
                    >
                      {attachment.preview && (
                        <img src={attachment.preview} alt="" />
                      )}
                      <span title={attachment.path}>{attachment.name}</span>
                      <button
                        type="button"
                        disabled={sending}
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() =>
                          setAttachments((current) => ({
                            ...current,
                            [draftKey]: (current[draftKey] ?? []).filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {attaching && <span role="status">Adding files…</span>}
                  {draggingFiles && (
                    <span role="status">Drop files to attach</span>
                  )}
                </div>
              )}
              <div className="composer-meta">
                <span className="project-context">
                  <FolderOpen size={14} />
                  {state?.project.name || 'No project'}
                </span>
                <ModelControls
                  models={state?.models ?? []}
                  selectedModel={selectedModel}
                  thinkingLevel={state?.thinkingLevel ?? 'off'}
                  thinkingLevels={state?.availableThinkingLevels ?? []}
                  disabled={!state || active || sending}
                  onModelChange={async (model) =>
                    setState(
                      await window.piDesktop.setModel(model.provider, model.id),
                    )
                  }
                  onThinkingChange={async (level) =>
                    setState(await window.piDesktop.setThinkingLevel(level))
                  }
                  onError={(controlError) => setError(messageOf(controlError))}
                />
              </div>
              <div className={`composer ${active ? 'is-running' : ''}`}>
                <textarea
                  aria-label="Message Pi"
                  placeholder={
                    state
                      ? 'Ask Pi to work on this project'
                      : 'Open a project to start'
                  }
                  value={draft}
                  disabled={!state || sending}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (!files.length) return;
                    event.preventDefault();
                    void attachFiles(files);
                  }}
                  rows={1}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [draftKey]: event.target.value,
                    }))
                  }
                  onKeyDown={onComposerKeyDown}
                  onInput={(event) => {
                    const target = event.currentTarget;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
                  }}
                />
                {active ? (
                  <button
                    className="stop-button"
                    type="button"
                    onClick={() => void window.piDesktop.stopRun()}
                    aria-label="Stop Pi"
                  >
                    <Stop size={14} weight="fill" />
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={
                      (!draft.trim() && !draftAttachments.length) ||
                      attaching ||
                      sending ||
                      (!state?.selectedModel && !draftRunsExtensionCommand)
                    }
                    aria-label="Send message"
                  >
                    <PaperPlaneRight size={17} weight="fill" />
                  </button>
                )}
              </div>
              {commandMatches.length > 0 && (
                <div
                  className="command-autocomplete"
                  role="listbox"
                  aria-label="Pi commands and prompts"
                >
                  {commandMatches.map((command, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === selectedCommandIndex}
                      key={`${command.source}:${command.name}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        setDrafts((current) => ({
                          ...current,
                          [draftKey]: `/${command.name} `,
                        }))
                      }
                    >
                      <span>
                        <strong>/{command.name}</strong>
                        {command.description && (
                          <small>{command.description}</small>
                        )}
                      </span>
                      <em>{command.source}</em>
                    </button>
                  ))}
                </div>
              )}
              <ExtensionActivity
                surface={extensionSurface}
                placement="belowEditor"
              />
              <div className="composer-hint">
                Enter to send · Shift+Enter for a new line
              </div>
            </div>
          </>
        )}
      </main>

      {loading && <div className="loading-bar" aria-label="Loading" />}

      <ExtensionNotifications
        surface={extensionSurface}
        onDismiss={(id) =>
          setExtensionSurface((current) => ({
            ...current,
            notices: current.notices.filter((notice) => notice.id !== id),
          }))
        }
      />

      <ExtensionDialogHost
        request={extensionSurface.dialogs[0]}
        onRespond={(response) => {
          setExtensionSurface((current) => ({
            ...current,
            dialogs: current.dialogs.filter(
              (dialog) => dialog.id !== response.id,
            ),
          }));
          void window.piDesktop
            .respondToExtensionUI(response)
            .catch((responseError) => setError(messageOf(responseError)));
        }}
      />

      {trustRequest && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal sg-glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trust-title"
          >
            <div className="modal-icon">
              <ShieldCheck size={22} />
            </div>
            <h2 id="trust-title">Trust this project?</h2>
            <p className="modal-path">{trustRequest.inspection.path}</p>
            <p>
              Trusting allows Pi to load project settings, skills, packages, and
              executable extensions. Project instructions can still load without
              trust.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rememberTrust}
                onChange={(event) => {
                  rememberTrustRef.current = event.target.checked;
                  setRememberTrust(event.target.checked);
                }}
              />
              Remember this decision in Pi
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button sg-button"
                onClick={() => void openProject(trustRequest, false)}
              >
                Open without project resources
              </button>
              <button
                type="button"
                className="primary-button sg-button sg-button--primary"
                onClick={() => void openProject(trustRequest, true)}
              >
                Trust and open
              </button>
            </div>
          </div>
        </div>
      )}

      {renameRequest && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal sg-glass rename-modal"
            role="dialog"
            aria-modal="true"
            onSubmit={renameConversation}
          >
            <h2>Rename conversation</h2>
            <label htmlFor="conversation-title">Title</label>
            <input
              ref={renameInputRef}
              id="conversation-title"
              value={renameRequest.title}
              onChange={(event) =>
                setRenameRequest({
                  ...renameRequest,
                  title: event.target.value,
                })
              }
            />
            <div className="modal-actions">
              <button
                className="secondary-button sg-button"
                type="button"
                onClick={() => setRenameRequest(undefined)}
              >
                Cancel
              </button>
              <button
                className="primary-button sg-button sg-button--primary"
                type="submit"
                disabled={!renameRequest.title.trim()}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
