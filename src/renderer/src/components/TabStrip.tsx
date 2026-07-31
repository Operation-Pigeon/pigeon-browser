import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  GlobeIcon,
  KeyIcon,
  LayersIcon,
  Loader2Icon,
  MailIcon,
  PlusIcon,
  RotateCwIcon,
  StarIcon,
  XIcon,
} from 'lucide-react';
import type { Bookmark, TabInfo } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:')) return s;
  if (/^[^\s]+\.[^\s]{2,}/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/**
 * Top chrome: tab strip (doubles as the window drag region, with room
 * reserved for the native caption buttons) + nav + address bar + mail
 * toggle. Height must stay in sync with TOP_H in src/main/tabs.ts (84px).
 */
export function TabStrip({
  profile,
  allProfiles,
  tabs,
  activeTabId,
  rightPanel,
  onSelectPanel,
}: {
  profile: string | null;
  allProfiles: string[];
  tabs: TabInfo[];
  activeTabId: string | null;
  rightPanel: 'mail' | 'passwords' | null;
  onSelectPanel: (panel: 'mail' | 'passwords') => void;
}) {
  const active = tabs.find((t) => t.id === activeTabId);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  function setBookmarksOpenAndContent(open: boolean) {
    setBookmarksOpen(open);
    // The dropdown drops into the page region, which the native view owns —
    // hide the page while it's open or it eats the popover.
    void window.bridge.tabs.setContentVisible(!open);
  }

  useEffect(() => {
    void window.bridge.bookmarks.list().then(setBookmarks);
    return window.bridge.bookmarks.onChanged(setBookmarks);
  }, []);

  const currentBookmarked = !!active && bookmarks.some((b) => b.url === active.url);

  /** Same URL, every inbox's own session — foreground here, background elsewhere. */
  function openInAllInboxes(url: string) {
    for (const p of allProfiles) {
      void window.bridge.tabs.create(p, url, p !== profile);
    }
    setBookmarksOpenAndContent(false);
  }

  // Track the page unless the user is mid-edit.
  useEffect(() => {
    if (!editing) setAddress(active?.url === 'about:blank' ? '' : (active?.url ?? ''));
  }, [active?.url, active?.id, editing]);

  // Ctrl+L lands here from the main process.
  useEffect(
    () =>
      window.bridge.tabs.onFocusAddress(() => {
        addressRef.current?.focus();
        addressRef.current?.select();
      }),
    [],
  );

  return (
    <div className="flex h-[84px] shrink-0 flex-col border-b">
      {/* pr reserves space for the native min/max/close overlay (Windows).
          Middle-mousedown is suppressed here: the scrollable strip otherwise
          triggers Chromium's autoscroll before auxclick can close a tab. */}
      <div
        className="app-drag flex h-10 items-center gap-1 overflow-x-auto py-1 pr-[140px] pl-1"
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'app-no-drag group flex h-8 max-w-52 min-w-28 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs',
              tab.id === activeTabId ? 'bg-accent' : 'hover:bg-accent/50',
            )}
            onClick={() => void window.bridge.tabs.activate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) void window.bridge.tabs.close(tab.id);
            }}
          >
            {tab.loading ? (
              <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : tab.favicon ? (
              <img src={tab.favicon} className="size-3.5 shrink-0" alt="" />
            ) : (
              <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground active:scale-95"
              onClick={(e) => {
                e.stopPropagation();
                void window.bridge.tabs.close(tab.id);
              }}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
        {profile && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag shrink-0"
            onClick={() => void window.bridge.tabs.create(profile)}
            title="New tab"
          >
            <PlusIcon />
          </Button>
        )}
      </div>
      <div className="flex h-[44px] items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!active?.canGoBack}
          onClick={() => active && void window.bridge.tabs.back(active.id)}
          title="Back"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!active?.canGoForward}
          onClick={() => active && void window.bridge.tabs.forward(active.id)}
          title="Forward"
        >
          <ArrowRightIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!active}
          onClick={() => active && void window.bridge.tabs.reload(active.id)}
          title="Reload"
        >
          <RotateCwIcon />
        </Button>
        <Input
          ref={addressRef}
          value={address}
          disabled={!active}
          placeholder={profile ? `Browsing as ${profile}` : ''}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && active && address.trim()) {
              void window.bridge.tabs.navigate(active.id, normalizeUrl(address));
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          className="h-8 flex-1 rounded-full select-text"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!active || !active.url || active.url === 'about:blank'}
          onClick={() =>
            active &&
            void window.bridge.bookmarks.toggle(active.url, active.title, active.favicon)
          }
          title={currentBookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
        >
          <StarIcon className={cn(currentBookmarked && 'fill-primary text-primary')} />
        </Button>
        <Button
          variant={bookmarksOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          title="Bookmarks"
          onClick={() => setBookmarksOpenAndContent(!bookmarksOpen)}
        >
          <BookmarkIcon />
        </Button>
        {/* Hand-rolled dropdown: chrome overlays coordinate with the native
            page view (hidden while open), so a plain fixed panel beats a
            positioning library here. */}
        {bookmarksOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setBookmarksOpenAndContent(false)} />
            <div className="fixed top-[88px] right-14 z-50 w-80 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              {bookmarks.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  No bookmarks yet — star a page or press Ctrl+D.
                </p>
              ) : (
                <div className="flex max-h-96 flex-col overflow-y-auto">
                  {bookmarks.map((b) => (
                    <div
                      key={b.id}
                      className="group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={() => {
                        if (!active) return;
                        void window.bridge.tabs.navigate(active.id, b.url);
                        setBookmarksOpenAndContent(false);
                      }}
                    >
                      {b.favicon ? (
                        <img src={b.favicon} className="size-3.5 shrink-0" alt="" />
                      ) : (
                        <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{b.title}</span>
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground active:scale-95"
                        title="Open in every inbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          openInAllInboxes(b.url);
                        }}
                      >
                        <LayersIcon className="size-3" />
                      </button>
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground active:scale-95"
                        title="Remove bookmark"
                        onClick={(e) => {
                          e.stopPropagation();
                          void window.bridge.bookmarks.remove(b.id);
                        }}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <Button
          variant={rightPanel === 'passwords' ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => onSelectPanel('passwords')}
          title="Saved passwords for this inbox"
        >
          <KeyIcon />
        </Button>
        <Button
          variant={rightPanel === 'mail' ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => onSelectPanel('mail')}
          title="Toggle mail panel"
        >
          <MailIcon />
        </Button>
      </div>
    </div>
  );
}
