import type { Inbox } from '../../../shared/types';

/** Left rail: one entry per inbox — each is its own browsing session. */
export function Rail({
  inboxes,
  activeProfile,
  onSelect,
}: {
  inboxes: Inbox[];
  activeProfile: string | null;
  onSelect: (address: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-neutral-800 p-2">
      <div className="px-2 py-1 text-sm font-semibold">🐦 Pigeon</div>
      {inboxes.map((inbox) => {
        const active = inbox.address === activeProfile;
        return (
          <button
            key={inbox.address}
            type="button"
            onClick={() => onSelect(inbox.address)}
            className={`flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
              active ? 'bg-neutral-800' : 'hover:bg-neutral-900'
            }`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-700 text-xs font-semibold uppercase">
              {(inbox.displayName || inbox.address)[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {inbox.displayName || inbox.address}
              </span>
              <span className="block truncate text-xs text-neutral-500">{inbox.address}</span>
            </span>
            {inbox.unread > 0 && (
              <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-xs font-semibold">
                {inbox.unread}
              </span>
            )}
          </button>
        );
      })}
      {inboxes.length === 0 && (
        <p className="px-2 text-xs text-neutral-500">
          No inboxes — create one in the Pigeon webapp or API.
        </p>
      )}
    </aside>
  );
}
