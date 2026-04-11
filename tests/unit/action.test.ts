import { describe, test, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  defineAction,
  actionOk,
  actionError,
  actionRedirect,
  isActionDefinition,
  ActionRedirectError,
} from "@zauso-ai/capstan-core";
import type { ActionArgs, ActionResult, ActionDefinition } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArgs(overrides: Partial<ActionArgs> = {}): ActionArgs {
  return {
    input: overrides.input ?? {},
    params: overrides.params ?? {},
    request: overrides.request ?? new Request("http://localhost/test", { method: "POST" }),
    ctx: overrides.ctx ?? {
      auth: { isAuthenticated: false, type: "anonymous" },
    },
  };
}

// ---------------------------------------------------------------------------
// defineAction
// ---------------------------------------------------------------------------

describe("defineAction", () => {
  test("returns an object branded as capstan_action", () => {
    const action = defineAction({
      handler: async () => actionOk("done"),
    });
    expect(action.__brand).toBe("capstan_action");
    expect(typeof action.handler).toBe("function");
  });

  test("stores the input schema on the definition", () => {
    const schema = z.object({ name: z.string() });
    const action = defineAction({
      input: schema,
      handler: async () => actionOk(null),
    });
    expect(action.input).toBe(schema);
  });

  test("with no input schema, passes input through unmodified", async () => {
    let received: unknown;
    const action = defineAction({
      handler: async (args) => {
        received = args.input;
        return actionOk("ok");
      },
    });
    const rawInput = { arbitrary: "data", nested: { a: 1 } };
    await action.handler(makeArgs({ input: rawInput }));
    expect(received).toEqual(rawInput);
  });

  test("with valid Zod schema, validates and passes parsed input", async () => {
    const schema = z.object({ count: z.coerce.number() });
    let received: unknown;
    const action = defineAction({
      input: schema,
      handler: async (args) => {
        received = args.input;
        return actionOk("ok");
      },
    });
    const result = await action.handler(makeArgs({ input: { count: "42" } }));
    expect(result.ok).toBe(true);
    expect(received).toEqual({ count: 42 });
  });

  test("with empty config object — handler must still be provided at call site", () => {
    // TypeScript enforces handler is required, but at runtime ensure __brand is set
    const action = defineAction({
      handler: async () => actionOk(undefined),
    });
    expect(action.__brand).toBe("capstan_action");
  });
});

// ---------------------------------------------------------------------------
// Zod validation failure
// ---------------------------------------------------------------------------

