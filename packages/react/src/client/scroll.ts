/**
 * Scroll position save/restore using sessionStorage.
 *
 * Each history entry gets a unique key based on `history.state.__capstanKey`.
 * On navigation, the current position is saved; on popstate, it is restored.
 */

const STORAGE_KEY_PREFIX = "__capstan_scroll_";

let currentKey: string | null = null;

/**
 * Generate a unique key for a new history entry.
 */
export function generateScrollKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Set the current scroll key (called after pushState/replaceState).
 */
export function setCurrentScrollKey(key: string): void {
  currentKey = key;
}

/**
 * Save the current scroll position for the active history entry.
 * Call this before navigating away.
 */
export function saveScrollPosition(): void {
  if (!currentKey || typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY_PREFIX + currentKey,
      JSON.stringify({ x: window.scrollX, y: window.scrollY }),
    );
  } catch {
    // sessionStorage may be full or disabled — silently ignore
  }
}

/**
 * Restore the scroll position for a history entry.
 * Returns true if a saved position was found and restored.
 */
export function restoreScrollPosition(key: string | null): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return false;
    const pos = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof pos.x !== "number" || typeof pos.y !== "number") return false;
    window.scrollTo(pos.x, pos.y);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll to the top of the page (default behavior after forward navigation).
 */
export function scrollToTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo(0, 0);
}
