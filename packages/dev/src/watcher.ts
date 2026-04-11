import { watch, existsSync, readdirSync, statSync } from "node:fs";
import type { Dirent, FSWatcher } from "node:fs";
import path from "node:path";

type WatchHandle = { close: () => void };

interface DirectoryWatchOptions {
  debounceMs: number;
  scanIntervalMs?: number;
  matches: (filename: string | null) => boolean;
}

function collectMatchingFileSnapshot(
  rootDir: string,
  matches: (filename: string | null) => boolean,
): Map<string, string> {
  const snapshot = new Map<string, string>();
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !matches(entry.name)) {
        continue;
      }

      try {
        const stats = statSync(fullPath);
        snapshot.set(
          path.relative(rootDir, fullPath),
          `${stats.mtimeMs}:${stats.size}`,
        );
      } catch {
        // Ignore files that disappear between directory listing and stat.
      }
    }
  }

  return snapshot;
}

function findFirstSnapshotDifference(
  previous: Map<string, string>,
  next: Map<string, string>,
): string | undefined {
  for (const [file, signature] of next) {
    if (previous.get(file) !== signature) {
      return file;
    }
  }

  for (const file of previous.keys()) {
    if (!next.has(file)) {
      return file;
    }
  }

  return undefined;
}

function watchDirectory(
  rootDir: string,
  onChange: (changedFile?: string) => void,
  options: DirectoryWatchOptions,
): WatchHandle {
  if (!existsSync(rootDir)) {
    return { close: () => {} };
  }

  const scanIntervalMs = options.scanIntervalMs ?? Math.max(options.debounceMs, 100);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let lastChangedFile: string | undefined;
  let snapshot = collectMatchingFileSnapshot(rootDir, options.matches);
  let watcher: FSWatcher | null = null;

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
    }, options.debounceMs);
  }

  function scanForChanges(): void {
    if (closed) return;

    const nextSnapshot = collectMatchingFileSnapshot(rootDir, options.matches);
    const changedRelativePath = findFirstSnapshotDifference(snapshot, nextSnapshot);
    snapshot = nextSnapshot;

    if (changedRelativePath) {
      scheduleCallback(path.join(rootDir, changedRelativePath));
    }
  }

  try {
    watcher = watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (!options.matches(filename ?? null)) {
        return;
      }

      const fullPath = filename ? path.join(rootDir, filename) : undefined;
      scheduleCallback(fullPath);
    });

    watcher.on("error", () => {
      // Intentionally swallowed. The polling snapshot fallback keeps the
      // watcher usable even if the underlying fs.watch stream glitches.
    });
  } catch {
    watcher = null;
  }

  scanTimer = setInterval(scanForChanges, scanIntervalMs);
  scanTimer.unref?.();

  return {
    close: () => {
      closed = true;

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (scanTimer !== null) {
        clearInterval(scanTimer);
        scanTimer = null;
      }

      watcher?.close();
      watcher = null;
    },
  };
}

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
): WatchHandle {
  const routeExtensions = [".ts", ".tsx"];
  return watchDirectory(routesDir, onChange, {
    debounceMs: 300,
    matches: (filename) =>
      typeof filename === "string" &&
      routeExtensions.some((ext) => filename.endsWith(ext)),
  });
}

/**
 * Watch a styles directory for CSS file changes and invoke a callback.
 *
 * Uses `node:fs.watch` in recursive mode with a 100ms debounce (shorter
 * than route watching because CSS rebuilds are fast and users expect
 * near-instant feedback on style changes).
 *
 * If the directory does not exist, returns a no-op watcher.
 */
export function watchStyles(
  stylesDir: string,
  onChange: (changedFile?: string) => void,
): WatchHandle {
  return watchDirectory(stylesDir, onChange, {
    debounceMs: 100,
    matches: (filename) => typeof filename === "string" && filename.endsWith(".css"),
  });
}
