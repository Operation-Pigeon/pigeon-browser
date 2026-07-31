import { useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function KeySetup({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await window.bridge.pigeon.saveKey(key.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'key rejected');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-drag flex h-full items-center justify-center">
      <form
        className="app-no-drag flex w-96 flex-col gap-3 rounded-lg border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save();
        }}
      >
        <h1 className="text-lg font-semibold">🐦 Pigeon Browser</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Pigeon API key. It's stored encrypted on this machine and only ever sent to the
          Pigeon API.
        </p>
        <Input
          type="password"
          placeholder="pgn_..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          className="select-text"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || key.trim() === ''}>
          {busy && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Save key
        </Button>
      </form>
    </div>
  );
}
