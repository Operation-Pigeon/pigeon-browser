import { useCallback, useEffect, useState } from 'react';
import { EyeIcon, EyeOffIcon, KeyIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import type { SavedPassword } from '../../../shared/types';
import { Button } from '@/components/ui/button';

/**
 * Right bar: saved logins for the ACTIVE inbox only — credentials are
 * per-inbox, so showing another profile's here would be noise. Revealing
 * decrypts exactly one entry on demand.
 */
export function PasswordPanel({ address, width }: { address: string; width: number }) {
  const [saved, setSaved] = useState<SavedPassword[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    void window.bridge.passwords
      .list()
      .then((all) => setSaved(all.filter((p) => p.profile === address)));
  }, [address]);

  useEffect(() => {
    setRevealed({});
    refresh();
  }, [refresh]);

  async function toggleReveal(id: string) {
    if (revealed[id] !== undefined) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    const pw = await window.bridge.passwords.reveal(id);
    if (pw !== null) setRevealed((r) => ({ ...r, [id]: pw }));
  }

  async function remove(id: string) {
    await window.bridge.passwords.remove(id);
    refresh();
  }

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-l bg-sidebar">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <KeyIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{address}</span>
        <Button variant="ghost" size="icon-sm" onClick={refresh} title="Refresh">
          <RotateCwIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {saved.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No saved logins for this inbox yet.
          </p>
        ) : (
          saved.map((p) => (
            <div key={p.id} className="flex items-center gap-1 border-b px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{new URL(p.origin).host}</span>
                <span className="block truncate text-xs text-muted-foreground select-text">
                  {p.username || '(no username)'}
                </span>
                {revealed[p.id] !== undefined && (
                  <span className="block truncate font-mono text-xs select-text">
                    {revealed[p.id]}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void toggleReveal(p.id)}
                title={revealed[p.id] !== undefined ? 'Hide password' : 'Reveal password'}
              >
                {revealed[p.id] !== undefined ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void remove(p.id)}
                title="Delete saved password"
              >
                <Trash2Icon />
              </Button>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
