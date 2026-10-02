import { randomUUID } from 'node:crypto';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type {
  AgentUiEvent,
  ExtensionUIDialogRequest,
  ExtensionUIResponse,
} from '../shared/contracts';

type DialogMethod = ExtensionUIDialogRequest['method'];
type DialogRequestWithoutId = ExtensionUIDialogRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, 'id'>
    : never
  : never;

interface PendingDialog {
  method: DialogMethod;
  finish: (value: string | boolean | undefined) => void;
}

interface ExtensionUIAdapterOptions {
  emit: (event: AgentUiEvent) => void;
  getComposerText: () => string;
}

const desktopTheme = new Proxy(
  {},
  {
    get: (_target, property) => {
      if (property === 'name') return 'crust';
      if (property === 'appearance') return 'dark';
      if (property === 'colors') return {};
      return (...args: unknown[]) =>
        typeof args.at(-1) === 'string' ? args.at(-1) : '';
    },
  },
);

/**
 * Bridges Pi's mode-independent extension UI calls to renderer-owned desktop UI.
 * Terminal component factories stay unsupported, matching Pi's documented RPC
 * boundary; all text-based interactions remain functional.
 */
export class ExtensionUIAdapter {
  private readonly pending = new Map<string, PendingDialog>();

  private warnedAboutCustomWidget = false;

  readonly context: ExtensionUIContext;

  constructor(private readonly options: ExtensionUIAdapterOptions) {
    const dialog = (
      request: DialogRequestWithoutId,
      signal?: AbortSignal,
      timeout?: number,
    ) => this.openDialog(request, signal, timeout);

    this.context = {
      select: async (title, values, opts) => {
        const result = await dialog(
          { method: 'select', title, options: values, timeout: opts?.timeout },
          opts?.signal,
          opts?.timeout,
        );
        return typeof result === 'string' ? result : undefined;
      },
      confirm: async (title, message, opts) => {
        const result = await dialog(
          { method: 'confirm', title, message, timeout: opts?.timeout },
          opts?.signal,
          opts?.timeout,
        );
        return result === true;
      },
      input: async (title, placeholder, opts) => {
        const result = await dialog(
          { method: 'input', title, placeholder, timeout: opts?.timeout },
          opts?.signal,
          opts?.timeout,
        );
        return typeof result === 'string' ? result : undefined;
      },
      editor: async (title, prefill) => {
        const result = await dialog({ method: 'editor', title, prefill });
        return typeof result === 'string' ? result : undefined;
      },
      notify: (message, notificationType = 'info') => {
        this.options.emit({
          type: 'extension-notification',
          id: randomUUID(),
          message,
          notificationType,
        });
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        this.options.emit({ type: 'extension-status', key, text });
      },
      setWorkingMessage: (message) => {
        this.options.emit({
          type: 'extension-status',
          key: 'pi:working',
          text: message,
        });
      },
      setWorkingVisible: (visible) => {
        this.options.emit({
          type: 'extension-status',
          key: 'pi:working',
          text: visible ? 'Working…' : undefined,
        });
      },
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, widgetOptions) => {
        if (typeof content === 'function') {
          if (!this.warnedAboutCustomWidget) {
            this.warnedAboutCustomWidget = true;
            this.context.notify(
              'An extension requested a terminal-only custom widget. Crust supports text widgets only.',
              'warning',
            );
          }
          return;
        }
        this.options.emit({
          type: 'extension-widget',
          key,
          lines: content,
          placement: widgetOptions?.placement ?? 'aboveEditor',
        });
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.options.emit({ type: 'extension-title', title });
      },
      custom: async <T>() => undefined as T,
      pasteToEditor: (text) => {
        this.options.emit({
          type: 'extension-composer',
          text,
          behavior: 'insert',
        });
      },
      setEditorText: (text) => {
        this.options.emit({
          type: 'extension-composer',
          text,
          behavior: 'replace',
        });
      },
      getEditorText: () => this.options.getComposerText(),
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: desktopTheme as ExtensionUIContext['theme'],
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: 'Theme switching is not supported by Crust extensions',
      }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    } as ExtensionUIContext;
  }

  respond(response: ExtensionUIResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return false;

    if ('cancelled' in response) {
      pending.finish(pending.method === 'confirm' ? false : undefined);
    } else if (pending.method === 'confirm' && 'confirmed' in response) {
      pending.finish(response.confirmed);
    } else if (pending.method !== 'confirm' && 'value' in response) {
      pending.finish(response.value);
    } else {
      return false;
    }
    return true;
  }

  reset() {
    for (const pending of this.pending.values()) {
      pending.finish(pending.method === 'confirm' ? false : undefined);
    }
    this.pending.clear();
    this.options.emit({ type: 'extension-title', title: undefined });
    this.options.emit({ type: 'extension-ui-reset' });
  }

  private openDialog(
    request: DialogRequestWithoutId,
    signal?: AbortSignal,
    timeout?: number,
  ) {
    if (signal?.aborted) {
      return Promise.resolve(request.method === 'confirm' ? false : undefined);
    }

    const id = randomUUID();
    return new Promise<string | boolean | undefined>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const abort = () =>
        finish(request.method === 'confirm' ? false : undefined);
      const finish = (value: string | boolean | undefined) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
        this.options.emit({ type: 'extension-ui-dismiss', id });
        resolve(value);
      };

      this.pending.set(id, { method: request.method, finish });
      signal?.addEventListener('abort', abort, { once: true });
      if (timeout !== undefined) timer = setTimeout(abort, timeout);
      this.options.emit({
        type: 'extension-ui-request',
        request: { ...request, id } as ExtensionUIDialogRequest,
      });
    });
  }
}
