import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  Brain,
  CaretDown,
  Check,
  Cpu,
  MagnifyingGlass,
  SpinnerGap,
} from '@phosphor-icons/react';
import type { ModelOption, ThinkingLevel } from '../shared/contracts';

const thinkingLabels: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};
const thinkingDescriptions: Record<ThinkingLevel, string> = {
  off: 'No added reasoning',
  minimal: 'A light reasoning budget',
  low: 'A smaller reasoning budget',
  medium: 'A moderate reasoning budget',
  high: 'A larger reasoning budget',
  xhigh: 'An extra-large reasoning budget',
  max: 'The maximum reasoning budget',
};

export default function ModelControls({
  models,
  selectedModel,
  thinkingLevel,
  thinkingLevels,
  disabled,
  onModelChange,
  onThinkingChange,
  onError,
}: {
  models: ModelOption[];
  selectedModel?: ModelOption;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  disabled: boolean;
  onModelChange: (model: ModelOption) => Promise<void>;
  onThinkingChange: (level: ThinkingLevel) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState<'model' | 'thinking'>();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const thinkingRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const modelListId = useId();
  const thinkingListId = useId();
  const close = () => {
    (open === 'model' ? modelRef : thinkingRef).current?.focus();
    setOpen(undefined);
  };

  if (disabled && open) setOpen(undefined);
  useEffect(() => {
    if (!open) return undefined;
    if (open === 'model') searchRef.current?.focus();
    else
      rootRef.current
        ?.querySelector<HTMLButtonElement>(
          '[role="option"][aria-selected="true"]',
        )
        ?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(undefined);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const navigate = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    // Preserve normal text editing in search; arrows still enter the results.
    if (
      event.target === searchRef.current &&
      ['Home', 'End'].includes(event.key)
    )
      return;
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      ) ?? [],
    );
    if (!options.length) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : (index <= 0 ? options.length : index) - 1;
    options[next].focus();
  };
  const change = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      close();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  const filtered = models.filter((model) =>
    `${model.name} ${model.id} ${model.provider}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const providers = [...new Set(filtered.map((model) => model.provider))];
  const toggle = (kind: 'model' | 'thinking') => {
    setQuery('');
    setOpen(open === kind ? undefined : kind);
  };

  return (
    <div
      className="model-controls"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(undefined);
      }}
    >
      <div className="model-control">
        <button
          className="model-control-trigger"
          type="button"
          ref={modelRef}
          disabled={disabled || busy || !models.length}
          aria-label={`Model: ${selectedModel?.name ?? 'No models'}`}
          aria-haspopup="listbox"
          aria-expanded={open === 'model'}
          aria-controls={open === 'model' ? modelListId : undefined}
          onClick={() => toggle('model')}
        >
          <Cpu size={15} />
          <span>{selectedModel?.name ?? 'Choose model'}</span>
          <CaretDown size={12} />
        </button>
        {open === 'model' && (
          <div
            className="model-control-popover"
            onKeyDown={navigate}
            role="presentation"
          >
            <label className="model-search">
              <MagnifyingGlass size={15} />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label="Search models"
                aria-expanded="true"
                aria-controls={modelListId}
                autoComplete="off"
                placeholder="Search models…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div
              id={modelListId}
              role="listbox"
              aria-label="Models"
              className="model-options"
              aria-busy={busy}
            >
              {providers.map((provider) => (
                <div key={provider} role="group" aria-label={provider}>
                  <div className="model-provider">{provider}</div>
                  {filtered
                    .filter((model) => model.provider === provider)
                    .map((model) => {
                      const selected =
                        model.id === selectedModel?.id &&
                        model.provider === selectedModel.provider;
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className="model-option"
                          key={model.id}
                          disabled={busy}
                          onClick={() =>
                            void change(() => onModelChange(model))
                          }
                        >
                          <span>{model.name}</span>
                          {selected && <Check size={15} weight="bold" />}
                        </button>
                      );
                    })}
                </div>
              ))}
              {!filtered.length && (
                <div className="model-no-results">No matching models</div>
              )}
            </div>
            <div className="model-popover-footer">
              {busy ? (
                <>
                  <SpinnerGap className="spin" size={12} /> Switching model…
                </>
              ) : (
                '↑ ↓ to navigate · Enter to choose'
              )}
            </div>
          </div>
        )}
      </div>
      {selectedModel?.reasoning && thinkingLevels.length > 1 && (
        <div className="model-control">
          <button
            className="model-control-trigger thinking-trigger"
            type="button"
            ref={thinkingRef}
            disabled={disabled || busy}
            aria-label={`Thinking level: ${thinkingLabels[thinkingLevel]}`}
            aria-haspopup="listbox"
            aria-expanded={open === 'thinking'}
            aria-controls={open === 'thinking' ? thinkingListId : undefined}
            onClick={() => toggle('thinking')}
          >
            <Brain size={15} />
            <span>
              Thinking{' '}
              <span className="thinking-current">
                {thinkingLabels[thinkingLevel]}
              </span>
            </span>
            <CaretDown size={12} />
          </button>
          {open === 'thinking' && (
            <div
              className="model-control-popover thinking-popover"
              role="presentation"
              onKeyDown={navigate}
            >
              <div className="thinking-heading">
                Reasoning budget<span>Higher levels can take longer.</span>
              </div>
              <div
                id={thinkingListId}
                role="listbox"
                aria-label="Thinking levels"
                className="model-options"
                aria-busy={busy}
              >
                {thinkingLevels.map((level) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={level === thinkingLevel}
                    className="model-option thinking-option"
                    key={level}
                    disabled={busy}
                    onClick={() => void change(() => onThinkingChange(level))}
                  >
                    <span>
                      {thinkingLabels[level]}
                      <small>{thinkingDescriptions[level]}</small>
                    </span>
                    {level === thinkingLevel && (
                      <Check size={15} weight="bold" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
