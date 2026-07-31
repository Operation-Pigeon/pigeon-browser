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

/** How a mirrored action names its target across differing DOMs. */
export interface ElementRef {
  selector: string;
  text?: string;
  /** Classified by the leader so main knows what to substitute per inbox. */
  field?: 'email' | 'password' | 'otp' | 'other';
}

export type MirrorEvent =
  | { kind: 'click'; target: ElementRef }
  | { kind: 'input'; target: ElementRef; value: string }
  | { kind: 'submit'; target: ElementRef }
  | { kind: 'key'; target: ElementRef; key: string };

export interface MirrorState {
  leader: string | null;
  followers: string[];
  paused: boolean;
}

export interface HistoryEntry {
  id: string;
  profile: string;
  url: string;
  title: string;
  visitCount: number;
  lastVisit: string;
}

/** A capture awaiting the user's yes/no when auto-save is off. */
export interface PendingCredential {
  profile: string;
  origin: string;
  host: string;
  username: string;
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
