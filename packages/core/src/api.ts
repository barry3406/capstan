import type {
  APIDefinition,
  APIHandlerInput,
  CapstanContext,
} from "./types.js";

/**
 * Define a typed API route handler.
 *
 * The returned definition wraps the original handler so that:
 *  1. Input is validated against the Zod `input` schema (if provided).
 *  2. The handler runs with the validated input.
 *  3. Output is validated against the Zod `output` schema (if provided).
 *
 * The definition object is also stored for introspection by the agent
 * manifest system (see `getAPIRegistry()`).
 */
export function defineAPI<TInput = unknown, TOutput = unknown>(
  def: APIDefinition<TInput, TOutput>,
): APIDefinition<TInput, TOutput> {
  const wrappedHandler = async (
    args: APIHandlerInput<TInput>,
  ): Promise<TOutput> => {
    // --- validate input ---------------------------------------------------
    let validatedInput: TInput = args.input;
    if (def.input) {
      validatedInput = def.input.parse(args.input) as TInput;
    }

    // --- run handler ------------------------------------------------------
    const result = await def.handler({
      input: validatedInput,
      ctx: args.ctx,
    });

    // --- validate output --------------------------------------------------
    if (def.output) {
      return def.output.parse(result) as TOutput;
    }

    return result;
  };

  const wrapped: APIDefinition<TInput, TOutput> = {
    ...def,
    handler: wrappedHandler,
  };

  // Register for introspection.
  apiRegistry.push(wrapped as APIDefinition);

  return wrapped;
}

// ---------------------------------------------------------------------------
// Internal registry — used by createCapstanApp to build the agent manifest.
// ---------------------------------------------------------------------------

const apiRegistry: APIDefinition[] = [];

/**
 * Return all API definitions registered via `defineAPI()`.
 * Primarily consumed by `createCapstanApp` when building route metadata.
 */
export function getAPIRegistry(): ReadonlyArray<APIDefinition> {
  return apiRegistry;
}
