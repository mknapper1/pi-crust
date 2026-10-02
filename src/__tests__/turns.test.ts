import { groupPromptTurns } from '../renderer/turns';
import { serializeTimeline } from '../utility/serialize';

const usage = {
  input: 100,
  output: 20,
  cacheRead: 80,
  cacheWrite: 10,
  totalTokens: 210,
};

it('counts tool-only model calls and the final response in the same prompt', () => {
  const timeline = serializeTimeline([
    { role: 'user', content: 'Investigate', timestamp: 1 },
    {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'bash-1',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ],
      usage,
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 'bash-1',
      content: '/project',
      timestamp: 3,
    },
    { role: 'assistant', content: 'Done.', usage, timestamp: 4 },
    { role: 'user', content: 'Next question', timestamp: 5 },
    { role: 'assistant', content: 'Answer.', usage, timestamp: 6 },
  ]);
  const turns = groupPromptTurns(timeline);
  expect(turns).toHaveLength(2);
  expect(turns[0].usage).toEqual({
    input: 200,
    output: 40,
    cacheRead: 160,
    cacheWrite: 20,
    totalTokens: 420,
  });
  expect(turns[0].tools[0].input).toContain('pwd');
  expect(turns[0].tools[0].output).toContain('/project');
  expect(turns[1].usage?.totalTokens).toBe(210);
});

it('does not invent usage for older sessions or failed calls', () => {
  const turns = groupPromptTurns(
    serializeTimeline([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Provider failed',
      },
    ]),
  );
  expect(turns[0].usage).toBeUndefined();
  expect(turns[0].usageReports).toBe(0);
  expect(turns[0].messages[1].error).toBe('Provider failed');
});

it('preserves usage from cancelled responses and rejects malformed counts', () => {
  const turns = groupPromptTurns(
    serializeTimeline([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Partial', usage, stopReason: 'aborted' },
      {
        role: 'assistant',
        content: 'Other call',
        usage: { ...usage, totalTokens: NaN },
      },
    ]),
  );
  expect(turns[0].usage?.totalTokens).toBe(210);
  expect(turns[0].usageReports).toBe(1);
  expect(turns[0].assistantCalls).toBe(2);
  expect(turns[0].messages[1].status).toBe('cancelled');
});
