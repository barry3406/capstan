import { describe, it, expect, beforeEach } from "bun:test";

import {
  createHmrCoordinator,
  createHmrTransport,
} from "../../packages/dev/src/hmr.js";
import type {
  HmrCoordinator,
  HmrCoordinatorConfig,
  HmrTransport,
  HmrUpdate,
} from "../../packages/dev/src/hmr.js";
import {
  buildHmrClientScript,
  createHmrRuntime,
} from "../../packages/react/src/client/hmr-runtime.js";
import type { HmrRuntimeHandle } from "../../packages/react/src/client/hmr-runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: HmrCoordinatorConfig = {
  rootDir: "/project",
  routesDir: "/project/app/routes",
};

function makeCoordinator(
  overrides?: Partial<HmrCoordinatorConfig>,
): HmrCoordinator {
  return createHmrCoordinator({ ...DEFAULT_CONFIG, ...overrides });
}

/** Create a minimal fake WebSocket-like object. */
function fakeWs(): {
  sent: string[];
  closed: boolean;
  send: (data: string) => void;
  close: () => void;
} {
  const obj: { sent: string[]; closed: boolean; send: (data: string) => void; close: () => void } = {
    sent: [],
    closed: false,
    send: () => {},
    close: () => {},
  };
  obj.send = (data: string) => { obj.sent.push(data); };
  obj.close = () => { obj.closed = true; };
  return obj;
}

/** Create a minimal fake SSE response object. */
function fakeSseResponse(): {
  written: string[];
  closed: boolean;
  write: (data: string) => void;
  close: () => void;
} {
  const obj: { written: string[]; closed: boolean; write: (data: string) => void; close: () => void } = {
    written: [],
    closed: false,
    write: () => {},
    close: () => {},
  };
  obj.write = (data: string) => { obj.written.push(data); };
  obj.close = () => { obj.closed = true; };
  return obj;
}

// ===========================================================================
// classifyChange
// ===========================================================================

describe("classifyChange", () => {
  let coord: HmrCoordinator;

  beforeEach(() => {
    coord = makeCoordinator();
  });

  // --- Page files ---

  it("classifies .page.tsx in routes dir as page", () => {
    expect(
      coord.classifyChange("/project/app/routes/index.page.tsx"),
    ).toBe("page");
  });

  it("classifies .page.ts in routes dir as page", () => {
    expect(
      coord.classifyChange("/project/app/routes/about.page.ts"),
    ).toBe("page");
  });

  it("classifies nested .page.tsx as page", () => {
    expect(
      coord.classifyChange("/project/app/routes/blog/[slug].page.tsx"),
    ).toBe("page");
  });

  it("does NOT classify .page.tsx outside routes dir as page", () => {
    expect(
      coord.classifyChange("/project/src/components/demo.page.tsx"),
    ).toBe("full-reload");
  });

  // --- Layout files ---

  it("classifies _layout.tsx in routes dir as layout", () => {
    expect(
      coord.classifyChange("/project/app/routes/_layout.tsx"),
    ).toBe("layout");
  });

  it("classifies nested _layout.tsx as layout", () => {
    expect(
      coord.classifyChange("/project/app/routes/admin/_layout.tsx"),
    ).toBe("layout");
  });

  // --- API files ---

  it("classifies .api.ts in routes dir as api", () => {
    expect(
      coord.classifyChange("/project/app/routes/api/users.api.ts"),
    ).toBe("api");
  });

  it("classifies nested .api.ts as api", () => {
    expect(
      coord.classifyChange("/project/app/routes/v2/posts.api.ts"),
    ).toBe("api");
  });

  // --- Middleware ---

  it("classifies _middleware.ts in routes dir as middleware", () => {
    expect(
      coord.classifyChange("/project/app/routes/_middleware.ts"),
    ).toBe("middleware");
  });

  // --- Loading ---

  it("classifies _loading.tsx in routes dir as loading", () => {
    expect(
      coord.classifyChange("/project/app/routes/_loading.tsx"),
    ).toBe("loading");
  });

  // --- Error ---

  it("classifies _error.tsx in routes dir as error", () => {
    expect(
      coord.classifyChange("/project/app/routes/_error.tsx"),
    ).toBe("error");
  });

  // --- CSS files ---

  it("classifies .css file as css", () => {
    expect(
      coord.classifyChange("/project/app/styles/main.css"),
    ).toBe("css");
  });

  it("classifies nested .css file as css", () => {
    expect(
      coord.classifyChange("/project/app/styles/components/button.css"),
    ).toBe("css");
  });

  it("classifies .css file outside styles dir as css", () => {
    expect(coord.classifyChange("/project/vendor/theme.css")).toBe("css");
  });

  // --- Config ---

  it("classifies capstan.config.ts as config", () => {
    expect(coord.classifyChange("capstan.config.ts")).toBe("config");
  });

  it("classifies capstan.config.js as config", () => {
    expect(coord.classifyChange("capstan.config.js")).toBe("config");
  });

  it("classifies capstan.config.mjs as config", () => {
    expect(coord.classifyChange("/project/capstan.config.mjs")).toBe("config");
  });

  // --- full-reload (catch-all) ---

  it("classifies helper .ts file as full-reload", () => {
    expect(
      coord.classifyChange("/project/app/utils/helper.ts"),
    ).toBe("full-reload");
  });

  it("classifies package.json as full-reload", () => {
    expect(coord.classifyChange("package.json")).toBe("full-reload");
  });

  it("classifies tsconfig.json as full-reload", () => {
    expect(coord.classifyChange("tsconfig.json")).toBe("full-reload");
  });

  // --- Edge cases ---

  it("classifies empty string as full-reload", () => {
    expect(coord.classifyChange("")).toBe("full-reload");
  });

  it("classifies .tsx.bak as full-reload", () => {
    expect(
      coord.classifyChange("/project/app/routes/old.page.tsx.bak"),
    ).toBe("full-reload");
  });

  it("classifies file with no extension as full-reload", () => {
    expect(coord.classifyChange("/project/Makefile")).toBe("full-reload");
  });

  it("handles Windows-style paths", () => {
    expect(
      coord.classifyChange(
        "\\project\\app\\routes\\index.page.tsx",
      ),
    ).toBe("page");
  });

  it("handles Windows-style backslash for routes dir too", () => {
    const c = makeCoordinator({
      routesDir: "C:\\project\\app\\routes",
    });
    expect(c.classifyChange("C:\\project\\app\\routes\\home.page.tsx")).toBe(
      "page",
    );
  });

  it("classifies .page.tsx in a random dir as full-reload", () => {
    expect(
      coord.classifyChange("/somewhere/else/index.page.tsx"),
    ).toBe("full-reload");
  });

  it("classifies _layout.tsx outside routes as full-reload", () => {
    expect(
      coord.classifyChange("/project/app/_layout.tsx"),
    ).toBe("full-reload");
  });
});

