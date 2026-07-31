import { useEffect, useState } from 'react';
import { EyeIcon, EyeOffIcon, Loader2Icon, Trash2Icon, XIcon } from 'lucide-react';
import type { SavedPassword } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

/**
 * Global settings + saved passwords. Passwords are inherently per inbox —
 * the list is grouped by profile, and revealing decrypts exactly one entry
 * on demand. The overlay covers the page area, so the caller hides the
 * native view while it's open (bookmarks pattern).
 */
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [saved, setSaved] = useState<SavedPassword[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  useEffect(() => {
    void window.bridge.passwords.list().then(setSaved);
  }, []);

  async function saveKey() {
    setKeyBusy(true);
    setKeyMsg('');
    try {
      await window.bridge.pigeon.saveKey(key.trim());
      setKeyMsg('Key updated.');
      setKey('');
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : 'key rejected');
    } finally {
      setKeyBusy(false);
    }
  }

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
    setSaved(await window.bridge.passwords.list());
  }

  const byProfile = saved.reduce<Record<string, SavedPassword[]>>((acc, p) => {
    (acc[p.profile] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 pt-24">
      <div className="flex max-h-[70vh] w-[560px] flex-col rounded-lg border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="flex-1 font-semibold">Settings</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Pigeon API key</h2>
            <p className="text-xs text-muted-foreground">
              Stored encrypted on this machine. Paste a new tenant key to replace it.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="pgn_..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="select-text"
              />
              <Button onClick={() => void saveKey()} disabled={keyBusy || key.trim() === ''}>
                {keyBusy && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                Save
              </Button>
            </div>
            {keyMsg && <p className="text-xs text-muted-foreground">{keyMsg}</p>}
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Saved passwords</h2>
            {saved.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing saved yet — log in somewhere and it lands here, scoped to that inbox.
              </p>
            )}
            {Object.entries(byProfile).map(([profile, entries]) => (
              <div key={profile} className="flex flex-col gap-1">
                <h3 className="mt-1 text-xs font-semibold text-muted-foreground">{profile}</h3>
                {entries.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{new URL(p.origin).host}</span>
                      <span className="block truncate text-xs text-muted-foreground select-text">
                        {p.username || '(no username)'}
                        {revealed[p.id] !== undefined && (
                          <span className="ml-2 font-mono">{revealed[p.id]}</span>
                        )}
                      </span>
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
                ))}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
