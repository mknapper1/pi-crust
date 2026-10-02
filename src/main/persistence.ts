import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { defaultSidebarLayout, readSidebarLayout } from '../shared/sidebar';
import type {
  AppPreferences,
  CredentialStatus,
  RecentProject,
  ThemePreference,
} from '../shared/contracts';

const defaultPreferences: AppPreferences = {
  theme: 'system',
  sidebarWidth: 286,
  recentProjects: [],
  archivedSessionPaths: [],
  sidebarLayout: defaultSidebarLayout,
};

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

function isTheme(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function recentProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      typeof candidate.path !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.lastOpenedAt !== 'string'
    ) {
      return [];
    }
    return [
      {
        path: candidate.path,
        name: candidate.name,
        lastOpenedAt: candidate.lastOpenedAt,
      },
    ];
  });
}

export class PreferencesStore {
  private readonly filePath: string;
  private updateQueue: Promise<unknown> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'preferences.json');
  }

  async read(): Promise<AppPreferences> {
    const value = await readJson(this.filePath);
    if (typeof value !== 'object' || value === null) {
      return structuredClone(defaultPreferences);
    }
    const candidate = value as Partial<AppPreferences>;
    return {
      theme: isTheme(candidate.theme) ? candidate.theme : 'system',
      sidebarLayout: readSidebarLayout(candidate.sidebarLayout),
      sidebarWidth:
        typeof candidate.sidebarWidth === 'number' &&
        Number.isFinite(candidate.sidebarWidth)
          ? Math.min(420, Math.max(220, Math.round(candidate.sidebarWidth)))
          : defaultPreferences.sidebarWidth,
      recentProjects: recentProjects(candidate.recentProjects).slice(0, 12),
      archivedSessionPaths: Array.isArray(candidate.archivedSessionPaths)
        ? candidate.archivedSessionPaths.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    };
  }

  async write(preferences: AppPreferences) {
    await writeJson(this.filePath, preferences);
    return preferences;
  }

  async update(
    update: (current: AppPreferences) => AppPreferences,
  ): Promise<AppPreferences> {
    // Sidebar interactions and project navigation can save simultaneously.
    // Serialize read-modify-write operations to preserve both sets of preferences.
    const operation = this.updateQueue.then(async () =>
      this.write(update(await this.read())),
    );
    this.updateQueue = operation.catch(() => undefined);
    return operation;
  }

  async touchProject(projectPath: string, name: string) {
    return this.update((current) => ({
      ...current,
      recentProjects: [
        { path: projectPath, name, lastOpenedAt: new Date().toISOString() },
        ...current.recentProjects.filter((item) => item.path !== projectPath),
      ].slice(0, 12),
    }));
  }
}

interface EncryptedCredentialFile {
  version: 1;
  entries: Record<string, string>;
}

export class CredentialVault {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'credentials.json');
  }

  async isAvailable() {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    if (
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      return false;
    }
    return true;
  }

  private async readEncrypted(): Promise<EncryptedCredentialFile> {
    const value = await readJson(this.filePath);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('entries' in value) ||
      typeof value.entries !== 'object' ||
      value.entries === null
    ) {
      return { version: 1, entries: {} };
    }
    return {
      version: 1,
      entries: Object.fromEntries(
        Object.entries(value.entries).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };
  }

  async status(): Promise<CredentialStatus> {
    const encrypted = await this.readEncrypted();
    return {
      protectedStorageAvailable: await this.isAvailable(),
      savedProviders: Object.keys(encrypted.entries).sort(),
    };
  }

  async decryptAll() {
    if (!(await this.isAvailable())) return {};
    const file = await this.readEncrypted();
    const entries: Record<string, string> = {};
    let shouldRewrite = false;
    for (const [provider, value] of Object.entries(file.entries)) {
      const decrypted = await safeStorage.decryptStringAsync(
        Buffer.from(value, 'base64'),
      );
      entries[provider] = decrypted.result;
      shouldRewrite ||= decrypted.shouldReEncrypt;
    }
    if (shouldRewrite) await this.writePlainEntries(entries);
    return entries;
  }

  private async writePlainEntries(entries: Record<string, string>) {
    const encryptedEntries: Record<string, string> = {};
    for (const [provider, key] of Object.entries(entries)) {
      const encrypted = await safeStorage.encryptStringAsync(key);
      encryptedEntries[provider] = encrypted.toString('base64');
    }
    await writeJson(this.filePath, { version: 1, entries: encryptedEntries });
  }

  async set(provider: string, key: string) {
    if (!(await this.isAvailable())) {
      throw new Error(
        'Protected credential storage is unavailable. Crust will not save this key as plaintext.',
      );
    }
    const entries = await this.decryptAll();
    entries[provider] = key;
    await this.writePlainEntries(entries);
    return this.status();
  }

  async remove(provider: string) {
    if (!(await this.isAvailable())) {
      throw new Error('Protected credential storage is unavailable');
    }
    const entries = await this.decryptAll();
    delete entries[provider];
    await this.writePlainEntries(entries);
    return this.status();
  }
}
