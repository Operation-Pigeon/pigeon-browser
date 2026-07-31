import { getApiKey, setApiKey } from './settings';

/**
 * Pigeon API client, main-process only: no CORS to fight, and the key never
 * enters a renderer that also hosts arbitrary web content.
 */
const BASE = process.env.PIGEON_API_URL ?? 'https://api.mailpigeon.vip';

async function call<T>(path: string): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error('no API key configured');
  const res = await fetch(BASE + path, { headers: { 'x-api-key': key } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status}`);
  return body as T;
}

export const pigeon = {
  hasKey: () => getApiKey() !== null,

  /** Validates against /me before persisting — a bad paste never sticks. */
  async saveKey(key: string): Promise<void> {
    const res = await fetch(`${BASE}/me`, { headers: { 'x-api-key': key } });
    if (!res.ok) throw new Error('key rejected by the API');
    setApiKey(key);
  },

  me: () => call<{ tenantId: string; name: string; admin: boolean }>('/me'),
  inboxes: () => call<{ inboxes: unknown[] }>('/inboxes'),
  mail: (address: string) =>
    call<{ emails: unknown[] }>(`/inboxes/${encodeURIComponent(address)}/emails?limit=25`),
  mailDetail: (id: string) => call<unknown>(`/emails/${encodeURIComponent(id)}`),
  mailHtml: (id: string) => call<{ html: string }>(`/emails/${encodeURIComponent(id)}/html`),
};
