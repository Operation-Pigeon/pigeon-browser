import {
  ChevronDownIcon,
  ChevronRightIcon,
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
import type {
  ExitCountry,
  ExitState,
  ExitStatus,
  FollowerStatus,
  Inbox,
} from '../../../shared/types';
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

/**
 * Five labels and no more.
 *
 * The point is telling groups apart at a glance in a narrow strip, and past
 * about five the colours stop being distinguishable there. Classes are spelled
 * out rather than built from the name because Tailwind only keeps the ones it
 * can see in the source.
 */
export const GROUP_COLORS = ['rose', 'amber', 'emerald', 'sky', 'violet'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

const SWATCH: Record<GroupColor, string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
};

const RING: Record<GroupColor, string> = {
  rose: 'ring-rose-500/60',
  amber: 'ring-amber-500/60',
  emerald: 'ring-emerald-500/60',
  sky: 'ring-sky-500/60',
  violet: 'ring-violet-500/60',
};

/** Groups in palette order, unlabelled last, original order kept inside each. */
function groupInboxes(
  inboxes: Inbox[],
  colors: Record<string, string>,
): Array<{ color: GroupColor | null; members: Inbox[] }> {
  const groups: Array<{ color: GroupColor | null; members: Inbox[] }> = [];
  for (const color of GROUP_COLORS) {
    const members = inboxes.filter((i) => colors[i.address] === color);
    if (members.length) groups.push({ color, members });
  }
  const rest = inboxes.filter((i) => !GROUP_COLORS.includes(colors[i.address] as GroupColor));
  if (rest.length) groups.push({ color: null, members: rest });
  return groups;
}

/**
 * One status for a whole group.
 *
 * Worst case wins, because a group is only as usable as its weakest member:
 * anything down means pages in that group are waiting, and that matters more
 * than the fact that four others are fine.
 */
function groupStatus(members: Inbox[], exits: Record<string, ExitState>): ExitStatus {
  const states = members.map((m) => exits[m.address]?.status ?? 'off');
  if (states.some((s) => s === 'down')) return 'down';
  if (states.some((s) => s === 'connecting')) return 'connecting';
  if (states.some((s) => s === 'connected')) return 'connected';
  return 'off';
}

/**
 * Every icon control in the rail.
 *
 * There were four of these built at different times: a real button here, a
 * span with role="button" there, three different hover colours and padding
 * that differed by a pixel or two. Nothing was individually wrong and the
 * whole thing read as two lists glued together, so size, padding, hover and
 * the disabled treatment now come from one place instead of being matched by
 * hand each time one changes.
 *
 * A real <button>: a span with role="button" is not focusable, does not fire
 * on Enter, and is invisible to anything driven by the keyboard.
 */
function RailAction({
  icon: Icon,
  title,
  tone = 'muted',
  spin = false,
  disabled = false,
  onClick,
}: {
  icon: typeof GlobeIcon;
  title: string;
  tone?: 'muted' | 'connected' | 'connecting' | 'down';
  spin?: boolean;
  disabled?: boolean;
  onClick: (anchor: DOMRect) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        // These sit inside larger clickable rows; without this, acting on one
        // also switches inbox or folds the group underneath it.
        e.stopPropagation();
        onClick(e.currentTarget.getBoundingClientRect());
      }}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-muted',
        {
          muted: 'text-muted-foreground',
          connected: 'text-emerald-400',
          connecting: 'text-amber-400',
          down: 'text-destructive',
        }[tone],
      )}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} />
    </button>
  );
}

