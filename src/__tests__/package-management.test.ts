import {
  removePackageSetting,
  setPackageEnabled,
} from '../utility/package-management';

jest.mock('@earendil-works/pi-coding-agent', () => ({}), { virtual: true });

function settingsWith(packages: unknown[]) {
  let current = packages;
  return {
    getGlobalSettings: () => ({ packages: current }),
    getProjectSettings: () => ({}),
    setPackages: (next: unknown[]) => {
      current = next;
    },
    read: () => current,
  };
}

describe('package resource settings', () => {
  it('removes only the exact persisted source in the selected scope', () => {
    let globalPackages: unknown[] = [
      '../../demo-package',
      { source: '../../other-package', extensions: ['-experimental.ts'] },
    ];
    let projectPackages: unknown[] = ['../../demo-package'];
    const settings = {
      getGlobalSettings: () => ({ packages: globalPackages }),
      getProjectSettings: () => ({ packages: projectPackages }),
      setPackages: (next: unknown[]) => {
        globalPackages = next;
      },
      setProjectPackages: (next: unknown[]) => {
        projectPackages = next;
      },
    };

    expect(
      removePackageSetting(
        settings as unknown as Parameters<typeof removePackageSetting>[0],
        '../../demo-package',
        'project',
      ),
    ).toBe(true);
    expect(globalPackages).toEqual([
      '../../demo-package',
      { source: '../../other-package', extensions: ['-experimental.ts'] },
    ]);
    expect(projectPackages).toEqual([]);
    expect(
      removePackageSetting(
        settings as unknown as Parameters<typeof removePackageSetting>[0],
        '/absolute/path/that-was-not-persisted',
        'project',
      ),
    ).toBe(false);
  });

  it('disables every resource without discarding existing filters', () => {
    const settings = settingsWith([
      {
        source: 'npm:example-pi-package',
        extensions: ['-experimental.ts'],
        skills: ['+review/SKILL.md'],
      },
    ]);

    setPackageEnabled(
      settings as unknown as Parameters<typeof setPackageEnabled>[0],
      'npm:example-pi-package',
      'user',
      false,
    );

    expect(settings.read()).toEqual([
      expect.objectContaining({
        source: 'npm:example-pi-package',
        extensions: ['-experimental.ts', '!**'],
        skills: ['+review/SKILL.md', '!**'],
        prompts: ['!**'],
        themes: ['!**'],
      }),
    ]);
  });

  it('reenables a package without erasing its resource overrides', () => {
    const settings = settingsWith([
      {
        source: 'npm:example-pi-package',
        extensions: ['-experimental.ts', '!**'],
        skills: ['+review/SKILL.md', '!**'],
        prompts: ['!**'],
        themes: ['!**'],
      },
    ]);

    setPackageEnabled(
      settings as unknown as Parameters<typeof setPackageEnabled>[0],
      'npm:example-pi-package',
      'user',
      true,
    );

    expect(settings.read()).toEqual([
      {
        source: 'npm:example-pi-package',
        extensions: ['-experimental.ts'],
        skills: ['+review/SKILL.md'],
      },
    ]);
  });
});
