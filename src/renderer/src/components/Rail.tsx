import { PanelLeftCloseIcon, PanelLeftOpenIcon, SettingsIcon } from 'lucide-react';
import type { Inbox } from '../../../shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

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
  onToggleCollapsed,
  onSelect,
  onOpenSettings,
}: {
  inboxes: Inbox[];
  activeProfile: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (address: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-sidebar',
        collapsed ? 'w-14 items-center' : 'w-56',
      )}
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
          const button = (
            <button
              key={inbox.address}
              type="button"
              onClick={() => onSelect(inbox.address)}
              className={cn(
                'relative flex items-center gap-2 rounded-md text-left text-sm',
                collapsed ? 'p-1.5' : 'w-full px-2 py-1.5',
                active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50',
              )}
            >
              <Avatar inbox={inbox} active={active} />
              {collapsed ? (
                inbox.unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {inbox.unread > 9 ? '9+' : inbox.unread}
                  </span>
                )
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {inbox.displayName || inbox.address}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {inbox.address}
                    </span>
                  </span>
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
                {inbox.unread > 0 ? ` — ${inbox.unread} unread` : ''}
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
