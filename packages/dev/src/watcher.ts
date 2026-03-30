import { watch, existsSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";

/**
 * Watch a routes directory for file changes and invoke a callback when
 * route files (.ts, .tsx) are added, modified, or removed.
 *
 * Uses `node:fs.watch` in recursive mode with a 300ms debounce to
 * coalesce rapid filesystem events (e.g. editor save + lint writes).
 *
 * Gracefully handles the case where the routes directory does not yet
 * exist -- the caller should create it and restart the watcher.
 */
export function watchRoutes(
  routesDir: string,
  onChange: (changedFile?: string) => void,
): { close: () => void } {
  // If the directory doesn't exist, return a no-op watcher.
  // The dev server will retry on next explicit scan.
  if (!existsSync(routesDir)) {
    return { close: () => {} };
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastChangedFile: string | undefined;

  const DEBOUNCE_MS = 300;

  /** Route-file extensions we care about. */
  const ROUTE_EXTENSIONS = [".ts", ".tsx"];

  function isRouteFile(filename: string | null): boolean {
    if (!filename) return false;
    return ROUTE_EXTENSIONS.some((ext) => filename.endsWith(ext));
  }

  function scheduleCallback(changedFile?: string): void {
    if (closed) return;

    lastChangedFile = changedFile;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!closed) {
        onChange(lastChangedFile);
        lastChangedFile = undefined;
      }
    }, DEBOUNCE_MS);
  }

  let watcher: FSWatcher;

  try {
    watcher = watch(routesDir, { recursive: true }, (_eventType, filename) => {
      if (isRouteFile(filename ?? null)) {
        const fullPath = filename ? path.join(routesDir, filename) : undefined;
        scheduleCallback(fullPath);
      }
    });
  } catch {
    // If watching fails (e.g. permission error), return a no-op handle.
    return { close: () => {} };
  }

  // Handle watcher errors silently -- the dev server keeps running
  // and the user can still trigger manual reloads.
  watcher.on("error", () => {
    // Intentionally swallowed. The server remains usable even if the
    // watcher encounters a transient filesystem error.
  });

  return {
    close: () => {
      closed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher.close();
    },
  };
}
