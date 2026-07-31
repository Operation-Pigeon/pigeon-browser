import { useEffect, useState } from 'react';
import { KeyIcon } from 'lucide-react';
import type { PendingCredential } from '../../../shared/types';
import { Button } from '@/components/ui/button';

/**
 * "Save password?" prompt. Lives at the foot of the rail, above the settings
 * separator — chrome territory the native page view never covers. A
 * collapsed rail has no room, so it falls back to the top strip (which
 * needs app-no-drag, or the window drag region eats the clicks).
 */
export function SavePasswordPrompt({ collapsed }: { collapsed: boolean }) {
  const [pending, setPending] = useState<PendingCredential | null>(null);

  useEffect(() => window.bridge.passwords.onPrompt(setPending), []);

  if (!pending) return null;

  function answer(save: boolean) {
    void window.bridge.passwords.resolvePrompt(save);
    setPending(null);
  }

  const buttons = (
    <>
      <Button size="sm" className="h-6" onClick={() => answer(true)}>
        Save
      </Button>
      <Button size="sm" variant="ghost" className="h-6" onClick={() => answer(false)}>
        Not now
      </Button>
    </>
  );

  if (collapsed) {
    return (
      <div className="app-no-drag fixed top-1.5 right-[150px] z-50 flex items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md">
        <KeyIcon className="size-3.5 shrink-0" />
        <span className="max-w-64 truncate">
          Save password for <span className="font-medium">{pending.host}</span>?
        </span>
        {buttons}
      </div>
    );
  }

  return (
    <div className="mx-2 mb-2 flex flex-col gap-1.5 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-sm">
      <span className="flex items-center gap-1.5">
        <KeyIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">{pending.host}</span>
      </span>
      <span className="truncate text-muted-foreground">
        Save password{pending.username ? ` for ${pending.username}` : ''}?
      </span>
      <span className="flex items-center gap-1">{buttons}</span>
    </div>
  );
}
