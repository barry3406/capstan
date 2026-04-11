import { describe, test, expect, beforeEach } from "bun:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActionForm,
  ActionContext,
  useActionData,
  useFormData,
} from "@zauso-ai/capstan-react";
import type { ActionContextValue } from "@zauso-ai/capstan-react";
import type { ActionResult } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function HookReader(props: { hook: "actionData" | "formData"; onValue?: (v: unknown) => void }) {
  const value =
    props.hook === "actionData" ? useActionData() : useFormData();
  props.onValue?.(value);
  return createElement("div", { "data-value": JSON.stringify(value ?? null) });
}

// ---------------------------------------------------------------------------
// ActionForm rendering
// ---------------------------------------------------------------------------

describe("ActionForm", () => {
  test("renders as <form> with method=\"post\"", () => {
    const html = render(createElement(ActionForm, {}));
    expect(html).toContain("<form");
    expect(html).toContain('method="post"');
  });

  test("includes a hidden _capstan_action field", () => {
    const html = render(createElement(ActionForm, {}));
    expect(html).toContain('name="_capstan_action"');
    expect(html).toContain('value="1"');
    expect(html).toContain('type="hidden"');
  });

  test("renders children inside the form", () => {
    const html = render(
      createElement(
        ActionForm,
        {},
        createElement("button", { type: "submit" }, "Submit"),
      ),
    );
    expect(html).toContain("<button");
    expect(html).toContain("Submit");
    expect(html).toContain("</form>");
  });

  test("uses custom action URL", () => {
    const html = render(
      createElement(ActionForm, { action: "/api/submit" }),
    );
    expect(html).toContain('action="/api/submit"');
  });

  test("does not render action attribute when omitted", () => {
    const html = render(createElement(ActionForm, {}));
    expect(html).not.toContain("action=");
  });

  test("renders with encType attribute", () => {
    const html = render(
      createElement(ActionForm, { encType: "multipart/form-data" }),
    );
    // React SSR may render as camelCase encType or lowercase enctype
    expect(html.toLowerCase()).toContain('multipart/form-data');
  });

  test("does not render encType attribute when omitted", () => {
    const html = render(createElement(ActionForm, {}));
    expect(html.toLowerCase()).not.toContain("enctype");
  });

  test("renders with className", () => {
    const html = render(
      createElement(ActionForm, { className: "my-form" }),
    );
    expect(html).toContain('class="my-form"');
  });

  test("renders with id", () => {
    const html = render(
      createElement(ActionForm, { id: "login-form" }),
    );
    expect(html).toContain('id="login-form"');
  });

  test("renders with both className and id", () => {
    const html = render(
      createElement(ActionForm, { className: "form-cls", id: "f1" }),
    );
    expect(html).toContain('class="form-cls"');
    expect(html).toContain('id="f1"');
  });

  test("always uses method post even when explicitly set", () => {
    const html = render(
      createElement(ActionForm, { method: "post" }),
    );
    expect(html).toContain('method="post"');
  });

  test("renders multiple children", () => {
    const html = render(
      createElement(
        ActionForm,
        {},
        createElement("input", { name: "email", type: "text" }),
        createElement("input", { name: "password", type: "password" }),
        createElement("button", { type: "submit" }, "Go"),
      ),
    );
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain("Go");
  });

  test("renders with no children", () => {
    const html = render(createElement(ActionForm, {}));
    expect(html).toContain("<form");
    expect(html).toContain("</form>");
  });
});

// ---------------------------------------------------------------------------
// useActionData hook
// ---------------------------------------------------------------------------