/** The icon and tone that go with a tunnel state. */
function tunnelLook(status: ExitStatus): {
  icon: typeof GlobeIcon;
  tone: 'muted' | 'connected' | 'connecting' | 'down';
} {
  switch (status) {
    case 'connected':
      return { icon: GlobeIcon, tone: 'connected' };
    case 'connecting':
      return { icon: Loader2Icon, tone: 'connecting' };
    case 'down':
      return { icon: UnplugIcon, tone: 'down' };
    default:
      return { icon: PowerIcon, tone: 'muted' };
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
  const { icon, tone } = tunnelLook(exit.status);
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

  // Collapsed rail has no room for a control, so the state is shown as a mark
  // on the avatar and the tunnel is reached by expanding the rail.
  if (collapsed) {
    const Icon = icon;
    return (
      <span
        className={cn(
          'absolute -bottom-0.5 -left-0.5 flex size-3 items-center justify-center',
          { muted: 'text-muted-foreground', connected: 'text-emerald-400',
            connecting: 'text-amber-400', down: 'text-destructive' }[tone],
        )}
        title={where}
      >
        <Icon className={cn('size-3', exit.status === 'connecting' && 'animate-spin')} />
      </span>
    );
  }

  return (
    <RailAction
      icon={icon}
      tone={tone}
      title={where}
      spin={exit.status === 'connecting'}
      disabled={!ready}
      onClick={onOpen}
    />
  );
}

/**
 * Where an inbox should appear to be.
 *
 * Countries come from the live network rather than a fixed list, with the
 * number of nodes shown â€” a country with three exits will drop constantly and
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
            ? `${exit.city ?? exit.country ?? ''}${exit.isp ? ` Â· ${exit.isp}` : ''}`
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

/**
 * Colour labels as wedges around the pointer.
 *
 * A ring rather than a list because every option is then the same short flick
 * from where the cursor already is, and there is no reading order to work
 * through: the choice is a direction. Wedges rather than dots because the
 * target is then the whole direction rather than a small disc in it, which is
 * the difference between aiming and flicking.
 *
 * Clearing sits in the middle: the largest target and no travel at all, which
 * is what you want when undoing a mislabel in a hurry.
 */
function ColorPicker({
  current,
  point,
  onPick,
  onClose,
}: {
  current: string | undefined;
  point: { x: number; y: number };
  onPick: (color: GroupColor | null) => void;
  onClose: () => void;
}) {
  const OUTER = 52;
  const INNER = 20;
  // Real daylight between wedges. At a hairline they merge into one dull
  // disc; at this width each is plainly its own target.
  const GAP = 0.13;
  const EDGE = OUTER + 6;

  // Keep the whole ring on screen: near an edge the centre shifts inward
  // rather than letting half the options fall off it.
  const cx = Math.min(Math.max(point.x, EDGE), window.innerWidth - EDGE);
  const cy = Math.min(Math.max(point.y, EDGE), window.innerHeight - EDGE);
  const size = OUTER * 2;

  // Hex rather than classes: SVG fill does not take Tailwind background
  // utilities, and these are the same -500 values the swatches use.
  const HEX: Record<GroupColor, string> = {
    rose: '#f43f5e',
    amber: '#f59e0b',
    emerald: '#10b981',
    sky: '#0ea5e9',
    violet: '#8b5cf6',
  };

  /** One donut segment, in the SVG's own coordinates. */
  const wedge = (from: number, to: number): string => {
    const at = (r: number, a: number) => [OUTER + r * Math.cos(a), OUTER + r * Math.sin(a)];
    const [x0, y0] = at(OUTER, from);
    const [x1, y1] = at(OUTER, to);
    const [x2, y2] = at(INNER, to);
    const [x3, y3] = at(INNER, from);
    const large = to - from > Math.PI ? 1 : 0;
    return [
      `M${x0},${y0}`,
      `A${OUTER},${OUTER} 0 ${large} 1 ${x1},${y1}`,
      `L${x2},${y2}`,
      `A${INNER},${INNER} 0 ${large} 0 ${x3},${y3}`,
      'Z',
    ].join(' ');
  };

  const step = (2 * Math.PI) / GROUP_COLORS.length;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />

      <svg
        width={size}
        height={size}
        style={{ left: cx - OUTER, top: cy - OUTER }}
        className="pointer-events-none fixed z-50 overflow-visible drop-shadow-xl"
      >
        {/* Sits under the wedges so they read against whatever page is
            behind, and catches nothing: the backdrop above handles dismissal. */}
        <circle cx={OUTER} cy={OUTER} r={OUTER} className="fill-popover/95 stroke-border" />

        {/* A ring on the current label, drawn under the wedges so a wedge
            growing on hover still sits above it. */}
        {current && GROUP_COLORS.includes(current as GroupColor) && (
          <circle
            cx={OUTER}
            cy={OUTER}
            r={(OUTER + INNER) / 2}
            fill="none"
            strokeWidth={OUTER - INNER + 8}
            className="stroke-foreground/20"
          />
        )}

        {GROUP_COLORS.map((color, i) => {
          // Start at the top and go clockwise, so a colour is always in the
          // same direction and the palette order is a spatial one.
          const from = -Math.PI / 2 + i * step + GAP / 2;
          const to = from + step - GAP;
          return (
            <path
              key={color}
              d={wedge(from, to)}
              fill={HEX[color]}
              // No stroke. A stroke in the wedge's own colour grows it by
              // half its width on every side, which closes the gaps and turns
              // five choices back into one solid disc.
              onClick={() => onPick(color)}
              style={{ transformOrigin: `${OUTER}px ${OUTER}px` }}
              className={cn(
                // Full saturation: dimming every option to distinguish the
                // chosen one made all six look disabled instead.
                'pointer-events-auto cursor-pointer transition-transform duration-100',
                'hover:scale-110',
                current === color && 'scale-105',
              )}
            >
              <title>{color}</title>
            </path>
          );
        })}
      </svg>

      <button
        type="button"
        title="No label"
        onClick={() => onPick(null)}
        style={{ left: cx - INNER + 3, top: cy - INNER + 3, width: (INNER - 3) * 2, height: (INNER - 3) * 2 }}
        className={cn(
          'fixed z-50 flex items-center justify-center rounded-full border bg-popover text-muted-foreground hover:text-foreground',
          !current && 'ring-2 ring-foreground',
        )}
      >
        <XIcon className="size-3.5" />
      </button>
    </>,
    document.body,
  );
}

