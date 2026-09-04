import {
  GlobeIcon,
  KeyRoundIcon,
  Loader2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  SettingsIcon,
  UnplugIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import logo from '@/assets/logo.svg';
import type { ExitCountry, ExitState, FollowerStatus, Inbox } from '../../../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * "GB" means nothing at a glance; "United Kingdom" does. Intl has the whole
 * table built in, so there is no list to ship or keep current. Codes the
 * runtime does not recognise fall back to themselves.
 */
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function statusLabel(status: FollowerStatus): string {
  switch (status) {
    case 'drifted':
      return 'on a different page';
    case 'missed':
      return "couldn't apply last action";
    case 'paused':
      return 'paused';
    default:
      return 'in sync';
  }
}

/**
 * Where this inbox currently appears to be, and whether it can browse at all.
 *
 * Residential exits drop constantly, so this is not decoration — it is the
 * difference between "the site is broken" and "this inbox is between houses
 * in Manchester". The switch is deliberate-off, which is distinct from down:
 * an inbox that is off stays off rather than being reconnected underneath you.
 */
function TunnelChip({
  exit,
  collapsed,
  ready,
  onOpen,
}: {
  exit: ExitState;
  collapsed: boolean;
  /** Tunnels are set up and funded; without this the control does nothing. */
  ready: boolean;
  onOpen: (anchor: DOMRect) => void;
}) {
  const look = {
    connected: { cls: 'text-emerald-400', Icon: GlobeIcon },
    connecting: { cls: 'text-amber-400', Icon: Loader2Icon },
    down: { cls: 'text-destructive', Icon: UnplugIcon },
    off: { cls: 'text-muted-foreground', Icon: PowerIcon },
  }[exit.status];

  const where =
    exit.status === 'connected'
      ? `${exit.city ?? exit.country ?? 'connected'}${exit.isp ? ` · ${exit.isp}` : ''}`
      : exit.status === 'connecting'
        ? 'Finding a tunnel'
        : exit.status === 'off'
          ? ready
            ? 'Tunnel off'
            : 'Set up tunnels in Settings'
          : (exit.detail ?? 'Tunnel down, pages will wait');

  if (collapsed) {
    return (
      <span
        className={cn('absolute -bottom-0.5 -left-0.5 flex size-3 items-center justify-center', look.cls)}
        title={where}
      >
        <look.Icon className={cn('size-3', exit.status === 'connecting' && 'animate-spin')} />
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      title={where}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-xs',
        ready ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-40',
        look.cls,
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (ready) onOpen(e.currentTarget.getBoundingClientRect());
      }}
    >
      <look.Icon className={cn('size-3', exit.status === 'connecting' && 'animate-spin')} />
    </span>
  );
}

/**
 * Where an inbox should appear to be.
 *
 * Countries come from the live network rather than a fixed list, with the
 * number of nodes shown — a country with three exits will drop constantly and
 * one with four hundred will not, and that is the difference between a usable
 * inbox and a frustrating one. It is the only honest way to make the choice.
 */
function TunnelPicker({
  exit,
  countries,
  anchor,
  onEnable,
  onDisable,
  onClose,
}: {
  exit: ExitState | undefined;
  countries: ExitCountry[];
  /** Screen rect of the chip that opened this. */
  anchor: DOMRect;
  onEnable: (country: string) => void;
  onDisable: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const on = !!exit && exit.status !== 'off';
  const q = filter.trim().toLowerCase();
  const shown = countries.filter(
    (c) => !q || c.code.toLowerCase().includes(q) || countryName(c.code).toLowerCase().includes(q),
  );

  // Rendered into the body rather than the rail. The rail scrolls, and a
  // scrolling parent clips anything positioned inside it, so a popover placed
  // there is invisible whenever the rail is narrow. Fixed coordinates off the
  // chip's own rect keep it beside the inbox it belongs to, and clamped to the
  // viewport so it cannot run off the bottom.
  const width = 240;
  const left = Math.min(anchor.right + 8, window.innerWidth - width - 8);
  const top = Math.min(anchor.top, window.innerHeight - 340);

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={{ left, top, width }}
        className="fixed z-50 flex max-h-[330px] flex-col gap-2 rounded-md border bg-popover p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Tunnel location</span>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          onClick={onClose}
        >
          <XIcon className="size-3" />
        </button>
      </div>

      {on && exit && (
        <p className="text-xs text-muted-foreground">
          {exit.status === 'connected'
            ? `${exit.city ?? exit.country ?? ''}${exit.isp ? ` · ${exit.isp}` : ''}`
            : exit.status === 'connecting'
              ? 'Finding a tunnel'
              : 'Tunnel down, pages are waiting'}
        </p>
      )}

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter countries"
        className="w-full rounded border bg-background px-2 py-1 text-xs select-text"
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {shown.map((country) => (
          <button
            key={country.code}
            type="button"
            onClick={() => onEnable(country.code)}
            className={cn(
              'flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent',
              exit?.wanted === country.code && 'bg-accent font-medium',
            )}
          >
            <span className="min-w-0 truncate">{countryName(country.code)}</span>
            <span className="shrink-0 text-muted-foreground">{country.count}</span>
          </button>
        ))}
        {shown.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {countries.length === 0 ? 'Set up tunnels in Settings first.' : 'No match.'}
          </p>
        )}
      </div>

        {on && (
          <Button size="sm" variant="secondary" onClick={onDisable}>
            <PowerIcon data-icon="inline-start" />
            Turn off, browse direct
          </Button>
        )}
      </div>
    </>,
    document.body,
  );
}