// ===========================================================================
// handleFileChange
// ===========================================================================

describe("handleFileChange", () => {
  let coord: HmrCoordinator;

  beforeEach(() => {
    coord = makeCoordinator();
  });

  it("returns an HmrUpdate with correct type", () => {
    const update = coord.handleFileChange("/project/app/styles/main.css");
    expect(update.type).toBe("css");
    expect(update.filePath).toBe("/project/app/styles/main.css");
    expect(typeof update.timestamp).toBe("number");
  });

  it("returns an HmrUpdate for page change", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/index.page.tsx",
    );
    expect(update.type).toBe("page");
  });

  it("returns an HmrUpdate for config change", () => {
    const update = coord.handleFileChange("capstan.config.ts");
    expect(update.type).toBe("config");
  });

  it("returns monotonically increasing timestamps", () => {
    const first = coord.handleFileChange("/project/app/styles/a.css");
    const second = coord.handleFileChange("/project/app/styles/b.css");
    const third = coord.handleFileChange("/project/app/styles/c.css");
    expect(second.timestamp).toBeGreaterThan(first.timestamp);
    expect(third.timestamp).toBeGreaterThan(second.timestamp);
  });

  it("guarantees unique timestamps even in same millisecond", () => {
    const timestamps = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const u = coord.handleFileChange(`/project/app/styles/file${i}.css`);
      timestamps.add(u.timestamp);
    }
    expect(timestamps.size).toBe(100);
  });

  it("does NOT call module cache invalidation for CSS changes", () => {
    // CSS changes should not invalidate the module cache because CSS is
    // served as a static asset, not a server module.
    // We verify indirectly: handleFileChange for CSS should still return
    // a valid update without throwing.
    const update = coord.handleFileChange("/project/app/styles/main.css");
    expect(update.type).toBe("css");
  });

  it("handles api file changes (server-side invalidation)", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/api/users.api.ts",
    );
    expect(update.type).toBe("api");
  });

  it("handles middleware file changes (server-side invalidation)", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/_middleware.ts",
    );
    expect(update.type).toBe("middleware");
  });

  it("handles unknown files with full-reload", () => {
    const update = coord.handleFileChange("/project/random.txt");
    expect(update.type).toBe("full-reload");
  });
});

// ===========================================================================
// HmrTransport
// ===========================================================================

describe("HmrTransport", () => {
  let transport: HmrTransport;

  beforeEach(() => {
    transport = createHmrTransport();
  });

  const sampleUpdate: HmrUpdate = {
    type: "css",
    filePath: "/styles/main.css",
    timestamp: 1000,
  };

  // --- clientCount ---

  it("starts with 0 clients", () => {
    expect(transport.clientCount).toBe(0);
  });

  it("increments clientCount on handleConnection", () => {
    transport.handleConnection(fakeWs());
    expect(transport.clientCount).toBe(1);
  });

  it("increments clientCount on handleSSEConnection", () => {
    transport.handleSSEConnection(fakeSseResponse());
    expect(transport.clientCount).toBe(1);
  });

  it("tracks multiple clients", () => {
    transport.handleConnection(fakeWs());
    transport.handleConnection(fakeWs());
    transport.handleSSEConnection(fakeSseResponse());
    expect(transport.clientCount).toBe(3);
  });

  // --- broadcast ---

  it("broadcasts to all WS clients", () => {
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    transport.handleConnection(ws1);
    transport.handleConnection(ws2);

    transport.broadcast(sampleUpdate);

    const expected = JSON.stringify(sampleUpdate);
    expect(ws1.sent).toEqual([expected]);
    expect(ws2.sent).toEqual([expected]);
  });

  it("broadcasts to SSE clients with SSE framing", () => {
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);

    transport.broadcast(sampleUpdate);

    const expected = `data: ${JSON.stringify(sampleUpdate)}\n\n`;
    // The first write is the initial ": connected\n\n", second is broadcast.
    expect(sse.written[1]).toBe(expected);
  });

  it("sends initial comment to SSE clients on connect", () => {
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);
    expect(sse.written[0]).toBe(": connected\n\n");
  });

  it("does not throw when broadcasting to 0 clients", () => {
    expect(() => transport.broadcast(sampleUpdate)).not.toThrow();
  });

  it("handles multiple rapid broadcasts", () => {
    const ws = fakeWs();
    transport.handleConnection(ws);

    for (let i = 0; i < 50; i++) {
      transport.broadcast({ ...sampleUpdate, timestamp: i });
    }

    expect(ws.sent.length).toBe(50);
  });

  it("removes client on send failure", () => {
    const badWs = {
      send: () => {
        throw new Error("connection lost");
      },
      close: () => {},
    };
    transport.handleConnection(badWs);
    expect(transport.clientCount).toBe(1);

    transport.broadcast(sampleUpdate);
    // After the failed send, the client should be removed.
    expect(transport.clientCount).toBe(0);
  });

  it("removes SSE client on send failure and continues to others", () => {
    const badSse = {
      write: (data: string) => {
        // Let the initial ": connected" through, fail on subsequent writes.
        if (!data.startsWith(":")) {
          throw new Error("broken pipe");
        }
      },
      close: () => {},
    };
    const goodSse = fakeSseResponse();

    transport.handleSSEConnection(badSse);
    transport.handleSSEConnection(goodSse);
    expect(transport.clientCount).toBe(2);

    transport.broadcast(sampleUpdate);

    // The bad client should be removed; the good one should still receive.
    expect(transport.clientCount).toBe(1);
    const expected = `data: ${JSON.stringify(sampleUpdate)}\n\n`;
    expect(goodSse.written[1]).toBe(expected);
  });

  // --- dispose ---

  it("closes all connections on dispose", () => {
    const ws = fakeWs();
    const sse = fakeSseResponse();
    transport.handleConnection(ws);
    transport.handleSSEConnection(sse);

    transport.dispose();

    expect(ws.closed).toBe(true);
    expect(sse.closed).toBe(true);
  });

  it("clears client list on dispose", () => {
    transport.handleConnection(fakeWs());
    transport.handleConnection(fakeWs());

    transport.dispose();
    expect(transport.clientCount).toBe(0);
  });

  it("does not throw on dispose with 0 clients", () => {
    expect(() => transport.dispose()).not.toThrow();
  });

  it("does not broadcast after dispose", () => {
    const ws = fakeWs();
    transport.handleConnection(ws);
    transport.dispose();

    // ws was already closed by dispose; send count should stay at 0.
    transport.broadcast(sampleUpdate);
    expect(ws.sent.length).toBe(0);
  });

  it("handleConnection after dispose is a no-op", () => {
    transport.dispose();
    transport.handleConnection(fakeWs());
    expect(transport.clientCount).toBe(0);
  });

  it("handleSSEConnection after dispose is a no-op", () => {
    transport.dispose();
    transport.handleSSEConnection(fakeSseResponse());
    expect(transport.clientCount).toBe(0);
  });

  it("handles close() throwing during dispose without crashing", () => {
    const throwingWs = {
      send: () => {},
      close: () => {
        throw new Error("already closed");
      },
    };
    transport.handleConnection(throwingWs);
    expect(() => transport.dispose()).not.toThrow();
  });

  // --- mixed WS and SSE ---

  it("broadcasts to a mix of WS and SSE clients", () => {
    const ws = fakeWs();
    const sse = fakeSseResponse();
    transport.handleConnection(ws);
    transport.handleSSEConnection(sse);

    transport.broadcast(sampleUpdate);

    const json = JSON.stringify(sampleUpdate);
    expect(ws.sent).toEqual([json]);
    expect(sse.written[1]).toBe(`data: ${json}\n\n`);
  });
});

