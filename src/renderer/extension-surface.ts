import type {
  AgentUiEvent,
  ExtensionUIDialogRequest,
  PackageProgress,
} from '../shared/contracts';

export interface ExtensionNotice {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
}

export interface ExtensionWidgetState {
  key: string;
  lines: string[];
  placement: 'aboveEditor' | 'belowEditor';
}

export interface ExtensionSurfaceState {
  dialogs: ExtensionUIDialogRequest[];
  notices: ExtensionNotice[];
  statuses: Record<string, string>;
  widgets: Record<string, ExtensionWidgetState>;
  packageProgress?: PackageProgress;
}

export const emptyExtensionSurface: ExtensionSurfaceState = {
  dialogs: [],
  notices: [],
  statuses: {},
  widgets: {},
};

function limitedNotices(notices: ExtensionNotice[]) {
  return notices.slice(-5);
}

export function applyExtensionSurfaceEvent(
  current: ExtensionSurfaceState,
  event: AgentUiEvent,
): ExtensionSurfaceState {
  switch (event.type) {
    case 'extension-ui-request':
      return { ...current, dialogs: [...current.dialogs, event.request] };
    case 'extension-ui-dismiss':
      return {
        ...current,
        dialogs: current.dialogs.filter((dialog) => dialog.id !== event.id),
      };
    case 'extension-notification':
      return {
        ...current,
        notices: limitedNotices([
          ...current.notices,
          {
            id: event.id,
            message: event.message,
            type: event.notificationType,
          },
        ]),
      };
    case 'extension-status': {
      const statuses = { ...current.statuses };
      if (event.text === undefined) delete statuses[event.key];
      else statuses[event.key] = event.text;
      return { ...current, statuses };
    }
    case 'extension-widget': {
      const widgets = { ...current.widgets };
      if (event.lines === undefined) delete widgets[event.key];
      else
        widgets[event.key] = {
          key: event.key,
          lines: event.lines,
          placement: event.placement,
        };
      return { ...current, widgets };
    }
    case 'package-progress': {
      const progress = event.progress;
      if (progress.type !== 'error')
        return { ...current, packageProgress: progress };
      return {
        ...current,
        packageProgress: progress,
        notices: limitedNotices([
          ...current.notices,
          {
            id: `package-${Date.now()}`,
            message: progress.message || `${progress.action} failed`,
            type: 'error',
          },
        ]),
      };
    }
    case 'extension-ui-reset':
      return {
        ...emptyExtensionSurface,
        notices: current.notices,
        packageProgress: current.packageProgress,
      };
    default:
      return current;
  }
}
