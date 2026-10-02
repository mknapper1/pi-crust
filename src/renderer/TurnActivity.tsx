import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  CaretRight,
  CheckCircle,
  SpinnerGap,
  TerminalWindow,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ToolTimelineItem } from '../shared/contracts';
import type { PromptTurn } from './turns';

function ToolActivity({ item }: { item: ToolTimelineItem }) {
  return (
    <details
      className={`tool-activity sg-panel tool-${item.status}`}
      data-surface="terminal"
    >
      <summary>
        <span className="tool-icon" aria-hidden="true">
          {item.status === 'running' ? (
            <SpinnerGap className="spin" size={15} />
          ) : item.status === 'failed' ? (
            <WarningCircle size={15} />
          ) : (
            <CheckCircle size={15} />
          )}
        </span>
        <span className="tool-name">{item.name}</span>
        <span className="tool-status">
          {item.status === 'running'
            ? 'Running'
            : item.status === 'failed'
              ? 'Failed'
              : 'Completed'}
        </span>
        <CaretRight className="tool-caret" size={14} />
      </summary>
      <div className="tool-details">
        {item.input && (
          <div>
            <span className="tool-detail-label">Input</span>
            <pre>{item.input}</pre>
          </div>
        )}
        {item.output && (
          <div>
            <span className="tool-detail-label">Output</span>
            <pre>{item.output}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

export default function TurnActivity({
  turn,
  running,
}: {
  turn: PromptTurn;
  running: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState({ below: false, height: 360 });
  const preview = () => {
    const container = containerRef.current;
    const timeline = container?.closest('.timeline');
    if (container && timeline) {
      const rect = container.getBoundingClientRect();
      const bounds = timeline.getBoundingClientRect();
      const above = rect.top - bounds.top - 8;
      const below = bounds.bottom - rect.bottom - 8;
      setPlacement({
        below: above < 200 && below > above,
        height: Math.max(
          100,
          Math.min(360, above < 200 && below > above ? below : above),
        ),
      });
    }
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (containerRef.current?.contains(document.activeElement))
        buttonRef.current?.focus();
      setPinned(false);
      setOpen(false);
    };
    document.addEventListener('keydown', dismiss);
    const dismissOutside = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setPinned(false);
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);
  const failed = turn.tools.filter((tool) => tool.status === 'failed').length;
  const usage = turn.usage;
  const partial = turn.usageReports < turn.assistantCalls || running;
  const number = (value: number) => value.toLocaleString();
  return (
    <div
      role="group"
      aria-label="Prompt diagnostics"
      ref={containerRef}
      className={`turn-activity ${pinned ? 'is-pinned' : ''} ${placement.below ? 'opens-below' : ''}`}
      style={
        {
          '--activity-preview-height': `${placement.height}px`,
        } as CSSProperties
      }
      onMouseEnter={preview}
      onMouseLeave={() => {
        if (!pinned) setOpen(false);
      }}
      onFocus={preview}
      onBlur={(event) => {
        if (
          !pinned &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setOpen(false);
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        className={`turn-activity-button${running ? ' is-running' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
      >
        {running ? (
          <span role="status" aria-label="Pi is typing…">
            Pi is typing
            <span className="typing-dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        ) : (
          <>
            {failed ? (
              <WarningCircle size={14} />
            ) : (
              <TerminalWindow size={14} />
            )}
            <span>
              Activity
              {turn.tools.length
                ? ` · ${turn.tools.length} tool ${turn.tools.length === 1 ? 'call' : 'calls'}`
                : ''}
            </span>
            <span>
              {usage
                ? `${number(usage.totalTokens)} tokens${partial ? ' so far' : ''}`
                : 'Tokens unavailable'}
            </span>
            {failed > 0 && (
              <span className="activity-failed">{failed} failed</span>
            )}
          </>
        )}
      </button>
      {open && (
        <section
          id={id}
          className="turn-activity-panel"
          aria-label="Prompt activity and token usage"
        >
          <div className="turn-usage">
            <strong>Prompt usage{partial && usage ? ' (partial)' : ''}</strong>
            {usage ? (
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{number(usage.input)}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{number(usage.output)}</dd>
                </div>
                <div>
                  <dt>Cache read</dt>
                  <dd>{number(usage.cacheRead)}</dd>
                </div>
                <div>
                  <dt>Cache write</dt>
                  <dd>{number(usage.cacheWrite)}</dd>
                </div>
                <div>
                  <dt>Total tokens</dt>
                  <dd>{number(usage.totalTokens)}</dd>
                </div>
              </dl>
            ) : (
              <p>
                {running
                  ? 'Waiting for provider usage.'
                  : 'The provider did not report token usage.'}
              </p>
            )}
            <p>
              Across all model calls for this prompt, including tool steps.
              Cached tokens are included; this is not a dollar charge.
            </p>
          </div>
          {turn.tools.length > 0 && (
            <div className="turn-tools">
              {turn.tools.map((tool) => (
                <ToolActivity key={tool.id} item={tool} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