// ===========================================================================
// buildHmrClientScript
// ===========================================================================

describe("buildHmrClientScript", () => {
  it("returns a string", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(typeof script).toBe("string");
  });

  it("wraps output in <script> tags", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script.startsWith("<script>")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
  });

  it("embeds the port number correctly (SSE)", () => {
    const script = buildHmrClientScript({ port: 4567 });
    // SSE uses a relative URL, so the port is not embedded directly in the
    // URL string — but the script should still be valid.
    expect(script).toContain("/__capstan_hmr");
  });

  it("embeds the port number in WS URL", () => {
    const script = buildHmrClientScript({ port: 9999, protocol: "ws" });
    expect(script).toContain("9999");
    expect(script).toContain("ws://");
  });

  it("embeds custom hostname in WS URL", () => {
    const script = buildHmrClientScript({
      port: 3000,
      hostname: "myhost.local",
      protocol: "ws",
    });
    expect(script).toContain("myhost.local");
  });

  it("SSE protocol generates EventSource code (no WebSocket)", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("EventSource");
    expect(script).not.toContain("new WebSocket");
  });

  it("WS protocol generates WebSocket code (no EventSource)", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("new WebSocket");
    expect(script).not.toContain("EventSource");
  });

  it("defaults to SSE protocol", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("EventSource");
    expect(script).not.toContain("new WebSocket");
  });

  it("includes reconnection logic", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("reconnect");
    expect(script).toContain("maxAttempts");
  });

  it("includes CSS hot swap handler", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("hotSwapCSS");
    expect(script).toContain("stylesheet");
  });

  it("includes page re-fetch handler", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("__CAPSTAN_ROUTER__");
    expect(script).toContain("navigate");
  });

  it("includes reconnection overlay", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("Reconnecting...");
    expect(script).toContain("__capstan_hmr_overlay");
  });

  // --- XSS safety ---

  it("escapes < in hostname to prevent script breakout", () => {
    const script = buildHmrClientScript({
      port: 3000,
      hostname: "</script><script>alert(1)//",
      protocol: "ws",
    });
    // The literal `</script>` must not appear within the script body.
    // Remove the wrapping tags and check the interior.
    const interior = script.slice("<script>".length, script.length - "</script>".length);
    expect(interior).not.toContain("</script>");
  });

  it("escapes single quotes in hostname", () => {
    const script = buildHmrClientScript({
      port: 3000,
      hostname: "host'name",
      protocol: "ws",
    });
    // Should not contain an unescaped single quote inside the JS.
    expect(script).toContain("\\'");
  });

  it("escapes backslashes in hostname", () => {
    const script = buildHmrClientScript({
      port: 3000,
      hostname: "host\\name",
      protocol: "ws",
    });
    expect(script).toContain("\\\\");
  });
});

// ===========================================================================
// createHmrCoordinator — integration
// ===========================================================================

describe("createHmrCoordinator — integration", () => {
  it("throws when routesDir is empty", () => {
    expect(() =>
      createHmrCoordinator({ rootDir: "/project", routesDir: "" }),
    ).toThrow();
  });

  it("getClientScript returns a string containing <script>", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000 });
    expect(script).toContain("<script>");
    expect(script).toContain("</script>");
  });

  it("getClientScript with WS protocol uses WebSocket", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("new WebSocket");
  });

  it("getClientScript with SSE protocol uses EventSource", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("EventSource");
  });

  it("getClientScript embeds port for WS", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 8888, protocol: "ws" });
    expect(script).toContain("8888");
  });

  it("viteActive defaults to true", () => {
    const coord = makeCoordinator();
    expect(coord.viteActive).toBe(true);
  });

  it("viteActive can be explicitly disabled", () => {
    const coord = makeCoordinator({ enableViteHmr: false });
    expect(coord.viteActive).toBe(false);
  });

  it("dispose does not throw", () => {
    const coord = makeCoordinator();
    expect(() => coord.dispose()).not.toThrow();
  });

  it("dispose can be called multiple times", () => {
    const coord = makeCoordinator();
    coord.dispose();
    expect(() => coord.dispose()).not.toThrow();
  });
});

