import { app } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomInt } from 'crypto';
import type { Persona } from '../shared/types';

/**
 * One invented person per inbox.
 *
 * Per-inbox rather than a shared pool, for the same reason cookies, history
 * and saved logins are: an inbox IS the identity here. A pool would mean
 * choosing who to be on every form, and choosing wrong once is what links two
 * accounts together.
 *
 * Names and dates only. This exists to get past a signup form consistently,
 * not to fabricate a documented person, and the fields it holds are the ones
 * such forms actually ask for.
 */
const file = (): string => join(app.getPath('userData'), 'personas.json');

let cache: Record<string, Persona> | null = null;

function load(): Record<string, Persona> {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, Persona>;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  writeFileSync(file(), JSON.stringify(cache ?? {}, null, 2));
}

// Deliberately ordinary and widely spread. A memorable name is a linkable
// one, and the point of these is to be forgettable.
const FIRST = [
  'James', 'Sarah', 'Michael', 'Emma', 'David', 'Laura', 'Daniel', 'Rachel',
  'Thomas', 'Hannah', 'Andrew', 'Claire', 'Peter', 'Alice', 'Simon', 'Ruth',
  'Mark', 'Helen', 'Paul', 'Nicola', 'Stephen', 'Julia', 'Adam', 'Rebecca',
  'Robert', 'Fiona', 'Chris', 'Megan', 'Alan', 'Sophie',
];

const LAST = [
  'Walker', 'Bennett', 'Hughes', 'Foster', 'Gibson', 'Harper', 'Ellis',
  'Fletcher', 'Palmer', 'Moore', 'Barnes', 'Doyle', 'Reid', 'Shaw', 'Carter',
  'Newman', 'Grant', 'Chapman', 'Lawson', 'Marsh', 'Wallace', 'Sutton',
  'Nolan', 'Pearce', 'Ward', 'Nash', 'Quinn', 'Barrett', 'Hale', 'Frost',
];

// Kept as full names rather than codes: state dropdowns frequently use
// opaque internal ids for their values (3434 = Alabama), so the visible text
// is the only thing reliably matchable.
const STATES = [
  'Alabama', 'Arizona', 'California', 'Colorado', 'Connecticut', 'Florida',
  'Georgia', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Missouri', 'Nevada',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'Tennessee',
  'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'Wisconsin',
];

const pick = <T>(list: T[]): T => list[randomInt(list.length)];

/**
 * A birthday for an adult between 24 and 58.
 *
 * Day capped at 28 so the date exists in any month, which matters because a
 * form that validates the date will reject the 31st of February and there is
 * nothing gained by risking it.
 */
function birthday(): { day: number; month: number; year: number } {
  const thisYear = new Date().getFullYear();
  return {
    day: randomInt(1, 29),
    month: randomInt(1, 13),
    year: thisYear - randomInt(24, 59),
  };
}

function generatePersona(profile: string): Persona {
  const { day, month, year } = birthday();
  return {
    profile,
    firstName: pick(FIRST),
    lastName: pick(LAST),
    birthDay: day,
    birthMonth: month,
    birthYear: year,
    country: 'US',
    state: pick(STATES),
    updatedAt: new Date().toISOString(),
  };
}

export const personas = {
  /** Every persona, for a panel that wants to show them all. */
  all(): Persona[] {
    return Object.values(load());
  },

  get(profile: string): Persona | null {
    return load()[profile] ?? null;
  },

  /**
   * The inbox's persona, inventing one the first time it is asked for.
   *
   * Generating on read rather than making the user press a button first: the
   * panel is more useful showing a person you can overwrite than an empty
   * form, and an unused persona costs nothing.
   */
  ensure(profile: string): Persona {
    const existing = load()[profile];
    // Personas saved before country and state existed are filled in rather
    // than regenerated, so an inbox keeps the person it has been using.
    if (existing && (!existing.country || !existing.state)) {
      const patched = { ...existing, country: existing.country || 'US', state: existing.state || pick(STATES) };
      load()[profile] = patched;
      persist();
      return patched;
    }
    if (existing) return existing;
    const fresh = generatePersona(profile);
    load()[profile] = fresh;
    persist();
    return fresh;
  },

  /** A different person for this inbox, discarding the old one. */
  regenerate(profile: string): Persona {
    const fresh = generatePersona(profile);
    load()[profile] = fresh;
    persist();
    return fresh;
  },

  save(persona: Persona): Persona {
    const updated = { ...persona, updatedAt: new Date().toISOString() };
    load()[persona.profile] = updated;
    persist();
    return updated;
  },

  /** Drops personas for inboxes that are gone. Empty list is ignored. */
  prune(known: string[]): void {
    if (!known.length) return;
    const alive = new Set(known);
    const all = load();
    let changed = false;
    for (const address of Object.keys(all)) {
      if (!alive.has(address)) {
        delete all[address];
        changed = true;
      }
    }
    if (changed) persist();
  },

  remove(profile: string): void {
    delete load()[profile];
    persist();
  },
};
