import type { WebContents } from 'electron';
import type { FollowerStatus, MirrorEvent, MirrorState } from '../shared/types';
import { passwords } from './passwords';

/** What TabManager must provide; injected to avoid a circular import. */
export interface MirrorTabs {
  activeWebContents(profile: string): WebContents | null;
  ensureTab(profile: string): void;
  navigateProfile(profile: string, url: string): void;
  broadcastMirrorRoles(): void;
}

/** Same page for mirroring purposes: origin + path, ignoring query/hash noise. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/**
 * Multi-inbox control: one leader inbox drives N followers. Actions mirror
 * semantically (this element, this value) rather than as raw input, because
 * the same site renders differently in each session.
 *
 * Identity never mirrors — email fields get each follower's own address,
 * password fields its own stored credential — and one-time codes are refused
 * outright, which is what pause exists for.
 *
 * Divergence is the hard part: a follower on a different page must NEVER have
 * actions replayed into it (that's how you click the wrong button in someone
 * else's account), so every apply is guarded by a page check and every
 * follower carries a visible status.
 */
class MirrorController {
  private tabs: MirrorTabs | null = null;
  private leader: string | null = null;
  private followers = new Set<string>();
  private paused = false;
  private pausedFollowers = new Set<string>();
  private status = new Map<string, FollowerStatus>();
  private onChange: (() => void) | null = null;

  attach(tabs: MirrorTabs, onChange: () => void): void {
    this.tabs = tabs;
    this.onChange = onChange;
  }

  state(): MirrorState {
    const status: Record<string, FollowerStatus> = {};
    for (const f of this.followers) {
      status[f] = this.pausedFollowers.has(f) ? 'paused' : (this.status.get(f) ?? 'synced');
    }
    return { leader: this.leader, followers: [...this.followers], paused: this.paused, status };
  }

  private changed(): void {
    this.onChange?.();
  }

  start(leader: string, followers: string[]): void {
    this.leader = leader;
    this.followers = new Set(followers.filter((f) => f !== leader));
    this.paused = false;
    this.pausedFollowers.clear();
    this.status.clear();
    for (const f of this.followers) this.tabs?.ensureTab(f);
    this.tabs?.broadcastMirrorRoles();
    this.changed();
  }

  stop(): void {
    this.leader = null;
    this.followers.clear();
    this.pausedFollowers.clear();
    this.status.clear();
    this.paused = false;
    this.tabs?.broadcastMirrorRoles();
    this.changed();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.tabs?.broadcastMirrorRoles();
    this.changed();
  }

  /** Pause one inbox (its OTP step) while the rest keep moving. */
  setFollowerPaused(profile: string, paused: boolean): void {
    if (paused) this.pausedFollowers.add(profile);
    else this.pausedFollowers.delete(profile);
    this.changed();
  }

  /**
   * Whichever inbox the user is viewing drives the rest: they switch to a
   * deviant one to fix it by hand, and it takes over from there.
   */
  makeLeader(profile: string): void {
    if (!this.leader || profile === this.leader || !this.followers.has(profile)) return;
    const previous = this.leader;
    this.followers.delete(profile);
    this.followers.add(previous);
    this.leader = profile;
    this.status.delete(profile);
    this.tabs?.broadcastMirrorRoles();
    this.changed();
  }

  /** Drag every follower back to the leader's current page. */
  resync(): void {
    if (!this.leader) return;
    const leaderUrl = this.tabs?.activeWebContents(this.leader)?.getURL();
    if (!leaderUrl) return;
    for (const follower of this.followers) {
      this.tabs?.navigateProfile(follower, leaderUrl);
      this.status.set(follower, 'synced');
    }
    this.changed();
  }

  roleFor(profile: string): 'leader' | 'follower' | 'off' {
    if (this.paused || !this.leader) return 'off';
    if (profile === this.leader) return 'leader';
    if (!this.followers.has(profile)) return 'off';
    return this.pausedFollowers.has(profile) ? 'off' : 'follower';
  }

  onLeaderNavigate(profile: string, url: string): void {
    if (this.paused || profile !== this.leader) return;
    for (const follower of this.followers) {
      if (this.pausedFollowers.has(follower)) continue;
      const wc = this.tabs?.activeWebContents(follower);
      if (!wc) continue;
      if (!samePage(wc.getURL(), url)) this.tabs?.navigateProfile(follower, url);
      this.status.set(follower, 'synced');
    }
    this.changed();
  }

  /** Followers report whether an action actually landed. */
  onApplyResult(profile: string, ok: boolean): void {
    if (!this.followers.has(profile)) return;
    this.status.set(profile, ok ? 'synced' : 'missed');
    this.changed();
  }

  onLeaderEvent(profile: string, event: MirrorEvent): void {
    if (this.paused || profile !== this.leader) return;
    const leaderUrl = this.tabs?.activeWebContents(profile)?.getURL() ?? '';

    for (const follower of this.followers) {
      if (this.pausedFollowers.has(follower)) continue;
      const wc = this.tabs?.activeWebContents(follower);
      if (!wc) continue;

      // The guard that matters: a follower parked on a different page (extra
      // consent screen, redirect, captcha) must not receive clicks meant for
      // the leader's page — a matching selector there could be anything.
      if (!samePage(wc.getURL(), leaderUrl)) {
        this.status.set(follower, 'drifted');
        this.changed();
        continue;
      }

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
        // No stored credential means nothing safe to type — leave the field
        // rather than leaking the leader's password.
        return cred ? { ...event, value: cred.password } : null;
      }
      default:
        return event;
    }
  }
}

export const mirror = new MirrorController();