describe("useActionData", () => {
  test("returns undefined when no ActionContext provider", () => {
    let captured: unknown = "not-set";
    render(
      createElement(HookReader, {
        hook: "actionData",
        onValue: (v) => { captured = v; },
      }),
    );
    expect(captured).toBeUndefined();
  });

  test("returns undefined when ActionContext value is undefined", () => {
    let captured: unknown = "not-set";
    render(
      createElement(
        ActionContext.Provider,
        { value: undefined },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toBeUndefined();
  });

  test("returns the action result when context has result", () => {
    const result: ActionResult<string> = { ok: true, data: "created" };
    let captured: unknown;
    render(
      createElement(
        ActionContext.Provider,
        { value: { result } },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toEqual(result);
  });

  test("returns error result including fieldErrors", () => {
    const result: ActionResult = {
      ok: false,
      error: "Validation failed",
      fieldErrors: { name: ["Required"] },
    };
    let captured: unknown;
    render(
      createElement(
        ActionContext.Provider,
        { value: { result } },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toEqual(result);
  });

  test("returns undefined when context has no result property", () => {
    let captured: unknown = "not-set";
    render(
      createElement(
        ActionContext.Provider,
        { value: { formData: { name: "test" } } as ActionContextValue },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useFormData hook
// ---------------------------------------------------------------------------

describe("useFormData", () => {
  test("returns undefined when no ActionContext provider", () => {
    let captured: unknown = "not-set";
    render(
      createElement(HookReader, {
        hook: "formData",
        onValue: (v) => { captured = v; },
      }),
    );
    expect(captured).toBeUndefined();
  });

  test("returns form data from context", () => {
    const formData = { email: "a@b.com", name: "Alice" };
    let captured: unknown;
    render(
      createElement(
        ActionContext.Provider,
        { value: { formData } },
        createElement(HookReader, {
          hook: "formData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toEqual(formData);
  });

  test("returns undefined when context has no formData", () => {
    let captured: unknown = "not-set";
    render(
      createElement(
        ActionContext.Provider,
        { value: { result: { ok: true, data: null } } },
        createElement(HookReader, {
          hook: "formData",
          onValue: (v) => { captured = v; },
        }),
      ),
    );
    expect(captured).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ActionContext — nested providers
// ---------------------------------------------------------------------------

describe("ActionContext", () => {
  test("provides correct value to children", () => {
    const ctx: ActionContextValue = {
      result: { ok: true, data: "inner" },
      formData: { key: "val" },
    };
    let actionDataCaptured: unknown;
    let formDataCaptured: unknown;
    render(
      createElement(
        ActionContext.Provider,
        { value: ctx },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { actionDataCaptured = v; },
        }),
        createElement(HookReader, {
          hook: "formData",
          onValue: (v) => { formDataCaptured = v; },
        }),
      ),
    );
    expect(actionDataCaptured).toEqual({ ok: true, data: "inner" });
    expect(formDataCaptured).toEqual({ key: "val" });
  });

  test("nested ActionContext providers — inner overrides outer", () => {
    const outerCtx: ActionContextValue = {
      result: { ok: true, data: "outer" },
    };
    const innerCtx: ActionContextValue = {
      result: { ok: false, error: "inner-error" },
    };
    let outerCaptured: unknown;
    let innerCaptured: unknown;

    render(
      createElement(
        ActionContext.Provider,
        { value: outerCtx },
        createElement(HookReader, {
          hook: "actionData",
          onValue: (v) => { outerCaptured = v; },
        }),
        createElement(
          ActionContext.Provider,
          { value: innerCtx },
          createElement(HookReader, {
            hook: "actionData",
            onValue: (v) => { innerCaptured = v; },
          }),
        ),
      ),
    );

    expect(outerCaptured).toEqual({ ok: true, data: "outer" });
    expect(innerCaptured).toEqual({ ok: false, error: "inner-error" });
  });

  test("multiple ActionForms can each have their own context", () => {
    const ctx1: ActionContextValue = {
      result: { ok: true, data: "form1" },
    };
    const ctx2: ActionContextValue = {
      result: { ok: false, error: "form2-error" },
    };
    let captured1: unknown;
    let captured2: unknown;

    render(
      createElement(
        "div",
        {},
        createElement(
          ActionContext.Provider,
          { value: ctx1 },
          createElement(
            ActionForm,
            {},
            createElement(HookReader, {
              hook: "actionData",
              onValue: (v) => { captured1 = v; },
            }),
          ),
        ),
        createElement(
          ActionContext.Provider,
          { value: ctx2 },
          createElement(
            ActionForm,
            {},
            createElement(HookReader, {
              hook: "actionData",
              onValue: (v) => { captured2 = v; },
            }),
          ),
        ),
      ),
    );

    expect(captured1).toEqual({ ok: true, data: "form1" });
    expect(captured2).toEqual({ ok: false, error: "form2-error" });
  });
});

// ---------------------------------------------------------------------------
// Static analysis detection (inline test for action export patterns)
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeRouteFileStaticInfo,
  clearRouteStaticAnalysisCache,
} from "@zauso-ai/capstan-router/static-analysis";

describe("static analysis — action export detection", () => {
  let tmpDir: string;
  let fileIdx = 0;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "action-sa-"));
    fileIdx = 0;
    clearRouteStaticAnalysisCache();
  });

  function writeTmpFile(content: string): string {
    const filePath = join(tmpDir, `page-${++fileIdx}.ts`);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  test("detects `export const action = defineAction(...)`", () => {
    const fp = writeTmpFile(`
      export default function Page() { return null; }
      export const action = defineAction({ handler: async () => ({ ok: true, data: null }) });
    `);
    const { staticInfo } = analyzeRouteFileStaticInfo(fp, "page", "/test", false);
    expect(staticInfo?.exportNames).toContain("action");
    expect(staticInfo?.hasAction).toBe(true);
  });

  test("file without action has hasAction absent or false", () => {
    const fp = writeTmpFile(`
      export default function Page() { return null; }
      export const loader = async () => ({ items: [] });
    `);
    const { staticInfo } = analyzeRouteFileStaticInfo(fp, "page", "/test", false);
    expect(staticInfo?.hasAction).toBeUndefined();
  });

  test("detects `export { action }` re-export", () => {
    const fp = writeTmpFile(`
      export default function Page() { return null; }
      const action = defineAction({ handler: async () => ({ ok: true, data: null }) });
      export { action };
    `);
    const { staticInfo } = analyzeRouteFileStaticInfo(fp, "page", "/test", false);
    expect(staticInfo?.exportNames).toContain("action");
    expect(staticInfo?.hasAction).toBe(true);
  });

  test("action export on layout generates warning diagnostic", () => {
    const fp = writeTmpFile(`
      export default function Layout({ children }) { return children; }
      export const action = defineAction({ handler: async () => ({ ok: true, data: null }) });
    `);
    const { diagnostics } = analyzeRouteFileStaticInfo(fp, "layout", "/test", false);
    expect(diagnostics.length).toBeGreaterThan(0);
    const actionWarning = diagnostics.find((d) => d.message.includes("action"));
    expect(actionWarning).toBeDefined();
    expect(actionWarning!.severity).toBe("warning");
  });

  test("action export on error boundary generates warning", () => {
    const fp = writeTmpFile(`
      export default function Error() { return null; }
      export const action = defineAction({ handler: async () => ({ ok: true, data: null }) });
    `);
    const { diagnostics } = analyzeRouteFileStaticInfo(fp, "error", "/test", false);
    const actionWarning = diagnostics.find((d) => d.message.includes("action"));
    expect(actionWarning).toBeDefined();
  });

  test("action export on loading boundary generates warning", () => {
    const fp = writeTmpFile(`
      export default function Loading() { return null; }
      export const action = defineAction({ handler: async () => ({ ok: true, data: null }) });
    `);
    const { diagnostics } = analyzeRouteFileStaticInfo(fp, "loading", "/test", false);
    const actionWarning = diagnostics.find((d) => d.message.includes("action"));
    expect(actionWarning).toBeDefined();
  });
});
