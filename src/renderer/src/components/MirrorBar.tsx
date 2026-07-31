import { useEffect, useState } from 'react';
import { CopyCheckIcon, PauseIcon, PlayIcon, XIcon } from 'lucide-react';
import type { Inbox, MirrorState } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Multi-inbox control. Pick the inboxes to drive; everything you then do in
 * the active inbox replays in theirs. Identity fields fill per inbox, and
 * one-time codes never mirror — pause, enter them individually, resume.
 */
export function MirrorBar({
  inboxes,
  activeProfile,
  state,
  picking,
  setPicking,
  onChange,
}: {
  inboxes: Inbox[];
  activeProfile: string | null;
  state: MirrorState;
  picking: boolean;
  setPicking: (v: boolean) => void;
  onChange: (next: MirrorState) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!picking) setSelected(state.followers);
  }, [picking, state.followers]);

  const running = state.leader !== null;
  const others = inboxes.filter((i) => i.address !== activeProfile);

  async function refresh() {
    onChange(await window.bridge.mirror.state());
  }

  if (running) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-1.5 text-xs',
          state.paused ? 'bg-muted' : 'bg-primary/10',
        )}
      >
        <CopyCheckIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {state.paused ? 'Control paused — ' : 'Controlling '}
          <span className="font-medium">{state.followers.length}</span>
          {' inbox'}
          {state.followers.length === 1 ? '' : 'es'}
          {state.paused ? ' (enter codes individually, then resume)' : ` from ${state.leader}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6"
          onClick={async () => {
            await window.bridge.mirror.setPaused(!state.paused);
            void refresh();
          }}
        >
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
        <Button
          size="sm"
          variant="ghost"
          className="h-6"
          onClick={async () => {
            await window.bridge.mirror.stop();
            void refresh();
          }}
        >
          <XIcon data-icon="inline-start" />
          Stop
        </Button>
      </div>
    );
  }

  if (!picking) return null;

  return (
    <div className="flex flex-col gap-2 border-b px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        Mirror actions from <span className="font-medium">{activeProfile}</span> into:
      </span>
      <div className="flex flex-wrap gap-1">
        {others.map((i) => {
          const on = selected.includes(i.address);
          return (
            <button
              key={i.address}
              type="button"
              onClick={() =>
                setSelected((s) =>
                  on ? s.filter((a) => a !== i.address) : [...s, i.address],
                )
              }
              className={cn(
                'cursor-pointer rounded-full border px-2 py-0.5',
                on ? 'border-primary bg-primary/15' : 'hover:bg-accent',
              )}
            >
              {i.displayName || i.address}
            </button>
          );
        })}
        {others.length === 0 && (
          <span className="text-muted-foreground">Only one inbox — nothing to mirror into.</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          className="h-6"
          disabled={!activeProfile || selected.length === 0}
          onClick={async () => {
            if (!activeProfile) return;
            await window.bridge.mirror.start(activeProfile, selected);
            setPicking(false);
            void refresh();
          }}
        >
          Start control
        </Button>
        <Button size="sm" variant="ghost" className="h-6" onClick={() => setPicking(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Toolbar entry point — kept separate so the bar itself can stay collapsed. */
export function MirrorToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size="icon-sm"
      onClick={onClick}
      title="Control multiple inboxes"
    >
      <CopyCheckIcon />
    </Button>
  );
}
