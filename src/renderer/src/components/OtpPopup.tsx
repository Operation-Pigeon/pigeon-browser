import { useState } from 'react';
import { CheckIcon, CopyIcon, KeyRoundIcon, XIcon } from 'lucide-react';
import type { Arrival } from '@/lib/useOtpArrivals';

/**
 * Shows up on its own when a code lands in the inbox you're driving — the
 * whole point of the feature: the site sends an OTP and it's on screen within
 * a poll, without opening mail. Codes for other inboxes are badged in the
 * rail instead (see useOtpArrivals).
 */
export function OtpPopup({
  arrivals,
  onDismiss,
}: {
  arrivals: Arrival[];
  onDismiss: (mailId: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  if (arrivals.length === 0) return null;

  function copy(arrival: Arrival) {
    void navigator.clipboard.writeText(arrival.code);
    setCopied(arrival.mailId);
    setTimeout(() => setCopied((c) => (c === arrival.mailId ? null : c)), 1500);
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
              onClick={() => onDismiss(arrival.mailId)}
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
