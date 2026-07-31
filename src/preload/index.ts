import { contextBridge, ipcRenderer } from 'electron';
import type { Bookmark, BrowserState } from '../shared/types';

const api = {
  tabs: {
    setProfile: (profile: string) => ipcRenderer.invoke('tabs:setProfile', profile),
    create: (profile: string, url?: string, background?: boolean) =>
      ipcRenderer.invoke('tabs:create', profile, url, background),
    close: (id: string) => ipcRenderer.invoke('tabs:close', id),
    activate: (id: string) => ipcRenderer.invoke('tabs:activate', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('tabs:navigate', id, url),
    back: (id: string) => ipcRenderer.invoke('tabs:back', id),
    forward: (id: string) => ipcRenderer.invoke('tabs:forward', id),
    reload: (id: string) => ipcRenderer.invoke('tabs:reload', id),
    setPanelOpen: (open: boolean) => ipcRenderer.invoke('tabs:panel', open),
    setRailWidth: (width: number) => ipcRenderer.invoke('tabs:railWidth', width),
    setContentVisible: (visible: boolean) => ipcRenderer.invoke('tabs:contentVisible', visible),
    snapshot: () => ipcRenderer.invoke('tabs:snapshot') as Promise<BrowserState>,
    onState: (cb: (state: BrowserState) => void): (() => void) => {
      const listener = (_e: unknown, state: BrowserState) => cb(state);
      ipcRenderer.on('browser:state', listener);
      return () => {
        ipcRenderer.removeListener('browser:state', listener);
      };
    },
    onFocusAddress: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('chrome:focusAddress', listener);
      return () => {
        ipcRenderer.removeListener('chrome:focusAddress', listener);
      };
    },
  },
  bookmarks: {
    list: () => ipcRenderer.invoke('bookmarks:list') as Promise<Bookmark[]>,
    toggle: (url: string, title: string, favicon: string | null) =>
      ipcRenderer.invoke('bookmarks:toggle', url, title, favicon) as Promise<boolean>,
    remove: (id: string) => ipcRenderer.invoke('bookmarks:remove', id),
    onChanged: (cb: (list: Bookmark[]) => void): (() => void) => {
      const listener = (_e: unknown, list: Bookmark[]) => cb(list);
      ipcRenderer.on('bookmarks:changed', listener);
      return () => {
        ipcRenderer.removeListener('bookmarks:changed', listener);
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
