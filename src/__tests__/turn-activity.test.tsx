import { fireEvent, render, screen } from '@testing-library/react';
import TurnActivity from '../renderer/TurnActivity';
import type { PromptTurn } from '../renderer/turns';

const turn: PromptTurn = {
  id: 'turn',
  messages: [],
  assistantCalls: 1,
  usageReports: 1,
  usage: {
    input: 100,
    output: 20,
    cacheRead: 80,
    cacheWrite: 10,
    totalTokens: 210,
  },
  tools: [
    {
      kind: 'tool',
      id: 'tool',
      toolCallId: 'call',
      name: 'bash',
      input: 'pwd',
      output: '/project',
      status: 'completed',
      timestamp: 1,
    },
  ],
};

it('hides debug details by default and previews them on hover', () => {
  render(<TurnActivity turn={turn} running={false} />);
  expect(screen.queryByText('pwd')).toBeNull();
  expect(screen.getByRole('button').textContent).toContain('210 tokens');
  fireEvent.mouseEnter(
    screen.getByRole('group', { name: 'Prompt diagnostics' }),
  );
  expect(screen.getByText('pwd')).toBeTruthy();
  expect(screen.getByText('bash').closest('details')?.open).toBe(false);
  fireEvent.mouseLeave(
    screen.getByRole('group', { name: 'Prompt diagnostics' }),
  );
  expect(screen.queryByText('pwd')).toBeNull();
});

it('pins details on click and supports keyboard dismissal', () => {
  render(<TurnActivity turn={turn} running={false} />);
  const button = screen.getByRole('button');
  fireEvent.click(button);
  fireEvent.mouseLeave(
    screen.getByRole('group', { name: 'Prompt diagnostics' }),
  );
  expect(screen.getByText('pwd')).toBeTruthy();
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(screen.queryByText('pwd')).toBeNull();
  fireEvent.focus(button);
  expect(screen.getByText('pwd')).toBeTruthy();
});

it('shows partial, unavailable, and failed activity states', () => {
  const { rerender } = render(<TurnActivity turn={turn} running />);
  expect(screen.getByRole('button').textContent).toBe('Pi is typing...');
  fireEvent.mouseEnter(
    screen.getByRole('group', { name: 'Prompt diagnostics' }),
  );
  expect(screen.getByText('Prompt usage (partial)')).toBeTruthy();
  rerender(
    <TurnActivity
      turn={{
        ...turn,
        usage: undefined,
        tools: [{ ...turn.tools[0], status: 'failed' }],
      }}
      running={false}
    />,
  );
  expect(screen.getByRole('button').textContent).toContain(
    'Tokens unavailable',
  );
  expect(screen.getByRole('button').textContent).toContain('1 failed');
});
