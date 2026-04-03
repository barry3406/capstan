import type { CapstanContext, MiddlewareDefinition } from "@zauso-ai/capstan-core";
import { loadRouteModule } from "./loader.js";

export class RouteMiddlewareLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RouteMiddlewareLoadError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RouteMiddlewareExportError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RouteMiddlewareExportError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface LoadedRouteMiddleware {
  filePath: string;
  definition: MiddlewareDefinition;
}

export interface RouteMiddlewareArgs {
  request: Request;
  ctx: CapstanContext;
}

export type RouteMiddlewareTerminalHandler = (
  args: RouteMiddlewareArgs,
) => Promise<Response>;

function isMiddlewareDefinition(
  value: unknown,
): value is MiddlewareDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "handler" in value &&
    typeof (value as MiddlewareDefinition).handler === "function"
  );
}

function normalizeMiddlewareExport(
  exported: unknown,
  filePath: string,
): MiddlewareDefinition {
  if (typeof exported === "function") {
    return { handler: exported as MiddlewareDefinition["handler"] };
  }

  if (isMiddlewareDefinition(exported)) {
    return exported;
  }

  throw new RouteMiddlewareExportError(
    `Invalid middleware export in ${filePath}: expected default export from defineMiddleware() or a function with a handler().`,
    filePath,
  );
}

export async function loadRouteMiddleware(
  filePath: string,
): Promise<LoadedRouteMiddleware> {
  let mod: Record<string, unknown>;
  try {
    mod = await loadRouteModule(filePath);
  } catch (cause) {
    throw new RouteMiddlewareLoadError(
      `Failed to load middleware module ${filePath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      filePath,
      cause,
    );
  }

  if (!Object.prototype.hasOwnProperty.call(mod, "default")) {
    throw new RouteMiddlewareExportError(
      `Middleware module ${filePath} must export a default middleware definition.`,
      filePath,
    );
  }

  return {
    filePath,
    definition: normalizeMiddlewareExport(mod.default, filePath),
  };
}

export async function loadRouteMiddlewares(
  filePaths: string[],
): Promise<LoadedRouteMiddleware[]> {
  const loaded: LoadedRouteMiddleware[] = [];
  for (const filePath of filePaths) {
    loaded.push(await loadRouteMiddleware(filePath));
  }
  return loaded;
}

export function composeRouteMiddlewares(
  middlewares: MiddlewareDefinition[],
  terminalHandler: RouteMiddlewareTerminalHandler,
): RouteMiddlewareTerminalHandler {
  const chain = middlewares.slice();

  return async function runRouteMiddleware(args: RouteMiddlewareArgs): Promise<Response> {
    let index = -1;

    const dispatch = async (position: number): Promise<Response> => {
      if (position <= index) {
        throw new Error("next() called multiple times in route middleware chain");
      }
      index = position;

      const current = chain[position];
      if (!current) {
        return terminalHandler(args);
      }

      const response = await current.handler({
        request: args.request,
        ctx: args.ctx,
        next: async () => {
          return dispatch(position + 1);
        },
      });

      return response;
    };

    return dispatch(0);
  };
}

export async function runRouteMiddlewares(
  filePaths: string[],
  args: RouteMiddlewareArgs,
  terminalHandler: RouteMiddlewareTerminalHandler,
): Promise<Response> {
  const loaded = await loadRouteMiddlewares(filePaths);
  return composeRouteMiddlewares(
    loaded.map((entry) => entry.definition),
    terminalHandler,
  )(args);
}
