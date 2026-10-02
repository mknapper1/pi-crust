import type { SlashCommandOption } from '../shared/contracts';

export function matchingSlashCommands(
  draft: string,
  commands: SlashCommandOption[],
  limit = 9,
) {
  const match = draft.match(/^\/([^\s]*)$/);
  if (!match) return [];
  const query = (match[1] ?? '').toLowerCase();
  return commands
    .filter(
      (command) =>
        command.name.toLowerCase().includes(query) ||
        command.description?.toLowerCase().includes(query),
    )
    .slice(0, limit);
}

export function invokesExtensionCommand(
  text: string,
  commands: SlashCommandOption[],
) {
  const name = text.trim().match(/^\/([^\s]+)/)?.[1];
  return Boolean(
    name &&
    commands.some(
      (command) => command.source === 'extension' && command.name === name,
    ),
  );
}
