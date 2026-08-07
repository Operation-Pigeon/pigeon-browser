import {
  Configuration,
  DefaultApi,
  Direction,
  MessageState,
  OtpConfidence,
  type InboxData,
  type MessageData,
} from '@operation-pigeon/client';

import { getApiKey, setApiKey } from './settings';
import { KEY_REJECTED, type Inbox, type MailDetail, type MailSummary, type OtpHit } from '../shared/types';

/**
 * Pigeon API client, main-process only: no CORS to fight, and the key never
 * enters a renderer that also hosts arbitrary web content.
 *
 * The client itself is **generated from the Smithy model**, not written here.
 * The hand-written one this replaced drifted the moment the API moved to v1 —
 * it sent `x-api-key` against unversioned paths, so every call answered 401
 * and the app was dead in the water with nothing to say about why. A generated
 * client turns that class of failure into a compile error.
 *
 * What stays hand-written is the *mapping* below. The app's own vocabulary
 * (`MailSummary`, `OtpHit`, addresses rather than ids) is deliberately kept:
 * every session, tab, password and history row is keyed by inbox address, and
 * rewriting all of that to carry ids would be a large change for no gain.
 */
const BASE = process.env.PIGEON_API_URL ?? 'https://api.mailpigeon.vip';

function api(key = getApiKey()): DefaultApi {
  if (!key) throw new Error('no API key configured');
  // The scheme changed with v1: `Authorization: Bearer`, not `x-api-key`.
  return new DefaultApi(
    new Configuration({ basePath: BASE, headers: { Authorization: `Bearer ${key}` } }),
  );
}

/**
 * Turns a refused key into something the app can act on.
 *
 * The authorizer answers `403` for a key it does not recognise, and every key
 * minted against v0 is such a key — so the first launch after this migration
 * fails this way for everybody. Swallowed, that is an empty rail and no
 * explanation. Named, the renderer can ask for a new key instead.
 *
 * Only 401 and 403. A timeout or a 500 is worth retrying and must not throw
 * away a key that is perfectly good.
 */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401 || status === 403) throw new Error(KEY_REJECTED);
    throw error;
  }
}

/**
 * Addresses are what this app is built around; v1 addresses inboxes by id.
 *
 * Resolved from the inbox list and remembered, because every mail call needs
 * it and the mapping only changes when an inbox is created or deleted. A miss
 * refetches once rather than failing — an inbox made in the webapp a moment
 * ago should not need a restart to appear.
 */
const ids = new Map<string, string>();

async function inboxId(address: string): Promise<string> {
  const known = ids.get(address);
  if (known) return known;

  await pigeon.inboxes();

  const found = ids.get(address);
  if (!found) throw new Error(`no inbox for ${address}`);
  return found;
}

/** `high` on the wire; the app has always shouted it. */
function confidence(value: OtpConfidence): OtpHit['confidence'] {
  return value.toUpperCase() as OtpHit['confidence'];
}

function summary(message: MessageData): MailSummary {
  return {
    id: message.id,
    threadId: message.threadId,
    direction: message.direction === Direction.Outbound ? 'OUTBOUND' : 'INBOUND',
    from: message.from.map((who) => ({ email: who.email, name: who.name })),
    subject: message.subject,
    receivedAt: message.receivedAt.toISOString(),
    snippet: message.snippet,
    attachmentCount: message.attachments.length,
    // Kept as a timestamp-or-null because that is what this app reads. v1
    // moved the fact to `state`; the stamp is now a detail of being trashed,
    // and only ever set when it is.
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
    // The API paginates messages, not conversations. One row is one message.
    count: 1,
    read: message.read,
    otp: message.otp
      ? { code: message.otp.code, confidence: confidence(message.otp.confidence) }
      : null,
  };
}

