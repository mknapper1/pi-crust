import type {
  AgentUiEvent,
  ProjectSessionState,
  TimelineItem,
  ToolTimelineItem,
} from '../shared/contracts';

function replaceTimelineItem(
  timeline: TimelineItem[],
  id: string,
  update: (item: TimelineItem) => TimelineItem,
) {
  const index = timeline.findIndex((item) => item.id === id);
  if (index === -1) return timeline;
  const next = [...timeline];
  next[index] = update(next[index]);
  return next;
}

function upsertTimelineItem(timeline: TimelineItem[], item: TimelineItem) {
  const index = timeline.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...timeline, item];
  const next = [...timeline];
  next[index] = item;
  return next;
}

export function applyAgentEvent(
  state: ProjectSessionState | undefined,
  event: AgentUiEvent,
): ProjectSessionState | undefined {
  if (event.type === 'snapshot') return event.state;
  if (!state) return state;

  switch (event.type) {
    case 'run-state':
      return {
        ...state,
        runState: event.state,
        diagnostics: event.error
          ? [...state.diagnostics, event.error]
          : state.diagnostics,
      };
    case 'message-start':
      return {
        ...state,
        timeline: upsertTimelineItem(state.timeline, event.item),
      };
    case 'message-delta':
      return {
        ...state,
        timeline: replaceTimelineItem(state.timeline, event.id, (item) =>
          item.kind === 'message'
            ? { ...item, text: `${item.text}${event.delta}` }
            : item,
        ),
      };
    case 'message-complete':
      return {
        ...state,
        timeline: upsertTimelineItem(state.timeline, event.item),
      };
    case 'tool-start':
      return {
        ...state,
        timeline: upsertTimelineItem(state.timeline, event.item),
      };
    case 'tool-update':
      return {
        ...state,
        timeline: replaceTimelineItem(state.timeline, event.id, (item) =>
          item.kind === 'tool'
            ? ({ ...item, output: event.output } satisfies ToolTimelineItem)
            : item,
        ),
      };
    case 'tool-complete':
      return {
        ...state,
        timeline: upsertTimelineItem(state.timeline, event.item),
      };
    case 'runtime-crash':
      return {
        ...state,
        runState: 'error',
        diagnostics: [...state.diagnostics, event.error],
      };
    default:
      return state;
  }
}