function Avatar({ inbox, active }: { inbox: Inbox; active: boolean }) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {(inbox.displayName || inbox.address)[0]}
    </span>
  );
}

/**
 * Left rail: one entry per inbox — each is its own isolated browsing
 * session. Collapses to a Firefox-vertical-tabs-style avatar strip; widths
 * (w-56 / w-14) must match RAIL_EXPANDED/RAIL_COLLAPSED in App.tsx and the
 * values sent to main.
 */
export function Rail({
  inboxes,
  activeProfile,
  collapsed,
  width,
  onToggleCollapsed,
  onSelect,
  onOpenSettings,
  footerSlot,
  mirrorLeader,
  mirrorFollowers,
  mirrorStatus,
  mirrorPicking,
  onToggleFollower,
  onToggleFollowerPause,
  otpBadges,
  exitStates,
  exitCountries,
  tunnelsReady,
}: {
  /** False until the Mysterium setup in Settings is complete and funded. */
  tunnelsReady: boolean;
  /** Per-inbox network exit; absent for inboxes browsing directly. */
  exitStates: Record<string, ExitState>;
  /** Countries the network currently has residential nodes in. */
  exitCountries: ExitCountry[];
  /** Per-follower health: synced | drifted | missed | paused. */
  mirrorStatus: Record<string, FollowerStatus>;
  onToggleFollowerPause: (address: string) => void;
  inboxes: Inbox[];
  activeProfile: string | null;
  collapsed: boolean;
  width: number;
  onToggleCollapsed: () => void;
  onSelect: (address: string) => void;
  onOpenSettings: () => void;
  /** Rendered above the settings separator — mirror controls, save prompt. */
  footerSlot?: React.ReactNode;
  /** Sky ring = controls the others; white ring = mirrored. */
  mirrorLeader: string | null;
  mirrorFollowers: string[];
  mirrorPicking: boolean;
  onToggleFollower: (address: string) => void;
  /** Inboxes holding a code that arrived while you were elsewhere. */
  otpBadges: Record<string, { code: string }>;
}) {
  const [picking, setPicking] = useState<{ address: string; anchor: DOMRect } | null>(null);

  // The picker is portalled to the body so the rail cannot clip it, which
  // puts it over the page area. That area belongs to the native
  // WebContentsView, and the native view always draws above the renderer, so
  // the popover would be buried and unclickable. Hiding the page while it is
  // open is the same dance bookmarks, settings and the address suggestions do.
  useEffect(() => {
    void window.bridge.tabs.setOverlay('tunnel-picker', picking !== null);
  }, [picking]);
  return (
    <aside
      style={collapsed ? undefined : { width }}
      className={cn('flex shrink-0 flex-col border-r bg-sidebar', collapsed && 'w-14 items-center')}
    >
      {/* Top strip doubles as a window-drag handle. */}
      <div
        className={cn(
          'app-drag flex h-10 shrink-0 items-center',
          collapsed ? 'justify-center' : 'justify-between pr-1 pl-3',
        )}
      >
        {!collapsed && (
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <img src={logo} alt="" className="size-4 rounded-[3px]" />
            Pigeon
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="app-no-drag"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </Button>
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2', collapsed && 'items-center')}>
        {inboxes.map((inbox) => {
          const active = inbox.address === activeProfile;
          // During picking the leader is whichever inbox is active; while
          // running it's whatever main reported.
          const isLeader = mirrorPicking ? active : inbox.address === mirrorLeader;
          const isFollower = mirrorFollowers.includes(inbox.address);
          const status = mirrorStatus[inbox.address];
          const otp = otpBadges[inbox.address];
          // Every inbox gets a chip, including ones browsing directly — the
          // chip is how you turn an exit ON, so hiding it from inboxes
          // without one hides the feature from exactly the people who need it.
          const exit: ExitState = exitStates[inbox.address] ?? {
            profile: inbox.address,
            status: 'off',
          };
          // Ring tells the story at a glance: sky drives, white follows,
          // amber wandered off, red didn't take the last action.
          const ring = isLeader
            ? 'ring-2 ring-sky-400'
            : isFollower
              ? status === 'drifted'
                ? 'ring-2 ring-amber-400'
                : status === 'missed'
                  ? 'ring-2 ring-destructive'
                  : status === 'paused'
                    ? 'ring-2 ring-foreground/30'
                    : 'ring-2 ring-foreground/70'
              : '';
          const button = (
            <button
              key={inbox.address}
              type="button"
              onClick={() => {
                // In picking mode a click chooses who gets mirrored rather
                // than switching inbox; the controller can't mirror itself.
                if (mirrorPicking && !active) onToggleFollower(inbox.address);
                else if (!mirrorPicking) onSelect(inbox.address);
              }}
              className={cn(
                'relative flex items-center gap-2 rounded-md text-left text-sm',
                collapsed ? 'p-1.5' : 'w-full px-2 py-1.5',
                active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50',
                ring,
              )}
            >
              <Avatar inbox={inbox} active={active} />
              {collapsed && (
                <TunnelChip
                  exit={exit}
                  collapsed
                  ready={tunnelsReady}
                  onOpen={(anchor) => setPicking({ address: inbox.address, anchor })}
                />
              )}
              {collapsed ? (
                otp ? (
                  <span
                    title={`Code waiting: ${otp.code}`}
                    className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-sky-500 text-primary-foreground"
                  >
                    <KeyRoundIcon className="size-2.5" />
                  </span>
                ) : (
                  inbox.unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {inbox.unread > 9 ? '9+' : inbox.unread}
                  </span>
                  )
                )
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {inbox.displayName || inbox.address}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {status && isFollower
                        ? statusLabel(status)
                        : exit.status === 'connecting'
                          ? 'Finding a tunnel'
                          : exit.status === 'down'
                            ? 'Tunnel down, pages wait'
                            : exit.status === 'connected' && exit.city
                              ? `${exit.city}${exit.country ? `, ${exit.country}` : ''}`
                              : inbox.address}
                    </span>
                  </span>
                  <TunnelChip
                    exit={exit}
                    collapsed={false}
                    ready={tunnelsReady}
                    onOpen={(anchor) =>
                      setPicking(
                        picking?.address === inbox.address
                          ? null
                          : { address: inbox.address, anchor },
                      )
                    }
                  />
                  {isFollower && !mirrorPicking && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={status === 'paused' ? 'Resume this inbox' : 'Pause just this inbox'}
                      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFollowerPause(inbox.address);
                      }}
                    >
                      {status === 'paused' ? (
                        <PlayIcon className="size-3" />
                      ) : (
                        <PauseIcon className="size-3" />
                      )}
                    </span>
                  )}
                  {otp && (
                    <span
                      title="Code arrived here, open this inbox to use it"
                      className="flex shrink-0 items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-sky-400"
                    >
                      <KeyRoundIcon className="size-3" />
                      {otp.code}
                    </span>
                  )}
                  {inbox.unread > 0 && <Badge>{inbox.unread}</Badge>}
                </>
              )}
            </button>
          );
          const withPicker = (element: React.ReactNode) => (
            <div key={inbox.address} className="relative">
              {element}
              {picking?.address === inbox.address && (
                <TunnelPicker
                  exit={exitStates[inbox.address]}
                  countries={exitCountries}
                  anchor={picking.anchor}
                  onEnable={(country) => {
                    void window.bridge.exits.enable(inbox.address, country);
                    setPicking(null);
                  }}
                  onDisable={() => {
                    void window.bridge.exits.disable(inbox.address);
                    setPicking(null);
                  }}
                  onClose={() => setPicking(null)}
                />
              )}
            </div>
          );

          return withPicker(
            collapsed ? (
              <Tooltip>
                <TooltipTrigger render={button} />
                <TooltipContent side="right">
                  {inbox.displayName || inbox.address}
                  {otp ? `, code ${otp.code}` : ''}
                  {inbox.unread > 0 ? `, ${inbox.unread} unread` : ''}
                  {isLeader
                    ? ', controlling'
                    : isFollower
                      ? `, ${statusLabel(status ?? 'synced')}`
                      : ''}
                </TooltipContent>
              </Tooltip>
            ) : (
              button
            ),
          );
        })}
        {inboxes.length === 0 && !collapsed && (
          <p className="px-2 text-xs text-muted-foreground">
            No inboxes, create one in the Pigeon webapp or API.
          </p>
        )}
      </div>

      {footerSlot}

      <div className={cn('border-t p-2', collapsed && 'flex justify-center')}>
        <Button
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          className={cn(!collapsed && 'w-full justify-start')}
          onClick={onOpenSettings}
          title="Settings"
        >
          <SettingsIcon data-icon={collapsed ? undefined : 'inline-start'} />
          {!collapsed && 'Settings'}
        </Button>
      </div>
    </aside>
  );
}
