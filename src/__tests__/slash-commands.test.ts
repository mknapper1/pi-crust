import {
  invokesExtensionCommand,
  matchingSlashCommands,
} from '../renderer/slash-commands';

const commands = [
  {
    name: 'deploy',
    description: 'Deploy the app',
    source: 'extension' as const,
    packageSource: 'npm:extension-package',
    scope: 'user' as const,
  },
  {
    name: 'review',
    description: 'Review this change',
    source: 'prompt' as const,
    packageSource: 'npm:prompt-package',
    scope: 'user' as const,
  },
  {
    name: 'skill:security',
    description: 'Security audit',
    source: 'skill' as const,
    packageSource: 'npm:skill-package',
    scope: 'project' as const,
  },
];

it('discovers extension commands, prompts, and skills from a slash draft', () => {
  expect(matchingSlashCommands('/', commands)).toEqual(commands);
  expect(matchingSlashCommands('/sec', commands)).toEqual([commands[2]]);
  expect(matchingSlashCommands('/review extra', commands)).toEqual([]);
});

it('distinguishes extension commands that can run without a model', () => {
  expect(invokesExtensionCommand('/deploy production', commands)).toBe(true);
  expect(invokesExtensionCommand('/review', commands)).toBe(false);
  expect(invokesExtensionCommand('/missing', commands)).toBe(false);
});
