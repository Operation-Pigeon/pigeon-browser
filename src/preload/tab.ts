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

/**
 * Fills the page as it is right now, on request, rather than as it was when
 * it loaded.
 *
 * The load-time path bails once it has filled something, which is right for
 * automatic behaviour: a form that arrives late should not be refilled behind
 * the user's back. But a person pressing Fill means this page, this moment,
 * so this ignores that guard and rescans, and it skips nothing for already
 * having a value: retyping over a wrong autofill is the usual reason to press
 * it twice.
 */
function fillNow(incoming: FillData): { filled: string[]; missing: string[] } {
  const done: string[] = [];
  const missing: string[] = [];

  const passwords = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter(visible);
  const emails = Array.from(document.querySelectorAll<HTMLInputElement>(EMAIL_SELECTOR)).filter(
    (i) => visible(i) && i.type !== 'password' && i.type !== 'hidden',
  );

  const user = incoming.username || incoming.email;
  if (emails.length && user) {
    for (const input of emails) setNativeValue(input, user);
    done.push('email');
  } else if (emails.length) {
    missing.push('email');
  }

  if (passwords.length && incoming.password) {
    for (const input of passwords) setNativeValue(input, incoming.password);
    done.push('password');
  } else if (passwords.length) {
    // A password box with nothing saved for this site yet. Worth saying, so
    // the panel can offer to make one rather than looking broken.
    missing.push('password');
  }

  return { filled: done, missing };
}

/**
 * Hidden inputs are not fillable in any useful sense, and forms routinely
 * carry a decoy copy of the login fields that is display:none. Filling those
 * looks like success and submits nothing.
 */
function visible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
}

interface PersonaData {
  firstName: string;
  lastName: string;
  birthDay: number;
  birthMonth: number;
  birthYear: number;
  country: string;
  state: string;
}

/**
 * Finds a field by what the page calls it.
 *
 * autocomplete first, because a page that bothers to set it has told us the
 * answer and is never wrong. Name and id next. Placeholder and aria-label
 * last: they are prose, so they match loosely and are the most likely to be
 * a false positive.
 */
function findField(patterns: {
  autocomplete?: string[];
  attr?: RegExp;
  types?: string[];
}): HTMLInputElement | HTMLSelectElement | null {
  const fields = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'),
  ).filter((el) => visible(el) && !(el instanceof HTMLInputElement && el.type === 'hidden'));

  for (const want of patterns.autocomplete ?? []) {
    const hit = fields.find((el) => el.getAttribute('autocomplete') === want);
    if (hit) return hit;
  }
  if (patterns.attr) {
    const hit = fields.find((el) => {
      const hay = `${el.getAttribute('name') ?? ''} ${el.id} ${
        el.getAttribute('placeholder') ?? ''
      } ${el.getAttribute('aria-label') ?? ''}`;
      return patterns.attr!.test(hay);
    });
    if (hit) return hit;
  }
  for (const type of patterns.types ?? []) {
    const hit = fields.find((el) => el instanceof HTMLInputElement && el.type === type);
    if (hit) return hit;
  }
  return null;
}

/**
 * True while filling automatically on page load, when the rule is different:
 * fill what is empty and leave alone anything already carrying a value.
 *
 * Pressing the button means "this page, now, do it again", so that path still
 * overwrites; a load-time pass that clobbered half-typed answers would be a
 * worse feature than not running at all.
 */
let gentle = false;

