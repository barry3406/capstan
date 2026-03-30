import { describe, it, expect, beforeEach } from "bun:test";
import {
  CircuitBreaker,
  CircuitOpenError,
} from "@zauso-ai/capstan-core";
import type { CircuitState } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function succeedingFn<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

function failingFn(message = "boom"): () => Promise<never> {
  return () => Promise.reject(new Error(message));
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

describe("CircuitBreaker — initial state", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    expect(cb.getState()).toBe("closed" satisfies CircuitState);
  });

  it("allows execution when closed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    const result = await cb.execute(succeedingFn(42));
    expect(result).toBe(42);
  });

  it("returns the value from the wrapped function", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    const result = await cb.execute(succeedingFn({ ok: true }));
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Closed -> Open Transition
// ---------------------------------------------------------------------------

describe("CircuitBreaker — closed to open transition", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
  });

  it("stays closed when failures are below threshold", async () => {
    // 2 failures, threshold is 3
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(failingFn()); } catch { /* expected */ }
    }
    expect(cb.getState()).toBe("closed");
  });

  it("opens after reaching the failure threshold", async () => {
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn()); } catch { /* expected */ }
    }
    expect(cb.getState()).toBe("open");
  });

  it("re-throws the original error on failure", async () => {
    try {
      await cb.execute(failingFn("specific error"));
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("specific error");
    }
  });

  it("resets failure count on a success in closed state", async () => {
    // 2 failures
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }

    // 1 success resets the counter
    await cb.execute(succeedingFn("ok"));
    expect(cb.getState()).toBe("closed");

    // 2 more failures should NOT open (counter was reset)
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Open State — Rejects Calls
// ---------------------------------------------------------------------------

describe("CircuitBreaker — open state rejects calls", () => {
  it("throws CircuitOpenError when circuit is open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

    // Open the circuit
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");

    // Subsequent calls are rejected immediately
    try {
      await cb.execute(succeedingFn("should not run"));
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).message).toBe("Circuit breaker is open");
      expect((err as CircuitOpenError).name).toBe("CircuitOpenError");
    }
  });

  it("does not invoke the function when open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

    try { await cb.execute(failingFn()); } catch { /* expected */ }

    let called = false;
    try {
      await cb.execute(async () => {
        called = true;
        return "value";
      });
    } catch { /* expected CircuitOpenError */ }

    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Open -> Half-Open Transition (Timing)
// ---------------------------------------------------------------------------

describe("CircuitBreaker — half-open transition", () => {
  it("transitions to half-open after resetTimeout expires", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

    // Open the circuit
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");

    // Wait for resetTimeout
    await new Promise((r) => setTimeout(r, 60));

    // Next execute should transition to half-open and run the function
    const result = await cb.execute(succeedingFn("recovered"));
    expect(result).toBe("recovered");
  });

  it("stays open if resetTimeout has not elapsed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");

    // Immediately try — timeout hasn't elapsed
    try {
      await cb.execute(succeedingFn("no"));
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
    }
    expect(cb.getState()).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Half-Open Recovery
// ---------------------------------------------------------------------------

describe("CircuitBreaker — half-open recovery", () => {
  it("closes after enough successes in half-open (default threshold = 1)", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

    // Open the circuit
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    await new Promise((r) => setTimeout(r, 60));

    // One success should close it (default successThreshold = 1)
    await cb.execute(succeedingFn("ok"));
    expect(cb.getState()).toBe("closed");
  });

  it("closes after meeting custom successThreshold", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeout: 50,
      successThreshold: 3,
    });

    // Open the circuit
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    await new Promise((r) => setTimeout(r, 60));

    // First success — still half-open
    await cb.execute(succeedingFn("ok1"));
    expect(cb.getState()).toBe("half-open");

    // Second success — still half-open
    await cb.execute(succeedingFn("ok2"));
    expect(cb.getState()).toBe("half-open");

    // Third success — closes the circuit
    await cb.execute(succeedingFn("ok3"));
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens on failure during half-open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

    // Open the circuit
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    await new Promise((r) => setTimeout(r, 60));

    // Fail during half-open — should re-open
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");

    // And it should reject again immediately
    try {
      await cb.execute(succeedingFn("no"));
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
    }
  });
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe("CircuitBreaker — reset", () => {
  it("reset() returns circuit to closed state from open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 60000 });

    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");

    // Should be able to execute again
    const result = await cb.execute(succeedingFn("after reset"));
    expect(result).toBe("after reset");
  });

  it("reset() clears failure count so threshold restarts", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 60000 });

    // Accumulate 2 failures
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }

    cb.reset();

    // 2 more failures should NOT open (counter was reset)
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("closed");

    // Third failure after reset opens it
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Multiple Failures & Edge Cases
// ---------------------------------------------------------------------------

describe("CircuitBreaker — edge cases", () => {
  it("threshold of 1 opens on first failure", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");
  });

  it("high threshold requires many failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 10, resetTimeout: 5000 });

    for (let i = 0; i < 9; i++) {
      try { await cb.execute(failingFn()); } catch { /* expected */ }
    }
    expect(cb.getState()).toBe("closed");

    try { await cb.execute(failingFn()); } catch { /* expected */ }
    expect(cb.getState()).toBe("open");
  });

  it("interleaved successes and failures keep circuit closed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });

    // fail, fail, succeed, fail, fail, succeed — never reaches 3 consecutive
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    await cb.execute(succeedingFn("ok"));
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    try { await cb.execute(failingFn()); } catch { /* expected */ }
    await cb.execute(succeedingFn("ok"));

    expect(cb.getState()).toBe("closed");
  });

  it("multiple breakers are independent", async () => {
    const cb1 = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });
    const cb2 = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

    try { await cb1.execute(failingFn()); } catch { /* expected */ }
    expect(cb1.getState()).toBe("open");
    expect(cb2.getState()).toBe("closed");

    const result = await cb2.execute(succeedingFn("still works"));
    expect(result).toBe("still works");
  });

  it("CircuitOpenError has correct name property", () => {
    const err = new CircuitOpenError("test");
    expect(err.name).toBe("CircuitOpenError");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });
});
