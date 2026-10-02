import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowClockwise,
  ArrowSquareOut,
  Check,
  FolderOpen,
  MagnifyingGlass,
  Package,
  Plus,
  SpinnerGap,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import type {
  DiscoverPackage,
  InstalledPackage,
  PackageInventory,
  PackageProgress,
} from '../shared/contracts';

const stateLabels: Record<InstalledPackage['state'], string> = {
  loaded: 'Loaded',
  disabled: 'Disabled',
  blocked: 'Blocked by trust',
  failed: 'Failed',
  'awaiting-reload': 'Awaiting reload',
};

const compatibilityLabels = {
  'desktop-tested': 'Crust tested',
  partial: 'Partial',
  'terminal-only': 'Terminal-only',
  unknown: 'Unknown',
} as const;

interface InstallRequest {
  source: string;
  scope: 'user' | 'project';
}

interface RemoveRequest {
  package: InstalledPackage;
}

function requestedVersionOrRef(source: string) {
  if (source.startsWith('npm:')) {
    const spec = source.slice(4);
    const separator = spec.startsWith('@')
      ? spec.indexOf('@', spec.indexOf('/') + 1)
      : spec.lastIndexOf('@');
    return separator > 0 ? spec.slice(separator + 1) : 'Source default';
  }
  if (/^(git:|https?:\/\/|git@)/i.test(source)) {
    const withoutPrefix = source.startsWith('git:') ? source.slice(4) : source;
    const separator = withoutPrefix.lastIndexOf('@');
    const lastPathSeparator = Math.max(
      withoutPrefix.lastIndexOf('/'),
      withoutPrefix.lastIndexOf(':'),
    );
    return separator > lastPathSeparator
      ? withoutPrefix.slice(separator + 1)
      : 'Repository default';
  }
  return 'Local folder';
}

