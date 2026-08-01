import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  CopyIcon,
  MailIcon,
  MailOpenIcon,
  MoonIcon,
  RotateCwIcon,
  SunIcon,
  Trash2Icon,
} from 'lucide-react';
import type { MailDetail, MailSummary } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePolling } from '@/lib/usePolling';

const BASE_MAIL_STYLE = '<style>body{margin:0;padding:12px;font-size:14px}</style>';
const DARK_MAIL_STYLE =
  '<style>:root{color-scheme:dark}body{background:transparent;color:#e7e7e7;font-family:system-ui,sans-serif}a{color:#8ab4f8}</style>';

/** Codes in mail newer than this are offered for one-click copy. */
const OTP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Right panel: this inbox's mail, polled while open. The reason this browser
 * exists — the OTP arrives next to the login form that wants it. Width must
 * match PANEL_W in src/main/tabs.ts (w-96 = 384px).
 */
export function MailPanel({ address, width }: { address: string; width: number }) {
  const [mail, setMail] = useState<MailSummary[]>([]);
  const [open, setOpen] = useState<MailDetail | null>(null);
  const [openHtml, setOpenHtml] = useState<string | null>(null);
  const [bodyView, setBodyView] = useState<'html' | 'text'>('html');
  const [frameDark, setFrameDark] = useState(false); // mail is authored for light; moon flips it
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * The server marks mail read when the detail is fetched, but the list is a
   * separate snapshot — without this the row stays bold until the next poll,
   * so backing out of a message looked like it hadn't registered.
   */
  function setRead(id: string, read: boolean) {
    setMail((prev) => prev.map((m) => (m.id === id ? { ...m, read } : m)));
  }

  function toggleRead(m: MailSummary) {
    setRead(m.id, !m.read);
    const call = m.read ? window.bridge.pigeon.markUnread : window.bridge.pigeon.markRead;
    // Roll back on failure rather than leaving the list lying about the server.
    void call(m.id).catch(() => setRead(m.id, m.read));
  }

  function remove(id: string) {
    const prev = mail;
    setMail((list) => list.filter((m) => m.id !== id));
    setOpen((o) => (o?.id === id ? null : o));
    void window.bridge.pigeon.deleteMail(id).catch(() => setMail(prev));
  }

  function openMail(id: string) {
    setOpenHtml(null);
    setBodyView('html');
    setFrameDark(false);
    setRead(id, true);
    void window.bridge.pigeon.mailDetail(id).then((d) => {
      const detail = d as MailDetail;
      setOpen(detail);
      if (detail.direction === 'OUTBOUND' && detail.bodyHtml) {
        setOpenHtml(detail.bodyHtml);
      } else if (detail.hasHtml) {
        void window.bridge.pigeon
          .mailHtml(id)
          .then((r) => setOpenHtml((r as { html: string }).html))
          .catch(() => setOpenHtml(null));
      }
    });
  }

  const refresh = useCallback(() => {
    window.bridge.pigeon
      .mail(address)
      .then((r) => setMail((r as { emails: MailSummary[] }).emails))
      .catch(() => {});
  }, [address]);

  // Switching inbox clears immediately so the panel never shows one inbox's
  // mail under another's name; polling itself is focus-gated below.
  useEffect(() => {
    setMail([]);
    setOpen(null);
    refresh();
  }, [refresh]);

  usePolling(refresh, 10_000);

  // Codes come from the API, which extracts them at ingest from the full
  // body. The panel used to re-derive them from the subject and snippet with
  // a bare \d{4,8} — which happily offered "2026" out of a copyright line as
  // your login code. Two extractors also meant the chip and the popup could
  // disagree about the same message.
  const otps = useMemo(() => {
    const now = Date.now();
    return mail
      .filter((m) => m.otp && now - new Date(m.receivedAt).getTime() < OTP_WINDOW_MS)
      .map((m) => ({
        id: m.id,
        code: m.otp!.code,
        confidence: m.otp!.confidence,
        from: m.from[0]?.name || m.from[0]?.email || '(unknown)',
      }))
      .slice(0, 3);
  }, [mail]);

  function copy(code: string) {
    void navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-l bg-sidebar">
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
                {/* A guess worth showing but not trusting silently. */}
                {o.confidence !== 'HIGH' && ' · unsure'}
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
          <div className="flex items-center gap-1 border-b px-2 py-2">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Back to mail list"
              onClick={() => setOpen(null)}
            >
              <ArrowLeftIcon />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {open.subject || '(no subject)'}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Mark unread"
              onClick={() => {
                setRead(open.id, false);
                void window.bridge.pigeon.markUnread(open.id);
                setOpen(null);
              }}
            >
              <MailIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete"
              onClick={() => remove(open.id)}
            >
              <Trash2Icon />
            </Button>
            {openHtml !== null && (
              <>
                <Button
                  variant={bodyView === 'html' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setBodyView('html')}
                >
                  HTML
                </Button>
                <Button
                  variant={bodyView === 'text' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setBodyView('text')}
                >
                  Text
                </Button>
                {bodyView === 'html' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setFrameDark(!frameDark)}
                    title={frameDark ? 'Light background' : 'Dark background'}
                  >
                    {frameDark ? <SunIcon /> : <MoonIcon />}
                  </Button>
                )}
              </>
            )}
          </div>
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">
            {open.from[0] ? `${open.from[0].name || open.from[0].email}` : ''} ·{' '}
            {new Date(open.receivedAt).toLocaleString()}
          </p>
          {openHtml !== null && bodyView === 'html' ? (
            // Scripts stay dead (no allow-scripts); allow-popups + base
            // target=_blank turns every link into a window.open, which the
            // chrome's windowOpenHandler routes into a new tab in THIS
            // inbox's session.
            <iframe
              sandbox="allow-popups"
              srcDoc={
                '<base target="_blank">' +
                BASE_MAIL_STYLE +
                (frameDark ? DARK_MAIL_STYLE : '') +
                openHtml
              }
              title="Message body"
              className={cn('min-h-0 flex-1', frameDark ? 'bg-transparent' : 'bg-white')}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <pre className="font-sans text-sm break-words whitespace-pre-wrap select-text">
                {open.bodyText || '(empty body)'}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Row is a div, not a button: the actions are buttons themselves
              and nesting them is invalid. The open target stays a button so
              keyboard and screen readers still treat the row as one. */}
          {mail.map((m) => (
            <div key={m.id} className="group relative border-b hover:bg-accent/50">
              <button
                type="button"
                onClick={() => openMail(m.id)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left"
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
                  {/* Hidden while the actions are showing, so the timestamp
                      never sits underneath them. */}
                  <span className="shrink-0 text-xs text-muted-foreground group-hover:invisible">
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
              <div className="absolute top-1.5 right-2 hidden items-center gap-0.5 group-hover:flex">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={m.read ? 'Mark unread' : 'Mark read'}
                  onClick={() => toggleRead(m)}
                >
                  {m.read ? <MailIcon /> : <MailOpenIcon />}
                </Button>
                <Button variant="ghost" size="icon-sm" title="Delete" onClick={() => remove(m.id)}>
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))}
          {mail.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">No mail yet.</p>
          )}
        </div>
      )}
    </aside>
  );
}