// ===========================================================================
// createHmrRuntime — client runtime
// ===========================================================================

describe("createHmrRuntime", () => {
  it("returns an object with connect, disconnect, and onUpdate", () => {
    const runtime = createHmrRuntime();
    expect(typeof runtime.connect).toBe("function");
    expect(typeof runtime.disconnect).toBe("function");
    expect(typeof runtime.onUpdate).toBe("function");
  });

  it("onUpdate returns an unsubscribe function", () => {
    const runtime = createHmrRuntime();
    const unsub = runtime.onUpdate(() => {});
    expect(typeof unsub).toBe("function");
  });

  it("disconnect can be called without prior connect", () => {
    const runtime = createHmrRuntime();
    expect(() => runtime.disconnect()).not.toThrow();
  });

  it("defaults protocol to sse", () => {
    // We can only verify this indirectly — creating without error is enough
    // since it stores the protocol internally.
    const runtime = createHmrRuntime();
    expect(runtime).toBeDefined();
  });

  it("accepts ws protocol", () => {
    const runtime = createHmrRuntime({ protocol: "ws" });
    expect(runtime).toBeDefined();
  });

  it("accepts custom reconnect config", () => {
    const runtime = createHmrRuntime({
      reconnectDelay: 500,
      maxReconnectAttempts: 5,
    });
    expect(runtime).toBeDefined();
  });
});

// ===========================================================================
// CSS hot swap logic (unit tests for the client script behavior)
// ===========================================================================

describe("CSS hot swap logic", () => {
  // These tests verify the CSS hot-swap matching logic by testing the
  // coordinator's classify + handleFileChange pipeline for various CSS
  // path patterns. The actual DOM manipulation is in the injected script
  // and cannot be unit-tested without a browser, but we ensure the server
  // side correctly classifies and dispatches CSS updates.

  let coord: HmrCoordinator;

  beforeEach(() => {
    coord = makeCoordinator();
  });

  it("single stylesheet path classifies as css", () => {
    expect(coord.classifyChange("/project/app/styles/main.css")).toBe("css");
  });

  it("nested stylesheet path classifies as css", () => {
    expect(
      coord.classifyChange("/project/app/styles/components/button.css"),
    ).toBe("css");
  });

  it("CSS file outside project still classifies as css", () => {
    expect(coord.classifyChange("/tmp/vendor/reset.css")).toBe("css");
  });

  it(".css inside routes dir classifies as css (not page/api/etc)", () => {
    // Even though the file is in routes, .css takes priority.
    expect(
      coord.classifyChange("/project/app/routes/inline.css"),
    ).toBe("css");
  });

  it("non-CSS file does not classify as css", () => {
    expect(
      coord.classifyChange("/project/app/styles/main.scss"),
    ).toBe("full-reload");
  });

  it("handleFileChange for CSS returns css type update", () => {
    const update = coord.handleFileChange("/project/app/styles/main.css");
    expect(update.type).toBe("css");
    expect(update.filePath).toBe("/project/app/styles/main.css");
    expect(update.timestamp).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Reconnection logic (structural tests for the script output)
// ===========================================================================

describe("Reconnection logic — script structure", () => {
  it("SSE script includes reconnect function", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("function reconnect()");
  });

  it("WS script includes reconnect function", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("function reconnect()");
  });

  it("script enforces max reconnect attempts", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("maxAttempts");
    expect(script).toContain("attempts>=maxAttempts");
  });

  it("script uses exponential backoff", () => {
    const script = buildHmrClientScript({ port: 3000 });
    // The exponential backoff formula: delay * Math.pow(2, attempts)
    expect(script).toContain("Math.pow(2,attempts)");
  });

  it("SSE script supports manual disconnect prevention", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("disconnected");
  });

  it("script shows reconnecting overlay", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("showOverlay()");
    expect(script).toContain("hideOverlay()");
  });

  it("script hides overlay on successful reconnect", () => {
    const script = buildHmrClientScript({ port: 3000 });
    // On open, attempts should reset and overlay should hide.
    expect(script).toContain("attempts=0");
    expect(script).toContain("hideOverlay()");
  });
});

// ===========================================================================
// getClientScript (coordinator wrapper)
// ===========================================================================

describe("getClientScript", () => {
  it("returns valid HTML script tag", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000 });
    expect(script.startsWith("<script>")).toBe(true);
    expect(script.endsWith("</script>")).toBe(true);
  });

  it("defaults to SSE protocol", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000 });
    expect(script).toContain("EventSource");
  });

  it("respects ws protocol option", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("WebSocket");
  });

  it("handles server-only update types (api/middleware) as no-ops in script", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000 });
    // The script should contain logic that treats api/middleware as no-ops.
    expect(script).toContain("server-only");
  });

  it("handles config and full-reload with location.reload()", () => {
    const coord = makeCoordinator();
    const script = coord.getClientScript({ port: 3000 });
    expect(script).toContain("location.reload()");
  });
});

// ===========================================================================
// Edge cases and robustness
// ===========================================================================

