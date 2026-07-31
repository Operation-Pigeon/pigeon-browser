/** Shared between main, preload, and renderer. Pigeon API shapes mirror the service. */

export interface Identity {
  email: string;
  name: string;
}

export interface Inbox {
  address: string;
  displayName: string;
  createdAt: string;
  unread: number;
}

export interface MailSummary {
  id: string;
  threadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from: Identity[];
  subject: string;
  receivedAt: string;
  snippet: string;
  attachmentCount: number;
  deletedAt: string | null;
  count: number;
  read: boolean;
}

export interface MailDetail {
  id: string;
  inbox: string;
  threadId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  from: Identity[];
  to: Identity[];
  cc: Identity[];
  subject: string;
  receivedAt: string;
  bodyText: string;
  bodyHtml: string;
  hasHtml: boolean;
}

export interface SavedPassword {
  id: string;
  profile: string;
  origin: string;
  username: string;
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  createdAt: string;
}

export interface TabInfo {
  id: string;
  profile: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface ProfileTabs {
  tabs: TabInfo[];
  activeTabId: string | null;
}

export interface BrowserState {
  activeProfile: string | null;
  profiles: Record<string, ProfileTabs>;
  panelOpen: boolean;
}
