import { useCallback, useEffect, useState } from 'react';
import type { BrowserState, Inbox } from '../../shared/types';
import { KeySetup } from './components/KeySetup';
import { MailPanel } from './components/MailPanel';
import { Rail } from './components/Rail';
import { TabStrip } from './components/TabStrip';

const RAIL_EXPANDED = 224;
const RAIL_COLLAPSED = 56;

export default function App() {
  const [keyed, setKeyed] = useState<boolean | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const off = window.bridge.tabs.onNotice((text) => {
      setNotice(text);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 4000);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  const loadInboxes = useCallback(() => {
    window.bridge.pigeon
      .inboxes()
      .then((r) => setInboxes((r as { inboxes: Inbox[] }).inboxes))
      .catch(() => setInboxes([]));
  }, []);

  useEffect(() => {
    void window.bridge.pigeon.hasKey().then(setKeyed);
  }, []);

  useEffect(() => {
    if (!keyed) return;
    loadInboxes();
    const t = setInterval(loadInboxes, 30_000); // unread badges stay fresh
    return () => clearInterval(t);
  }, [keyed, loadInboxes]);

  useEffect(() => {
    void window.bridge.tabs.snapshot().then(setBrowser);
    return window.bridge.tabs.onState(setBrowser);
  }, []);

  function toggleRail() {
    const next = !railCollapsed;
    setRailCollapsed(next);
    // Main repositions the native browser view to the new chrome width.
    void window.bridge.tabs.setRailWidth(next ? RAIL_COLLAPSED : RAIL_EXPANDED);
  }

  if (keyed === null) return null;
  if (!keyed) return <KeySetup onDone={() => setKeyed(true)} />;

  const activeProfile = browser?.activeProfile ?? null;
  const profileTabs = activeProfile ? browser?.profiles[activeProfile] : undefined;
  const panelOpen = browser?.panelOpen ?? false;

  return (
    <div className="flex h-full">
      {/* Transient notice pill — lives inside the top chrome strip, the only
          region the native page view never covers. */}
      {notice && (
        <div className="fixed top-1.5 right-[150px] z-50 rounded-full border bg-popover px-3 py-1 text-xs text-popover-foreground shadow-md">
          {notice}
        </div>
      )}
      <Rail
        inboxes={inboxes}
        activeProfile={activeProfile}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRail}
        onSelect={(address) => void window.bridge.tabs.setProfile(address)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabStrip
          profile={activeProfile}
          allProfiles={inboxes.map((i) => i.address)}
          tabs={profileTabs?.tabs ?? []}
          activeTabId={profileTabs?.activeTabId ?? null}
          panelOpen={panelOpen}
          onTogglePanel={() => void window.bridge.tabs.setPanelOpen(!panelOpen)}
        />
        <div className="flex min-h-0 flex-1">
          {/* The WebContentsView floats over this area; it's only visible
              chrome when no profile/tab exists yet. */}
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {activeProfile ? '' : 'Pick an inbox on the left to start browsing in its session.'}
          </div>
          {panelOpen && activeProfile && <MailPanel address={activeProfile} />}
        </div>
      </div>
    </div>
  );
}