function Avatar({
  inbox,
  active,
  color,
}: {
  inbox: Inbox;
  active: boolean;
  color: GroupColor | null;
}) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase',
        color
          ? `${SWATCH[color]} text-white`
          : active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        // The active inbox keeps a ring so a label never hides which one it is.
        active && color && `ring-2 ring-offset-2 ring-offset-sidebar ${RING[color]}`,
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
  inboxColors,
  collapsedGroups,
  onSetColor,
  onToggleGroup,
  onGroupTunnel,
}: {
  /** Colour label per inbox address; absent means unlabelled. */
  inboxColors: Record<string, string>;
  /** Colour groups currently folded away. */
  collapsedGroups: string[];
  onSetColor: (address: string, color: GroupColor | null) => void;
  onToggleGroup: (group: string, collapsed: boolean) => void;
  /** Turn a whole group's tunnels on in one country, or all of them off. */
  onGroupTunnel: (addresses: string[], country: string | null) => void;
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
  const [coloring, setColoring] = useState<{ address: string; x: number; y: number } | null>(null);
  const [groupPicking, setGroupPicking] = useState<{ color: string; anchor: DOMRect } | null>(
    null,
  );

  const groups = groupInboxes(inboxes, inboxColors);
  // Headers appear only once something is labelled, so an unlabelled rail is
  // exactly what it was before this feature existed.
  const showGroups = groups.some((g) => g.color !== null);

  // The picker is portalled to the body so the rail cannot clip it, which
  // puts it over the page area. That area belongs to the native
  // WebContentsView, and the native view always draws above the renderer, so
  // the popover would be buried and unclickable. Hiding the page while it is
  // open is the same dance bookmarks, settings and the address suggestions do.
  useEffect(() => {
    void window.bridge.tabs.setOverlay('tunnel-picker', picking !== null);
  }, [picking]);

  // Same reason as the tunnel picker: portalled out of the rail, so it lands
  // over the page area that the native view draws above.
  useEffect(() => {
    void window.bridge.tabs.setOverlay('color-picker', coloring !== null);
  }, [coloring]);

  useEffect(() => {
    void window.bridge.tabs.setOverlay('group-tunnel', groupPicking !== null);
  }, [groupPicking]);
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
        {groups.map(({ color, members }: { color: GroupColor | null; members: Inbox[] }) => {
          // The unlabelled inboxes are a group too: they fold and route in
          // bulk like any other. "none" is their key, since a colour is what
          // every other group is keyed by.
          const key = color ?? 'none';
          const folded = collapsedGroups.includes(key);
          const status = groupStatus(members, exitStates);
          const look = tunnelLook(status);
          return (
            <div key={key} className="flex flex-col gap-1">
              {/* Headers appear only once something is labelled, so an
                  unlabelled rail looks exactly as it did before. */}
              {showGroups && (
                <div
                  className={cn(
                    // px-2 to match the inbox rows below. Anything else and
                    // neither the chevron/avatar edge nor the action icons
                    // line up, which is what made the two kinds of row read
                    // as two different lists.
                    //
                    // The hover lives here rather than on the collapse button
                    // so the whole row lights up, exactly as an inbox row
                    // does. With it on the inner button the strip beside the
                    // action icon was dead space that looked interactive.
                    'flex items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground',
                    'hover:bg-sidebar-accent/50',
                    collapsed && 'justify-center px-1',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onToggleGroup(key, !folded)}
                    title={folded ? 'Show these inboxes' : 'Hide these inboxes'}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5"
                  >
                    {folded ? (
                      <ChevronRightIcon className="size-3 shrink-0" />
                    ) : (
                      <ChevronDownIcon className="size-3 shrink-0" />
                    )}
                    <span
                      className={cn('size-2 shrink-0 rounded-full', color ? SWATCH[color] : 'bg-muted')}
                    />
                    {!collapsed && <span>{members.length}</span>}
                  </button>

                  {/* Sits at the right of the header row, where the per-inbox
                      tunnel control sits on its own row. */}
                  <RailAction
                    icon={look.icon}
                    tone={look.tone}
                    spin={status === 'connecting'}
                    disabled={!tunnelsReady}
                    title={
                      tunnelsReady
                        ? `Tunnels for all ${members.length} in this group`
                        : 'Set up tunnels in Settings'
                    }
                    onClick={(anchor) => setGroupPicking({ color: key, anchor })}
                  />
                </div>
              )}

              {groupPicking?.color === key && (
                <TunnelPicker
                  // A synthetic state standing for the group as a whole, so
                  // the picker can say what the group is currently doing
                  // without knowing anything about groups.
                  exit={{
                    profile: `group:${color}`,
                    status: groupStatus(members, exitStates),
                    wanted: members
                      .map((m) => exitStates[m.address]?.wanted)
                      .find((w): w is string => !!w),
                  }}
                  countries={exitCountries}
                  anchor={groupPicking.anchor}
                  onEnable={(country) => {
                    onGroupTunnel(
                      members.map((m) => m.address),
                      country,
                    );
                    setGroupPicking(null);
                  }}
                  onDisable={() => {
                    onGroupTunnel(
                      members.map((m) => m.address),
                      null,
                    );
                    setGroupPicking(null);
                  }}
                  onClose={() => setGroupPicking(null)}
                />
              )}

              {!folded &&
                members.map((inbox: Inbox) => {
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
              // Right-click labels the inbox. A menu gesture rather than a
              // visible control, so the rail stays as uncluttered as it was.
              onContextMenu={(e) => {
                e.preventDefault();
                setColoring({ address: inbox.address, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                'relative flex items-center gap-2 rounded-md text-left text-sm',
                collapsed ? 'p-1.5' : 'w-full px-2 py-1.5',
                active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50',
                ring,
              )}
            >
              <Avatar inbox={inbox} active={active} color={color} />
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
                    <RailAction
                      icon={status === 'paused' ? PlayIcon : PauseIcon}
                      title={status === 'paused' ? 'Resume this inbox' : 'Pause just this inbox'}
                      onClick={() => onToggleFollowerPause(inbox.address)}
                    />
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
              {coloring !== null && coloring.address === inbox.address && (
                <ColorPicker
                  current={inboxColors[inbox.address]}
                  point={{ x: coloring.x, y: coloring.y }}
                  onPick={(color) => {
                    onSetColor(inbox.address, color);
                    setColoring(null);
                  }}
                  onClose={() => setColoring(null)}
                />
              )}
              {picking !== null && picking.address === inbox.address && (
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
            </div>
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
