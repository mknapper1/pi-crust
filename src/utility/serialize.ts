import type {
  MessageTimelineItem,
  TimelineItem,
  ToolTimelineItem,
  TokenUsage,
} from '../shared/contracts';

interface ContentPart {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
}

interface AgentMessageLike {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  stopReason?: unknown;
  errorMessage?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
  usage?: unknown;
}

const sensitiveKey = /api[-_]?key|authorization|password|secret|token/i;
const maxSerializedLength = 30_000;

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKey.test(key) ? '[redacted]' : redactValue(entry, seen),
    ]),
  );
}

export function safeDisplayValue(value: unknown): string {
  let serialized: string;
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(redactValue(value, new WeakSet()), null, 2);
    } catch {
      serialized = String(value);
    }
  }
  if (serialized.length <= maxSerializedLength) return serialized;
  return `${serialized.slice(0, maxSerializedLength)}\n… output truncated`;
}

function timestampOf(message: AgentMessageLike) {
  return typeof message.timestamp === 'number' ? message.timestamp : Date.now();
}

function contentParts(message: AgentMessageLike): ContentPart[] {
  if (typeof message.content === 'string') {
    return [{ type: 'text', text: message.content }];
  }
  return Array.isArray(message.content)
    ? (message.content as ContentPart[])
    : [];
}

function textContent(message: AgentMessageLike) {
  return contentParts(message)
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function assistantStatus(
  message: AgentMessageLike,
): MessageTimelineItem['status'] {
  if (message.stopReason === 'aborted') return 'cancelled';
  if (message.stopReason === 'error') return 'failed';
  if (message.stopReason === 'pending') return 'streaming';
  return 'complete';
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fields = [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'totalTokens',
  ] as const;
  const candidate = value as Record<string, unknown>;
  if (
    !fields.every(
      (field) =>
        typeof candidate[field] === 'number' &&
        Number.isFinite(candidate[field]) &&
        (candidate[field] as number) >= 0,
    )
  )
    return undefined;
  return Object.fromEntries(
    fields.map((field) => [field, candidate[field]]),
  ) as unknown as TokenUsage;
}

export function serializeMessage(
  message: unknown,
  index: number,
): MessageTimelineItem | null {
  const candidate = message as AgentMessageLike;
  if (candidate.role !== 'user' && candidate.role !== 'assistant') return null;
  const text = textContent(candidate);
  const usage =
    candidate.role === 'assistant' ? tokenUsage(candidate.usage) : undefined;
  const images = contentParts(candidate).flatMap((part) =>
    part.type === 'image' &&
    typeof part.data === 'string' &&
    typeof part.mimeType === 'string' &&
    /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType)
      ? [{ data: part.data, mimeType: part.mimeType }]
      : [],
  );
  if (
    !text &&
    !usage &&
    candidate.role === 'assistant' &&
    typeof candidate.errorMessage !== 'string'
  ) {
    return null;
  }

  const timestamp = timestampOf(candidate);
  return {
    kind: 'message',
    id: `${candidate.role}-${timestamp}-${index}`,
    role: candidate.role,
    text,
    ...(usage ? { usage } : {}),
    ...(images.length ? { images } : {}),
    timestamp,
    ...(candidate.role === 'assistant'
      ? {
          status: assistantStatus(candidate),
          ...(typeof candidate.errorMessage === 'string'
            ? { error: candidate.errorMessage }
            : {}),
        }
      : {}),
  };
}

export function serializeTimeline(
  messages: readonly unknown[],
): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  const tools = new Map<string, ToolTimelineItem>();

  messages.forEach((message, index) => {
    const candidate = message as AgentMessageLike;
    const serializedMessage = serializeMessage(candidate, index);
    if (serializedMessage) timeline.push(serializedMessage);

    if (candidate.role === 'assistant') {
      for (const part of contentParts(candidate)) {
        if (
          part.type !== 'toolCall' ||
          typeof part.id !== 'string' ||
          typeof part.name !== 'string'
        ) {
          continue;
        }
        const tool: ToolTimelineItem = {
          kind: 'tool',
          id: `tool-${part.id}`,
          toolCallId: part.id,
          name: part.name,
          input: safeDisplayValue(part.arguments),
          timestamp: timestampOf(candidate),
          status: 'running',
        };
        tools.set(part.id, tool);
        timeline.push(tool);
      }
    }

    if (
      candidate.role === 'toolResult' &&
      typeof candidate.toolCallId === 'string'
    ) {
      const existing = tools.get(candidate.toolCallId);
      const output = safeDisplayValue(
        contentParts(candidate).map((part) =>
          part.type === 'text' ? part.text : part,
        ),
      );
      if (existing) {
        existing.output = output;
        existing.status = candidate.isError ? 'failed' : 'completed';
      } else {
        const tool: ToolTimelineItem = {
          kind: 'tool',
          id: `tool-${candidate.toolCallId}`,
          toolCallId: candidate.toolCallId,
          name:
            typeof candidate.toolName === 'string'
              ? candidate.toolName
              : 'Tool',
          input: '',
          output,
          timestamp: timestampOf(candidate),
          status: candidate.isError ? 'failed' : 'completed',
        };
        tools.set(candidate.toolCallId, tool);
        timeline.push(tool);
      }
    }
  });

  return timeline;
}
