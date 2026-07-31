import { useCallback, useEffect, useState } from 'react';
import type { BrowserState, Inbox } from '../../shared/types';
import { KeySetup } from './components/KeySetup';
import { MailPanel } from './components/MailPanel';
import { Rail } from './components/Rail';
import { TabStrip } from './components/TabStrip';

export default function App() {
  const [keyed, setKeyed] = useState<boolean | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [browser, setBrowser] = useState<BrowserState | null>(null);

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

  if (keyed === null) return null;
  if (!keyed) return <KeySetup onDone={() => setKeyed(true)} />;

  const activeProfile = browser?.activeProfile ?? null;
  const profileTabs = activeProfile ? browser?.profiles[activeProfile] : undefined;
  const panelOpen = browser?.panelOpen ?? false;

  return (
    <div className="flex h-full">
      <Rail
        inboxes={inboxes}
        activeProfile={activeProfile}
        onSelect={(address) => void window.bridge.tabs.setProfile(address)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TabStrip
          profile={activeProfile}
          tabs={profileTabs?.tabs ?? []}
          activeTabId={profileTabs?.activeTabId ?? null}
          panelOpen={panelOpen}
          onTogglePanel={() => void window.bridge.tabs.setPanelOpen(!panelOpen)}
        />
        <div className="flex min-h-0 flex-1">
          {/* The WebContentsView floats over this area; it's only visible
              chrome when no profile/tab exists yet. */}
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            {activeProfile ? '' : 'Pick an inbox on the left to start browsing in its session.'}
          </div>
          {panelOpen && activeProfile && <MailPanel address={activeProfile} />}
        </div>
      </div>
    </div>
  );
}
