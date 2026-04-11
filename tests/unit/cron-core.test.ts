
// --- cronToMs enhanced parser tests ---

import { cronToMs } from "../../packages/cron/src/cron.js";

describe("cronToMs — enhanced parser", () => {
  // Shorthand aliases
  it("@yearly → 365 days", () => expect(cronToMs("@yearly")).toBe(365 * 24 * 60 * 60 * 1000));
  it("@annually → 365 days", () => expect(cronToMs("@annually")).toBe(365 * 24 * 60 * 60 * 1000));
  it("@monthly → 30 days", () => expect(cronToMs("@monthly")).toBe(30 * 24 * 60 * 60 * 1000));
  it("@weekly → 7 days", () => expect(cronToMs("@weekly")).toBe(7 * 24 * 60 * 60 * 1000));
  it("@daily → 24 hours", () => expect(cronToMs("@daily")).toBe(24 * 60 * 60 * 1000));
  it("@midnight → 24 hours", () => expect(cronToMs("@midnight")).toBe(24 * 60 * 60 * 1000));
  it("@hourly → 60 minutes", () => expect(cronToMs("@hourly")).toBe(60 * 60 * 1000));

  // @every syntax
  it("@every 30s → 30 seconds", () => expect(cronToMs("@every 30 s")).toBe(30_000));
  it("@every 5m → 5 minutes", () => expect(cronToMs("@every 5 m")).toBe(5 * 60 * 1000));
  it("@every 2h → 2 hours", () => expect(cronToMs("@every 2 h")).toBe(2 * 60 * 60 * 1000));

  // Step patterns
  it("*/5 * * * * → every 5 minutes", () => expect(cronToMs("*/5 * * * *")).toBe(5 * 60 * 1000));
  it("*/15 * * * * → every 15 minutes", () => expect(cronToMs("*/15 * * * *")).toBe(15 * 60 * 1000));
  it("0 */2 * * * → every 2 hours", () => expect(cronToMs("0 */2 * * *")).toBe(2 * 60 * 60 * 1000));
  it("0 */6 * * * → every 6 hours", () => expect(cronToMs("0 */6 * * *")).toBe(6 * 60 * 60 * 1000));
  it("0 0 */3 * * → every 3 days", () => expect(cronToMs("0 0 */3 * *")).toBe(3 * 24 * 60 * 60 * 1000));

  // Fixed-time patterns
  it("* * * * * → every minute", () => expect(cronToMs("* * * * *")).toBe(60 * 1000));
  it("30 * * * * → hourly (at :30)", () => expect(cronToMs("30 * * * *")).toBe(60 * 60 * 1000));
  it("0 9 * * * → daily (at 09:00)", () => expect(cronToMs("0 9 * * *")).toBe(24 * 60 * 60 * 1000));
  it("0 9 * * 1-5 → daily (weekday filter approximated)", () => expect(cronToMs("0 9 * * 1-5")).toBe(24 * 60 * 60 * 1000));
  it("0 0 1 * * → monthly", () => expect(cronToMs("0 0 1 * *")).toBe(30 * 24 * 60 * 60 * 1000));
  it("0 0 1 1 * → yearly", () => expect(cronToMs("0 0 1 1 *")).toBe(365 * 24 * 60 * 60 * 1000));

  // Error cases
  it("throws on invalid pattern (too few fields)", () => {
    expect(() => cronToMs("* * *")).toThrow("expected 5 fields");
  });
  it("throws on unknown shorthand", () => {
    expect(() => cronToMs("@never")).toThrow("Unknown cron shorthand");
  });

  // Edge cases
  it("handles extra whitespace", () => expect(cronToMs("  */10   *   *   *   *  ")).toBe(10 * 60 * 1000));
  it("6+ fields still work (ignores extra)", () => expect(cronToMs("* * * * * extra")).toBe(60 * 1000));
});
