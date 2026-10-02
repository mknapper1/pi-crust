import { fireEvent, render, screen } from '@testing-library/react';
import { Timeline } from '../renderer/App';
import type { ProjectSessionState } from '../shared/contracts';

jest.mock('../renderer/Markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

const state: ProjectSessionState = {
  project: {
    path: '/tmp/project',
    name: 'project',
    trust: {
      hasProtectedResources: false,
      requiresDecision: false,
      trusted: true,
    },
  },
  conversations: [],
  timeline: [
    {
      kind: 'message',
      id: 'user',
      role: 'user',
      text: 'Fix the tests',
      status: 'complete',
      timestamp: 1,
    },
  ],
  models: [],
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  runState: 'working',
  diagnostics: [],
  commands: [],
};

it('keeps one typing line across empty messages, tools, and streamed text', () => {
  const props = {
    onOpenProject: jest.fn(),
    onOpenSettings: jest.fn(),
  };
  const { rerender, container } = render(<Timeline {...props} state={state} />);
  const indicator = screen.getByRole('status');
  expect(indicator.getAttribute('aria-label')).toBe('Pi is typing…');
  const dots = indicator.querySelector('.typing-dots');
  expect(dots?.getAttribute('aria-hidden')).toBe('true');
  expect(dots?.children).toHaveLength(3);
  const streaming: ProjectSessionState = {
    ...state,
    timeline: [
      ...state.timeline,
      {
        kind: 'message',
        id: 'assistant',
        role: 'assistant',
        text: '',
        status: 'streaming',
        timestamp: 2,
      },
      {
        kind: 'tool',
        id: 'tool',
        toolCallId: 'call',
        name: 'bash',
        input: 'npm test',
        status: 'running',
        timestamp: 3,
      },
    ],
  };
  rerender(<Timeline {...props} state={streaming} />);
  expect(screen.getByRole('status')).toBe(indicator);
  expect(indicator.querySelector('.typing-dots')).toBe(dots);
  expect(container.querySelectorAll('.message-assistant')).toHaveLength(0);
  const response: ProjectSessionState = {
    ...streaming,
    timeline: streaming.timeline.map((item) =>
      item.id === 'assistant' ? { ...item, text: 'Fixed.' } : item,
    ),
  };
  rerender(<Timeline {...props} state={response} />);
  expect(screen.getByRole('status')).toBe(indicator);
  expect(screen.getByText('Fixed.')).toBeTruthy();
  expect(screen.queryByText('Writing')).toBeNull();
  fireEvent.mouseEnter(
    screen.getByRole('group', { name: 'Prompt diagnostics' }),
  );
  expect(screen.getByText('npm test')).toBeTruthy();
  for (const runState of ['idle', 'error'] as const) {
    rerender(<Timeline {...props} state={{ ...response, runState }} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Fixed.')).toBeTruthy();
  }
});
