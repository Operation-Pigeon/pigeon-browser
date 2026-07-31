import { useState } from 'react';

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
    <div className="flex h-full items-center justify-center">
      <form
        className="flex w-96 flex-col gap-3 rounded-lg border border-neutral-800 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void save();
        }}
      >
        <h1 className="text-lg font-semibold">🐦 Pigeon Browser</h1>
        <p className="text-sm text-neutral-400">
          Paste a Pigeon API key. It's stored encrypted on this machine and only ever sent to the
          Pigeon API.
        </p>
        <input
          type="password"
          placeholder="pgn_..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || key.trim() === ''}
          className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Save key'}
        </button>
      </form>
    </div>
  );
}
