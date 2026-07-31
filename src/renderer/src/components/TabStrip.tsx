import { useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  Loader2Icon,
  MailIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from 'lucide-react';
import type { TabInfo } from '../../../shared/types';
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
  tabs,
  activeTabId,
  panelOpen,
  onTogglePanel,
}: {
  profile: string | null;
  tabs: TabInfo[];
  activeTabId: string | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const active = tabs.find((t) => t.id === activeTabId);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);

  // Track the page unless the user is mid-edit.
  useEffect(() => {
    if (!editing) setAddress(active?.url === 'about:blank' ? '' : (active?.url ?? ''));
  }, [active?.url, active?.id, editing]);

  return (
    <div className="flex h-[84px] shrink-0 flex-col border-b">
      {/* pr reserves space for the native min/max/close overlay (Windows). */}
      <div className="app-drag flex h-10 items-center gap-1 overflow-x-auto py-1 pr-[140px] pl-1">
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
              className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted"
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
          variant={panelOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={onTogglePanel}
          title="Toggle mail panel"
        >
          <MailIcon />
        </Button>
      </div>
    </div>
  );
}
