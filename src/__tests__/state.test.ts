import type { ProjectSessionState } from '../shared/contracts';
import { applyAgentEvent } from '../renderer/state';

const initialState: ProjectSessionState = {
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
  timeline: [],
  models: [],
  thinkingLevel: 'off',
  availableThinkingLevels: ['off'],
  runState: 'idle',
  diagnostics: [],
  commands: [],
};

describe('agent event state', () => {
  it('streams assistant text into one timeline entry', () => {
    const started = applyAgentEvent(initialState, {
      type: 'message-start',
      item: {
        kind: 'message',
        id: 'assistant-1',
        role: 'assistant',
        text: '',
        timestamp: 1,
        status: 'streaming',
      },
    });
    const updated = applyAgentEvent(started, {
      type: 'message-delta',
      id: 'assistant-1',
      delta: 'Hello',
    });

    expect(updated?.timeline).toEqual([
      expect.objectContaining({ id: 'assistant-1', text: 'Hello' }),
    ]);
  });

  it('treats an authoritative snapshot as the source of truth', () => {
    const next = { ...initialState, runState: 'working' as const };
    expect(
      applyAgentEvent(initialState, { type: 'snapshot', state: next }),
    ).toBe(next);
  });

  it('preserves a cancelled partial response as a completed event update', () => {
    const streaming = {
      ...initialState,
      runState: 'stopping' as const,
      timeline: [
        {
          kind: 'message' as const,
          id: 'assistant-2',
          role: 'assistant' as const,
          text: 'Partial',
          timestamp: 2,
          status: 'streaming' as const,
        },
      ],
    };

    const updated = applyAgentEvent(streaming, {
      type: 'message-complete',
      item: {
        ...streaming.timeline[0],
        text: 'Partial response',
        status: 'cancelled',
      },
    });

    expect(updated?.timeline).toEqual([
      expect.objectContaining({
        id: 'assistant-2',
        text: 'Partial response',
        status: 'cancelled',
      }),
    ]);
  });

  it('tracks starting, working, stopping, and idle lifecycle states', () => {
    let state: ProjectSessionState | undefined = initialState;
    for (const runState of [
      'starting',
      'working',
      'stopping',
      'idle',
    ] as const) {
      state = applyAgentEvent(state, { type: 'run-state', state: runState });
      expect(state?.runState).toBe(runState);
    }
  });
});
