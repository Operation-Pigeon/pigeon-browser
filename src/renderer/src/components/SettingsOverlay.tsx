import { useEffect, useState } from 'react';
import { Loader2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { TunnelSetup } from './TunnelSetup';
import { cn } from '@/lib/utils';

type Tab = 'general' | 'tunnels';

/**
 * Global settings. Saved passwords live in their own right-bar panel (they
 * are per-inbox); this is app-wide config only. The overlay covers the page
 * area, so the caller hides the native view while it's open.
 */
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  const [key, setKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const [shareHistory, setShareHistory] = useState(false);
  const [personaFill, setPersonaFill] = useState(true);

  useEffect(() => {
    void window.bridge.settings.get().then((s) => {
      setAutoSave(s.autoSavePasswords);
      setShareHistory(s.shareHistorySuggestions);
      setPersonaFill(s.personaFill);
    });
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

  function toggleAutoSave(value: boolean) {
    setAutoSave(value);
    void window.bridge.settings.setAutoSave(value);
  }

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'border-b-2 px-3 py-2 text-sm',
        tab === id
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 pt-24">
      <div className="flex max-h-[70vh] w-[560px] flex-col rounded-lg border bg-card shadow-lg">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="flex-1 font-semibold">Settings</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon />
          </Button>
        </div>

        <div className="flex shrink-0 gap-1 border-b px-2">
          {tabButton('general', 'General')}
          {tabButton('tunnels', 'Tunnels')}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {tab === 'general' && (
            <>
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Pigeon API key</h2>
                <p className="text-xs text-muted-foreground">
                  Stored encrypted on this machine. Paste a new workspace key to replace it.
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
                <h2 className="text-sm font-medium">Passwords</h2>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoSave}
                    onChange={(e) => toggleAutoSave(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Save passwords automatically
                    <span className="block text-xs text-muted-foreground">
                      Off: you get a prompt after each login. Saved logins live in the key panel on
                      the right, per inbox.
                    </span>
                  </span>
                </label>
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Autofill</h2>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={personaFill}
                    onChange={(e) => {
                      setPersonaFill(e.target.checked);
                      void window.bridge.settings.setPersonaFill(e.target.checked);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Allow filling invented details
                    <span className="block text-xs text-muted-foreground">
                      Names, dates of birth, country and state, for every inbox. Off blocks it in
                      the app itself, not just in the panel. Saved passwords are unaffected.
                    </span>
                  </span>
                </label>
              </section>

              <Separator />

              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">History</h2>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={shareHistory}
                    onChange={(e) => {
                      setShareHistory(e.target.checked);
                      void window.bridge.settings.setShareHistory(e.target.checked);
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    Share address-bar suggestions between inboxes
                    <span className="block text-xs text-muted-foreground">
                      Off: each inbox suggests only its own history. The history panel is always
                      per-inbox either way.
                    </span>
                  </span>
                </label>
              </section>
            </>
          )}

          {tab === 'tunnels' && <TunnelSetup />}
        </div>
      </div>
    </div>
  );
}
