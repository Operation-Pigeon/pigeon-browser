import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserState } from '../shared/types';

const api = {
  tabs: {
    setProfile: (profile: string) => ipcRenderer.invoke('tabs:setProfile', profile),
    create: (profile: string, url?: string) => ipcRenderer.invoke('tabs:create', profile, url),
    close: (id: string) => ipcRenderer.invoke('tabs:close', id),
    activate: (id: string) => ipcRenderer.invoke('tabs:activate', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('tabs:navigate', id, url),
    back: (id: string) => ipcRenderer.invoke('tabs:back', id),
    forward: (id: string) => ipcRenderer.invoke('tabs:forward', id),
    reload: (id: string) => ipcRenderer.invoke('tabs:reload', id),
    setPanelOpen: (open: boolean) => ipcRenderer.invoke('tabs:panel', open),
    snapshot: () => ipcRenderer.invoke('tabs:snapshot') as Promise<BrowserState>,
    onState: (cb: (state: BrowserState) => void): (() => void) => {
      const listener = (_e: unknown, state: BrowserState) => cb(state);
      ipcRenderer.on('browser:state', listener);
      return () => {
        ipcRenderer.removeListener('browser:state', listener);
      };
    },
  },
  pigeon: {
    hasKey: () => ipcRenderer.invoke('pigeon:hasKey') as Promise<boolean>,
    saveKey: (key: string) => ipcRenderer.invoke('pigeon:saveKey', key) as Promise<void>,
    me: () => ipcRenderer.invoke('pigeon:me'),
    inboxes: () => ipcRenderer.invoke('pigeon:inboxes'),
    mail: (address: string) => ipcRenderer.invoke('pigeon:mail', address),
    mailDetail: (id: string) => ipcRenderer.invoke('pigeon:mailDetail', id),
    mailHtml: (id: string) => ipcRenderer.invoke('pigeon:mailHtml', id),
  },
};

contextBridge.exposeInMainWorld('bridge', api);

export type Bridge = typeof api;