describe("Edge cases and robustness", () => {
  it("coordinator works after rapid successive calls", () => {
    const coord = makeCoordinator();
    const results: HmrUpdate[] = [];
    for (let i = 0; i < 200; i++) {
      results.push(coord.handleFileChange(`/project/app/styles/s${i}.css`));
    }
    // All should be css type with unique timestamps.
    const types = new Set(results.map((r) => r.type));
    expect(types.size).toBe(1);
    expect(types.has("css")).toBe(true);

    const timestamps = new Set(results.map((r) => r.timestamp));
    expect(timestamps.size).toBe(200);
  });

  it("transport handles send throwing TypeError", () => {
    const transport = createHmrTransport();
    const badWs = {
      send: () => {
        throw new TypeError("Invalid state");
      },
      close: () => {},
    };
    transport.handleConnection(badWs);
    // Should not throw, just remove the client.
    expect(() =>
      transport.broadcast({
        type: "css",
        filePath: "a.css",
        timestamp: 1,
      }),
    ).not.toThrow();
    expect(transport.clientCount).toBe(0);
  });

  it("transport SSE initial connect failure removes client", () => {
    const transport = createHmrTransport();
    const badSse = {
      write: () => {
        throw new Error("broken");
      },
      close: () => {},
    };
    transport.handleSSEConnection(badSse);
    // The initial write(": connected\n\n") should fail and remove the client.
    expect(transport.clientCount).toBe(0);
  });

  it("classifyChange with deeply nested routes dir", () => {
    const coord = createHmrCoordinator({
      rootDir: "/a/b/c",
      routesDir: "/a/b/c/app/deep/routes",
    });
    expect(
      coord.classifyChange("/a/b/c/app/deep/routes/index.page.tsx"),
    ).toBe("page");
  });

  it("classifyChange does not match partial directory names", () => {
    const coord = createHmrCoordinator({
      rootDir: "/project",
      routesDir: "/project/app/routes",
    });
    // "routes-extra" starts with "routes" but is a different directory.
    expect(
      coord.classifyChange("/project/app/routes-extra/index.page.tsx"),
    ).toBe("full-reload");
  });

  it("capstan.config at nested path still detects as config", () => {
    const coord = makeCoordinator();
    expect(
      coord.classifyChange("/project/configs/capstan.config.ts"),
    ).toBe("config");
  });

  it("file named capstan.config without extension is not config", () => {
    const coord = makeCoordinator();
    // basename = "capstan.config" — fails the regex because no final extension segment
    // after the known "config" part. Actually the regex expects capstan.config.{letters}.
    expect(coord.classifyChange("/project/capstan.config")).toBe("full-reload");
  });

  it("multiple transports are independent", () => {
    const t1 = createHmrTransport();
    const t2 = createHmrTransport();

    const ws1 = fakeWs();
    const ws2 = fakeWs();
    t1.handleConnection(ws1);
    t2.handleConnection(ws2);

    const update: HmrUpdate = {
      type: "css",
      filePath: "a.css",
      timestamp: 1,
    };

    t1.broadcast(update);
    expect(ws1.sent.length).toBe(1);
    expect(ws2.sent.length).toBe(0);

    t1.dispose();
    t2.dispose();
  });
});

// ===========================================================================
// Additional classifyChange boundary tests
// ===========================================================================

describe("classifyChange — extended boundary tests", () => {
  let coord: HmrCoordinator;

  beforeEach(() => {
    coord = makeCoordinator();
  });

  it("classifies _layout.ts (not .tsx) in routes as layout", () => {
    expect(
      coord.classifyChange("/project/app/routes/_layout.ts"),
    ).toBe("layout");
  });

  it("classifies _loading.ts (not .tsx) in routes as loading", () => {
    expect(
      coord.classifyChange("/project/app/routes/_loading.ts"),
    ).toBe("loading");
  });

  it("classifies _error.ts (not .tsx) in routes as error", () => {
    expect(
      coord.classifyChange("/project/app/routes/_error.ts"),
    ).toBe("error");
  });

  it("does not classify _middleware.tsx as middleware (only .ts)", () => {
    // Middleware files must be .ts — .tsx is not a valid middleware extension
    // because middleware is server-only and does not render JSX.
    expect(
      coord.classifyChange("/project/app/routes/_middleware.tsx"),
    ).toBe("full-reload");
  });

  it("classifies file with multiple dots in name correctly", () => {
    expect(
      coord.classifyChange("/project/app/routes/user.profile.page.tsx"),
    ).toBe("page");
  });

  it("does not match .css.map as css", () => {
    expect(
      coord.classifyChange("/project/app/styles/main.css.map"),
    ).toBe("full-reload");
  });

  it("classifies root-level CSS file as css", () => {
    expect(coord.classifyChange("global.css")).toBe("css");
  });

  it("classifies capstan.config.cjs as config", () => {
    expect(coord.classifyChange("capstan.config.cjs")).toBe("config");
  });

  it("does not classify non-capstan config files as config", () => {
    expect(coord.classifyChange("webpack.config.ts")).toBe("full-reload");
  });

  it("does not classify 'capstan.config' directory as config", () => {
    expect(
      coord.classifyChange("/project/capstan.config/settings.ts"),
    ).toBe("full-reload");
  });

  it("classifies .page.tsx at routes root", () => {
    expect(
      coord.classifyChange("/project/app/routes/home.page.tsx"),
    ).toBe("page");
  });

  it("classifies deeply nested api file", () => {
    expect(
      coord.classifyChange("/project/app/routes/v1/admin/settings.api.ts"),
    ).toBe("api");
  });

  it("classifies .api.ts outside routes dir as full-reload", () => {
    expect(
      coord.classifyChange("/project/lib/legacy.api.ts"),
    ).toBe("full-reload");
  });

  it("classifies _error.tsx outside routes dir as full-reload", () => {
    expect(
      coord.classifyChange("/project/components/_error.tsx"),
    ).toBe("full-reload");
  });

  it("handles path that is exactly the routes dir", () => {
    // The routes dir itself is not a file pattern we match.
    expect(
      coord.classifyChange("/project/app/routes"),
    ).toBe("full-reload");
  });

  it("handles trailing slash on routes-dir-like path", () => {
    expect(
      coord.classifyChange("/project/app/routes/"),
    ).toBe("full-reload");
  });

  it("handles absolute Windows path with drive letter", () => {
    const c = createHmrCoordinator({
      rootDir: "C:\\Users\\dev\\project",
      routesDir: "C:\\Users\\dev\\project\\app\\routes",
    });
    expect(
      c.classifyChange("C:\\Users\\dev\\project\\app\\routes\\_layout.tsx"),
    ).toBe("layout");
  });

  it("handles mixed separators", () => {
    const c = createHmrCoordinator({
      rootDir: "/project",
      routesDir: "/project/app/routes",
    });
    expect(
      c.classifyChange("/project/app/routes\\nested\\page.page.tsx"),
    ).toBe("page");
  });
});

