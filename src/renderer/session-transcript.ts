import type { ProjectSessionState } from '../shared/contracts';

function fenced(text: string) {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

export function sessionTranscript(state: ProjectSessionState): string {
  const parts = [
    `# ${state.activeConversationTitle || 'Pi session'}`,
    `Project: ${state.project.path}`,
    `Session state: ${state.runState}`,
    'Transcript of the current session, including tool activity. Tool data retains any display truncation/redaction; image attachments are listed, not embedded. Review sensitive details before sharing.',
  ];
  for (const item of state.timeline) {
    if (item.kind === 'tool') {
      parts.push(
        `## Tool: ${item.name} (${item.status})`,
        `Input:\n${fenced(item.input)}`,
      );
      if (item.output !== undefined)
        parts.push(`Output:\n${fenced(item.output)}`);
    } else {
      if (!item.text && !item.error && !item.images?.length) continue;
      parts.push(
        `## ${item.role === 'user' ? 'You' : 'Pi'}${item.status && item.status !== 'complete' ? ` (${item.status})` : ''}`,
      );
      if (item.text) parts.push(item.text);
      if (item.error) parts.push(`Error: ${item.error}`);
      item.images?.forEach((image, index) => {
        parts.push(
          `[Image attachment ${index + 1}: ${image.mimeType}; attach separately]`,
        );
      });
    }
  }
  return `${parts.join('\n\n')}\n`;
}
