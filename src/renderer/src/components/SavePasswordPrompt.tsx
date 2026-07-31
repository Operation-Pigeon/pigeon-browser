import { useEffect, useState } from 'react';
import { KeyIcon } from 'lucide-react';
import type { PendingCredential } from '../../../shared/types';
import { Button } from '@/components/ui/button';

/**
 * "Save password?" toast, shown when auto-save is off (the default). Sits in
 * the top chrome strip — the one band the native page view never covers —
 * so it can't be hidden by whatever page triggered it.
 */
export function SavePasswordPrompt() {
  const [pending, setPending] = useState<PendingCredential | null>(null);

  useEffect(() => window.bridge.passwords.onPrompt(setPending), []);

  if (!pending) return null;

  function answer(save: boolean) {
    void window.bridge.passwords.resolvePrompt(save);
    setPending(null);
  }

  return (
    <div className="fixed top-1.5 right-[150px] z-50 flex items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
      <KeyIcon className="size-3.5 shrink-0" />
      <span className="max-w-64 truncate">
        Save password for <span className="font-medium">{pending.host}</span> in {pending.profile}?
      </span>
      <Button size="sm" className="h-6" onClick={() => answer(true)}>
        Save
      </Button>
      <Button size="sm" variant="ghost" className="h-6" onClick={() => answer(false)}>
        Never mind
      </Button>
    </div>
  );
}
