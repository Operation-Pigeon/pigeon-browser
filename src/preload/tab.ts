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
