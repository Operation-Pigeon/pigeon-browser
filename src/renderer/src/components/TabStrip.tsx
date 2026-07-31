import { useEffect, useState } from 'react';
import type { TabInfo } from '../../../shared/types';

function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:')) return s;
  if (/^[^\s]+\.[^\s]{2,}/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/**
 * Top chrome: tab strip + nav + address bar + mail-panel toggle.
 * Height must stay in sync with TOP_H in src/main/tabs.ts (84px).
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
    <div className="flex h-[84px] shrink-0 flex-col border-b border-neutral-800">
      <div className="flex h-10 items-center gap-1 overflow-x-auto px-1 pt-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex h-8 max-w-52 min-w-28 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md px-2 text-xs ${
              tab.id === activeTabId ? 'bg-neutral-800' : 'bg-neutral-900 hover:bg-neutral-800/60'
            }`}
            onClick={() => void window.bridge.tabs.activate(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) void window.bridge.tabs.close(tab.id);
            }}
          >
            {tab.favicon ? (
              <img src={tab.favicon} className="size-3.5 shrink-0" alt="" />
            ) : (
              <span className="size-3.5 shrink-0 rounded-sm bg-neutral-700" />
            )}
            <span className="min-w-0 flex-1 truncate">{tab.loading ? 'Loading…' : tab.title}</span>
            <button
              type="button"
              className="shrink-0 rounded px-1 opacity-0 group-hover:opacity-100 hover:bg-neutral-700"
              onClick={(e) => {
                e.stopPropagation();
                void window.bridge.tabs.close(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {profile && (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800"
            onClick={() => void window.bridge.tabs.create(profile)}
            title="New tab"
          >
            +
          </button>
        )}
      </div>
      <div className="flex h-[44px] items-center gap-1.5 px-2">
        <button
          type="button"
          disabled={!active?.canGoBack}
          onClick={() => active && void window.bridge.tabs.back(active.id)}
          className="rounded-md px-2 py-1 text-sm hover:bg-neutral-800 disabled:opacity-30"
          title="Back"
        >
          ←
        </button>
        <button
          type="button"
          disabled={!active?.canGoForward}
          onClick={() => active && void window.bridge.tabs.forward(active.id)}
          className="rounded-md px-2 py-1 text-sm hover:bg-neutral-800 disabled:opacity-30"
          title="Forward"
        >
          →
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => active && void window.bridge.tabs.reload(active.id)}
          className="rounded-md px-2 py-1 text-sm hover:bg-neutral-800 disabled:opacity-30"
          title="Reload"
        >
          ⟳
        </button>
        <input
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
          className="h-8 min-w-0 flex-1 rounded-full border border-neutral-800 bg-neutral-900 px-3 text-sm outline-none select-text focus:border-neutral-600"
        />
        <button
          type="button"
          onClick={onTogglePanel}
          className={`rounded-md px-2.5 py-1 text-sm ${
            panelOpen ? 'bg-neutral-800' : 'hover:bg-neutral-800'
          }`}
          title="Toggle mail panel"
        >
          ✉
        </button>
      </div>
    </div>
  );
}
