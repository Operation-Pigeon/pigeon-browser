import { useCallback, useEffect, useRef, useState } from 'react';
import type { Inbox, OtpHit } from '../../../shared/types';

export interface Arrival extends OtpHit {
  inbox: string;
}

/**
 * Splits incoming codes by where they landed: the inbox you're looking at
 * pops a card, every other inbox just gets a mark in the rail.
 *
 * A code arriving in a session you aren't driving is information, not an
 * interruption — it belongs to a login happening somewhere else, and popping
 * it over the page you're working in is noise that also leaks the code onto
 * whatever is on screen.
 *
 * Codes already present at the first poll are recorded but never surfaced:
 * they're history, not news.
 */
export function useOtpArrivals(inboxes: Inbox[], activeProfile: string | null) {
  const [popups, setPopups] = useState<Arrival[]>([]);
  const [badges, setBadges] = useState<Record<string, Arrival>>({});
  const seen = useRef<Set<string> | null>(null);
  // Read inside an effect that must not re-run when the inbox merely changes.
  const active = useRef(activeProfile);
  active.current = activeProfile;

  useEffect(() => {
    // The list starts empty before the first response lands. Treating that as
    // the baseline burns it on nothing, so the first real poll then looks
    // like a burst of arrivals and announces codes that were already sitting
    // there when the app opened.
    if (inboxes.length === 0) return;

    const first = seen.current === null;
    if (first) seen.current = new Set();

    const fresh: Arrival[] = [];
    for (const inbox of inboxes) {
      if (!inbox.otp) continue;
      const key = `${inbox.address}:${inbox.otp.mailId}`;
      if (seen.current!.has(key)) continue;
      seen.current!.add(key);
      if (!first) fresh.push({ ...inbox.otp, inbox: inbox.address });
    }
    if (!fresh.length) return;

    const mine = fresh.filter((a) => a.inbox === active.current);
    const others = fresh.filter((a) => a.inbox !== active.current);
    if (mine.length) setPopups((current) => [...mine, ...current].slice(0, 3));
    if (others.length) {
      // Newest wins per inbox — the badge is "there's a code waiting", not a
      // queue to work through.
      setBadges((current) => ({
        ...current,
        ...Object.fromEntries(others.map((a) => [a.inbox, a])),
      }));
    }
  }, [inboxes]);

  const dismissPopup = useCallback((mailId: string) => {
    setPopups((current) => current.filter((a) => a.mailId !== mailId));
  }, []);

  /** Switching to an inbox is how you answer its badge. */
  const clearBadge = useCallback((address: string) => {
    setBadges((current) => {
      if (!(address in current)) return current;
      const next = { ...current };
      delete next[address];
      return next;
    });
  }, []);

  return { popups, badges, dismissPopup, clearBadge };
}
