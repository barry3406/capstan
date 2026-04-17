/**
 * View Transition API wrapper.
 *
 * Wraps a DOM-mutating callback in `document.startViewTransition()` when
 * the API is available, falling back to a direct call otherwise.  This
 * gives browsers that support it smooth cross-fade animations between
 * pages for free, while remaining a no-op on older browsers.
 */

function supportsViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof (document as unknown as Record<string, unknown>)["startViewTransition"] === "function"
  );
}

/**
 * Execute `fn` inside a View Transition if the browser supports it.
 * Returns a promise that resolves when the transition is complete
 * (or immediately if not supported).
 */
export async function withViewTransition(fn: () => void | Promise<void>): Promise<void> {
  if (!supportsViewTransition()) {
    await fn();
    return;
  }

  // Use dynamic access to avoid extending Document (whose ViewTransition
  // type includes properties not yet available in all runtimes).
  const startVT = (document as unknown as Record<string, unknown>)["startViewTransition"] as
    (cb: () => void | Promise<void>) => { finished: Promise<void> };
  const transition = startVT.call(document, fn);
  await transition.finished;
}
