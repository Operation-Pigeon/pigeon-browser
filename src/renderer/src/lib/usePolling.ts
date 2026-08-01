import { useEffect, useRef, useState } from 'react';

/**
 * True while the app window has OS focus.
 *
 * Deliberately not `document.hasFocus()`: the chrome is one view among
 * several, and clicking into a tab hands DOM focus to that WebContentsView.
 * The chrome sees a blur while the user is plainly still using the browser.
 * Main owns the only honest answer.
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    void window.bridge.tabs.isFocused().then(setFocused);
    return window.bridge.tabs.onFocus(setFocused);
  }, []);
  return focused;
}

/**
 * Runs `fn` every `ms` while the window is focused, and once immediately on
 * regaining focus so the first render after alt-tabbing back is current
 * rather than however stale the app got while hidden.
 *
 * An unfocused window isn't reading anything, and every tick is a billed
 * DynamoDB query per inbox — background polling spends money to refresh
 * pixels nobody is looking at.
 */
export function usePolling(fn: () => void, ms: number, enabled = true): void {
  const focused = useWindowFocus();
  // Kept in a ref so a caller's inline callback doesn't restart the timer on
  // every render — the interval should track focus, not identity.
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    if (!enabled || !focused) return;
    saved.current();
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [enabled, focused, ms]);
}
