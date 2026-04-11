import { describe, expect, it } from "bun:test";
import { validateArgs } from "../../packages/ai/src/loop/validate-args.ts";

// ---------------------------------------------------------------------------
// validateArgs — JSON Schema input validation
// ---------------------------------------------------------------------------

describe("validateArgs", () => {
  it("returns valid when schema is undefined", () => {
    const result = validateArgs({ foo: "bar" }, undefined);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("passes when all required fields present with correct types", () => {
    const schema = {
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    };
    const result = validateArgs({ path: "/tmp/x", content: "hello" }, schema);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("reports missing required field with field name", () => {
    const schema = {
      required: ["path"],
      properties: {
        path: { type: "string" },
      },
    };
    const result = validateArgs({}, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing required field: "path"');
  });

  it("reports wrong type with expected vs actual", () => {
    const schema = {
      properties: {
        timeout: { type: "number" },
      },
    };
    const result = validateArgs({ timeout: "not-a-number" }, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Field "timeout": expected number, got string');
  });

  it("reports invalid enum value with allowed values", () => {
    const schema = {
      properties: {
        mode: { type: "string", enum: ["fast", "slow", "balanced"] },
      },
    };
    const result = validateArgs({ mode: "turbo" }, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("turbo");
    expect(result.error).toContain("fast");
    expect(result.error).toContain("slow");
    expect(result.error).toContain("balanced");
  });

  it("passes when optional fields are missing", () => {
    const schema = {
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
      },
    };
    const result = validateArgs({ name: "test" }, schema);
    expect(result.valid).toBe(true);
  });

  it("validates array type", () => {
    const schema = {
      properties: {
        tags: { type: "array" },
      },
    };

    const pass = validateArgs({ tags: ["a", "b"] }, schema);
    expect(pass.valid).toBe(true);

    const fail = validateArgs({ tags: "not-array" }, schema);
    expect(fail.valid).toBe(false);
    expect(fail.error).toContain('Field "tags": expected array, got string');
  });

  it("validates boolean type", () => {
    const schema = {
      properties: {
        verbose: { type: "boolean" },
      },
    };

    const pass = validateArgs({ verbose: true }, schema);
    expect(pass.valid).toBe(true);

    const fail = validateArgs({ verbose: "yes" }, schema);
    expect(fail.valid).toBe(false);
    expect(fail.error).toContain('Field "verbose": expected boolean, got string');
  });

  it("validates integer type — rejects non-integer numbers", () => {
    const schema = {
      properties: {
        count: { type: "integer" },
      },
    };

    const passInt = validateArgs({ count: 42 }, schema);
    expect(passInt.valid).toBe(true);

    const failFloat = validateArgs({ count: 3.14 }, schema);
    expect(failFloat.valid).toBe(false);
    expect(failFloat.error).toContain('Field "count": expected integer, got non-integer number');

    const failString = validateArgs({ count: "five" }, schema);
    expect(failString.valid).toBe(false);
    expect(failString.error).toContain('Field "count": expected integer, got string');
  });

  it("validates object type", () => {
    const schema = {
      properties: {
        config: { type: "object" },
      },
    };

    const pass = validateArgs({ config: { a: 1 } }, schema);
    expect(pass.valid).toBe(true);

    const failNull = validateArgs({ config: null }, schema);
    expect(failNull.valid).toBe(false);
    expect(failNull.error).toContain('Field "config": expected object, got null');

    const failArray = validateArgs({ config: [1, 2] }, schema);
    expect(failArray.valid).toBe(false);
    expect(failArray.error).toContain('Field "config": expected object, got array');
  });

  it("collects multiple errors in one result", () => {
    const schema = {
      required: ["path", "mode"],
      properties: {
        path: { type: "string" },
        mode: { type: "string", enum: ["read", "write"] },
        timeout: { type: "number" },
      },
    };
    const result = validateArgs({ timeout: "bad" }, schema);
    expect(result.valid).toBe(false);

    const lines = result.error!.split("\n");
    // Should contain: missing path, missing mode, wrong type for timeout
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(result.error).toContain('Missing required field: "path"');
    expect(result.error).toContain('Missing required field: "mode"');
    expect(result.error).toContain('Field "timeout": expected number, got string');
  });

  it("reports all missing required fields when args is empty", () => {
    const schema = {
      required: ["a", "b", "c"],
      properties: {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
      },
    };
    const result = validateArgs({}, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('"a"');
    expect(result.error).toContain('"b"');
    expect(result.error).toContain('"c"');
  });

  it("passes extra fields not in schema (permissive)", () => {
    const schema = {
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    };
    const result = validateArgs({ name: "test", extraField: 42, anotherExtra: true }, schema);
    expect(result.valid).toBe(true);
  });

  it("passes for schema with no required and no properties", () => {
    const result = validateArgs({ anything: "goes" }, {});
    expect(result.valid).toBe(true);
  });

  it("passes enum check when value matches", () => {
    const schema = {
      properties: {
        level: { type: "string", enum: ["info", "warn", "error"] },
      },
    };
    const result = validateArgs({ level: "warn" }, schema);
    expect(result.valid).toBe(true);
  });

  it("skips enum check when type already failed", () => {
    const schema = {
      properties: {
        level: { type: "string", enum: ["info", "warn", "error"] },
      },
    };
    // level is a number, not a string — should report type error, not enum error
    const result = validateArgs({ level: 42 }, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected string, got number");
    // Should NOT also complain about enum
    expect(result.error).not.toContain("is not one of");
  });
});
