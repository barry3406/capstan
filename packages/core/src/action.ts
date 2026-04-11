import type { ZodType, ZodError } from "zod";

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

// ---------------------------------------------------------------------------
// Action args — mirrors LoaderArgs context shape
// ---------------------------------------------------------------------------

export interface ActionArgs<TInput = unknown> {
  input: TInput;
  params: Record<string, string>;
  request: Request;
  ctx: {
    auth: {
      isAuthenticated: boolean;
      type: "human" | "agent" | "anonymous" | "workload";
      userId?: string;
      role?: string;
      email?: string;
      agentId?: string;
      agentName?: string;
      permissions?: string[];
      [key: string]: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// Action definition — returned by defineAction
// ---------------------------------------------------------------------------

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  __brand: "capstan_action";
  input?: ZodType<TInput>;
  handler: (args: ActionArgs<TInput>) => Promise<ActionResult<TOutput>>;
}

// ---------------------------------------------------------------------------
// ActionRedirectError — thrown by actionRedirect
// ---------------------------------------------------------------------------

export class ActionRedirectError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Action redirect to ${url}`);
    this.name = "ActionRedirectError";
    this.url = url;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// defineAction — creates a validated, branded action handler
// ---------------------------------------------------------------------------

export function defineAction<TInput = unknown, TOutput = unknown>(config: {
  input?: ZodType<TInput>;
  handler: (args: ActionArgs<TInput>) => Promise<ActionResult<TOutput>>;
}): ActionDefinition<TInput, TOutput> {
  const wrappedHandler = async (
    args: ActionArgs<TInput>,
  ): Promise<ActionResult<TOutput>> => {
    let validatedInput: TInput = args.input;

    if (config.input) {
      const parseResult = config.input.safeParse(args.input);
      if (!parseResult.success) {
        return zodErrorToActionResult(parseResult.error);
      }
      validatedInput = parseResult.data;
    }

    return config.handler({
      input: validatedInput,
      params: args.params,
      request: args.request,
      ctx: args.ctx,
    });
  };

  return {
    __brand: "capstan_action",
    ...(config.input !== undefined ? { input: config.input } : {}),
    handler: wrappedHandler,
  } as ActionDefinition<TInput, TOutput>;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  const result: ActionResult<never> = { ok: false, error };
  if (fieldErrors !== undefined) {
    result.fieldErrors = fieldErrors;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Redirect helper — throws, never returns
// ---------------------------------------------------------------------------

export function actionRedirect(
  url: string,
  status?: 301 | 302 | 303 | 307 | 308,
): never {
  throw new ActionRedirectError(url, status ?? 303);
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isActionDefinition(value: unknown): value is ActionDefinition {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate["__brand"] === "capstan_action" &&
    typeof candidate["handler"] === "function"
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function zodErrorToActionResult(error: ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "_root";
    const existing = fieldErrors[path];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[path] = [issue.message];
    }
  }

  return {
    ok: false,
    error: "Validation failed",
    fieldErrors,
  };
}