function setField(el: HTMLInputElement | HTMLSelectElement | null, value: string): boolean {
  if (!el) return false;
  if (gentle && el.value) return false;
  if (el instanceof HTMLSelectElement) {
    // Month dropdowns are the common case, and they are labelled every way
    // imaginable: "3", "03", "March", "Mar". Match the value first, then the
    // visible text, so all four land on the same option.
    const wanted = value.toLowerCase();
    const option = Array.from(el.options).find(
      (o) =>
        o.value.toLowerCase() === wanted ||
        o.value.replace(/^0/, '') === value.replace(/^0/, '') ||
        o.text.toLowerCase().startsWith(wanted),
    );
    if (!option) return false;
    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  setNativeValue(el, value);
  return true;
}

/**
 * The words shown next to a radio, which is often the only place its meaning
 * lives: a custom picker hides the input and paints a label instead, so the
 * value may be an index while "March" exists only as text.
 *
 * Four places that text can be, in order of how reliable it is. The last two
 * are guesses, so they are length-capped: a parent that contains the whole
 * form would otherwise "match" everything.
 */
function labelFor(el: HTMLInputElement): string[] {
  const texts: string[] = [];
  const push = (s: string | null | undefined) => {
    const t = (s ?? '').trim();
    if (t && t.length <= 24) texts.push(t.toLowerCase());
  };

  if (el.id) push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent);
  push(el.closest('label')?.textContent);
  push(el.getAttribute('aria-label'));
  push(el.nextElementSibling?.textContent);
  push(el.parentElement?.textContent);
  return texts;
}

/**
 * Picks one option out of a radio group.
 *
 * Custom dropdowns are frequently a pile of radios with the real inputs
 * styled away, so this deliberately does not require them to be visible: the
 * thing the user sees is a label, and the thing that carries the answer is a
 * radio nobody can see. Writing .value on a radio sets its attribute and
 * selects nothing, which is the trap.
 */
function setRadioGroup(group: HTMLInputElement[], candidates: string[]): boolean {
  // Someone has already chosen from this group; leave their answer alone.
  if (gentle && group.some((r) => r.checked && r.value)) return false;
  for (const want of candidates) {
    const wanted = want.toLowerCase();
    const hit = group.find((r) => {
      if (r.value.toLowerCase() === wanted) return true;
      if (r.value && r.value.replace(/^0/, '') === want.replace(/^0/, '')) return true;
      // Exact before prefix: with years on the page, "199" matching "1990"
      // by prefix would pick a different year than the one asked for.
      const labels = labelFor(r);
      if (labels.some((t) => t === wanted)) return true;
      return labels.some((t) => t.startsWith(wanted) && wanted.length >= 3);
    });
    if (!hit) continue;
    hit.checked = true;
    hit.dispatchEvent(new Event('input', { bubbles: true }));
    hit.dispatchEvent(new Event('change', { bubbles: true }));
    // Some custom pickers only listen for the click on the real input.
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }
  return false;
}

/**
 * Sets one field, whatever shape the page chose for it: text box, select, or
 * a radio group behind a custom picker.
 *
 * `candidates` are the ways the value might be written -- 4, 04, April, or
 * US and United States. The page decides which it understands and the first
 * that matches wins.
 */
type FieldOutcome = 'filled' | 'absent' | 'nomatch';

function setChoiceField(
  pattern: RegExp,
  autocomplete: string,
  candidates: string[],
): FieldOutcome {
  const all = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'input, select',
  ));
  const describes = (el: Element): boolean => {
    const hay = `${el.getAttribute('name') ?? ''} ${el.id} ${
      el.getAttribute('placeholder') ?? ''
    } ${el.getAttribute('aria-label') ?? ''}`;
    return pattern.test(hay);
  };

  const match =
    all.find((el) => el.getAttribute('autocomplete') === autocomplete) ??
    all.find((el) => describes(el));

  // Not on this page at all, which is normal and worth no comment.
  if (!match) return 'absent';

  if (match instanceof HTMLInputElement && match.type === 'radio') {
    const group = all.filter(
      (el): el is HTMLInputElement =>
        el instanceof HTMLInputElement && el.type === 'radio' && el.name === match.name,
    );
    return setRadioGroup(group, candidates) ? 'filled' : 'nomatch';
  }

  if (!visible(match)) return 'absent';
  for (const candidate of candidates) if (setField(match, candidate)) return 'filled';

  // The field is there and we had a value for it, but nothing in it matched:
  // a state dropdown that does not list this persona's state, say. Silence
  // here is what made a partial fill look like a whole one.
  return 'nomatch';
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Fills name and date of birth.
 *
 * Dates are asked for in three shapes and the page picks one: a single
 * date input, three separate boxes or dropdowns, or a free-text field. Each
 * is tried in turn, and a form that wants none of it is reported as such
 * rather than silently doing nothing.
 */
