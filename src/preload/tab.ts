/**
 * Injected into every browser tab (sandboxed, isolated world). Two jobs:
 *  - fill login fields with data main pushes for THIS tab's inbox + origin
 *  - report submitted credentials back so main can remember them
 *
 * It never asks for secrets by name — main decides what this page gets,
 * keyed off the tab's own profile and URL.
 */
import { ipcRenderer } from 'electron';

interface FillData {
  email: string;
  username?: string;
  password?: string;
}

let data: FillData | null = null;
let filled = false;

// :not([type=password]) on every branch — password fields are frequently
// named "user_password"-ish, and matching one here once poisoned a captured
// username with the password itself.
const EMAIL_SELECTOR = [
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="user" i]',
  'input[id*="user" i]',
]
  .map((s) => `${s}:not([type="password"]):not([type="hidden"])`)
  .join(', ');

function setNativeValue(input: HTMLInputElement, value: string): void {
  // React and friends ignore plain .value writes; go through the native
  // setter and announce it, or the framework never sees the fill.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function tryFill(): void {
  if (!data || filled) return;
  const passwordInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((i) => !i.value);
  const emailInputs = Array.from(document.querySelectorAll<HTMLInputElement>(EMAIL_SELECTOR)).filter(
    (i) => !i.value && i.type !== 'password' && i.type !== 'hidden',
  );

  if (data.password && passwordInputs.length > 0) {
    // Stored credential wins: username + password.
    for (const pw of passwordInputs) setNativeValue(pw, data.password);
    const user = data.username || data.email;
    if (emailInputs[0] && user) setNativeValue(emailInputs[0], user);
    filled = passwordInputs.length > 0;
    return;
  }

  // No password field on this page (e.g. step 1 of a two-page login) —
  // fill the identity field: the stored username if we have one, else this
  // inbox's address.
  if (emailInputs.length > 0) {
    const value = data.username || data.email;
    for (const input of emailInputs) setNativeValue(input, value);
    filled = true;
  }
}

ipcRenderer.on('autofill:data', (_e, incoming: FillData) => {
  data = incoming;
  filled = false;
  tryFill();
  // SPAs mount login forms late; retry briefly instead of observing forever.
  setTimeout(tryFill, 800);
  setTimeout(tryFill, 2500);
});

function capture(root: ParentNode): void {
  const pw = root.querySelector<HTMLInputElement>('input[type="password"]');
  if (!pw?.value) return;
  const userInput =
    root.querySelector<HTMLInputElement>(EMAIL_SELECTOR) ??
    root.querySelector<HTMLInputElement>('input[type="text"]');
  // Belt and braces: never let the password field double as the username.
  const user = userInput && userInput !== pw && userInput.value !== pw.value ? userInput.value : '';
  ipcRenderer.send('autofill:captured', { username: user, password: pw.value });
}

// Classic form posts.
window.addEventListener(
  'submit',
  (e) => {
    if (e.target instanceof HTMLFormElement) capture(e.target);
  },
  true,
);

// SPA logins that never submit a form: Enter in a password field, or a
// click on something button-shaped while a password field holds a value.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'password') {
      capture(e.target.form ?? document);
    }
  },
  true,
);
window.addEventListener(
  'click',
  (e) => {
    const el = e.target instanceof Element ? e.target.closest('button, [type="submit"], [role="button"]') : null;
    if (el) capture((el.closest('form') as ParentNode | null) ?? document);
  },
  true,
);

/* ---------------------------------------------------------------------- *
 * Multi-inbox mirroring
 *
 * Leader tabs describe what the user did; follower tabs resolve that
 * description against their own DOM. Coordinates would be useless — the same
 * site renders differently per session — so targets are described by stable
 * attributes first, structure last.
 * ---------------------------------------------------------------------- */

type MirrorRole = 'leader' | 'follower' | 'off';
let role: MirrorRole = 'off';
let applying = false; // guards against re-capturing our own synthetic events

ipcRenderer.on('mirror:role', (_e, next: MirrorRole) => {
  role = next;
});

const OTP_HINT = /(otp|one[-_]?time|verification|2fa|mfa|auth[-_]?code|passcode|\bcode\b)/i;

function classify(el: Element): 'email' | 'password' | 'otp' | 'other' {
  if (!(el instanceof HTMLInputElement)) return 'other'; // textarea, contenteditable
  if (el.type === 'password') return 'password';
  const hint = `${el.name} ${el.id} ${el.autocomplete} ${el.getAttribute('aria-label') ?? ''}`;
  if (el.autocomplete === 'one-time-code' || OTP_HINT.test(hint)) return 'otp';
  if (el.matches(EMAIL_SELECTOR)) return 'email';
  return 'other';
}

function isEditable(el: Element): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

