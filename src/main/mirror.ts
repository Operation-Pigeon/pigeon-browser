import type { WebContents } from 'electron';
import type { MirrorEvent, MirrorState } from '../shared/types';
import { passwords } from './passwords';

/** What TabManager must provide; injected to avoid a circular import. */
export interface MirrorTabs {
  activeWebContents(profile: string): WebContents | null;
  ensureTab(profile: string): void;
  navigateProfile(profile: string, url: string): void;
  broadcastMirrorRoles(): void;
}

/**
 * Multi-inbox control: one leader inbox drives N followers. Actions are
 * mirrored semantically (this element, this value) rather than as raw input,
 * because the same site renders in a different session per inbox.
 *
 * Identity is deliberately NOT mirrored: email fields get each follower's own
 * address and password fields its own stored credential, so N accounts stay N
 * accounts. One-time codes are never mirrored at all — that's what pause is
 * for.
 */
class MirrorController {
  private tabs: MirrorTabs | null = null;
  private leader: string | null = null;
  private followers = new Set<string>();
  private paused = false;

  attach(tabs: MirrorTabs): void {
    this.tabs = tabs;
  }

  state(): MirrorState {
    return { leader: this.leader, followers: [...this.followers], paused: this.paused };
  }

  start(leader: string, followers: string[]): void {
    this.leader = leader;
    this.followers = new Set(followers.filter((f) => f !== leader));
    this.paused = false;
    // A follower with no tab can't receive anything.
    for (const f of this.followers) this.tabs?.ensureTab(f);
    this.tabs?.broadcastMirrorRoles();
  }

  stop(): void {
    this.leader = null;
    this.followers.clear();
    this.paused = false;
    this.tabs?.broadcastMirrorRoles();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.tabs?.broadcastMirrorRoles();
  }

  roleFor(profile: string): 'leader' | 'follower' | 'off' {
    if (this.paused || !this.leader) return 'off';
    if (profile === this.leader) return 'leader';
    return this.followers.has(profile) ? 'follower' : 'off';
  }

  /** Leader navigated — followers follow, in their own sessions. */
  onLeaderNavigate(profile: string, url: string): void {
    if (this.paused || profile !== this.leader) return;
    for (const follower of this.followers) {
      const wc = this.tabs?.activeWebContents(follower);
      if (wc && wc.getURL() !== url) this.tabs?.navigateProfile(follower, url);
    }
  }

  onLeaderEvent(profile: string, event: MirrorEvent): void {
    if (this.paused || profile !== this.leader) return;

    for (const follower of this.followers) {
      const wc = this.tabs?.activeWebContents(follower);
      if (!wc) continue;
      const outgoing = this.substitute(event, follower, wc);
      if (outgoing) wc.send('mirror:apply', outgoing);
    }
  }

  /** Rewrites identity-bearing values so each inbox stays itself. */
  private substitute(event: MirrorEvent, follower: string, wc: WebContents): MirrorEvent | null {
    if (event.kind !== 'input') return event;

    switch (event.target.field) {
      case 'otp':
        // Never mirrored: a code belongs to exactly one session.
        return null;
      case 'email':
        return { ...event, value: follower };
      case 'password': {
        let origin = '';
        try {
          origin = new URL(wc.getURL()).origin;
        } catch {
          return null;
        }
        const cred = passwords.get(follower, origin);
        // No stored credential means there's nothing safe to type — leave the
        // field for the user rather than leaking the leader's password.
        return cred ? { ...event, value: cred.password } : null;
      }
      default:
        return event;
    }
  }
}

export const mirror = new MirrorController();
