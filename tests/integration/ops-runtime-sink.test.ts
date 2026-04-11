import { describe, expect, it, spyOn } from "bun:test";

import { createCapstanApp, defineAPI } from "@zauso-ai/capstan-core";

describe("ops runtime sink isolation", () => {
  it("keeps the request path healthy when one ops sink throws and another one succeeds", async () => {
    const flakyEvents: Array<{ kind: string; phase: string; requestId?: string }> = [];
    const healthyEvents: Array<{ kind: string; phase: string; requestId?: string }> = [];
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const capstan = await createCapstanApp({
        app: { name: "ops-sink-test" },
        ops: {
          appName: "ops-sink-test",
          source: "integration-test",
          sinks: [
            {
              async recordEvent(event) {
                flakyEvents.push({
                  kind: event.kind,
                  phase: event.phase,
                  requestId: event.requestId,
                });
                throw new Error("sink exploded");
              },
            },
            {
              async recordEvent(event) {
                healthyEvents.push({
                  kind: event.kind,
                  phase: event.phase,
                  requestId: event.requestId,
                });
              },
            },
          ],
        },
      });

      capstan.registerAPI(
        "GET",
        "/ops-sink/ping",
        defineAPI({
          description: "Ping route",
          capability: "read",
          resource: "ops.ping",
          async handler() {
            return { ok: true };
          },
        }),
      );

      const response = await capstan.app.fetch(
        new Request("http://localhost/ops-sink/ping", {
          headers: {
            "X-Request-Id": "sink-request",
            "X-Trace-Id": "sink-trace",
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(flakyEvents.length).toBeGreaterThanOrEqual(2);
      expect(healthyEvents.length).toBeGreaterThanOrEqual(2);
      expect(healthyEvents.map((event) => `${event.kind}.${event.phase}`)).toContain("request.start");
      expect(healthyEvents.map((event) => `${event.kind}.${event.phase}`)).toContain("request.end");
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