function fillPersona(p: PersonaData): { filled: string[]; missing: string[] } {
  const done: string[] = [];
  const missing: string[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');

  const first = findField({
    autocomplete: ['given-name'],
    attr: /first[\s_-]*name|given[\s_-]*name|\bfname\b|forename/i,
  });
  const last = findField({
    autocomplete: ['family-name'],
    attr: /last[\s_-]*name|family[\s_-]*name|\blname\b|surname/i,
  });

  if (setField(first, p.firstName)) done.push('first name');
  if (setField(last, p.lastName)) done.push('last name');

  // Only when the page has no split fields, or a single "name" box would be
  // filled with a full name while first/last sit beside it half-filled.
  if (!first && !last) {
    const full = findField({ autocomplete: ['name'], attr: /full[\s_-]*name|^name$/i });
    if (setField(full, `${p.firstName} ${p.lastName}`)) done.push('name');
  }

  const iso = `${p.birthYear}-${pad(p.birthMonth)}-${pad(p.birthDay)}`;
  const dateInput = findField({ autocomplete: ['bday'], types: ['date'] });
  if (dateInput) {
    if (setField(dateInput, iso)) done.push('date of birth');
  } else {
    // The separator before day/month/year is required, so `birthdate][day]`
    // matches (the "date][" sits in the middle) while a lone `birthday`,
    // which means the whole date rather than the day, does not.
    const DAY = /(birth|dob|bday)\w*[\W_]+day|^(day|dd)$/i;
    const MONTH = /(birth|dob|bday)\w*[\W_]+month|^(month|mm)$/i;
    const YEAR = /(birth|dob|bday)\w*[\W_]+year|^(year|yyyy)$/i;

    const outcomes = [
      setChoiceField(DAY, 'bday-day', [String(p.birthDay), pad(p.birthDay)]),
      setChoiceField(MONTH, 'bday-month', [
        String(p.birthMonth),
        pad(p.birthMonth),
        MONTHS[p.birthMonth - 1],
      ]),
      setChoiceField(YEAR, 'bday-year', [String(p.birthYear)]),
    ];
    const parts = outcomes.filter((o) => o === 'filled').length;

    if (parts === 3) done.push('date of birth');
    else if (parts > 0) done.push(`date of birth (${parts} of 3)`);
    else if (outcomes.some((o) => o === 'nomatch')) {
      missing.push('date of birth (no matching option)');
    }
  }

  // Country selects key on the ISO code far more often than the name, but
  // some use the name, so both are offered and the first that exists wins.
  const country = setChoiceField(/\bcountry\b/i, 'country', [
    p.country,
    COUNTRY_NAMES[p.country] ?? p.country,
  ]);
  if (country === 'filled') done.push('country');
  else if (country === 'nomatch') missing.push(`country (${p.country} not offered)`);

  // State dropdowns often use opaque internal ids for their values, so the
  // visible text is the only thing worth matching on. setField tries the
  // value first and falls through to the option text, which is what lands.
  const state = setChoiceField(/\bstate\b|\bprovince\b|\bregion\b/i, 'address-level1', [
    p.state,
  ]);
  if (state === 'filled') done.push('state');
  // Naming the value is the difference between "it is broken" and "this form
  // does not list Pennsylvania, pick another in the panel".
  else if (state === 'nomatch') missing.push(`state (${p.state} not offered)`);

  if (!done.length && !missing.length) missing.push('no matching fields found');
  return { filled: done, missing };
}

/** Only what the personas actually use; the code is what selects key on anyway. */
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
};


ipcRenderer.on('autofill:persona', (_e, payload: PersonaData & { gentle?: boolean }) => {
  gentle = payload.gentle === true;
  const result = fillPersona(payload);
  gentle = false;
  // A load-time pass that found nothing is not worth reporting: every
  // ordinary page would answer "no matching fields found".
  if (!payload.gentle || result.filled.length) {
    ipcRenderer.send('autofill:result', result);
  }
});

ipcRenderer.on('autofill:fill', (_e, incoming: FillData) => {
  ipcRenderer.send('autofill:result', fillNow(incoming));
});

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
