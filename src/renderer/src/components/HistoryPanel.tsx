import { useCallback, useEffect, useState } from 'react';
import { GlobeIcon, HistoryIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import type { HistoryEntry } from '../../../shared/types';
import { Button } from '@/components/ui/button';

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Right bar: the ACTIVE inbox's history — click to open in this session. */
export function HistoryPanel({
  address,
  width,
  onOpen,
}: {
  address: string;
  width: number;
  onOpen: (url: string) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(() => {
    void window.bridge.history.list(address).then(setEntries);
  }, [address]);

  useEffect(() => {
    setConfirmClear(false);
    refresh();
  }, [refresh]);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-l bg-sidebar">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <HistoryIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{address}</span>
        <Button variant="ghost" size="icon-sm" onClick={refresh} title="Refresh">
          <RotateCwIcon />
        </Button>
        <Button
          variant={confirmClear ? 'destructive' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              setTimeout(() => setConfirmClear(false), 3000);
              return;
            }
            void window.bridge.history.clear(address).then(refresh);
            setConfirmClear(false);
          }}
          title="Clear this inbox's history"
        >
          {confirmClear ? 'Sure?' : 'Clear'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nothing visited in this inbox yet.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="group flex items-center gap-2 border-b px-3 py-1.5">
              <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => onOpen(e.url)}
              >
                <span className="block truncate text-sm">{e.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.url.replace(/^https?:\/\//, '')}
                </span>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{when(e.lastVisit)}</span>
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground active:scale-95"
                title="Forget this page"
                onClick={() => void window.bridge.history.remove(e.id).then(refresh)}
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
