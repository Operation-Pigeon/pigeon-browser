import {
  KeyRoundIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
} from 'lucide-react';
import type { FollowerStatus, Inbox } from '../../../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
}: {
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
        {!collapsed && <span className="text-sm font-semibold">🐦 Pigeon</span>}
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
                      {status && isFollower ? statusLabel(status) : inbox.address}
                    </span>
                  </span>
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
                      title="Code arrived here — open this inbox to use it"
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
          return collapsed ? (
            <Tooltip key={inbox.address}>
              <TooltipTrigger render={button} />
              <TooltipContent side="right">
                {inbox.displayName || inbox.address}
                {otp ? ` — code ${otp.code}` : ''}
                {inbox.unread > 0 ? ` — ${inbox.unread} unread` : ''}
                {isLeader ? ' — controlling' : isFollower ? ` — ${statusLabel(status ?? 'synced')}` : ''}
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          );
        })}
        {inboxes.length === 0 && !collapsed && (
          <p className="px-2 text-xs text-muted-foreground">
            No inboxes — create one in the Pigeon webapp or API.
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