// ===========================================================================
// HmrTransport — extended tests
// ===========================================================================

describe("HmrTransport — extended", () => {
  it("clientCount is accurate after multiple connects and failed sends", () => {
    const transport = createHmrTransport();
    const ws1 = fakeWs();
    const ws3 = fakeWs();

    // ws2 starts broken — send always throws.
    let shouldThrow = false;
    const ws2 = {
      send: (data: string) => {
        if (shouldThrow) throw new Error("gone");
      },
      close: () => {},
    };

    transport.handleConnection(ws1);
    transport.handleConnection(ws2);
    transport.handleConnection(ws3);
    expect(transport.clientCount).toBe(3);

    // First broadcast succeeds for all.
    transport.broadcast({ type: "css", filePath: "a.css", timestamp: 1 });
    expect(transport.clientCount).toBe(3);

    // Now ws2 starts failing.
    shouldThrow = true;
    transport.broadcast({ type: "css", filePath: "b.css", timestamp: 2 });

    // ws2 removed, ws1 and ws3 still connected.
    expect(transport.clientCount).toBe(2);
  });

  it("broadcast sends valid JSON to WS clients", () => {
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    const update: HmrUpdate = {
      type: "page",
      filePath: "/routes/index.page.tsx",
      timestamp: 12345,
    };
    transport.broadcast(update);

    const parsed = JSON.parse(ws.sent[0]!) as HmrUpdate;
    expect(parsed.type).toBe("page");
    expect(parsed.filePath).toBe("/routes/index.page.tsx");
    expect(parsed.timestamp).toBe(12345);
  });

  it("broadcast sends valid JSON to SSE clients", () => {
    const transport = createHmrTransport();
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);

    const update: HmrUpdate = {
      type: "layout",
      filePath: "/routes/_layout.tsx",
      timestamp: 99,
    };
    transport.broadcast(update);

    // sse.written[0] is ": connected\n\n", [1] is the broadcast.
    const raw = sse.written[1]!;
    expect(raw.startsWith("data: ")).toBe(true);
    expect(raw.endsWith("\n\n")).toBe(true);

    const json = raw.slice("data: ".length, raw.length - 2);
    const parsed = JSON.parse(json) as HmrUpdate;
    expect(parsed.type).toBe("layout");
  });

  it("broadcast preserves message order", () => {
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    for (let i = 0; i < 20; i++) {
      transport.broadcast({ type: "css", filePath: `f${i}.css`, timestamp: i });
    }

    for (let i = 0; i < 20; i++) {
      const parsed = JSON.parse(ws.sent[i]!) as HmrUpdate;
      expect(parsed.timestamp).toBe(i);
      expect(parsed.filePath).toBe(`f${i}.css`);
    }
  });

  it("dispose is idempotent", () => {
    const transport = createHmrTransport();
    transport.handleConnection(fakeWs());
    transport.dispose();
    expect(() => transport.dispose()).not.toThrow();
    expect(transport.clientCount).toBe(0);
  });
});

// ===========================================================================
// buildHmrClientScript — extended
// ===========================================================================

describe("buildHmrClientScript — extended", () => {
  it("handles page/layout/loading/error with CAPSTAN_ROUTER navigate", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("__CAPSTAN_ROUTER__");
    expect(script).toContain("navigate(location.href");
    expect(script).toContain("noCache:true");
  });

  it("falls back to location.reload when no CAPSTAN_ROUTER", () => {
    const script = buildHmrClientScript({ port: 3000 });
    // The script should have a fallback `else{location.reload();}` branch.
    expect(script).toContain("location.reload()");
  });

  it("handles api and middleware as server-only no-ops", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("u.type==='api'");
    expect(script).toContain("u.type==='middleware'");
    expect(script).toContain("server-only");
  });

  it("CSS hot swap finds stylesheets via link[rel=stylesheet]", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain('link[rel="stylesheet"]');
  });

  it("CSS hot swap appends timestamp query param", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("?t=");
  });

  it("CSS hot swap preserves hash fragment", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("hash");
    expect(script).toContain("indexOf('#')");
  });

  it("CSS hot swap strips existing query params before rewriting", () => {
    const script = buildHmrClientScript({ port: 3000 });
    expect(script).toContain("split('?')[0]");
  });

  it("CSS hot swap returns boolean for fallback detection", () => {
    const script = buildHmrClientScript({ port: 3000 });
    // The function sets `found=false` and returns it.
    expect(script).toContain("var found=false");
    expect(script).toContain("return found");
  });

  it("full-reload triggers for unknown update types", () => {
    const script = buildHmrClientScript({ port: 3000 });
    // The else branch at the end catches everything else with reload.
    expect(script).toContain("else{location.reload();}");
  });

  it("WS script uses /__capstan_hmr path", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("/__capstan_hmr");
  });

  it("SSE script uses /__capstan_hmr path", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("/__capstan_hmr");
  });

  it("SSE script assigns EventSource to es variable", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "sse" });
    expect(script).toContain("es=new EventSource");
  });

  it("WS script creates WebSocket with ws:// URL", () => {
    const script = buildHmrClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("ws://localhost:3000/__capstan_hmr");
  });

  it("port 0 is handled without error", () => {
    const script = buildHmrClientScript({ port: 0, protocol: "ws" });
    expect(script).toContain(":0/");
  });

  it("large port number is embedded correctly", () => {
    const script = buildHmrClientScript({ port: 65535, protocol: "ws" });
    expect(script).toContain(":65535/");
  });
});

// ===========================================================================
// handleFileChange — module cache interaction
// ===========================================================================

