import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle,
  Info,
  PuzzlePiece,
  Warning,
  X,
} from '@phosphor-icons/react';
import type {
  ExtensionUIDialogRequest,
  ExtensionUIResponse,
} from '../shared/contracts';
import type { ExtensionSurfaceState } from './extension-surface';

export function ExtensionActivity({
  surface,
  placement,
}: {
  surface: ExtensionSurfaceState;
  placement: 'aboveEditor' | 'belowEditor';
}) {
  const widgets = Object.values(surface.widgets).filter(
    (widget) => widget.placement === placement,
  );
  const statuses = Object.entries(surface.statuses);
  if (!widgets.length && (placement !== 'aboveEditor' || !statuses.length))
    return null;
  return (
    <div className={`extension-activity extension-activity-${placement}`}>
      {placement === 'aboveEditor' && statuses.length > 0 && (
        <div className="extension-statuses" aria-label="Extension status">
          {statuses.map(([key, text]) => (
            <span key={key} title={key}>
              <PuzzlePiece size={12} /> {text}
            </span>
          ))}
        </div>
      )}
      {widgets.map((widget) => (
        <section className="extension-widget" key={widget.key}>
          <div>{widget.key}</div>
          <pre>{widget.lines.join('\n')}</pre>
        </section>
      ))}
    </div>
  );
}

export function ExtensionNotifications({
  surface,
  onDismiss,
}: {
  surface: ExtensionSurfaceState;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="extension-notifications" aria-live="polite">
      {surface.notices.map((notice) => (
        <div
          className={`extension-notice notice-${notice.type}`}
          key={notice.id}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          {notice.type === 'error' ? (
            <Warning size={17} />
          ) : notice.type === 'warning' ? (
            <Warning size={17} />
          ) : (
            <Info size={17} />
          )}
          <span>{notice.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notice.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TimeoutLabel({ request }: { request: ExtensionUIDialogRequest }) {
  const [remaining, setRemaining] = useState(
    request.timeout ? Math.ceil(request.timeout / 1000) : undefined,
  );
  useEffect(() => {
    if (!request.timeout) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setRemaining(
        Math.max(
          0,
          Math.ceil((request.timeout! - (Date.now() - started)) / 1000),
        ),
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [request.id, request.timeout]);
  return remaining === undefined ? null : (
    <span className="extension-dialog-timeout">Expires in {remaining}s</span>
  );
}

export function ExtensionDialogHost({
  request,
  onRespond,
}: {
  request: ExtensionUIDialogRequest | undefined;
  onRespond: (response: ExtensionUIResponse) => void;
}) {
  if (!request) return null;
  return (
    <ExtensionDialog key={request.id} request={request} onRespond={onRespond} />
  );
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionUIDialogRequest;
  onRespond: (response: ExtensionUIResponse) => void;
}) {
  const [value, setValue] = useState(
    request.method === 'editor' ? (request.prefill ?? '') : '',
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `extension-dialog-${request.id}`;

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>('[data-initial-focus]')
      ?.focus();
  }, []);

  const cancel = () => onRespond({ id: request.id, cancelled: true });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRespond({ id: request.id, value });
  };

  return (
    <div
      className="modal-backdrop extension-dialog-backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal sg-glass extension-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="extension-dialog-heading">
          <div className="modal-icon">
            <PuzzlePiece size={22} />
          </div>
          <TimeoutLabel request={request} />
        </div>
        <h2 id={titleId}>{request.title}</h2>
        {request.method === 'select' && (
          <div className="extension-select-options" role="listbox">
            {request.options.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                data-initial-focus={index === 0 ? '' : undefined}
                key={option}
                onClick={() => onRespond({ id: request.id, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        )}
        {request.method === 'confirm' && <p>{request.message}</p>}
        {(request.method === 'input' || request.method === 'editor') && (
          <form onSubmit={submit}>
            {request.method === 'input' ? (
              <input
                className="sg-input"
                data-initial-focus
                value={value}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <textarea
                className="sg-input extension-editor"
                data-initial-focus
                rows={12}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            <div className="modal-actions">
              <button
                className="secondary-button sg-button"
                type="button"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                className="primary-button sg-button sg-button--primary"
                type="submit"
              >
                <CheckCircle size={15} /> Submit
              </button>
            </div>
          </form>
        )}
        {request.method === 'confirm' && (
          <div className="modal-actions">
            <button
              className="secondary-button sg-button"
              type="button"
              data-initial-focus
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              className="primary-button sg-button sg-button--primary"
              type="button"
              onClick={() => onRespond({ id: request.id, confirmed: true })}
            >
              Confirm
            </button>
          </div>
        )}
        {request.method === 'select' && (
          <div className="modal-actions">
            <button
              className="secondary-button sg-button"
              type="button"
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
