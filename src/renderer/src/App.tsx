import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserState, Inbox } from '../../shared/types';
import { KeySetup } from './components/KeySetup';
import { MailPanel } from './components/MailPanel';
import { Rail } from './components/Rail';
import { SettingsOverlay } from './components/SettingsOverlay';
import { TabStrip } from './components/TabStrip';

const RAIL_COLLAPSED = 56;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const stored = (key: string, fallback: number, lo: number, hi: number) =>
  clamp(Number(localStorage.getItem(key)) || fallback, lo, hi);

/**
 * Draggable divider. The page's native view eats mouse events, so the drag
 * hides it (onStart) and the caller restores it in onDone.
 */
function ResizeHandle({
  onStart,
  onDrag,
  onDone,
}: {
  onStart: () => void;
  onDrag: (clientX: number) => void;
  onDone: () => void;
}) {
  // Pointer capture keeps the drag alive even when the cursor crosses the
  // mail iframe (iframes otherwise swallow the moves); the wrapper gives a
  // 12px grab zone around a 1px visual line.
  return (
    <div
      className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart();
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.clientX);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onDone();
      }}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:w-0.5 group-hover:bg-primary group-active:bg-primary" />
    </div>
  );
}

export default function App() {
  const [keyed, setKeyed] = useState<boolean | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('railCollapsed') === '1');
  const [railWidth, setRailWidth] = useState(() => stored('railWidth', 224, 160, 400));
  const [panelWidth, setPanelWidth] = useState(() => stored('panelWidth', 384, 280, 640));
  const railWidthRef = useRef(railWidth);
  const panelWidthRef = useRef(panelWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Main positions the native view from these — push the remembered values once.
  useEffect(() => {
    void window.bridge.tabs.setRailWidth(railCollapsed ? RAIL_COLLAPSED : railWidthRef.current);
    void window.bridge.tabs.setPanelWidth(panelWidthRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [notice, setNotice] = useState<string | null>(null);

  function setSettingsOpenAndContent(open: boolean) {
    setSettingsOpen(open);
    // Overlay covers the page area — same native-view dance as bookmarks.
    void window.bridge.tabs.setContentVisible(!open);
  }

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

  // Fresh launch lands on the first inbox instead of an empty pane.
  useEffect(() => {
    if (browser && browser.activeProfile === null && inboxes.length > 0) {
      void window.bridge.tabs.setProfile(inboxes[0].address);
    }
  }, [browser, inboxes]);

  function toggleRail() {
    const next = !railCollapsed;
    setRailCollapsed(next);
    localStorage.setItem('railCollapsed', next ? '1' : '0');
    // Main repositions the native browser view to the new chrome width.
    void window.bridge.tabs.setRailWidth(next ? RAIL_COLLAPSED : railWidthRef.current);
  }

  function railDrag(clientX: number) {
    const w = clamp(clientX, 160, 400);
    railWidthRef.current = w;
    setRailWidth(w);
  }

  function railDone() {
    localStorage.setItem('railWidth', String(railWidthRef.current));
    void window.bridge.tabs.setRailWidth(railWidthRef.current);
    void window.bridge.tabs.setContentVisible(true);
  }

  function panelDrag(clientX: number) {
    const w = clamp(window.innerWidth - clientX, 280, 640);
    panelWidthRef.current = w;
    setPanelWidth(w);
  }

  function panelDone() {
    localStorage.setItem('panelWidth', String(panelWidthRef.current));
    void window.bridge.tabs.setPanelWidth(panelWidthRef.current);
    void window.bridge.tabs.setContentVisible(true);
  }

  const hideContent = () => void window.bridge.tabs.setContentVisible(false);

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
        width={railWidth}
        onToggleCollapsed={toggleRail}
        onSelect={(address) => void window.bridge.tabs.setProfile(address)}
        onOpenSettings={() => setSettingsOpenAndContent(true)}
      />
      {!railCollapsed && <ResizeHandle onStart={hideContent} onDrag={railDrag} onDone={railDone} />}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpenAndContent(false)} />}
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
          {panelOpen && activeProfile && (
            <>
              <ResizeHandle onStart={hideContent} onDrag={panelDrag} onDone={panelDone} />
              <MailPanel address={activeProfile} width={panelWidth} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
