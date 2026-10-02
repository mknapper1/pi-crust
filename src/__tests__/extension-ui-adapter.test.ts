import type { AgentUiEvent } from '../shared/contracts';
import { ExtensionUIAdapter } from '../utility/extension-ui-adapter';

describe('ExtensionUIAdapter', () => {
  it('round-trips dialog answers and dismisses the desktop dialog', async () => {
    const events: AgentUiEvent[] = [];
    const adapter = new ExtensionUIAdapter({
      emit: (event) => events.push(event),
      getComposerText: () => 'draft',
    });

    const answer = adapter.context.input('Name', 'Ada');
    const requestEvent = events.find(
      (event) => event.type === 'extension-ui-request',
    );
    if (requestEvent?.type !== 'extension-ui-request')
      throw new Error('request not emitted');
    expect(
      adapter.respond({ id: requestEvent.request.id, value: 'Grace' }),
    ).toBe(true);
    await expect(answer).resolves.toBe('Grace');
    expect(events.at(-1)).toEqual({
      type: 'extension-ui-dismiss',
      id: requestEvent.request.id,
    });
  });

  it('surfaces status, text widgets, notifications, and composer proposals', () => {
    const events: AgentUiEvent[] = [];
    const adapter = new ExtensionUIAdapter({
      emit: (event) => events.push(event),
      getComposerText: () => 'existing draft',
    });

    adapter.context.setStatus('demo', 'Running');
    adapter.context.setWidget('demo', ['One', 'Two']);
    adapter.context.notify('Done');
    adapter.context.setEditorText('replacement');
    adapter.context.setTitle('Demo project');

    expect(adapter.context.getEditorText()).toBe('existing draft');
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'extension-status', key: 'demo', text: 'Running' },
        {
          type: 'extension-widget',
          key: 'demo',
          lines: ['One', 'Two'],
          placement: 'aboveEditor',
        },
        expect.objectContaining({
          type: 'extension-notification',
          message: 'Done',
        }),
        {
          type: 'extension-composer',
          text: 'replacement',
          behavior: 'replace',
        },
        { type: 'extension-title', title: 'Demo project' },
      ]),
    );
  });

  it('cancels pending requests when a session is replaced', async () => {
    const events: AgentUiEvent[] = [];
    const adapter = new ExtensionUIAdapter({
      emit: (event) => events.push(event),
      getComposerText: () => '',
    });
    const answer = adapter.context.confirm('Continue?', 'Check');

    adapter.reset();

    await expect(answer).resolves.toBe(false);
    expect(events.at(-1)).toEqual({ type: 'extension-ui-reset' });
  });
});
