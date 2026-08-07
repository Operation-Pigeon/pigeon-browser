import { useCallback, useEffect, useRef, useState } from 'react';
import { KEY_REJECTED, type BrowserState, type Inbox, type MirrorState } from '../../shared/types';
import { HistoryPanel } from './components/HistoryPanel';
import { KeySetup } from './components/KeySetup';
import { MirrorControls } from './components/MirrorControls';
import { OtpPopup } from './components/OtpPopup';
import { MailPanel } from './components/MailPanel';
import { PasswordPanel } from './components/PasswordPanel';
import { Rail } from './components/Rail';
import { SavePasswordPrompt } from './components/SavePasswordPrompt';
import { SettingsOverlay } from './components/SettingsOverlay';
import { TabStrip } from './components/TabStrip';
import { usePolling } from './lib/usePolling';
import { useOtpArrivals } from './lib/useOtpArrivals';

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
  // One right bar at a time.
  const [rightPanel, setRightPanel] = useState<'mail' | 'passwords' | 'history' | null>(null);
  const [mirror, setMirror] = useState<MirrorState>({
    leader: null,
    followers: [],
    paused: false,
    status: {},
  });
  const [mirrorPicking, setMirrorPicking] = useState(false);
  const [mirrorSelection, setMirrorSelection] = useState<string[]>([]);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.bridge.mirror.state().then(setMirror);
    return window.bridge.mirror.onState(setMirror);
  }, []);

  // The mirror bar changes the chrome's height; main positions the native
  // page view from whatever we measure here.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      void window.bridge.tabs.setTopHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    void window.bridge.tabs.setOverlay('settings', open);
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
      .catch((error: unknown) => {
        setInboxes([]);
        // A refused key is not a failed request to shrug at. Every key minted
        // against v0 is refused by v1, so without this the first launch after
        // the migration is an empty rail with the fix buried in Settings.
        // Anything else — a blip, a 500 — leaves the key alone and retries on
        // the next poll.
        if (String(error).includes(KEY_REJECTED)) setKeyed(false);
      });
  }, []);

  useEffect(() => {
    void window.bridge.pigeon.hasKey().then(setKeyed);
  }, []);

  // 10s: fast enough that a code shows up well inside a minute, and it's a
  // single request no matter how many inboxes exist. Focused-only — an OTP
  // arrives because the user just asked a page for one, so they're here.
  // `=== true`: keyed is null until the key check resolves, and unknown must
  // not poll.
  usePolling(loadInboxes, 10_000, keyed === true);

  useEffect(() => {
    void window.bridge.tabs.snapshot().then(setBrowser);
    return window.bridge.tabs.onState(setBrowser);
  }, []);

  // Fresh launch lands on the last-used inbox, falling back to the first.
  useEffect(() => {
    if (browser && browser.activeProfile === null && inboxes.length > 0) {
      const last = localStorage.getItem('lastProfile');
      const target = inboxes.find((i) => i.address === last) ?? inboxes[0];
      void window.bridge.tabs.setProfile(target.address);
    }
  }, [browser, inboxes]);

  useEffect(() => {
    if (browser?.activeProfile) localStorage.setItem('lastProfile', browser.activeProfile);
  }, [browser?.activeProfile]);

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
    void window.bridge.tabs.setOverlay('resize', false);
  }

  function panelDrag(clientX: number) {
    const w = clamp(window.innerWidth - clientX, 280, 640);
    panelWidthRef.current = w;
    setPanelWidth(w);
  }

  function panelDone() {
    localStorage.setItem('panelWidth', String(panelWidthRef.current));
    void window.bridge.tabs.setPanelWidth(panelWidthRef.current);
    void window.bridge.tabs.setOverlay('resize', false);
  }

  // Dragging a splitter needs the page out of the way for the whole drag.
  const hideContent = () => void window.bridge.tabs.setOverlay('resize', true);

  const activeProfile = browser?.activeProfile ?? null;

  // Above the early returns: hooks can't run conditionally.
  const {
    popups: otpPopups,
    badges: otpBadges,
    dismissPopup: dismissOtp,
    clearBadge: clearOtpBadge,
  } = useOtpArrivals(inboxes, activeProfile);

  if (keyed === null) return null;
  if (!keyed) return <KeySetup onDone={() => setKeyed(true)} />;

  const profileTabs = activeProfile ? browser?.profiles[activeProfile] : undefined;

  return (
    <div className="flex h-full">
      {/* Transient notice pill — lives inside the top chrome strip, the only
          region the native page view never covers. */}
      {notice && (
        <div className="app-no-drag fixed top-1.5 right-[150px] z-50 rounded-full border bg-popover px-3 py-1 text-xs text-popover-foreground shadow-md">
          {notice}
        </div>
      )}
      <Rail
        inboxes={inboxes}
        activeProfile={activeProfile}
        collapsed={railCollapsed}
        width={railWidth}
        onToggleCollapsed={toggleRail}
        onSelect={(address) => {
          // Opening the inbox is the answer to its badge.
          clearOtpBadge(address);
          void window.bridge.tabs.setProfile(address);
        }}
        otpBadges={otpBadges}
        onOpenSettings={() => setSettingsOpenAndContent(true)}
        mirrorLeader={mirror.leader}
        mirrorFollowers={mirrorPicking ? mirrorSelection : mirror.followers}
        mirrorStatus={mirror.status}
        mirrorPicking={mirrorPicking}
        onToggleFollowerPause={(address) =>
          void window.bridge.mirror.setFollowerPaused(
            address,
            mirror.status[address] !== 'paused',
          )
        }
        onToggleFollower={(address) =>
          setMirrorSelection((s) =>
            s.includes(address) ? s.filter((a) => a !== address) : [...s, address],
          )
        }
        footerSlot={
          <>
            <SavePasswordPrompt collapsed={railCollapsed} />
            <MirrorControls
              state={mirror}
              picking={mirrorPicking}
              selectionCount={mirrorSelection.length}
              collapsed={railCollapsed}
              canStart={!!activeProfile && mirrorSelection.length > 0}
              onPick={() => {
                setMirrorSelection([]);
                setMirrorPicking(true);
              }}
              onCancel={() => {
                setMirrorPicking(false);
                setMirrorSelection([]);
              }}
              onStart={() => {
                if (!activeProfile) return;
                void window.bridge.mirror.start(activeProfile, mirrorSelection);
                setMirrorPicking(false);
              }}
              onPause={() => void window.bridge.mirror.setPaused(!mirror.paused)}
              onResync={() => void window.bridge.mirror.resync()}
              onStop={() => {
                void window.bridge.mirror.stop();
                setMirrorSelection([]);
              }}
            />
          </>
        }
      />
      {!railCollapsed && <ResizeHandle onStart={hideContent} onDrag={railDrag} onDone={railDone} />}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpenAndContent(false)} />}
      <OtpPopup arrivals={otpPopups} onDismiss={dismissOtp} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={topRef} className="shrink-0">
        <TabStrip
          profile={activeProfile}
          allProfiles={inboxes.map((i) => i.address)}
          tabs={profileTabs?.tabs ?? []}
          activeTabId={profileTabs?.activeTabId ?? null}
          rightPanel={rightPanel}
          onSelectPanel={(panel) => {
            // Toggle off when re-picking the open one; main only needs to
            // know whether SOME panel occupies the right edge.
            const next = rightPanel === panel ? null : panel;
            setRightPanel(next);
            void window.bridge.tabs.setPanelOpen(next !== null);
          }}
          onSuggestOpen={(open) => void window.bridge.tabs.setOverlay('suggestions', open)}
        />
        </div>
        <div className="flex min-h-0 flex-1">
          {/* The WebContentsView floats over this area; it's only visible
              chrome when no profile/tab exists yet. */}
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {activeProfile ? '' : 'Pick an inbox on the left to start browsing in its session.'}
          </div>
          {rightPanel && activeProfile && (
            <>
              <ResizeHandle onStart={hideContent} onDrag={panelDrag} onDone={panelDone} />
              {rightPanel === 'mail' && <MailPanel address={activeProfile} width={panelWidth} />}
              {rightPanel === 'passwords' && (
                <PasswordPanel address={activeProfile} width={panelWidth} />
              )}
              {rightPanel === 'history' && (
                <HistoryPanel
                  address={activeProfile}
                  width={panelWidth}
                  onOpen={(url) => {
                    const tabId = profileTabs?.activeTabId;
                    if (tabId) void window.bridge.tabs.navigate(tabId, url);
                    else void window.bridge.tabs.create(activeProfile, url);
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
