import type { ScrollSnapshot } from "./scroll.js";

/**
 * Small helpers for normalizing and writing browser history state.
 *
 * History state is treated as an opaque bag from the caller, but Capstan
 * always adds its own bookkeeping fields in a predictable shape.
 */

export interface HistoryStateRecord extends Record<string, unknown> {
  __capstanKey?: string;
  __capstanUrl?: string;
  __capstanScroll?: ScrollSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScrollSnapshot(value: unknown): value is ScrollSnapshot {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}

function cloneHistoryState(state: HistoryStateRecord): HistoryStateRecord {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(state) as HistoryStateRecord;
    } catch {
      // Fall through to a shallow, safe copy.
    }
  }

  const copy: HistoryStateRecord = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "__capstanScroll" && isScrollSnapshot(value)) {
      copy.__capstanScroll = { x: value.x, y: value.y };
      continue;
    }
    copy[key] = value;
  }
  return copy;
}

function buildFallbackHistoryState(state: HistoryStateRecord): HistoryStateRecord {
  const fallback: HistoryStateRecord = {};
  if (typeof state.__capstanKey === "string") {
    fallback.__capstanKey = state.__capstanKey;
  }
  if (typeof state.__capstanUrl === "string") {
    fallback.__capstanUrl = state.__capstanUrl;
  }
  if (isScrollSnapshot(state.__capstanScroll)) {
    fallback.__capstanScroll = { x: state.__capstanScroll.x, y: state.__capstanScroll.y };
  }
  return fallback;
}

export function readHistoryState(value: unknown = history.state): HistoryStateRecord {
  return isRecord(value) ? { ...value } : {};
}

export function buildHistoryState(
  url: string,
  key: string,
  state: unknown,
  scroll?: ScrollSnapshot | null,
): HistoryStateRecord {
  const next = readHistoryState(state);
  next.__capstanKey = key;
  next.__capstanUrl = url;
  if (scroll) {
    next.__capstanScroll = { x: scroll.x, y: scroll.y };
  } else {
    delete next.__capstanScroll;
  }
  return next;
}

export function readHistoryEntryState(
  value: unknown = history.state,
): {
  state: HistoryStateRecord;
  key: string | null;
  url: string | null;
  scroll: ScrollSnapshot | null;
} {
  const state = readHistoryState(value);
  return {
    state,
    key: typeof state.__capstanKey === "string" ? state.__capstanKey : null,
    url: typeof state.__capstanUrl === "string" ? state.__capstanUrl : null,
    scroll: isScrollSnapshot(state.__capstanScroll)
      ? { x: state.__capstanScroll.x, y: state.__capstanScroll.y }
      : null,
  };
}

export function writeHistoryState(
  mode: "push" | "replace",
  state: HistoryStateRecord,
  url: string,
): boolean {
  const method = mode === "push" ? history.pushState : history.replaceState;
  const primary = cloneHistoryState(state);

  try {
    method.call(history, primary, "", url);
    return true;
  } catch {
    try {
      method.call(history, buildFallbackHistoryState(state), "", url);
      return true;
    } catch {
      return false;
    }
  }
}

