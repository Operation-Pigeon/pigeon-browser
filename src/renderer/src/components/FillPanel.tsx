import { useEffect, useState } from 'react';
import { KeyRoundIcon, Loader2Icon, RotateCwIcon, UserIcon, WandIcon } from 'lucide-react';
import type { FillResult, Persona } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Right bar: fill the page in front of you.
 *
 * The load-time autofill only ever sees the page as it arrived, which misses
 * every form that mounts later, appears behind a "Sign up" tab, or needed a
 * click to exist. This scans the page as it is when the button is pressed.
 *
 * The persona is per inbox, like everything else here, so the same invented
 * person answers every form in that session rather than a new one each time.
 */
export function FillPanel({ address, width }: { address: string; width: number }) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [result, setResult] = useState<FillResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Persona | null>(null);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    setResult(null);
    setDraft(null);
    void window.bridge.personas.get(address).then(setPersona);
    void window.bridge.settings.get().then((s) => setAllowed(s.personaFill));
  }, [address]);

  // The page answers asynchronously, since it has to look at itself first.
  useEffect(() => {
    return window.bridge.autofill.onResult((r) => {
      setResult(r);
      setBusy(null);
    });
  }, []);

  async function fill(kind: 'credentials' | 'persona') {
    setBusy(kind);
    setResult(null);
    const sent =
      kind === 'credentials'
        ? await window.bridge.autofill.fillNow()
        : await window.bridge.autofill.fillPersona(address);
    if (!sent) {
      setBusy(null);
      setResult({ filled: [], missing: ['no page to fill'] });
    }
  }

  async function makePassword() {
    setBusy('newpass');
    setResult(null);
    const sent = await window.bridge.autofill.newPassword();
    if (!sent) {
      setBusy(null);
      setResult({ filled: [], missing: ['no page to fill'] });
    }
  }

  async function regenerate() {
    setBusy('regen');
    setPersona(await window.bridge.personas.regenerate(address));
    setDraft(null);
    setBusy(null);
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy('save');
    setPersona(await window.bridge.personas.save(draft));
    setDraft(null);
    setBusy(null);
  }

  const shown = draft ?? persona;

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-l bg-sidebar">
      {/* Same header as the mail, password and history panels: icon, the
          inbox this acts on, and one action. Without it this was the only
          panel that started mid-air. */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <WandIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{address}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New person for this inbox"
          onClick={() => void regenerate()}
        >
          {busy === 'regen' ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <p className="text-xs text-muted-foreground">Scans the page as it is now.</p>

      <Button size="sm" disabled={busy !== null} onClick={() => void fill('credentials')}>
        {busy === 'credentials' ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <KeyRoundIcon data-icon="inline-start" />
        )}
        Email and password
      </Button>

      <Button
        size="sm"
        variant="secondary"
        disabled={busy !== null || !allowed}
        title={allowed ? undefined : 'Turned off in Settings'}
        onClick={() => void fill('persona')}
      >
        {busy === 'persona' ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <UserIcon data-icon="inline-start" />
        )}
        Name, date of birth, location
      </Button>

      {!allowed && (
        <span className="text-xs text-amber-400">
          Invented details are turned off in Settings.
        </span>
      )}

      {result && (
        <div className="flex flex-col gap-1 rounded-md border p-2 text-xs">
          {result.filled.length > 0 && (
            <span className="text-emerald-400">Filled: {result.filled.join(', ')}</span>
          )}
          {result.missing.length > 0 && (
            <span className="text-amber-400">{result.missing.join(', ')}</span>
          )}

          {/* The page wants a password and this inbox has none for the site.
              Saying so without offering one left the panel stating a problem
              it was in a position to solve. */}
          {result.missing.includes('password') && (
            <Button
              size="sm"
              className="mt-1 self-start"
              disabled={busy !== null}
              onClick={() => void makePassword()}
            >
              {busy === 'newpass' && (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              )}
              Generate and save one
            </Button>
          )}
        </div>
      )}

      <div className="border-t pt-3">
        <h3 className="text-sm font-medium">Persona</h3>
        <p className="text-xs text-muted-foreground">Used for this inbox only.</p>
      </div>

      {shown && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={shown.firstName}
              placeholder="First"
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, firstName: e.target.value })}
            />
            <Input
              value={shown.lastName}
              placeholder="Last"
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, lastName: e.target.value })}
            />
          </div>

          <div className="flex gap-2">
            <Input
              type="number"
              value={String(shown.birthDay)}
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, birthDay: Number(e.target.value) })}
            />
            <select
              value={shown.birthMonth}
              className="flex-1 rounded border bg-background px-2 text-xs"
              onChange={(e) => setDraft({ ...shown, birthMonth: Number(e.target.value) })}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <Input
              type="number"
              value={String(shown.birthYear)}
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, birthYear: Number(e.target.value) })}
            />
          </div>

          <div className="flex gap-2">
            <Input
              value={shown.country}
              placeholder="Country"
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, country: e.target.value })}
            />
            <Input
              value={shown.state}
              placeholder="State"
              className="select-text text-xs"
              onChange={(e) => setDraft({ ...shown, state: e.target.value })}
            />
          </div>

          {draft && (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => void saveDraft()}>
                {busy === 'save' && (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                )}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                <RotateCwIcon data-icon="inline-start" />
                Revert
              </Button>
            </div>
          )}
          </div>
        )}
      </div>
    </aside>
  );
}