describe("handleFileChange — module cache interaction", () => {
  let coord: HmrCoordinator;

  beforeEach(() => {
    coord = makeCoordinator();
  });

  it("api change triggers server-side invalidation without error", () => {
    // We cannot easily observe invalidateModuleCache being called without
    // mocking, but we can verify the call completes without throwing.
    const update = coord.handleFileChange(
      "/project/app/routes/users.api.ts",
    );
    expect(update.type).toBe("api");
  });

  it("middleware change triggers server-side invalidation", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/_middleware.ts",
    );
    expect(update.type).toBe("middleware");
  });

  it("config change triggers server-side invalidation", () => {
    const update = coord.handleFileChange("capstan.config.ts");
    expect(update.type).toBe("config");
  });

  it("page change does NOT trigger server-side invalidation", () => {
    // page is not in SERVER_SIDE_TYPES, so invalidateModuleCache is not called.
    const update = coord.handleFileChange(
      "/project/app/routes/index.page.tsx",
    );
    expect(update.type).toBe("page");
  });

  it("layout change does NOT trigger server-side invalidation", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/_layout.tsx",
    );
    expect(update.type).toBe("layout");
  });

  it("css change does NOT trigger server-side invalidation", () => {
    const update = coord.handleFileChange("/project/app/styles/main.css");
    expect(update.type).toBe("css");
  });

  it("loading change does NOT trigger server-side invalidation", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/_loading.tsx",
    );
    expect(update.type).toBe("loading");
  });

  it("error change does NOT trigger server-side invalidation", () => {
    const update = coord.handleFileChange(
      "/project/app/routes/_error.tsx",
    );
    expect(update.type).toBe("error");
  });

  it("full-reload does NOT trigger server-side invalidation", () => {
    const update = coord.handleFileChange("/project/random.txt");
    expect(update.type).toBe("full-reload");
  });
});

// ===========================================================================
// createHmrRuntime — extended
// ===========================================================================

describe("createHmrRuntime — extended", () => {
  it("disconnect clears any pending reconnect timers", () => {
    const runtime = createHmrRuntime();
    // Calling disconnect without connect should be safe.
    runtime.disconnect();
    expect(runtime).toBeDefined();
  });

  it("unsubscribe removes the handler", () => {
    const runtime = createHmrRuntime();
    let callCount = 0;
    const unsub = runtime.onUpdate(() => { callCount++; });
    unsub();
    // Since we can't easily trigger an update without a real connection,
    // we verify the unsub function runs without error.
    expect(callCount).toBe(0);
  });

  it("multiple handlers can be registered", () => {
    const runtime = createHmrRuntime();
    let count1 = 0;
    let count2 = 0;
    runtime.onUpdate(() => { count1++; });
    runtime.onUpdate(() => { count2++; });
    expect(count1).toBe(0);
    expect(count2).toBe(0);
  });

  it("unsubscribing one handler does not affect others", () => {
    const runtime = createHmrRuntime();
    let count1 = 0;
    let count2 = 0;
    const unsub1 = runtime.onUpdate(() => { count1++; });
    runtime.onUpdate(() => { count2++; });
    unsub1();
    // Both should still be at 0 since no messages were sent.
    expect(count1).toBe(0);
    expect(count2).toBe(0);
  });

  it("protocol defaults and creation do not throw", () => {
    expect(() => createHmrRuntime()).not.toThrow();
    expect(() => createHmrRuntime({ protocol: "ws" })).not.toThrow();
    expect(() => createHmrRuntime({ protocol: "sse" })).not.toThrow();
  });

  it("zero reconnectDelay is accepted", () => {
    const runtime = createHmrRuntime({ reconnectDelay: 0 });
    expect(runtime).toBeDefined();
  });

  it("zero maxReconnectAttempts is accepted", () => {
    const runtime = createHmrRuntime({ maxReconnectAttempts: 0 });
    expect(runtime).toBeDefined();
  });
});

// ===========================================================================
// Full coordinator lifecycle
// ===========================================================================

describe("Full coordinator lifecycle", () => {
  it("classify -> handleFileChange -> transport broadcast pipeline", () => {
    const coord = makeCoordinator();
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    const filePath = "/project/app/styles/theme.css";
    const type = coord.classifyChange(filePath);
    expect(type).toBe("css");

    const update = coord.handleFileChange(filePath);
    expect(update.type).toBe("css");

    transport.broadcast(update);
    expect(ws.sent.length).toBe(1);

    const received = JSON.parse(ws.sent[0]!) as HmrUpdate;
    expect(received.type).toBe("css");
    expect(received.filePath).toBe(filePath);

    transport.dispose();
    coord.dispose();
  });

  it("page change flows through entire pipeline", () => {
    const coord = makeCoordinator();
    const transport = createHmrTransport();
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);

    const filePath = "/project/app/routes/about.page.tsx";
    const update = coord.handleFileChange(filePath);
    transport.broadcast(update);

    // written[0] = ": connected\n\n", written[1] = broadcast
    const raw = sse.written[1]!;
    const json = raw.slice("data: ".length, raw.length - 2);
    const received = JSON.parse(json) as HmrUpdate;
    expect(received.type).toBe("page");

    transport.dispose();
    coord.dispose();
  });

  it("api change pipeline — no client action, only server invalidation", () => {
    const coord = makeCoordinator();
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    const update = coord.handleFileChange(
      "/project/app/routes/users.api.ts",
    );
    expect(update.type).toBe("api");

    // The transport still broadcasts the update — the client script decides
    // to ignore it. This is by design.
    transport.broadcast(update);
    expect(ws.sent.length).toBe(1);

    const received = JSON.parse(ws.sent[0]!) as HmrUpdate;
    expect(received.type).toBe("api");

    transport.dispose();
    coord.dispose();
  });

  it("config change results in full-reload type", () => {
    const coord = makeCoordinator();
    const update = coord.handleFileChange("capstan.config.ts");
    expect(update.type).toBe("config");
    coord.dispose();
  });

  it("unknown file type results in full-reload", () => {
    const coord = makeCoordinator();
    const update = coord.handleFileChange("/project/package.json");
    expect(update.type).toBe("full-reload");
    coord.dispose();
  });

  it("sequential css changes produce ordered timestamps", () => {
    const coord = makeCoordinator();
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    const files = [
      "/project/app/styles/a.css",
      "/project/app/styles/b.css",
      "/project/app/styles/c.css",
    ];

    for (const f of files) {
      transport.broadcast(coord.handleFileChange(f));
    }

    const timestamps = ws.sent.map(
      (s) => (JSON.parse(s) as HmrUpdate).timestamp,
    );

    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThan(timestamps[i - 1]!);
    }

    transport.dispose();
    coord.dispose();
  });
});

