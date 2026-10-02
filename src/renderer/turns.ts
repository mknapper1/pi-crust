import type {
  MessageTimelineItem,
  TimelineItem,
  TokenUsage,
  ToolTimelineItem,
} from '../shared/contracts';

export interface PromptTurn {
  id: string;
  messages: MessageTimelineItem[];
  tools: ToolTimelineItem[];
  usage?: TokenUsage;
  usageReports: number;
  assistantCalls: number;
}

// A prompt can make many model calls. Include tool-only assistant messages in
// its usage total, while keeping those messages out of the conversation UI.
export function groupPromptTurns(timeline: TimelineItem[]): PromptTurn[] {
  const turns: PromptTurn[] = [];
  for (const item of timeline) {
    if (!turns.length || (item.kind === 'message' && item.role === 'user')) {
      turns.push({
        id: item.id,
        messages: [],
        tools: [],
        usageReports: 0,
        assistantCalls: 0,
      });
    }
    const turn = turns[turns.length - 1];
    if (item.kind === 'tool') {
      turn.tools.push(item);
    } else {
      turn.messages.push(item);
      if (item.role === 'assistant') {
        turn.assistantCalls += 1;
        if (item.usage) {
          turn.usageReports += 1;
          const usage = turn.usage ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          };
          for (const key of Object.keys(usage) as (keyof TokenUsage)[])
            usage[key] += item.usage[key];
          turn.usage = usage;
        }
      }
    }
  }
  return turns;
}
