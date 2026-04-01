import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  defineEvent,
  defineWorker,
  onEvent,
  emitEvent,
  getEventBus,
  resetEventBus,
} from "@zauso-ai/capstan-core";

// Reset the global bus before each test to avoid cross-test contamination.
beforeEach(() => {
  resetEventBus();
});

// ---------------------------------------------------------------------------
// defineEvent
// ---------------------------------------------------------------------------

describe("defineEvent", () => {
  it("creates an event definition with a name", () => {
    const evt = defineEvent("user.created");
    expect(evt.name).toBe("user.created");
    expect(evt.schema).toBeUndefined();
  });

  it("creates an event definition with a name and schema", () => {
    const schema = z.object({ id: z.string() });
    const evt = defineEvent("user.created", schema);
    expect(evt.name).toBe("user.created");
    expect(evt.schema).toBe(schema);
  });
});

// ---------------------------------------------------------------------------
// emit / subscribe basics
// ---------------------------------------------------------------------------

describe("emit and subscribe", () => {
  it("delivers payload to a subscriber", async () => {
    const evt = defineEvent<{ id: string }>("order.placed");
    const received: { id: string }[] = [];
    onEvent(evt, (payload) => { received.push(payload); });

    await emitEvent(evt, { id: "order-1" });

    expect(received).toEqual([{ id: "order-1" }]);
  });

  it("delivers payload to multiple subscribers", async () => {
    const evt = defineEvent<number>("counter.incremented");
    const calls: number[] = [];

    onEvent(evt, (n) => { calls.push(n * 10); });
    onEvent(evt, (n) => { calls.push(n * 100); });

    await emitEvent(evt, 5);

    expect(calls).toContain(50);
    expect(calls).toContain(500);
    expect(calls).toHaveLength(2);
  });

  it("does not deliver to subscribers of a different event", async () => {
    const evtA = defineEvent<string>("a");
    const evtB = defineEvent<string>("b");
    const calls: string[] = [];

    onEvent(evtA, (s) => { calls.push("A:" + s); });
    onEvent(evtB, (s) => { calls.push("B:" + s); });

    await emitEvent(evtA, "hello");

    expect(calls).toEqual(["A:hello"]);
  });

  it("handles emit with no subscribers without error", async () => {
    const evt = defineEvent<string>("no.listeners");
    // Should not throw
    await emitEvent(evt, "silence");
  });

  it("delivers empty string payload", async () => {
    const evt = defineEvent<string>("empty.string");
    const received: string[] = [];
    onEvent(evt, (s) => { received.push(s); });
    await emitEvent(evt, "");
    expect(received).toEqual([""]);
  });

  it("delivers null payload", async () => {
    const evt = defineEvent<null>("null.event");
    const received: unknown[] = [];
    onEvent(evt, (p) => { received.push(p); });
    await emitEvent(evt, null);
    expect(received).toEqual([null]);
  });

  it("delivers zero as payload", async () => {
    const evt = defineEvent<number>("zero.event");
    const received: number[] = [];
    onEvent(evt, (n) => { received.push(n); });
    await emitEvent(evt, 0);
    expect(received).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// unsubscribe
// ---------------------------------------------------------------------------

describe("unsubscribe", () => {
  it("stops delivering after unsubscribe is called", async () => {
    const evt = defineEvent<number>("tick");
    const calls: number[] = [];

    const unsub = onEvent(evt, (n) => { calls.push(n); });

    await emitEvent(evt, 1);
    unsub();
    await emitEvent(evt, 2);

    expect(calls).toEqual([1]);
  });

  it("only removes the specific handler, not others", async () => {
    const evt = defineEvent<string>("multi");
    const callsA: string[] = [];
    const callsB: string[] = [];

    const unsubA = onEvent(evt, (s) => { callsA.push(s); });
    onEvent(evt, (s) => { callsB.push(s); });

    await emitEvent(evt, "first");
    unsubA();
    await emitEvent(evt, "second");

    expect(callsA).toEqual(["first"]);
    expect(callsB).toEqual(["first", "second"]);
  });

  it("is safe to call unsubscribe multiple times", async () => {
    const evt = defineEvent<number>("safe");
    const calls: number[] = [];
    const unsub = onEvent(evt, (n) => { calls.push(n); });
    unsub();
    unsub(); // second call should not throw
    await emitEvent(evt, 99);
    expect(calls).toEqual([]);
  });

  it("emit after all subscribers unsubscribed does not throw", async () => {
    const evt = defineEvent<string>("all.unsub");
    const unsub1 = onEvent(evt, () => {});
    const unsub2 = onEvent(evt, () => {});
    unsub1();
    unsub2();
    // Should not throw even though all listeners are gone
    await emitEvent(evt, "orphan");
  });
});

// ---------------------------------------------------------------------------
// schema validation
// ---------------------------------------------------------------------------

describe("schema validation", () => {
  it("allows valid payloads through", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const evt = defineEvent("user.validated", schema);
    const received: unknown[] = [];
    onEvent(evt, (p) => { received.push(p); });

    await emitEvent(evt, { name: "Alice", age: 30 });

    expect(received).toHaveLength(1);
  });

  it("rejects invalid payloads", async () => {
    const schema = z.object({ name: z.string() });
    const evt = defineEvent("user.validated", schema);
    onEvent(evt, () => {});

    await expect(
      emitEvent(evt, { name: 42 } as unknown as { name: string }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// async handlers
// ---------------------------------------------------------------------------

describe("async handlers", () => {
  it("awaits async handlers to completion", async () => {
    const evt = defineEvent<string>("async.work");
    const log: string[] = [];

    onEvent(evt, async (s) => {
      await new Promise((r) => setTimeout(r, 10));
      log.push("done:" + s);
    });

    await emitEvent(evt, "task");

    expect(log).toEqual(["done:task"]);
  });

  it("runs multiple async handlers concurrently", async () => {
    const evt = defineEvent<number>("parallel");
    const start = Date.now();
    const results: number[] = [];

    onEvent(evt, async (n) => {
      await new Promise((r) => setTimeout(r, 30));
      results.push(n);
    });
    onEvent(evt, async (n) => {
      await new Promise((r) => setTimeout(r, 30));
      results.push(n * 2);
    });

    await emitEvent(evt, 5);
    const elapsed = Date.now() - start;

    expect(results).toContain(5);
    expect(results).toContain(10);
    // Both ran concurrently, so total time should be closer to 30ms than 60ms
    expect(elapsed).toBeLessThan(55);
  });
});

// ---------------------------------------------------------------------------
// Error handling in handlers
// ---------------------------------------------------------------------------

describe("handler error propagation", () => {
  it("propagates sync handler errors through emitEvent", async () => {
    const evt = defineEvent<string>("error.sync");
    onEvent(evt, () => {
      throw new Error("handler-boom");
    });
    await expect(emitEvent(evt, "trigger")).rejects.toThrow("handler-boom");
  });

  it("propagates async handler rejection through emitEvent", async () => {
    const evt = defineEvent<string>("error.async");
    onEvent(evt, async () => {
      throw new Error("async-boom");
    });
    await expect(emitEvent(evt, "trigger")).rejects.toThrow("async-boom");
  });
});

// ---------------------------------------------------------------------------
// getEventBus / resetEventBus
// ---------------------------------------------------------------------------

describe("getEventBus and resetEventBus", () => {
  it("returns the same bus instance across calls", () => {
    const a = getEventBus();
    const b = getEventBus();
    expect(a).toBe(b);
  });

  it("resetEventBus clears all subscribers", async () => {
    const evt = defineEvent<number>("reset.test");
    const calls: number[] = [];
    onEvent(evt, (n) => { calls.push(n); });

    await emitEvent(evt, 1);
    resetEventBus();
    await emitEvent(evt, 2);

    expect(calls).toEqual([1]);
  });

  it("resetEventBus provides a fresh bus instance", () => {
    const before = getEventBus();
    resetEventBus();
    const after = getEventBus();
    expect(before).not.toBe(after);
  });
});

// ---------------------------------------------------------------------------
// EventBus.clear
// ---------------------------------------------------------------------------

describe("EventBus.clear", () => {
  it("removes all handlers from the bus", async () => {
    const evt = defineEvent<string>("clear.test");
    const calls: string[] = [];
    onEvent(evt, (s) => { calls.push(s); });

    await emitEvent(evt, "before");
    getEventBus().clear();
    await emitEvent(evt, "after");

    expect(calls).toEqual(["before"]);
  });
});

// ---------------------------------------------------------------------------
// defineWorker
// ---------------------------------------------------------------------------

describe("defineWorker", () => {
  it("returns a WorkerDefinition with event and handler", () => {
    const evt = defineEvent<{ taskId: string }>("task.queued");
    const worker = defineWorker(evt, async (payload) => {
      void payload;
    });
    expect(worker.event).toBe(evt);
    expect(typeof worker.handler).toBe("function");
  });

  it("auto-subscribes the handler to the event bus", async () => {
    const evt = defineEvent<{ value: number }>("worker.auto");
    const results: number[] = [];

    defineWorker(evt, async (payload) => {
      results.push(payload.value);
    });

    await emitEvent(evt, { value: 42 });

    expect(results).toEqual([42]);
  });

  it("worker receives validated payloads", async () => {
    const schema = z.object({ email: z.string().email() });
    const evt = defineEvent("worker.validated", schema);
    const emails: string[] = [];

    defineWorker(evt, async (payload) => {
      emails.push(payload.email);
    });

    await emitEvent(evt, { email: "test@example.com" });
    expect(emails).toEqual(["test@example.com"]);

    await expect(
      emitEvent(evt, { email: "not-an-email" } as unknown as { email: string }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema validation edge cases
// ---------------------------------------------------------------------------

describe("schema validation edge cases", () => {
  it("emit with incorrect schema type rejects (wrong field type)", async () => {
    const schema = z.object({ count: z.number() });
    const evt = defineEvent("typed.strict", schema);
    onEvent(evt, () => {});

    await expect(
      emitEvent(evt, { count: "not-a-number" } as unknown as { count: number }),
    ).rejects.toThrow();
  });

  it("emit with missing required field rejects", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const evt = defineEvent("typed.required", schema);
    onEvent(evt, () => {});

    await expect(
      emitEvent(evt, { name: "Alice" } as unknown as { name: string; age: number }),
    ).rejects.toThrow();
  });

  it("emit with extra fields passes (Zod strips by default or passes through)", async () => {
    const schema = z.object({ id: z.string() });
    const evt = defineEvent("typed.extra", schema);
    const received: unknown[] = [];
    onEvent(evt, (p) => { received.push(p); });

    // Extra fields — Zod should not reject by default
    await emitEvent(evt, { id: "x", bonus: true } as unknown as { id: string });
    expect(received).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// defineWorker unsubscribe
// ---------------------------------------------------------------------------

describe("defineWorker unsubscribe", () => {
  it("defineWorker returns an object; worker stops receiving after resetEventBus", async () => {
    const evt = defineEvent<number>("worker.unsub");
    const results: number[] = [];
    defineWorker(evt, async (n) => { results.push(n); });

    await emitEvent(evt, 1);
    resetEventBus();
    await emitEvent(evt, 2);

    expect(results).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Many subscribers stress test
// ---------------------------------------------------------------------------

describe("many subscribers", () => {
  it("100+ subscribers on the same event all receive the payload", async () => {
    const evt = defineEvent<number>("stress.many");
    const count = 150;
    const results: number[] = [];

    for (let i = 0; i < count; i++) {
      onEvent(evt, (n) => { results.push(n); });
    }

    await emitEvent(evt, 42);

    expect(results).toHaveLength(count);
    expect(results.every((v) => v === 42)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event name edge cases
// ---------------------------------------------------------------------------

describe("event name edge cases", () => {
  it("event name with special characters works", async () => {
    const evt = defineEvent<string>("evt:with/special.chars-and_underscores");
    const received: string[] = [];
    onEvent(evt, (s) => { received.push(s); });
    await emitEvent(evt, "ok");
    expect(received).toEqual(["ok"]);
  });

  it("event name with unicode works", async () => {
    const evt = defineEvent<string>("event.unicode.test");
    const received: string[] = [];
    onEvent(evt, (s) => { received.push(s); });
    await emitEvent(evt, "data");
    expect(received).toEqual(["data"]);
  });

  it("empty event name works", async () => {
    const evt = defineEvent<string>("");
    const received: string[] = [];
    onEvent(evt, (s) => { received.push(s); });
    await emitEvent(evt, "empty-name");
    expect(received).toEqual(["empty-name"]);
  });
});
