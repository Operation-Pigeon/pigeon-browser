import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, CopyIcon, RotateCwIcon } from 'lucide-react';
import type { MailDetail, MailSummary } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Codes 4-8 digits in mail newer than this are offered for one-click copy. */
const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_RE = /\b(\d{4,8})\b/g;

function extractOtp(m: MailSummary): string | null {
  const haystack = `${m.subject} ${m.snippet}`;
  const candidates = [...haystack.matchAll(OTP_RE)].map((x) => x[1]);
  // Prefer 6 digits (the overwhelming convention), then longest.
  return (
    candidates.find((c) => c.length === 6) ??
    candidates.sort((a, b) => b.length - a.length)[0] ??
    null
  );
}

/**
 * Right panel: this inbox's mail, polled while open. The reason this browser
 * exists — the OTP arrives next to the login form that wants it. Width must
 * match PANEL_W in src/main/tabs.ts (w-96 = 384px).
 */
export function MailPanel({ address }: { address: string }) {
  const [mail, setMail] = useState<MailSummary[]>([]);
  const [open, setOpen] = useState<MailDetail | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.bridge.pigeon
      .mail(address)
      .then((r) => setMail((r as { emails: MailSummary[] }).emails))
      .catch(() => {});
  }, [address]);

  useEffect(() => {
    setMail([]);
    setOpen(null);
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const otps = useMemo(() => {
    const now = Date.now();
    return mail
      .filter((m) => now - new Date(m.receivedAt).getTime() < OTP_WINDOW_MS)
      .map((m) => ({ id: m.id, code: extractOtp(m), from: m.from[0]?.name || m.from[0]?.email }))
      .filter((x): x is { id: string; code: string; from: string } => x.code !== null)
      .slice(0, 3);
  }, [mail]);

  function copy(code: string) {
    void navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l bg-sidebar">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{address}</span>
        <Button variant="ghost" size="icon-sm" onClick={refresh} title="Refresh">
          <RotateCwIcon />
        </Button>
      </div>

      {otps.length > 0 && (
        <div className="flex flex-col gap-1 border-b p-2">
          {otps.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => copy(o.code)}
              className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-sm hover:bg-primary/20"
            >
              <span className="font-mono text-base font-semibold tracking-widest">{o.code}</span>
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                from {o.from}
              </span>
              <span className="flex items-center gap-1 text-xs">
                <CopyIcon className="size-3" />
                {copied === o.code ? 'Copied ✓' : 'Copy'}
              </span>
            </button>
          ))}
        </div>
      )}

      {open ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(null)}>
              <ArrowLeftIcon />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {open.subject || '(no subject)'}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {open.from[0] ? `${open.from[0].name || open.from[0].email}` : ''} ·{' '}
              {new Date(open.receivedAt).toLocaleString()}
            </p>
            <pre className="font-sans text-sm break-words whitespace-pre-wrap select-text">
              {open.bodyText || '(empty body)'}
            </pre>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mail.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                void window.bridge.pigeon.mailDetail(m.id).then((d) => setOpen(d as MailDetail))
              }
              className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-accent/50"
            >
              <span className="flex w-full items-center gap-2">
                {!m.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    m.read ? 'text-muted-foreground' : 'font-semibold',
                  )}
                >
                  {m.from[0]?.name || m.from[0]?.email || '(unknown)'}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(m.receivedAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">
                {m.subject || '(no subject)'} — {m.snippet}
              </span>
            </button>
          ))}
          {mail.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">No mail yet.</p>
          )}
        </div>
      )}
    </aside>
  );
}
