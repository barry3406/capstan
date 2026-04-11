/**
 * Compute memory age in days from a timestamp.
 */
export function memoryAgeDays(timestampMs: number): number {
  return Math.max(0, Math.floor((Date.now() - timestampMs) / 86_400_000));
}

/**
 * Human-readable age string.
 */
export function memoryAge(timestampMs: number): string {
  const d = memoryAgeDays(timestampMs);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/**
 * Staleness caveat text. Empty for memories ≤1 day old.
 * For older memories, warns the LLM to verify before asserting as fact.
 */
export function memoryFreshnessText(timestampMs: number): string {
  const d = memoryAgeDays(timestampMs);
  if (d <= 1) return "";
  return (
    `This memory is ${d} days old. `
    + "Memories are point-in-time observations, not live state — "
    + "claims about code behavior or file:line citations may be outdated. "
    + "Verify against current code before asserting as fact."
  );
}
