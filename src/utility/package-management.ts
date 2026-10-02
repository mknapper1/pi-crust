import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  PackageSource,
  ProgressEvent,
  ResolvedPaths,
  SettingsManager,
  ResourceLoader,
} from '@earendil-works/pi-coding-agent';
import type {
  AgentUiEvent,
  DiscoverPackage,
  ExtensionResourceInfo,
  ExtensionResourceType,
  InstalledPackage,
  PackageCapabilities,
  PackageInventory,
} from '../shared/contracts';

interface PackageContext {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  resourceLoader?: ResourceLoader;
  projectTrusted: boolean;
}

interface PackageRuntime {
  capabilities: PackageCapabilities;
  npmUsesElectron: boolean;
  gitDirectory?: string;
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  homepage?: unknown;
  repository?: unknown;
  pi?: unknown;
}

const resourceTypes: ExtensionResourceType[] = [
  'extensions',
  'skills',
  'prompts',
  'themes',
];

function executablePath(command: string) {
  if (path.isAbsolute(command))
    return existsSync(command) ? command : undefined;
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
      : [''];
  const search = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    ...(process.platform === 'darwin'
      ? ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
      : []),
  ];
  for (const directory of search.filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep looking through the packaged-app-safe search paths.
      }
    }
  }
  return undefined;
}

function commandVersion(
  command: string,
  args: string[],
  npmUsesElectron: boolean,
) {
  const result = spawnSync(command, [...args, '--version'], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      ...(npmUsesElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  });
  if (result.error) return { error: result.error.message };
  if (result.status !== 0) {
    return {
      error:
        (result.stderr || result.stdout || '').trim() ||
        `command exited with status ${result.status}`,
    };
  }
  return {
    version: (result.stdout || result.stderr || '').trim() || 'available',
  };
}

function preparePackageRuntime(
  settingsManager: SettingsManager,
): PackageRuntime {
  const configured = settingsManager.getNpmCommand();
  let npmCommand: string | undefined;
  let npmArgs: string[] = [];
  let npmUsesElectron = false;

  if (configured?.length) {
    npmCommand = executablePath(configured[0] ?? '');
    npmArgs = configured.slice(1);
  } else {
    const wrapper = process.env.PI_DESKTOP_NPM_WRAPPER;
    const appPath = process.env.PI_DESKTOP_APP_PATH;
    const nodeRuntime = process.env.PI_DESKTOP_NODE_RUNTIME;
    const bundledNpm =
      appPath && path.join(appPath, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (
      wrapper &&
      bundledNpm &&
      nodeRuntime &&
      existsSync(wrapper) &&
      existsSync(bundledNpm) &&
      existsSync(nodeRuntime)
    ) {
      const environmentLauncher =
        process.platform === 'win32' ? undefined : executablePath('env');
      if (environmentLauncher) {
        // Launching a packaged Electron executable directly from one of its
        // utility processes can re-enter the app lifecycle. env applies the
        // run-as-Node flag in a fresh process before Electron starts.
        npmCommand = environmentLauncher;
        npmArgs = ['ELECTRON_RUN_AS_NODE=1', nodeRuntime, wrapper];
      } else {
        npmCommand = nodeRuntime;
        npmArgs = [wrapper];
        npmUsesElectron = true;
      }
    } else {
      npmCommand = executablePath('npm');
    }
    if (npmCommand) {
      // This override is process-local. Terminal Pi keeps the user's persisted
      // npmCommand, while Crust gets an absolute, verified executable.
      settingsManager.applyOverrides({ npmCommand: [npmCommand, ...npmArgs] });
    }
  }

  const npmCheck = npmCommand
    ? commandVersion(npmCommand, npmArgs, npmUsesElectron)
    : undefined;
  const gitPath = executablePath('git');
  const gitCheck = gitPath ? commandVersion(gitPath, [], false) : undefined;

  return {
    npmUsesElectron,
    gitDirectory: gitPath ? path.dirname(gitPath) : undefined,
    capabilities: {
      npm: npmCheck?.version
        ? { available: true, detail: `npm ${npmCheck.version}` }
        : {
            available: false,
            detail: npmCheck?.error
              ? `npm is unavailable: ${npmCheck.error}`
              : 'npm is unavailable to the packaged app. npm and dependency-bearing Git installs are disabled.',
          },
      git: gitCheck?.version
        ? { available: true, detail: gitCheck.version }
        : {
            available: false,
            detail: gitCheck?.error
              ? `Git is unavailable: ${gitCheck.error}`
              : 'Git is unavailable to the packaged app.',
          },
    },
  };
}

export async function withPackageEnvironment<T>(
  runtime: PackageRuntime,
  operation: () => Promise<T>,
) {
  const previousPath = process.env.PATH;
  const previousElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (runtime.gitDirectory) {
    process.env.PATH = [runtime.gitDirectory, previousPath]
      .filter(Boolean)
      .join(path.delimiter);
  }
  if (runtime.npmUsesElectron) process.env.ELECTRON_RUN_AS_NODE = '1';
  try {
    return await operation();
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousElectronRunAsNode === undefined)
      delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previousElectronRunAsNode;
  }
}

