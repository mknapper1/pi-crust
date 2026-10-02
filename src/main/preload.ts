import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import type { AgentUiEvent, PiDesktopApi } from '../shared/contracts';
import { ipcChannels } from '../shared/ipc';
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments';

const api: PiDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(ipcChannels.bootstrap),
  chooseProject: () => ipcRenderer.invoke(ipcChannels.chooseProject),
  inspectProject: (path) =>
    ipcRenderer.invoke(ipcChannels.inspectProject, path),
  listProjectSessions: (path) =>
    ipcRenderer.invoke(ipcChannels.listProjectSessions, path),
  openProject: (input) => ipcRenderer.invoke(ipcChannels.openProject, input),
  newConversation: () => ipcRenderer.invoke(ipcChannels.newConversation),
  openConversation: (path) =>
    ipcRenderer.invoke(ipcChannels.openConversation, path),
  renameConversation: (path, title) =>
    ipcRenderer.invoke(ipcChannels.renameConversation, { path, title }),
  archiveConversation: (path, archived) =>
    ipcRenderer.invoke(ipcChannels.archiveConversation, { path, archived }),
  prepareAttachment: async (file) => {
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw new Error('Files must be 20 MB or smaller');
    const path = webUtils.getPathForFile(file);
    return ipcRenderer.invoke(
      ipcChannels.prepareAttachment,
      path
        ? { path }
        : {
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          },
    );
  },
  sendMessage: (text, attachmentPaths = []) =>
    ipcRenderer.invoke(ipcChannels.sendMessage, { text, attachmentPaths }),
  stopRun: () => ipcRenderer.invoke(ipcChannels.stopRun),
  syncComposer: (text) => ipcRenderer.invoke(ipcChannels.syncComposer, text),
  respondToExtensionUI: (response) =>
    ipcRenderer.invoke(ipcChannels.respondToExtensionUI, response),
  listPackages: () => ipcRenderer.invoke(ipcChannels.listPackages),
  installPackage: (source, scope) =>
    ipcRenderer.invoke(ipcChannels.installPackage, { source, scope }),
  updatePackage: (source, scope) =>
    ipcRenderer.invoke(ipcChannels.updatePackage, { source, scope }),
  removePackage: (source, scope) =>
    ipcRenderer.invoke(ipcChannels.removePackage, { source, scope }),
  setPackageEnabled: (source, scope, enabled) =>
    ipcRenderer.invoke(ipcChannels.setPackageEnabled, {
      source,
      scope,
      enabled,
    }),
  setPackageResourceEnabled: (input) =>
    ipcRenderer.invoke(ipcChannels.setPackageResourceEnabled, input),
  discoverPackages: (query) =>
    ipcRenderer.invoke(ipcChannels.discoverPackages, query),
  choosePackageFolder: () =>
    ipcRenderer.invoke(ipcChannels.choosePackageFolder),
  revealPath: (path) => ipcRenderer.invoke(ipcChannels.revealPath, path),
  setModel: (provider, id) =>
    ipcRenderer.invoke(ipcChannels.setModel, { provider, id }),
  setThinkingLevel: (level) =>
    ipcRenderer.invoke(ipcChannels.setThinkingLevel, level),
  saveApiKey: (provider, key) =>
    ipcRenderer.invoke(ipcChannels.saveApiKey, { provider, key }),
  removeApiKey: (provider) =>
    ipcRenderer.invoke(ipcChannels.removeApiKey, provider),
  updatePreferences: (patch) =>
    ipcRenderer.invoke(ipcChannels.updatePreferences, patch),
  openExternal: (url) => ipcRenderer.invoke(ipcChannels.openExternal, url),
  onAgentEvent: (listener) => {
    const subscription = (_event: IpcRendererEvent, value: AgentUiEvent) =>
      listener(value);
    ipcRenderer.on(ipcChannels.agentEvent, subscription);
    return () =>
      ipcRenderer.removeListener(ipcChannels.agentEvent, subscription);
  },
};

contextBridge.exposeInMainWorld('piDesktop', api);

export type PiDesktopHandler = typeof api;
