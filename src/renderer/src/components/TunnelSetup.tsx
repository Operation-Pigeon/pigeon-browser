import { useEffect, useState } from 'react';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  LogOutIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { MystSetup } from '../../../shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * One-time setup for per-inbox tunnels.
 *
 * The stages are a chain, each blocked until the one before it is done, so
 * only the current step is shown rather than a form full of controls that
 * cannot work yet.
 */
export function TunnelSetup() {
  const [setup, setSetup] = useState<MystSetup | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [importPath, setImportPath] = useState('');
  const [importPass, setImportPass] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Cached snapshot first so the panel paints at once, then a real refresh:
    // the node's balance cache starts empty, and showing 0 MYST to someone
    // who has funds is alarming in a way a brief spinner is not.
    void window.bridge.exits.setup().then(setSetup);
    void window.bridge.exits.refresh().then(setSetup);
    return window.bridge.exits.onSetup(setSetup);
  }, []);

  // Stages advance on their own: registration settles, a top-up lands.
  useEffect(() => {
    const t = setInterval(() => void window.bridge.exits.refresh().then(setSetup), 8000);
    return () => clearInterval(t);
  }, []);

  async function run(name: string, work: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      const result = (await work()) as { ok?: boolean; error?: string } | undefined;
      if (result && result.ok === false) setError(result.error ?? 'Failed.');
    } finally {
      setBusy(null);
      setSetup(await window.bridge.exits.refresh());
    }
  }

  if (!setup) return null;
  const gib = setup.pricePerGib;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Give each inbox its own IP address. Uses the Mysterium network, paid by the gigabyte.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {setup.stage === 'no-binary' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            Needs the Mysterium node program. Windows Defender may block it; allow the folder and
            retry.
          </span>
          <Button
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() => run('install', () => window.bridge.exits.install())}
          >
            {busy === 'install' ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            Download
          </Button>
          <div className="flex gap-2">
            <Input
              placeholder="Or path to an existing myst.exe"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              className="select-text text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!manualPath.trim()}
              onClick={() => run('path', () => window.bridge.exits.useBinary(manualPath.trim()))}
            >
              Use
            </Button>
          </div>
        </div>
      )}

      {setup.stage === 'starting' && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Starting node
        </span>
      )}

      {setup.stage === 'no-identity' && setup.relinkable && (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <span className="text-xs text-muted-foreground">
            An identity is still on this machine, unlinked.
          </span>
          <span className="font-mono text-[10px] break-all select-text">{setup.relinkable}</span>
          <Button
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() => run('relink', () => window.bridge.exits.relink())}
          >
            {busy === 'relink' && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Use it again
          </Button>
        </div>
      )}

      {setup.stage === 'no-identity' && (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() => run('identity', () => window.bridge.exits.createIdentity())}
          >
            {busy === 'identity' && (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            )}
            Create payment identity
          </Button>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Import an existing one</summary>
            <div className="mt-2 flex flex-col gap-2">
              <Input
                placeholder="Path to the UTC-... keystore file"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                className="select-text text-xs"
              />
              <Input
                type="password"
                placeholder="Its passphrase"
                value={importPass}
                onChange={(e) => setImportPass(e.target.value)}
                className="select-text text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={!importPath.trim() || busy !== null}
                onClick={() =>
                  run('import', () =>
                    window.bridge.exits.importIdentity(importPath.trim(), importPass),
                  )
                }
              >
                {busy === 'import' && (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                )}
                Import
              </Button>
            </div>
          </details>
        </div>
      )}

      {setup.stage === 'unregistered' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">
            Registration costs about 0.1 MYST and completes after your first top-up.
          </span>
          <Button
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() => run('register', () => window.bridge.exits.register())}
          >
            {busy === 'register' && (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            )}
            Register
          </Button>
        </div>
      )}

      {setup.stage === 'registering' && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" /> Registering, completes once funded
        </span>
      )}

      {(setup.stage === 'unfunded' || setup.stage === 'ready') && setup.channelAddress && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Balance</span>
            <span className="font-mono text-sm">
              {setup.balance.toFixed(4)} MYST
              {gib ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  ~{(setup.balance / gib).toFixed(1)} GB
                </span>
              ) : null}
            </span>
          </div>

          <span className="text-xs text-muted-foreground">
            Top up with MYST on the Polygon network. This is the payment channel, not the identity.
          </span>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs select-text">
              {setup.channelAddress}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(setup.channelAddress!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>

          {gib && (
            <span className="text-xs text-muted-foreground">
              {gib.toFixed(2)} MYST per GB. A browsing session is roughly 10 to 30 MB.
            </span>
          )}

          {setup.stage === 'unfunded' && (
            <span className="text-xs text-amber-400">
              No balance yet. Tunnels cannot connect until there is one.
            </span>
          )}
          {setup.stage === 'ready' && (
            <span className="text-xs text-emerald-400">
              Ready. Turn a tunnel on from the globe icon in the left rail.
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => run('refresh', () => window.bridge.exits.refresh())}
        >
          <RotateCwIcon data-icon="inline-start" />
          Refresh
        </Button>

        {setup.identity && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setSigningOut(true)}
          >
            <LogOutIcon data-icon="inline-start" />
            Unlink identity
          </Button>
        )}
      </div>

      {setup.identity && (
        <span className="font-mono text-[10px] break-all text-muted-foreground select-text">
          {setup.identity}
        </span>
      )}

      {/* Unlinking is reversible, forgetting is not, so they are two separate
          answers rather than one button with a warning attached. */}
      {signingOut && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
          <span className="text-xs">
            Turn off every tunnel and unlink this identity? Inboxes go back to browsing directly.
          </span>
          <span className="text-xs text-muted-foreground">
            The keystore stays on this machine, so you can link it again and keep the balance.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSigningOut(false);
                void run('signout', () => window.bridge.exits.signOut(false));
              }}
            >
              Unlink, keep keystore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSigningOut(false)}>
              Cancel
            </Button>
          </div>
          <button
            type="button"
            className="self-start text-[11px] text-destructive underline"
            onClick={() => {
              setSigningOut(false);
              void run('signout', () => window.bridge.exits.signOut(true));
            }}
          >
            Unlink and delete the keystore. Any remaining balance becomes unreachable.
          </button>
        </div>
      )}
    </div>
  );
}