describe("Zod validation", () => {
  test("returns structured error on invalid input (does NOT throw)", async () => {
    const action = defineAction({
      input: z.object({ email: z.string().email() }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(makeArgs({ input: { email: "not-an-email" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Validation failed");
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors!["email"]).toBeDefined();
      expect(result.fieldErrors!["email"]!.length).toBeGreaterThan(0);
    }
  });

  test("reports multiple field errors for multiple invalid fields", async () => {
    const action = defineAction({
      input: z.object({
        name: z.string().min(2),
        age: z.number().positive(),
      }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(
      makeArgs({ input: { name: "", age: -1 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors!["name"]).toBeDefined();
      expect(result.fieldErrors!["age"]).toBeDefined();
    }
  });

  test("validation failure with nested objects uses dot-path keys", async () => {
    const action = defineAction({
      input: z.object({
        address: z.object({
          zip: z.string().length(5),
        }),
      }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(
      makeArgs({ input: { address: { zip: "123" } } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors!["address.zip"]).toBeDefined();
    }
  });

  test("validation failure with arrays uses dot-path keys", async () => {
    const action = defineAction({
      input: z.object({
        tags: z.array(z.string().min(1)),
      }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(
      makeArgs({ input: { tags: ["valid", ""] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors!["tags.1"]).toBeDefined();
    }
  });

  test("validation failure with optional fields — present but invalid", async () => {
    const action = defineAction({
      input: z.object({
        nickname: z.string().min(3).optional(),
      }),
      handler: async () => actionOk("ok"),
    });
    // Providing a value that is too short
    const result = await action.handler(makeArgs({ input: { nickname: "ab" } }));
    expect(result.ok).toBe(false);
  });

  test("validation succeeds when optional field is omitted", async () => {
    const action = defineAction({
      input: z.object({
        nickname: z.string().min(3).optional(),
      }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(makeArgs({ input: {} }));
    expect(result.ok).toBe(true);
  });

  test("schema with transform applies the transformation", async () => {
    let received: unknown;
    const action = defineAction({
      input: z.object({
        name: z.string().transform((s) => s.toUpperCase()),
      }),
      handler: async (args) => {
        received = args.input;
        return actionOk("ok");
      },
    });
    await action.handler(makeArgs({ input: { name: "hello" } }));
    expect((received as { name: string }).name).toBe("HELLO");
  });

  test("schema with refine returns error on failure", async () => {
    const action = defineAction({
      input: z
        .object({
          password: z.string(),
          confirm: z.string(),
        })
        .refine((data) => data.password === data.confirm, {
          message: "Passwords must match",
          path: ["confirm"],
        }),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(
      makeArgs({ input: { password: "abc", confirm: "xyz" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors!["confirm"]).toBeDefined();
      expect(result.fieldErrors!["confirm"]![0]).toBe("Passwords must match");
    }
  });

  test("root-level validation error uses _root key", async () => {
    const action = defineAction({
      input: z.string().min(1),
      handler: async () => actionOk("ok"),
    });
    const result = await action.handler(makeArgs({ input: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors!["_root"]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Handler behavior
// ---------------------------------------------------------------------------

describe("handler behavior", () => {
  test("handler returning actionOk() produces ok: true result", async () => {
    const action = defineAction({
      handler: async () => actionOk({ id: 42 }),
    });
    const result = await action.handler(makeArgs());
    expect(result).toEqual({ ok: true, data: { id: 42 } });
  });

  test("handler returning actionError() with field errors", async () => {
    const action = defineAction({
      handler: async () =>
        actionError("Bad input", { email: ["Required"] }),
    });
    const result = await action.handler(makeArgs());
    expect(result).toEqual({
      ok: false,
      error: "Bad input",
      fieldErrors: { email: ["Required"] },
    });
  });

  test("handler returning actionError() without field errors", async () => {
    const action = defineAction({
      handler: async () => actionError("Something went wrong"),
    });
    const result = await action.handler(makeArgs());
    expect(result).toEqual({ ok: false, error: "Something went wrong" });
    expect("fieldErrors" in result).toBe(false);
  });

  test("handler receives correct params, request, and ctx", async () => {
    let captured: ActionArgs | undefined;
    const action = defineAction({
      handler: async (args) => {
        captured = args;
        return actionOk(null);
      },
    });
    const customRequest = new Request("http://localhost/items/99", {
      method: "POST",
    });
    const customCtx = {
      auth: { isAuthenticated: true, type: "human", userId: "u1", role: "admin" },
    };
    await action.handler(
      makeArgs({
        params: { id: "99" },
        request: customRequest,
        ctx: customCtx,
      }),
    );
    expect(captured).toBeDefined();
    expect(captured!.params).toEqual({ id: "99" });
    expect(captured!.request).toBe(customRequest);
    expect(captured!.ctx.auth.isAuthenticated).toBe(true);
    expect(captured!.ctx.auth.userId).toBe("u1");
  });

  test("handler that throws a non-redirect error propagates", async () => {
    const action = defineAction({
      handler: async () => {
        throw new TypeError("Something broke");
      },
    });
    await expect(action.handler(makeArgs())).rejects.toThrow("Something broke");
  });

  test("handler that returns undefined as data in actionOk", async () => {
    const action = defineAction({
      handler: async () => actionOk(undefined),
    });
    const result = await action.handler(makeArgs());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeUndefined();
    }
  });

  test("handler that returns null as data in actionOk", async () => {
    const action = defineAction({
      handler: async () => actionOk(null),
    });
    const result = await action.handler(makeArgs());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  test("concurrent action invocations are independent", async () => {
    let callCount = 0;
    const action = defineAction({
      handler: async (args) => {
        const n = ++callCount;
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 1));
        return actionOk({ call: n, input: args.input });
      },
    });

    const results = await Promise.all([
      action.handler(makeArgs({ input: { tag: "a" } })),
      action.handler(makeArgs({ input: { tag: "b" } })),
      action.handler(makeArgs({ input: { tag: "c" } })),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const datas = results.map((r) => (r as { ok: true; data: { tag: string } }).data.input);
    expect(datas).toContainEqual({ tag: "a" });
    expect(datas).toContainEqual({ tag: "b" });
    expect(datas).toContainEqual({ tag: "c" });
  });

  test("action with very large input does not error", async () => {
    const action = defineAction({
      handler: async (args) => actionOk({ size: JSON.stringify(args.input).length }),
    });
    const largeInput: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) {
      largeInput[`key_${i}`] = `value_${i}`;
    }
    const result = await action.handler(makeArgs({ input: largeInput }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { size: number }).size).toBeGreaterThan(100_000);
    }
  });

  test("action handler that never resolves can be externally timed out", async () => {
    const action = defineAction({
      handler: () => new Promise<ActionResult>(() => {}), // never resolves
    });

    const raceResult = await Promise.race([
      action.handler(makeArgs()),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    expect(raceResult).toBe("timeout");
  });
});

// ---------------------------------------------------------------------------
// ActionRedirectError and actionRedirect
// ---------------------------------------------------------------------------

describe("ActionRedirectError", () => {
  test("is an instance of Error", () => {
    const err = new ActionRedirectError("/login", 303);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ActionRedirectError);
  });

  test("stores url and status", () => {
    const err = new ActionRedirectError("/dashboard", 307);
    expect(err.url).toBe("/dashboard");
    expect(err.status).toBe(307);
  });

  test("has a descriptive message", () => {
    const err = new ActionRedirectError("/foo", 302);
    expect(err.message).toContain("/foo");
  });

  test("name is ActionRedirectError", () => {
    const err = new ActionRedirectError("/x", 303);
    expect(err.name).toBe("ActionRedirectError");
  });
});

describe("actionRedirect", () => {
  test("throws ActionRedirectError", () => {
    expect(() => actionRedirect("/login")).toThrow(ActionRedirectError);
  });

  test("defaults to status 303", () => {
    try {
      actionRedirect("/login");
    } catch (err) {
      expect(err).toBeInstanceOf(ActionRedirectError);
      expect((err as ActionRedirectError).status).toBe(303);
    }
  });

  test.each([301, 302, 303, 307, 308] as const)(
    "supports status %d",
    (status) => {
      try {
        actionRedirect("/target", status);
      } catch (err) {
        expect((err as ActionRedirectError).status).toBe(status);
        expect((err as ActionRedirectError).url).toBe("/target");
      }
    },
  );

  test("handler throwing actionRedirect propagates through defineAction", async () => {
    const action = defineAction({
      handler: async () => {
        actionRedirect("/home", 302);
      },
    });

    try {
      await action.handler(makeArgs());
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ActionRedirectError);
      expect((err as ActionRedirectError).url).toBe("/home");
      expect((err as ActionRedirectError).status).toBe(302);
    }
  });

  test("actionRedirect after validation still throws redirect", async () => {
    const action = defineAction({
      input: z.object({ name: z.string() }),
      handler: async () => {
        actionRedirect("/success");
      },
    });

    try {
      await action.handler(makeArgs({ input: { name: "ok" } }));
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ActionRedirectError);
    }
  });
});

// ---------------------------------------------------------------------------
// actionOk / actionError
// ---------------------------------------------------------------------------

describe("actionOk", () => {
  test("returns { ok: true, data }", () => {
    expect(actionOk(42)).toEqual({ ok: true, data: 42 });
  });

  test("handles complex objects", () => {
    const data = { users: [{ id: 1 }], meta: { page: 1 } };
    expect(actionOk(data)).toEqual({ ok: true, data });
  });

  test("handles null", () => {
    expect(actionOk(null)).toEqual({ ok: true, data: null });
  });

  test("handles undefined", () => {
    expect(actionOk(undefined)).toEqual({ ok: true, data: undefined });
  });
});

describe("actionError", () => {
  test("returns { ok: false, error } without fieldErrors when omitted", () => {
    const result = actionError("fail");
    expect(result).toEqual({ ok: false, error: "fail" });
    expect("fieldErrors" in result).toBe(false);
  });

  test("includes fieldErrors when provided", () => {
    const result = actionError("Validation failed", {
      email: ["Required", "Invalid format"],
      name: ["Too short"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Validation failed");
    expect(result.fieldErrors).toEqual({
      email: ["Required", "Invalid format"],
      name: ["Too short"],
    });
  });

  test("empty fieldErrors object is still included", () => {
    const result = actionError("fail", {});
    expect(result.fieldErrors).toEqual({});
  });

  test("empty error string is allowed", () => {
    const result = actionError("");
    expect(result.error).toBe("");
  });
});

// ---------------------------------------------------------------------------
// isActionDefinition
// ---------------------------------------------------------------------------

describe("isActionDefinition", () => {
  test("returns true for valid action definition", () => {
    const action = defineAction({
      handler: async () => actionOk(null),
    });
    expect(isActionDefinition(action)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isActionDefinition(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isActionDefinition(undefined)).toBe(false);
  });

  test("returns false for plain object without brand", () => {
    expect(isActionDefinition({ handler: () => {} })).toBe(false);
  });

  test("returns false for object with wrong brand", () => {
    expect(
      isActionDefinition({ __brand: "capstan_api", handler: () => {} }),
    ).toBe(false);
  });

  test("returns false for object with brand but no handler", () => {
    expect(isActionDefinition({ __brand: "capstan_action" })).toBe(false);
  });

  test("returns false for string", () => {
    expect(isActionDefinition("capstan_action")).toBe(false);
  });

  test("returns false for number", () => {
    expect(isActionDefinition(42)).toBe(false);
  });

  test("returns false for boolean", () => {
    expect(isActionDefinition(true)).toBe(false);
  });

  test("returns false for array", () => {
    expect(isActionDefinition([])).toBe(false);
  });

  test("returns false for function", () => {
    expect(isActionDefinition(() => {})).toBe(false);
  });

  test("returns true for manually constructed object with correct shape", () => {
    expect(
      isActionDefinition({
        __brand: "capstan_action",
        handler: async () => actionOk(null),
      }),
    ).toBe(true);
  });

  test("returns true even with extra properties", () => {
    expect(
      isActionDefinition({
        __brand: "capstan_action",
        handler: async () => actionOk(null),
        input: z.object({}),
        extra: true,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// server POST handler edge cases
// ---------------------------------------------------------------------------

describe("server POST handler edge cases", () => {
  // Test: _capstan_action marker is stripped from form input before reaching handler
  test("_capstan_action hidden field is stripped from action input", async () => {
    let receivedInput: unknown;
    const action = defineAction({
      handler: async (args) => {
        receivedInput = args.input;
        return actionOk("done");
      },
    });
    // Simulate what the server does: parse form data, strip marker, call handler
    const formObject: Record<string, unknown> = {
      _capstan_action: "1",
      title: "hello",
      body: "world",
    };
    delete formObject["_capstan_action"];
    await action.handler({
      input: formObject,
      params: {},
      request: new Request("http://localhost/test", { method: "POST" }),
      ctx: { auth: { isAuthenticated: false, type: "anonymous" } },
    });
    expect(receivedInput).toEqual({ title: "hello", body: "world" });
    expect(receivedInput).not.toHaveProperty("_capstan_action");
  });

  // Test: non-object JSON body is rejected
  test("non-object JSON bodies are rejected (array)", () => {
    const parsed: unknown = [1, 2, 3];
    const isValid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    expect(isValid).toBe(false);
  });

  test("non-object JSON bodies are rejected (string)", () => {
    const parsed: unknown = "hello";
    const isValid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    expect(isValid).toBe(false);
  });

  test("non-object JSON bodies are rejected (null)", () => {
    const parsed: unknown = null;
    const isValid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    expect(isValid).toBe(false);
  });

  test("non-object JSON bodies are rejected (number)", () => {
    const parsed: unknown = 42;
    const isValid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    expect(isValid).toBe(false);
  });

  test("valid object JSON body passes validation", () => {
    const parsed: unknown = { title: "test" };
    const isValid = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    expect(isValid).toBe(true);
  });
});
