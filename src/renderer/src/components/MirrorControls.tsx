import { CopyCheckIcon, PauseIcon, PlayIcon, XIcon } from 'lucide-react';
import type { MirrorState } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Mirror controls, in the rail footer next to the inboxes they act on.
 * Selection itself happens by clicking rail entries — this is just the
 * start/pause/stop surface.
 */
export function MirrorControls({
  state,
  picking,
  selectionCount,
  collapsed,
  canStart,
  onPick,
  onCancel,
  onStart,
  onPause,
  onStop,
}: {
  state: MirrorState;
  picking: boolean;
  selectionCount: number;
  collapsed: boolean;
  canStart: boolean;
  onPick: () => void;
  onCancel: () => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const running = state.leader !== null;

  if (collapsed) {
    return (
      <div className="flex justify-center px-1 pb-1">
        <Button
          variant={running ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={running ? onStop : onPick}
          title={running ? 'Stop controlling inboxes' : 'Control multiple inboxes'}
        >
          <CopyCheckIcon className={cn(running && !state.paused && 'text-sky-400')} />
        </Button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="mx-2 mb-2 flex flex-col gap-1.5 rounded-md border bg-popover p-2 text-xs">
        <span className="flex items-center gap-1.5">
          <CopyCheckIcon className={cn('size-3.5 shrink-0', !state.paused && 'text-sky-400')} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {state.paused ? 'Control paused' : `Controlling ${state.followers.length}`}
          </span>
        </span>
        <span className="text-muted-foreground">
          {state.paused ? 'Enter codes in each inbox, then resume.' : 'Actions replay in each.'}
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-6 flex-1" onClick={onPause}>
            {state.paused ? (
              <>
                <PlayIcon data-icon="inline-start" />
                Resume
              </>
            ) : (
              <>
                <PauseIcon data-icon="inline-start" />
                Pause
              </>
            )}
          </Button>
          <Button size="sm" variant="ghost" className="h-6" onClick={onStop} title="Stop">
            <XIcon />
          </Button>
        </span>
      </div>
    );
  }

  if (picking) {
    return (
      <div className="mx-2 mb-2 flex flex-col gap-1.5 rounded-md border bg-popover p-2 text-xs">
        <span className="text-muted-foreground">
          Click inboxes above to mirror into. The current inbox controls them.
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" className="h-6 flex-1" disabled={!canStart} onClick={onStart}>
            Start ({selectionCount})
          </Button>
          <Button size="sm" variant="ghost" className="h-6" onClick={onCancel}>
            Cancel
          </Button>
        </span>
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onPick}>
        <CopyCheckIcon data-icon="inline-start" />
        Control inboxes
      </Button>
    </div>
  );
}