let piSdkPromise:
  Promise<typeof import('@earendil-works/pi-coding-agent')> | undefined;

function loadPiSdk() {
  piSdkPromise ??= import('@earendil-works/pi-coding-agent');
  return piSdkPromise;
}

export async function createPackageManager(
  context: PackageContext,
  emit?: (event: AgentUiEvent) => void,
) {
  const { DefaultPackageManager } = await loadPiSdk();
  const packageRuntime = preparePackageRuntime(context.settingsManager);
  const packageManager = new DefaultPackageManager({
    cwd: context.cwd,
    agentDir: context.agentDir,
    settingsManager: context.settingsManager,
  });
  if (emit) {
    packageManager.setProgressCallback((progress: ProgressEvent) => {
      emit({ type: 'package-progress', progress });
    });
  }
  return { packageManager, packageRuntime };
}

function sourceType(source: string): InstalledPackage['sourceType'] {
  if (source.startsWith('npm:')) return 'npm';
  if (
    source.startsWith('git:') ||
    /^https?:\/\//i.test(source) ||
    /^git@/i.test(source)
  )
    return 'git';
  return 'local';
}

function npmParts(source: string) {
  const spec = source.startsWith('npm:') ? source.slice(4) : source;
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  return {
    name: match?.[1] ?? spec,
    requestedVersion: match?.[2],
  };
}

function gitRef(source: string) {
  const withoutPrefix = source.startsWith('git:') ? source.slice(4) : source;
  const separator = withoutPrefix.lastIndexOf('@');
  const slash = Math.max(
    withoutPrefix.lastIndexOf('/'),
    withoutPrefix.lastIndexOf(':'),
  );
  return separator > slash ? withoutPrefix.slice(separator + 1) : undefined;
}

function manifestAt(installedPath?: string): PackageManifest | undefined {
  if (!installedPath) return undefined;
  const manifestPath = path.join(installedPath, 'package.json');
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return undefined;
  }
}

function repositoryUrl(repository: unknown) {
  const value =
    typeof repository === 'string'
      ? repository
      : repository &&
          typeof repository === 'object' &&
          'url' in repository &&
          typeof repository.url === 'string'
        ? repository.url
        : undefined;
  if (!value) return undefined;
  return value
    .replace(/^git\+/, '')
    .replace(/^git:\/\/github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '');
}