export default function ExtensionsView({
  projectPath,
  projectTrusted,
  agentActive,
  progress,
  error: displayedError,
  onDone,
  onError,
  onDismissError,
}: {
  projectPath?: string;
  projectTrusted: boolean;
  agentActive: boolean;
  progress?: PackageProgress;
  error?: string;
  onDone: () => void;
  onError: (error: unknown) => void;
  onDismissError: () => void;
}) {
  const [tab, setTab] = useState<'installed' | 'discover'>('installed');
  const [inventory, setInventory] = useState<PackageInventory>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [installRequest, setInstallRequest] = useState<InstallRequest>();
  const [removeRequest, setRemoveRequest] = useState<RemoveRequest>();
  const [notice, setNotice] = useState<string>();
  const [query, setQuery] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverResults, setDiscoverResults] = useState<DiscoverPackage[]>([]);

  useEffect(() => {
    let cancelled = false;
    void window.piDesktop
      .listPackages()
      .then((nextInventory) => {
        if (!cancelled) setInventory(nextInventory);
        return nextInventory;
      })
      .catch((loadError) => {
        if (!cancelled) onError(loadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, projectTrusted, onError]);

  const run = async (
    operation: () => ReturnType<typeof window.piDesktop.installPackage>,
    success: string,
  ) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await operation();
      setInventory(result.inventory);
      setNotice(
        result.loadedSuccessfully
          ? success
          : `${success} Pi saved the change, but it has not loaded yet.`,
      );
    } catch (operationError) {
      onError(operationError);
    } finally {
      setBusy(false);
    }
  };

  const requestInstall = (requestedSource = source) => {
    const trimmed = requestedSource.trim();
    if (!trimmed) return;
    setInstallRequest({ source: trimmed, scope });
  };

  const install = async () => {
    if (!installRequest) return;
    const request = installRequest;
    setInstallRequest(undefined);
    await run(
      () => window.piDesktop.installPackage(request.source, request.scope),
      `Installed ${request.source}.`,
    );
    setSource('');
  };

  const discover = async (event: FormEvent) => {
    event.preventDefault();
    setDiscovering(true);
    try {
      setDiscoverResults(await window.piDesktop.discoverPackages(query));
    } catch (discoveryError) {
      onError(discoveryError);
    } finally {
      setDiscovering(false);
    }
  };

  const actionsDisabled = busy || agentActive;
  const projectScopeAvailable = Boolean(projectPath && projectTrusted);
  const installed = useMemo(
    () =>
      [...(inventory?.packages ?? [])].sort((left, right) =>
        `${left.scope}:${left.name}`.localeCompare(
          `${right.scope}:${right.name}`,
        ),
      ),
    [inventory],
  );

  return (
    <div className="extensions-view">
      <header className="content-header extensions-header">
        <div>
          <h1>Extensions</h1>
          <p>Pi packages shared with Crust and terminal Pi</p>
        </div>
        <button
          className="secondary-button sg-button"
          type="button"
          onClick={onDone}
        >
          Done
        </button>
      </header>
      <div className="extensions-content">
        {displayedError && (
          <div className="error-banner" role="alert">
            <Warning size={17} />
            <span>{displayedError}</span>
            <button type="button" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        )}
        <div className="extensions-toolbar">
          <div
            className="segmented-control sg-segments"
            aria-label="Extension view"
          >
            {(['installed', 'discover'] as const).map((value) => (
              <button
                className={`sg-segment ${tab === value ? 'is-selected' : ''}`}
                aria-pressed={tab === value}
                type="button"
                key={value}
                onClick={() => setTab(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          {loading && <SpinnerGap className="spin" size={17} />}
        </div>

        {agentActive && (
          <div className="inline-warning sg-alert sg-alert--warning">
            <Warning size={18} />
            <span>
              Package changes are available when the current task finishes.
            </span>
          </div>
        )}
        {progress && progress.type !== 'complete' && (
          <div
            className={`package-progress progress-${progress.type}`}
            role="status"
          >
            {progress.type !== 'error' && (
              <SpinnerGap className="spin" size={15} />
            )}
            <span>
              {progress.message || `${progress.action} ${progress.source}`}
            </span>
          </div>
        )}
        {notice && (
          <div className="package-success" role="status">
            <Check size={15} /> {notice}
          </div>
        )}

        {tab === 'installed' ? (
          <>
            <section className="install-panel sg-panel">
              <div>
                <h2>Install from source</h2>
                <p>Use an npm spec, Git URL, or local package folder.</p>
              </div>
              <div className="install-row">
                <input
                  className="sg-input"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="npm:@scope/package@1.2.3 or https://github.com/…"
                  disabled={actionsDisabled}
                />
                <button
                  className="secondary-button sg-button"
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() =>
                    void window.piDesktop
                      .choosePackageFolder()
                      .then((folder) => {
                        if (folder) setSource(folder);
                        return folder;
                      })
                  }
                >
                  <FolderOpen size={15} /> Folder
                </button>
                <button
                  className="primary-button sg-button sg-button--primary"
                  type="button"
                  disabled={actionsDisabled || !source.trim()}
                  onClick={() => requestInstall()}
                >
                  <Plus size={15} /> Install
                </button>
              </div>
              <div className="install-options">
                <label>
                  <input
                    type="radio"
                    checked={scope === 'user'}
                    onChange={() => setScope('user')}
                  />
                  Personal
                </label>
                <label
                  title={
                    !projectScopeAvailable
                      ? 'Open and trust a project first'
                      : undefined
                  }
                >
                  <input
                    type="radio"
                    checked={scope === 'project'}
                    disabled={!projectScopeAvailable}
                    onChange={() => setScope('project')}
                  />
                  Project
                </label>
              </div>
              {inventory && (
                <div className="package-capabilities">
                  <span
                    className={
                      inventory.capabilities.npm.available
                        ? 'available'
                        : 'missing'
                    }
                  >
                    npm: {inventory.capabilities.npm.detail}
                  </span>
                  <span
                    className={
                      inventory.capabilities.git.available
                        ? 'available'
                        : 'missing'
                    }
                  >
                    Git: {inventory.capabilities.git.detail}
                  </span>
                </div>
              )}
            </section>

            <div className="package-list">
              {installed.length ? (
                installed.map((item) => (
                  <article className="package-card sg-panel" key={item.key}>
                    <div className="package-card-header">
                      <div className="package-icon">
                        <Package size={19} />
                      </div>
                      <div className="package-title">
                        <h2>{item.name}</h2>
                        <p title={item.source}>{item.source}</p>
                      </div>
                      <span className={`package-state state-${item.state}`}>
                        {stateLabels[item.state]}
                      </span>
                    </div>
                    <div className="package-meta">
                      <span>
                        {item.scope === 'user' ? 'Personal' : 'Project'}
                      </span>
                      {(item.version || item.requestedVersion || item.ref) && (
                        <span>
                          {item.version || item.requestedVersion || item.ref}
                        </span>
                      )}
                      <span
                        className={`compatibility compatibility-${item.compatibility}`}
                      >
                        {compatibilityLabels[item.compatibility]}
                      </span>
                    </div>
                    {item.errors.map((message) => (
                      <div className="package-error" key={message}>
                        <Warning size={14} /> {message}
                      </div>
                    ))}
                    <details className="package-resources">
                      <summary>
                        Configure resources <span>{item.resources.length}</span>
                      </summary>
                      {item.resources.length ? (
                        <div className="resource-list">
                          {item.resources.map((resource) => (
                            <label key={resource.id}>
                              <input
                                aria-label={`${resource.name} ${resource.type}`}
                                type="checkbox"
                                checked={resource.enabled}
                                disabled={
                                  actionsDisabled || item.state === 'blocked'
                                }
                                onChange={(event) =>
                                  void run(
                                    () =>
                                      window.piDesktop.setPackageResourceEnabled(
                                        {
                                          source: item.source,
                                          scope: item.scope,
                                          resourceType: resource.type,
                                          path: resource.path,
                                          enabled: event.target.checked,
                                        },
                                      ),
                                    `Updated ${resource.name}.`,
                                  )
                                }
                              />
                              <span>
                                <strong>{resource.name}</strong>
                                <small>{resource.type}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="package-empty">No resources available.</p>
                      )}
                    </details>
                    <div className="package-actions">
                      {item.installedPath && (
                        <button
                          type="button"
                          onClick={() =>
                            void window.piDesktop.revealPath(
                              item.installedPath!,
                            )
                          }
                        >
                          <FolderOpen size={14} /> Source
                        </button>
                      )}
                      {item.documentation && (
                        <button
                          type="button"
                          onClick={() =>
                            void window.piDesktop.openExternal(
                              item.documentation!,
                            )
                          }
                        >
                          <ArrowSquareOut size={14} /> Docs
                        </button>
                      )}
                      {item.sourceType !== 'local' && (
                        <button
                          type="button"
                          disabled={actionsDisabled || item.state === 'blocked'}
                          onClick={() =>
                            void run(
                              () =>
                                window.piDesktop.updatePackage(
                                  item.source,
                                  item.scope,
                                ),
                              `Updated ${item.name}.`,
                            )
                          }
                        >
                          <ArrowClockwise size={14} /> Update
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={actionsDisabled || item.state === 'blocked'}
                        onClick={() =>
                          void run(
                            () =>
                              window.piDesktop.setPackageEnabled(
                                item.source,
                                item.scope,
                                item.state === 'disabled',
                              ),
                            `${item.state === 'disabled' ? 'Enabled' : 'Disabled'} ${item.name}.`,
                          )
                        }
                      >
                        {item.state === 'disabled'
                          ? 'Enable all'
                          : 'Disable all'}
                      </button>
                      <button
                        className="danger-action"
                        type="button"
                        disabled={actionsDisabled || item.state === 'blocked'}
                        onClick={() => setRemoveRequest({ package: item })}
                      >
                        <Trash size={14} /> Remove
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="extensions-empty">
                  <Package size={24} />
                  <h2>No packages configured</h2>
                  <p>Packages installed by Crust or terminal Pi appear here.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <section className="discover-panel">
            <div className="discover-intro">
              <div>
                <h2>Discover Pi packages</h2>
                <p>
                  Search npm packages tagged <code>pi-package</code>.
                  Compatibility is separate from security and endorsement.
                </p>
              </div>
              <button
                type="button"
                className="secondary-button sg-button"
                onClick={() =>
                  void window.piDesktop.openExternal('https://pi.dev/packages')
                }
              >
                <ArrowSquareOut size={15} /> Pi gallery
              </button>
            </div>
            <form className="discover-search" onSubmit={discover}>
              <MagnifyingGlass size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search packages"
              />
              <button
                className="primary-button sg-button sg-button--primary"
                disabled={discovering}
                type="submit"
              >
                {discovering ? (
                  <SpinnerGap className="spin" size={15} />
                ) : (
                  'Search'
                )}
              </button>
            </form>
            <p className="compatibility-note">
              No supported Crust compatibility metadata feed is configured.
              Results are labeled Unknown.
            </p>
            <div className="discover-results">
              {discoverResults.map((item) => (
                <article className="discover-card sg-panel" key={item.source}>
                  <div>
                    <h3>{item.name}</h3>
                    <span>{item.version}</span>
                  </div>
                  <p>{item.description}</p>
                  <div className="discover-actions">
                    <span className="compatibility compatibility-unknown">
                      Unknown
                    </span>
                    {(item.homepage || item.repository) && (
                      <button
                        type="button"
                        onClick={() =>
                          void window.piDesktop.openExternal(
                            (item.homepage || item.repository)!,
                          )
                        }
                      >
                        <ArrowSquareOut size={14} /> Source
                      </button>
                    )}
                    <button
                      type="button"
                      className="primary-button sg-button sg-button--primary"
                      disabled={actionsDisabled}
                      onClick={() => requestInstall(item.source)}
                    >
                      Install
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {installRequest && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal sg-glass package-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-package-title"
          >
            <div className="modal-icon">
              <Warning size={22} />
            </div>
            <h2 id="install-package-title">Install executable package?</h2>
            <p className="modal-path">{installRequest.source}</p>
            <p>
              Pi extensions execute code with your user privileges. Review the
              source before installing.
            </p>
            <dl>
              <div>
                <dt>Scope</dt>
                <dd>
                  {installRequest.scope === 'user' ? 'Personal' : 'Project'}
                </dd>
              </div>
              <div>
                <dt>Version/ref</dt>
                <dd>{requestedVersionOrRef(installRequest.source)}</dd>
              </div>
            </dl>
            {installRequest.scope === 'user' && (
              <p className="package-scope-warning">
                This also affects terminal Pi.
              </p>
            )}
            <div className="modal-actions">
              <button
                className="secondary-button sg-button"
                type="button"
                onClick={() => setInstallRequest(undefined)}
              >
                Cancel
              </button>
              <button
                className="primary-button sg-button sg-button--primary"
                type="button"
                onClick={() => void install()}
              >
                Install package
              </button>
            </div>
          </div>
        </div>
      )}

      {removeRequest && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal sg-glass package-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-package-title"
          >
            <h2 id="remove-package-title">
              Remove {removeRequest.package.name}?
            </h2>
            <p>
              Pi will remove the{' '}
              {removeRequest.package.scope === 'user' ? 'personal' : 'project'}{' '}
              package declaration and its managed install. Local source folders
              are not deleted.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button sg-button"
                type="button"
                onClick={() => setRemoveRequest(undefined)}
              >
                Cancel
              </button>
              <button
                className="primary-button sg-button sg-button--primary"
                type="button"
                onClick={() => {
                  const item = removeRequest.package;
                  setRemoveRequest(undefined);
                  void run(
                    () =>
                      window.piDesktop.removePackage(item.source, item.scope),
                    `Removed ${item.name}.`,
                  );
                }}
              >
                Remove package
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