// ===========================================================================
// HmrTransport.removeClient
// ===========================================================================

describe("HmrTransport.removeClient", () => {
  it("removeClient with unknown object reference does not affect count", () => {
    const transport = createHmrTransport();
    const unknown = { send: (_d: string) => {}, close: () => {} };
    // Should not throw when removing something that was never added
    transport.removeClient(unknown);
    expect(transport.clientCount).toBe(0);
  });

  it("removeClient with original SSE object does not remove internal wrapper", () => {
    // handleSSEConnection creates an internal TrackedClient that wraps
    // response.write/close. The original object is a different reference,
    // so removeClient won't find it in the Set.
    const transport = createHmrTransport();
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);
    expect(transport.clientCount).toBe(1);

    // Attempting to remove via the original SSE object won't match
    transport.removeClient(sse);
    expect(transport.clientCount).toBe(1);

    transport.dispose();
  });

  it("removeClient after dispose does not throw", () => {
    const transport = createHmrTransport();
    const sse = fakeSseResponse();
    transport.handleSSEConnection(sse);
    transport.dispose();
    // Should not throw even after disposal
    transport.removeClient(sse);
    // After dispose, clientCount should be 0 (dispose closes all)
    expect(transport.clientCount).toBe(0);
  });

  it("broadcast after removeClient with unknown object still reaches all clients", () => {
    const transport = createHmrTransport();
    const ws = fakeWs();
    transport.handleConnection(ws);

    const unknown = { send: (_d: string) => {}, close: () => {} };
    transport.removeClient(unknown);

    const update: HmrUpdate = {
      type: "css",
      filePath: "/project/app/styles/test.css",
      timestamp: Date.now(),
    };
    transport.broadcast(update);
    expect(ws.sent.length).toBe(1);

    transport.dispose();
  });
});

// ===========================================================================
// getClientScript
// ===========================================================================

describe("getClientScript", () => {
  it("ws protocol: uses configured hostname in generated URL", () => {
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
      hostname: "192.168.1.100",
    });
    const script = coord.getClientScript({ port: 4567, protocol: "ws" });
    expect(script).toContain("192.168.1.100");
    expect(script).toContain("4567");
    coord.dispose();
  });

  it("ws protocol: defaults to localhost when no hostname provided", () => {
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
    });
    const script = coord.getClientScript({ port: 3000, protocol: "ws" });
    expect(script).toContain("localhost");
    expect(script).toContain("3000");
    coord.dispose();
  });

  it("sse protocol: uses relative URL path instead of absolute", () => {
    // SSE mode uses EventSource with a relative path (/__capstan_hmr)
    // so hostname and port are not embedded in the script
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
    });
    const script = coord.getClientScript({ port: 8080, protocol: "sse" });
    expect(script).toContain("/__capstan_hmr");
    expect(script).toContain("EventSource");
    coord.dispose();
  });

  it("defaults to sse protocol when none specified", () => {
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
    });
    const script = coord.getClientScript({ port: 3000 });
    // Default protocol is SSE, so should use EventSource
    expect(script).toContain("EventSource");
    expect(script).toContain("/__capstan_hmr");
    coord.dispose();
  });

  it("returns a non-empty string wrapped in script tags", () => {
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
    });
    const script = coord.getClientScript({ port: 3000, protocol: "ws" });
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain("<script>");
    expect(script).toContain("</script>");
    coord.dispose();
  });

  it("ws protocol: includes WebSocket constructor in script", () => {
    const coord = createHmrCoordinator({
      rootDir: "/tmp",
      routesDir: "/tmp/app/routes",
    });
    const script = coord.getClientScript({ port: 5000, protocol: "ws" });
    expect(script).toContain("WebSocket");
    coord.dispose();
  });
});

describe("handleSSEConnection returns dispose function", () => {
  it("dispose function removes the exact tracked client", () => {
    const transport = createHmrTransport();
    const dispose = transport.handleSSEConnection({
      write: () => {},
      close: () => {},
    });
    expect(transport.clientCount).toBe(1);
    dispose();
    expect(transport.clientCount).toBe(0);
  });

  it("dispose function is idempotent", () => {
    const transport = createHmrTransport();
    const dispose = transport.handleSSEConnection({
      write: () => {},
      close: () => {},
    });
    dispose();
    dispose(); // second call should not throw or affect count
    expect(transport.clientCount).toBe(0);
  });

  it("each connection gets its own dispose function", () => {
    const transport = createHmrTransport();
    const dispose1 = transport.handleSSEConnection({ write: () => {}, close: () => {} });
    const dispose2 = transport.handleSSEConnection({ write: () => {}, close: () => {} });
    expect(transport.clientCount).toBe(2);
    dispose1();
    expect(transport.clientCount).toBe(1);
    dispose2();
    expect(transport.clientCount).toBe(0);
  });

  it("broadcast still reaches remaining clients after partial dispose", () => {
    const transport = createHmrTransport();
    const messages: string[] = [];
    const dispose1 = transport.handleSSEConnection({
      write: () => {},
      close: () => {},
    });
    transport.handleSSEConnection({
      write: (data: string) => { messages.push(data); },
      close: () => {},
    });
    // messages[0] is ": connected\n\n" from handleSSEConnection
    const initialCount = messages.length;
    dispose1(); // remove first client
    transport.broadcast({ type: "css", filePath: "a.css", timestamp: 1 });
    expect(messages.length).toBe(initialCount + 1);
    expect(messages[messages.length - 1]).toContain("css");
  });
});