function blockedProjectSources(cwd: string): PackageSource[] {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(cwd, '.pi', 'settings.json'), 'utf8'),
    ) as { packages?: unknown };
    return Array.isArray(parsed.packages)
      ? parsed.packages.filter(
          (item): item is PackageSource =>
            typeof item === 'string' ||
            (typeof item === 'object' &&
              item !== null &&
              'source' in item &&
              typeof item.source === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

function resourceName(resourcePath: string, type: ExtensionResourceType) {
  const base = path.basename(resourcePath);
  return type === 'skills' && base === 'SKILL.md'
    ? path.basename(path.dirname(resourcePath))
    : base.replace(/\.(ts|js|md|json)$/i, '');
}

function resourcesForPackage(
  resolved: ResolvedPaths,
  source: string,
  scope: 'user' | 'project',
  installedPath?: string,
) {
  return resourceTypes.flatMap((type) =>
    resolved[type]
      .filter((resource) => {
        if (resource.metadata.origin !== 'package') return false;
        if (resource.metadata.scope !== scope) return false;
        if (resource.metadata.source === source) return true;
        return Boolean(
          installedPath &&
          resource.metadata.packageRoot &&
          path.resolve(resource.metadata.packageRoot) ===
            path.resolve(installedPath),
        );
      })
      .map((resource): ExtensionResourceInfo => ({
        id: `${type}:${resource.path}`,
        type,
        name: resourceName(resource.path, type),
        path: resource.path,
        enabled: resource.enabled,
      })),
  );
}

function loadedResourceKeys(loader?: ResourceLoader) {
  const keys = new Set<string>();
  if (!loader) return keys;
  for (const extension of loader.getExtensions().extensions)
    keys.add(`extensions:${extension.path}`);
  for (const skill of loader.getSkills().skills)
    keys.add(`skills:${skill.filePath}`);
  for (const prompt of loader.getPrompts().prompts)
    keys.add(`prompts:${prompt.filePath}`);
  for (const theme of loader.getThemes().themes) {
    if (theme.sourcePath) keys.add(`themes:${theme.sourcePath}`);
  }
  return keys;
}

function loaderErrors(loader?: ResourceLoader) {
  if (!loader) return [];
  return [
    ...loader
      .getExtensions()
      .errors.map((item) => ({ path: item.path, message: item.error })),
    ...loader.getSkills().diagnostics.map((item) => ({
      path: item.path,
      message: item.message,
    })),
    ...loader.getPrompts().diagnostics.map((item) => ({
      path: item.path,
      message: item.message,
    })),
    ...loader.getThemes().diagnostics.map((item) => ({
      path: item.path,
      message: item.message,
    })),
  ];
}

function pathBelongsToPackage(
  filePath: string | undefined,
  installedPath: string | undefined,
) {
  if (!filePath || !installedPath) return false;
  const relative = path.relative(
    path.resolve(installedPath),
    path.resolve(filePath),
  );
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export async function packageInventory(
  context: PackageContext,
  awaitingReload: ReadonlySet<string> = new Set(),
  runtimeErrors: ReadonlyMap<string, string[]> = new Map(),
): Promise<PackageInventory> {
  const { packageManager, packageRuntime } =
    await createPackageManager(context);
  let resolved: ResolvedPaths = {
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
  try {
    resolved = await packageManager.resolve(async () => 'skip');
  } catch {
    // Per-package missing/install errors below remain more actionable than a
    // second inventory-wide error.
  }

  const configured = packageManager.listConfiguredPackages();
  if (!context.projectTrusted) {
    for (const source of blockedProjectSources(context.cwd)) {
      configured.push({
        source: typeof source === 'string' ? source : source.source,
        scope: 'project',
        filtered: typeof source === 'object',
      });
    }
  }

  const loaded = loadedResourceKeys(context.resourceLoader);
  const diagnostics = loaderErrors(context.resourceLoader);
  const packages = configured.map((configuredPackage): InstalledPackage => {
    const { source, scope, filtered, installedPath } = configuredPackage;
    const manifest = manifestAt(installedPath);
    const npm = sourceType(source) === 'npm' ? npmParts(source) : undefined;
    const resources = resourcesForPackage(
      resolved,
      source,
      scope,
      installedPath,
    );
    const errors = [
      ...diagnostics
        .filter((diagnostic) =>
          pathBelongsToPackage(diagnostic.path, installedPath),
        )
        .map((diagnostic) => diagnostic.message),
      ...(runtimeErrors.get(`${scope}:${source}`) ?? []),
    ];
    if (!installedPath && context.projectTrusted) {
      errors.push('Package is configured but its source is unavailable.');
    } else if (installedPath && resources.length === 0) {
      errors.push('No Pi extensions, skills, prompts, or themes were found.');
    }

    const key = `${scope}:${source}`;
    let state: InstalledPackage['state'];
    if (!context.projectTrusted && scope === 'project') state = 'blocked';
    else if (errors.length) state = 'failed';
    else if (awaitingReload.has(key)) state = 'awaiting-reload';
    else if (!resources.some((resource) => resource.enabled))
      state = 'disabled';
    else if (resources.some((resource) => loaded.has(resource.id)))
      state = 'loaded';
    else state = 'awaiting-reload';

    const homepage =
      typeof manifest?.homepage === 'string' ? manifest.homepage : undefined;
    const repository = repositoryUrl(manifest?.repository);
    return {
      key,
      name:
        typeof manifest?.name === 'string'
          ? manifest.name
          : npm?.name || path.basename(installedPath || source),
      source,
      sourceType: sourceType(source),
      requestedVersion: npm?.requestedVersion,
      version:
        typeof manifest?.version === 'string' ? manifest.version : undefined,
      ref: sourceType(source) === 'git' ? gitRef(source) : undefined,
      scope,
      installedPath,
      homepage: repository ?? homepage,
      documentation: homepage,
      resources,
      state,
      errors,
      compatibility: 'unknown',
      filtered,
    };
  });

  return {
    packages,
    capabilities: packageRuntime.capabilities,
    projectPath: context.resourceLoader ? context.cwd : undefined,
    projectTrusted: context.projectTrusted,
  };
}

function updatePackageSetting(
  settingsManager: SettingsManager,
  source: string,
  scope: 'user' | 'project',
  update: (item: Exclude<PackageSource, string>) => PackageSource,
) {
  const current =
    scope === 'project'
      ? (settingsManager.getProjectSettings().packages ?? [])
      : (settingsManager.getGlobalSettings().packages ?? []);
  const next = current.map((item) => {
    const itemSource = typeof item === 'string' ? item : item.source;
    return itemSource === source
      ? update(typeof item === 'string' ? { source: item } : { ...item })
      : item;
  });
  if (scope === 'project') settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
}

export function removePackageSetting(
  settingsManager: SettingsManager,
  source: string,
  scope: 'user' | 'project',
) {
  const current =
    scope === 'project'
      ? (settingsManager.getProjectSettings().packages ?? [])
      : (settingsManager.getGlobalSettings().packages ?? []);
  const next = current.filter(
    (item) => (typeof item === 'string' ? item : item.source) !== source,
  );
  if (next.length === current.length) return false;
  if (scope === 'project') settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
  return true;
}

export function setPackageEnabled(
  settingsManager: SettingsManager,
  source: string,
  scope: 'user' | 'project',
  enabled: boolean,
) {
  updatePackageSetting(settingsManager, source, scope, (item) => {
    const next = { ...item };
    for (const type of resourceTypes) {
      const entries = next[type] ?? [];
      const withoutDisableAll = entries.filter((entry) => entry !== '!**');
      next[type] = enabled ? withoutDisableAll : [...withoutDisableAll, '!**'];
      if (enabled && next[type]?.length === 0) delete next[type];
    }
    const hasFilters = resourceTypes.some((type) => next[type] !== undefined);
    return hasFilters || next.autoload === false ? next : next.source;
  });
}

export async function setPackageResourceEnabled(
  context: PackageContext,
  source: string,
  scope: 'user' | 'project',
  resourceType: ExtensionResourceType,
  resourcePath: string,
  enabled: boolean,
) {
  const { packageManager } = await createPackageManager(context);
  const resolved = await packageManager.resolve(async () => 'skip');
  const configured = packageManager
    .listConfiguredPackages()
    .find((item) => item.source === source && item.scope === scope);
  const resource = resolved[resourceType].find(
    (item) =>
      item.path === resourcePath &&
      item.metadata.scope === scope &&
      item.metadata.origin === 'package' &&
      (item.metadata.source === source ||
        pathBelongsToPackage(item.path, configured?.installedPath)),
  );
  if (!resource)
    throw new Error('That package resource is no longer available');
  const baseDir = resource.metadata.baseDir;
  if (!baseDir)
    throw new Error('Pi did not report a package root for this resource');
  const pattern = path
    .relative(baseDir, resource.path)
    .split(path.sep)
    .join('/');
  updatePackageSetting(context.settingsManager, source, scope, (item) => {
    const entries = item[resourceType] ?? [];
    const updated = entries.filter((entry) => {
      const target = /^[!+-]/.test(entry) ? entry.slice(1) : entry;
      return target !== pattern;
    });
    updated.push(`${enabled ? '+' : '-'}${pattern}`);
    return { ...item, [resourceType]: updated };
  });
}

export async function discoverPackages(
  query: string,
): Promise<DiscoverPackage[]> {
  const search = ['keywords:pi-package', query.trim()]
    .filter(Boolean)
    .join(' ');
  const url = new URL('https://registry.npmjs.org/-/v1/search');
  url.searchParams.set('text', search);
  url.searchParams.set('size', '40');
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Package discovery failed with HTTP ${response.status}`);
  const body = (await response.json()) as {
    objects?: Array<{
      package?: {
        name?: unknown;
        version?: unknown;
        description?: unknown;
        links?: {
          homepage?: unknown;
          repository?: unknown;
          npm?: unknown;
        };
      };
    }>;
  };
  return (body.objects ?? []).flatMap((entry) => {
    const item = entry.package;
    if (typeof item?.name !== 'string' || typeof item.version !== 'string')
      return [];
    return [
      {
        name: item.name,
        source: `npm:${item.name}@${item.version}`,
        version: item.version,
        description:
          typeof item.description === 'string'
            ? item.description
            : 'No description provided.',
        homepage:
          typeof item.links?.homepage === 'string'
            ? item.links.homepage
            : typeof item.links?.npm === 'string'
              ? item.links.npm
              : undefined,
        repository:
          typeof item.links?.repository === 'string'
            ? item.links.repository
            : undefined,
        compatibility: 'unknown' as const,
      },
    ];
  });
}