function describe(el: Element): { selector: string; text?: string } {
  const tag = el.tagName.toLowerCase();
  const attr = (name: string) => {
    const v = el.getAttribute(name);
    return v ? `${tag}[${name}="${CSS.escape(v)}"]` : null;
  };
  // Stable identifiers beat structure; purely numeric ids are usually
  // framework-generated and differ between sessions.
  const stable =
    (el.id && !/^\d/.test(el.id) ? `#${CSS.escape(el.id)}` : null) ??
    attr('name') ??
    attr('data-testid') ??
    attr('aria-label') ??
    attr('placeholder');

  let selector = stable ?? '';
  if (!selector) {
    const path: string[] = [];
    let node: Element | null = el;
    while (node && path.length < 8) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      const idx =
        Array.from(parent.children).filter((c) => c.tagName === node!.tagName).indexOf(node) + 1;
      path.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${idx})`);
      node = parent;
    }
    selector = path.join(' > ');
  }

  const text = (el.textContent ?? '').trim().slice(0, 60);
  return { selector, text: text || undefined };
}

function resolve(ref: { selector: string; text?: string }): HTMLElement | null {
  if (ref.selector) {
    try {
      const el = document.querySelector<HTMLElement>(ref.selector);
      if (el) return el;
    } catch {
      /* selector didn't survive the trip — fall through to text */
    }
  }
  if (ref.text) {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, a, [role="button"], input[type="submit"]'),
    );
    return (
      candidates.find(
        (c) => (c.textContent ?? (c as HTMLInputElement).value ?? '').trim() === ref.text,
      ) ?? null
    );
  }
  return null;
}

function emit(event: unknown): void {
  if (role !== 'leader' || applying) return;
  ipcRenderer.send('mirror:event', event);
}

window.addEventListener(
  'click',
  (e) => {
    if (role !== 'leader' || !(e.target instanceof Element)) return;
    const el = e.target.closest<HTMLElement>('a, button, [role="button"], input, label, select');
    if (!el) return;
    // Typing is mirrored by value; clicking into a field is noise.
    if (el instanceof HTMLInputElement && !['submit', 'button', 'checkbox', 'radio'].includes(el.type)) {
      return;
    }
    emit({ kind: 'click', target: describe(el) });
  },
  true,
);

/**
 * Focus moves are mirrored so followers put their caret in the same field —
 * which is what makes raw keystroke replay land in the right place.
 */
window.addEventListener(
  'focusin',
  (e) => {
    if (role !== 'leader' || !(e.target instanceof Element) || !isEditable(e.target)) return;
    emit({ kind: 'focus', target: { ...describe(e.target), field: classify(e.target) } });
  },
  true,
);

/**
 * Only identity fields mirror by value — everything else arrives as real key
 * events (see keydown below), so rich editors like ProseMirror stay
 * consistent instead of having their state overwritten behind their back.
 */
window.addEventListener(
  'input',
  (e) => {
    if (role !== 'leader' || !(e.target instanceof HTMLInputElement)) return;
    const field = classify(e.target);
    if (field === 'other') return;
    emit({ kind: 'input', target: { ...describe(e.target), field }, value: e.target.value });
  },
  true,
);

const SPECIAL_KEYS = new Set([
  'Backspace',
  'Delete',
  'Enter',
  'Tab',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

window.addEventListener(
  'keydown',
  (e) => {
    if (role !== 'leader') return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
    if (!printable && !SPECIAL_KEYS.has(e.key)) return;
    emit({
      kind: 'keystroke',
      stroke: { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey },
    });
  },
  true,
);

let scrollTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener(
  'scroll',
  () => {
    if (role !== 'leader' || scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      emit({ kind: 'scroll', x: window.scrollX, y: window.scrollY });
    }, 120);
  },
  true,
);

window.addEventListener(
  'submit',
  (e) => {
    if (role !== 'leader' || !(e.target instanceof HTMLFormElement)) return;
    emit({ kind: 'submit', target: describe(e.target) });
  },
  true,
);

window.addEventListener(
  'keydown',
  (e) => {
    if (role !== 'leader' || e.key !== 'Enter' || !(e.target instanceof HTMLElement)) return;
    emit({ kind: 'key', target: describe(e.target), key: 'Enter' });
  },
  true,
);

function applyTo(el: HTMLElement, event: { kind: string; value?: string }): void {
  applying = true;
  try {
    switch (event.kind) {
      case 'click':
        el.click();
        break;
      case 'focus':
        el.focus();
        break;
      case 'input':
        if (el instanceof HTMLInputElement && event.value !== undefined) {
          setNativeValue(el, event.value);
        }
        break;
      case 'submit':
        if (el instanceof HTMLFormElement) el.requestSubmit();
        break;
      case 'key':
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        break;
    }
  } finally {
    applying = false;
  }
}

ipcRenderer.on('mirror:scroll', (_e, pos: { x: number; y: number }) => {
  if (role !== 'follower') return;
  window.scrollTo(pos.x, pos.y);
});

ipcRenderer.on(
  'mirror:apply',
  (_e, event: { kind: string; target: { selector: string; text?: string }; value?: string }) => {
    if (role !== 'follower') return;

    const immediate = resolve(event.target);
    if (immediate) {
      applyTo(immediate, event);
      ipcRenderer.send('mirror:result', true);
      return;
    }

    // A follower mid-load simply doesn't have the element yet; most "misses"
    // are timing, not real divergence. Wait for it via MutationObserver
    // rather than polling: follower tabs are hidden pages, and Chromium
    // throttles timers there — exactly where the retry is needed most.
    let settled = false;
    const finish = (el: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(giveUp);
      if (el) applyTo(el, event);
      ipcRenderer.send('mirror:result', el !== null);
    };
    const observer = new MutationObserver(() => {
      if (role !== 'follower') return finish(null);
      const el = resolve(event.target);
      if (el) finish(el);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    // Generous because a throttled timer may fire late; the observer is what
    // usually settles this.
    const giveUp = setTimeout(() => finish(null), 5000);
  },
);