export const pigeon = {
  hasKey: () => getApiKey() !== null,

  /** Validates against /me before persisting — a bad paste never sticks. */
  async saveKey(key: string): Promise<void> {
    try {
      await api(key).getMe({});
    } catch {
      throw new Error('key rejected by the API');
    }
    setApiKey(key);
  },

  async me(): Promise<{ tenantId: string; name: string; admin: boolean }> {
    const me = await run(() => api().getMe({}));
    return {
      tenantId: me.tenant.id,
      name: me.tenant.name,
      // v1 answers with scopes rather than a flag. Nothing in this app gates
      // on it yet, so the question it used to ask is answered honestly here
      // rather than dropped and rediscovered later.
      admin: me.scopes.includes('admin'),
    };
  },

  async inboxes(): Promise<{ inboxes: Inbox[] }> {
    const listed = await run(() => api().listInboxes({ limit: 100 }));

    const inboxes = listed.data.map((inbox: InboxData) => {
      ids.set(inbox.address, inbox.id);
      return {
        address: inbox.address,
        displayName: inbox.displayName,
        createdAt: inbox.createdAt.toISOString(),
        unread: inbox.counts.unread,
        // The API already filters this by age — a code too old to be useful
        // is absent rather than stale (§5). `from` and `subject` are not on
        // the snapshot; the panel fills them in from the message itself when
        // it needs them, and the popup only ever shows the code.
        otp: inbox.lastOtp
          ? {
              code: inbox.lastOtp.code,
              confidence: confidence(inbox.lastOtp.confidence),
              mailId: inbox.lastOtp.messageId,
              from: [],
              subject: '',
              receivedAt: inbox.lastOtp.receivedAt.toISOString(),
            }
          : null,
      } satisfies Inbox;
    });

    return { inboxes };
  },

  async mail(address: string): Promise<{ emails: MailSummary[] }> {
    const inbox = await inboxId(address);
    const listed = await run(() => api().listMessages({ inbox, limit: 25 }));
    return { emails: listed.data.map(summary) };
  },

  /**
   * The message, and the fact that you have now read it.
   *
   * Two calls where v0 needed one: fetching a message used to mark it read as
   * a side effect, and v1 deliberately separated them so a client can show a
   * message without asserting anybody saw it. This app is not that client —
   * opening mail in the panel *is* reading it — so it says so explicitly.
   *
   * The read is not awaited into the result: failing to record it should not
   * stop the mail being shown.
   */
  async mailDetail(id: string): Promise<MailDetail> {
    const { message } = await run(() => api().getMessage({ messageId: id }));

    void api()
      .updateMessage({ messageId: id, updateMessageRequestContent: { read: true } })
      .catch(() => {});

    return {
      id: message.id,
      inbox: message.inboxId,
      threadId: message.threadId,
      direction: message.direction === Direction.Outbound ? 'OUTBOUND' : 'INBOUND',
      from: message.from.map((who) => ({ email: who.email, name: who.name })),
      to: message.to.map((who) => ({ email: who.email, name: who.name })),
      cc: message.cc.map((who) => ({ email: who.email, name: who.name })),
      subject: message.subject,
      receivedAt: message.receivedAt.toISOString(),
      bodyText: message.body.text,
      // Fetched separately, and only when it is worth having: HTML can exceed
      // a DynamoDB item on its own, so it is never on the representation.
      bodyHtml: '',
      hasHtml: message.body.hasHtml,
    };
  },

  /**
   * The sanitized HTML, or nothing.
   *
   * Absent rather than empty when a message has no HTML part, which is most
   * plain-text mail — so this is a real case and not a defensive default. The
   * panel decides what to show; an empty string is how it has always been
   * told there is nothing.
   */
  async mailHtml(id: string): Promise<{ html: string }> {
    const { html } = await run(() => api().getMessageHtml({ messageId: id }));
    return { html: html ?? '' };
  },

  markRead: async (id: string): Promise<void> => {
    await api().updateMessage({ messageId: id, updateMessageRequestContent: { read: true } });
  },

  markUnread: async (id: string): Promise<void> => {
    await api().updateMessage({ messageId: id, updateMessageRequestContent: { read: false } });
  },

  /**
   * The bin, not the incinerator.
   *
   * v0's DELETE was reversible; v1's is not — it removes the copy and its
   * stored objects for good. What the panel's button has always meant is
   * "get this out of my way", so it moves the message to trash, where the
   * retention window can still give it back.
   */
  deleteMail: async (id: string): Promise<void> => {
    await api().updateMessage({
      messageId: id,
      updateMessageRequestContent: { state: MessageState.Trashed },
    });
  },
};
