import { describe, it, expect } from "bun:test";
import {
  defineWebSocket,
  WebSocketRoom,
} from "../../packages/core/src/websocket.js";
import type {
  WebSocketClient,
  WebSocketHandler,
  WebSocketRoute,
} from "../../packages/core/src/websocket.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock WebSocketClient for testing. */
function mockClient(
  overrides?: Partial<WebSocketClient>,
): WebSocketClient & { sent: (string | ArrayBuffer)[]; closed: boolean } {
  const sent: (string | ArrayBuffer)[] = [];
  return {
    sent,
    closed: false,
    readyState: 1, // OPEN
    send(data: string | ArrayBuffer) {
      sent.push(data);
    },
    close() {
      (this as { closed: boolean }).closed = true;
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defineWebSocket
// ---------------------------------------------------------------------------

describe("defineWebSocket", () => {
  it("returns a WebSocketRoute with path and handler", () => {
    const handler: WebSocketHandler = {
      onOpen: () => {},
    };
    const route = defineWebSocket("/ws", handler);
    expect(route.path).toBe("/ws");
    expect(route.handler).toBe(handler);
  });

  it("handler interface accepts all callbacks", () => {
    const handler: WebSocketHandler = {
      onOpen: () => {},
      onMessage: () => {},
      onClose: () => {},
      onError: () => {},
    };
    const route = defineWebSocket("/ws/full", handler);
    expect(route.handler.onOpen).toBeDefined();
    expect(route.handler.onMessage).toBeDefined();
    expect(route.handler.onClose).toBeDefined();
    expect(route.handler.onError).toBeDefined();
  });

  it("handler with only onMessage is valid", () => {
    const route = defineWebSocket("/ws/msg", {
      onMessage: (_ws, _msg) => {},
    });
    expect(route.handler.onOpen).toBeUndefined();
    expect(route.handler.onMessage).toBeDefined();
    expect(route.handler.onClose).toBeUndefined();
    expect(route.handler.onError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WebSocketRoom
// ---------------------------------------------------------------------------

describe("WebSocketRoom", () => {
  it("join increases size", () => {
    const room = new WebSocketRoom();
    expect(room.size).toBe(0);
    room.join(mockClient());
    expect(room.size).toBe(1);
    room.join(mockClient());
    expect(room.size).toBe(2);
  });

  it("leave decreases size", () => {
    const room = new WebSocketRoom();
    const c = mockClient();
    room.join(c);
    expect(room.size).toBe(1);
    room.leave(c);
    expect(room.size).toBe(0);
  });

  it("leave with non-member is a no-op", () => {
    const room = new WebSocketRoom();
    room.join(mockClient());
    room.leave(mockClient()); // different client
    expect(room.size).toBe(1);
  });

  it("broadcast sends to all clients", () => {
    const room = new WebSocketRoom();
    const c1 = mockClient();
    const c2 = mockClient();
    room.join(c1);
    room.join(c2);

    room.broadcast("hello");

    expect(c1.sent).toEqual(["hello"]);
    expect(c2.sent).toEqual(["hello"]);
  });

  it("broadcast excludes specified client", () => {
    const room = new WebSocketRoom();
    const sender = mockClient();
    const receiver = mockClient();
    room.join(sender);
    room.join(receiver);

    room.broadcast("msg", sender);

    expect(sender.sent).toEqual([]);
    expect(receiver.sent).toEqual(["msg"]);
  });

  it("broadcast skips clients with readyState !== 1", () => {
    const room = new WebSocketRoom();
    const open = mockClient();
    const closed = mockClient({ readyState: 3 }); // CLOSED
    room.join(open);
    room.join(closed);

    room.broadcast("test");

    expect(open.sent).toEqual(["test"]);
    expect(closed.sent).toEqual([]);
  });

  it("empty room broadcast does nothing", () => {
    const room = new WebSocketRoom();
    // Should not throw
    room.broadcast("noop");
    expect(room.size).toBe(0);
  });

  it("close disconnects all clients and empties the room", () => {
    const room = new WebSocketRoom();
    const c1 = mockClient();
    const c2 = mockClient();
    room.join(c1);
    room.join(c2);

    room.close();

    expect(c1.closed).toBe(true);
    expect(c2.closed).toBe(true);
    expect(room.size).toBe(0);
  });

  it("multiple rooms are independent", () => {
    const roomA = new WebSocketRoom();
    const roomB = new WebSocketRoom();
    const clientA = mockClient();
    const clientB = mockClient();

    roomA.join(clientA);
    roomB.join(clientB);

    roomA.broadcast("a-msg");
    roomB.broadcast("b-msg");

    expect(clientA.sent).toEqual(["a-msg"]);
    expect(clientB.sent).toEqual(["b-msg"]);
    expect(roomA.size).toBe(1);
    expect(roomB.size).toBe(1);
  });

  it("joining same client twice does not duplicate", () => {
    const room = new WebSocketRoom();
    const c = mockClient();
    room.join(c);
    room.join(c);
    expect(room.size).toBe(1);

    room.broadcast("once");
    expect(c.sent).toEqual(["once"]);
  });

  it("client can be in multiple rooms simultaneously", () => {
    const roomA = new WebSocketRoom();
    const roomB = new WebSocketRoom();
    const shared = mockClient();

    roomA.join(shared);
    roomB.join(shared);

    roomA.broadcast("from-a");
    roomB.broadcast("from-b");

    expect(shared.sent).toEqual(["from-a", "from-b"]);
  });

  it("broadcast with multiple closed clients skips all of them", () => {
    const room = new WebSocketRoom();
    const c1 = mockClient({ readyState: 3 });
    const c2 = mockClient({ readyState: 0 }); // CONNECTING
    const c3 = mockClient({ readyState: 2 }); // CLOSING
    const open = mockClient();
    room.join(c1);
    room.join(c2);
    room.join(c3);
    room.join(open);

    room.broadcast("test");

    expect(c1.sent).toEqual([]);
    expect(c2.sent).toEqual([]);
    expect(c3.sent).toEqual([]);
    expect(open.sent).toEqual(["test"]);
  });

  it("leave a client not in room is a no-op (no error)", () => {
    const room = new WebSocketRoom();
    const outsider = mockClient();
    // Should not throw
    room.leave(outsider);
    expect(room.size).toBe(0);
  });

  it("broadcast with ArrayBuffer data", () => {
    const room = new WebSocketRoom();
    const c = mockClient();
    room.join(c);

    const buf = new ArrayBuffer(4);
    room.broadcast(buf);

    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toBe(buf);
  });

  it("close on already-empty room does not throw", () => {
    const room = new WebSocketRoom();
    room.close();
    expect(room.size).toBe(0);
  });

  it("join after close works (room is reusable)", () => {
    const room = new WebSocketRoom();
    const c1 = mockClient();
    room.join(c1);
    room.close();
    expect(room.size).toBe(0);

    const c2 = mockClient();
    room.join(c2);
    expect(room.size).toBe(1);
    room.broadcast("after-close");
    expect(c2.sent).toEqual(["after-close"]);
  });
});

// ---------------------------------------------------------------------------
// defineWebSocket additional edge cases
// ---------------------------------------------------------------------------

describe("defineWebSocket edge cases", () => {
  it("handler with no callbacks (empty object) is valid", () => {
    const route = defineWebSocket("/ws/empty", {});
    expect(route.path).toBe("/ws/empty");
    expect(route.handler.onOpen).toBeUndefined();
    expect(route.handler.onMessage).toBeUndefined();
    expect(route.handler.onClose).toBeUndefined();
    expect(route.handler.onError).toBeUndefined();
  });

  it("handler with all callbacks defined", () => {
    const calls: string[] = [];
    const handler: WebSocketHandler = {
      onOpen: () => { calls.push("open"); },
      onMessage: () => { calls.push("message"); },
      onClose: () => { calls.push("close"); },
      onError: () => { calls.push("error"); },
    };
    const route = defineWebSocket("/ws/all", handler);

    // Invoke each callback to verify they work
    route.handler.onOpen!(mockClient());
    route.handler.onMessage!(mockClient(), "data");
    route.handler.onClose!(mockClient());
    route.handler.onError!(mockClient(), new Error("test"));

    expect(calls).toEqual(["open", "message", "close", "error"]);
  });

  it("path with trailing slash is preserved", () => {
    const route = defineWebSocket("/ws/trailing/", { onOpen: () => {} });
    expect(route.path).toBe("/ws/trailing/");
  });
});
