import { act, fireEvent, render, screen } from '@testing-library/react';
import CopySessionButton from '../renderer/CopySessionButton';
import { sessionTranscript } from '../renderer/session-transcript';
import type { ProjectSessionState } from '../shared/contracts';

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
  activeConversationTitle: 'Fix a bug',
  conversations: [],
  models: [],
  commands: [],
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  runState: 'idle',
  diagnostics: [],
  timeline: [
    {
      kind: 'message',
      id: 'user',
      role: 'user',
      text: 'Fix this',
      timestamp: 1,
    },
    { kind: 'message', id: 'empty', role: 'assistant', text: '', timestamp: 2 },
    {
      kind: 'tool',
      id: 'tool',
      toolCallId: 'call',
      name: 'bash',
      input: 'npm test',
      output: '```\nFailed\n… output truncated',
      status: 'failed',
      timestamp: 3,
    },
    {
      kind: 'message',
      id: 'answer',
      role: 'assistant',
      text: 'Blocked.',
      error: 'Permission denied',
      status: 'failed',
      timestamp: 4,
      images: [{ data: 'private-base64', mimeType: 'image/png' }],
    },
  ],
};

it('copies ordered messages and tool evidence without embedding image data', () => {
  const transcript = sessionTranscript(state);
  expect(transcript).toContain('# Fix a bug\n\nProject: /tmp/project');
  expect(transcript).toContain('## Tool: bash (failed)');
  expect(transcript).toContain('Input:\n```text\nnpm test\n```');
  expect(transcript).toContain('Output:\n````text\n```\nFailed');
  expect(transcript).toContain('… output truncated');
  expect(transcript).toContain('Error: Permission denied');
  expect(transcript).toContain(
    'Image attachment 1: image/png; attach separately',
  );
  expect(transcript).not.toContain('private-base64');
  expect(transcript.indexOf('Fix this')).toBeLessThan(
    transcript.indexOf('npm test'),
  );
  expect(transcript.indexOf('npm test')).toBeLessThan(
    transcript.indexOf('Blocked.'),
  );
  expect(transcript.match(/## Pi/g)).toHaveLength(1);
});

it('copies a snapshot of an active session and confirms success', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(<CopySessionButton state={{ ...state, runState: 'working' }} />);
  const button = screen.getByRole('button', { name: 'Copy session' });
  expect(button.classList.contains('icon-button')).toBe(true);
  expect(button.textContent).toBe('');
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Copy session' })),
  );
  expect(writeText).toHaveBeenCalledWith(
    sessionTranscript({ ...state, runState: 'working' }),
  );
  expect(screen.getByRole('status').textContent).toBe('Session copied');
});

it('shows clipboard failures and allows retry', async () => {
  const writeText = jest
    .fn()
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(<CopySessionButton state={state} />);
  const button = screen.getByRole('button', { name: 'Copy session' });
  await act(async () => fireEvent.click(button));
  expect(screen.getByRole('status').textContent).toContain('Couldn’t copy');
  await act(async () => fireEvent.click(button));
  expect(screen.getByRole('status').textContent).toBe('Session copied');
});

it('disables copying empty sessions', () => {
  render(<CopySessionButton state={{ ...state, timeline: [] }} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
