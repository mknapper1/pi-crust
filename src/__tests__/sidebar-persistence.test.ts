/** @jest-environment node */
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PreferencesStore } from '../main/persistence';
import { defaultSidebarLayout } from '../shared/sidebar';

jest.mock('electron', () => ({ safeStorage: {} }));

it('saves sidebar preferences across reloads without losing concurrent project updates', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-sidebar-test-'));
  try {
    const store = new PreferencesStore(directory);
    const layout = {
      ...defaultSidebarLayout,
      hidden: true,
      sections: ['recent', 'projects'] as ('recent' | 'projects')[],
    };
    await Promise.all([
      store.update((current) => ({ ...current, sidebarLayout: layout })),
      store.touchProject('/tmp/project', 'project'),
    ]);
    const loaded = await new PreferencesStore(directory).read();
    expect(loaded.sidebarLayout).toEqual(layout);
    expect(loaded.recentProjects[0].path).toBe('/tmp/project');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
