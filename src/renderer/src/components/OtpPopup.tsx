import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, KeyRoundIcon, XIcon } from 'lucide-react';
import type { Inbox, OtpHit } from '../../../shared/types';

interface Arrival extends OtpHit {
  inbox: string;
}

/**
 * Shows up on its own when a code lands — the whole point of the feature:
 * the site sends an OTP and it's on screen within a poll, without opening
 * mail. Dismissed codes never return, and codes already on screen when the
 * app starts are ignored (they're history, not news).
 */
export function OtpPopup({ inboxes }: { inboxes: Inbox[] }) {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const fresh: Arrival[] = [];
    // First poll only records what's already there; anything after it is a
    // genuine arrival worth interrupting for.
    const first = seen.current === null;
    if (first) seen.current = new Set();

    for (const inbox of inboxes) {
      if (!inbox.otp) continue;
      const key = `${inbox.address}:${inbox.otp.mailId}`;
      if (seen.current!.has(key)) continue;
      seen.current!.add(key);
      if (!first) fresh.push({ ...inbox.otp, inbox: inbox.address });
    }
    if (fresh.length) setArrivals((current) => [...fresh, ...current].slice(0, 3));
  }, [inboxes]);

  if (arrivals.length === 0) return null;

  function copy(arrival: Arrival) {
    void navigator.clipboard.writeText(arrival.code);
    setCopied(arrival.mailId);
    setTimeout(() => setCopied((c) => (c === arrival.mailId ? null : c)), 1500);
  }

  function dismiss(mailId: string) {
    setArrivals((current) => current.filter((a) => a.mailId !== mailId));
  }

  return (
    <div className="app-no-drag fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {arrivals.map((arrival) => (
        <div
          key={arrival.mailId}
          className="flex w-80 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 shrink-0 text-sky-400" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {arrival.from[0]?.name || arrival.from[0]?.email || 'Unknown sender'} ·{' '}
              {arrival.inbox}
            </span>
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => dismiss(arrival.mailId)}
              title="Dismiss"
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-3 rounded-md bg-primary/10 px-3 py-2 hover:bg-primary/20"
            onClick={() => copy(arrival)}
          >
            <span className="font-mono text-2xl font-semibold tracking-[0.2em]">{arrival.code}</span>
            <span className="ml-auto flex items-center gap-1 text-xs">
              {copied === arrival.mailId ? (
                <>
                  <CheckIcon className="size-3" />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon className="size-3" />
                  Copy
                </>
              )}
            </span>
          </button>
          {arrival.confidence !== 'HIGH' && (
            <span className="text-xs text-muted-foreground">
              Best guess from “{arrival.subject || 'no subject'}” — check the mail if it fails.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
