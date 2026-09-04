/** Shared between main, preload, and renderer. Pigeon API shapes mirror the service. */

/**
 * The API refused the key.
 *
 * Crosses IPC as an error message, because that is all an IPC error is by the
 * time the renderer sees it. Worth a named constant anyway: the renderer acts
 * on this one — it is the difference between "the network hiccuped" and "this
 * key will never work again", and only the second should ask for a new one.
 */
export const KEY_REJECTED = 'pigeon:key-rejected';

export interface Identity {
  email: string;
  name: string;
}

export interface OtpHit {
  code: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  mailId: string;
  from: Identity[];
  subject: string;
  receivedAt: string;
}

export interface Inbox {
  address: string;
  displayName: string;
  createdAt: string;
  unread: number;
  /** Most recent code seen in the last 15 minutes, if any. */
  otp: OtpHit | null;
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
  /** Extracted server-side at ingest; null when the message carries no code. */
  otp: { code: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } | null;
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

export interface KeyStroke {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type MirrorEvent =
  | { kind: 'click'; target: ElementRef }
  | { kind: 'focus'; target: ElementRef }
  | { kind: 'input'; target: ElementRef; value: string }
  | { kind: 'submit'; target: ElementRef }
  | { kind: 'scroll'; target?: ElementRef; x: number; y: number }
  /** Typed characters ride as real key events so rich editors behave. */
  | { kind: 'keystroke'; stroke: KeyStroke };

/** in-sync | drifted (different page) | missed (target not found) | paused */
export type FollowerStatus = 'synced' | 'drifted' | 'missed' | 'paused';

export interface MirrorState {
  leader: string | null;
  followers: string[];
  paused: boolean;
  /** Per-follower health, so the rail can show what's actually happening. */
  status: Record<string, FollowerStatus>;
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

/**
 * off       switched off for this inbox — deliberately, so it stays off
 * connecting  starting its node, or finding a new peer after a drop
 * connected   has an exit and can browse
 * down        the peer dropped; pages hold rather than erroring
 */
export type ExitStatus = 'off' | 'connecting' | 'connected' | 'down';

export interface ExitState {
  profile: string;
  status: ExitStatus;
  /** The country asked for, which is not always the one currently in use. */
  wanted?: string;
  country?: string;
  city?: string;
  isp?: string;
  ip?: string;
  detail?: string;
}

/**
 * How far the machine is from being able to run exits at all.
 *
 * Ordered: each step is blocked until the one before it is done, and the
 * settings panel walks the user down it.
 */
export type MystStage =
  | 'no-binary'
  | 'starting'
  | 'no-identity'
  | 'unregistered'
  | 'registering'
  | 'unfunded'
  | 'ready';

export interface MystSetup {
  stage: MystStage;
  binaryPath: string | null;
  identity: string | null;
  /** Where to send MYST. The identity address is NOT this, and does not work. */
  channelAddress: string | null;
  balance: number;
  /** MYST per GiB at current network prices, for showing what a top-up buys. */
  pricePerGib: number | null;
  /**
   * An identity sitting unused on this machine, unlinked but not deleted.
   * Offered as a one-click way back rather than making someone find the
   * keystore file again.
   */
  relinkable?: string | null;
  error?: string;
}

/**
 * An invented person for one inbox, for signup forms that want a name and a
 * date of birth. Names and dates only, and never anything that would pass for
 * a real document.
 */
export interface Persona {
  profile: string;
  firstName: string;
  lastName: string;
  birthDay: number;
  birthMonth: number;
  birthYear: number;
  /** ISO code, because country selects key on it far more often than on the name. */
  country: string;
  /** Full name, not a code: state dropdowns often use opaque numeric ids. */
  state: string;
  updatedAt: string;
}

/**
 * What a fill actually managed to do on the page in front of you.
 *
 * Reported per field rather than as one boolean because "nothing happened" and
 * "filled the email but this form has no password box" are different answers,
 * and only one of them is a problem.
 */
export interface FillResult {
  filled: string[];
  /** Fields the page asked for that we had nothing to put in. */
  missing: string[];
}

/** A country the network currently has residential exits in. */
export interface ExitCountry {
  code: string;
  count: number;
}

export interface BrowserState {
  activeProfile: string | null;
  profiles: Record<string, ProfileTabs>;
  panelOpen: boolean;
}
