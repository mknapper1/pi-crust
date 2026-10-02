import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import type { ProjectSessionState } from '../shared/contracts';
import { sessionTranscript } from './session-transcript';

export default function CopySessionButton({
  state,
}: {
  state: ProjectSessionState;
}) {
  const [status, setStatus] = useState<
    'idle' | 'copying' | 'copied' | 'failed'
  >('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetRef.current), []);
  const copy = async () => {
    clearTimeout(resetRef.current);
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(sessionTranscript(state));
      setStatus('copied');
      resetRef.current = setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('failed');
    }
  };
  return (
    <div className="session-copy">
      <button
        type="button"
        className={`icon-button session-copy-button${status === 'copied' ? ' is-copied' : ''}`}
        onClick={() => void copy()}
        disabled={!state.timeline.length || status === 'copying'}
        title={
          status === 'copied'
            ? 'Session copied'
            : 'Copy session · Includes messages and tool activity; review sensitive details before sharing'
        }
        aria-label="Copy session"
      >
        {status === 'copied' ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <span className="session-copy-feedback" role="status">
        {status === 'failed'
          ? 'Couldn’t copy. Try again.'
          : status === 'copied'
            ? 'Session copied'
            : ''}
      </span>
    </div>
  );
}
