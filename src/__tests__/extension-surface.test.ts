import {
  applyExtensionSurfaceEvent,
  emptyExtensionSurface,
} from '../renderer/extension-surface';

it('keeps extension UI out of the conversation and resets session-owned state', () => {
  let state = applyExtensionSurfaceEvent(emptyExtensionSurface, {
    type: 'extension-status',
    key: 'demo',
    text: 'Running',
  });
  state = applyExtensionSurfaceEvent(state, {
    type: 'extension-widget',
    key: 'demo',
    lines: ['Progress 1/2'],
    placement: 'aboveEditor',
  });
  state = applyExtensionSurfaceEvent(state, {
    type: 'extension-notification',
    id: 'notice',
    message: 'Finished',
    notificationType: 'info',
  });

  expect(state.statuses.demo).toBe('Running');
  expect(state.widgets.demo.lines).toEqual(['Progress 1/2']);
  expect(state.notices).toHaveLength(1);

  state = applyExtensionSurfaceEvent(state, { type: 'extension-ui-reset' });
  expect(state.statuses).toEqual({});
  expect(state.widgets).toEqual({});
  expect(state.notices).toHaveLength(1);
});
