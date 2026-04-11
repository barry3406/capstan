// ---------------------------------------------------------------------------
// Lightweight JSON Schema validator for tool input arguments.
//
// Checks required fields, types (string, number, integer, boolean, array,
// object), and enum constraints.  Collects ALL errors rather than failing on
// the first one.
// ---------------------------------------------------------------------------

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown> | undefined,
): { valid: boolean; error?: string } {
  if (schema === undefined) {
    return { valid: true };
  }

  const errors: string[] = [];

  // Collect required fields
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];

  // Collect property definitions
  const properties =
    schema.properties != null && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

  // Check required fields
  for (const field of required) {
    if (!(field in args)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Validate each property that exists in args and has a schema definition
  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (prop === undefined) {
      // Extra fields not in schema -- permissive, skip
      continue;
    }

    // Type checking
    const expectedType = typeof prop.type === "string" ? prop.type : undefined;
    if (expectedType !== undefined) {
      const typeError = checkType(key, value, expectedType);
      if (typeError !== undefined) {
        errors.push(typeError);
        // Skip enum check when type already failed
        continue;
      }
    }

    // Enum checking
    if (Array.isArray(prop.enum)) {
      const allowed = prop.enum as unknown[];
      if (!allowed.includes(value)) {
        const formatted = allowed.map((v) => JSON.stringify(v)).join(", ");
        errors.push(
          `Field "${key}": value ${JSON.stringify(value)} is not one of [${formatted}]`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join("\n") };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Internal type checker
// ---------------------------------------------------------------------------

function checkType(
  field: string,
  value: unknown,
  expectedType: string,
): string | undefined {
  switch (expectedType) {
    case "string":
      if (typeof value !== "string") {
        return `Field "${field}": expected string, got ${actualType(value)}`;
      }
      break;
    case "number":
      if (typeof value !== "number") {
        return `Field "${field}": expected number, got ${actualType(value)}`;
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return typeof value !== "number"
          ? `Field "${field}": expected integer, got ${actualType(value)}`
          : `Field "${field}": expected integer, got non-integer number`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `Field "${field}": expected boolean, got ${actualType(value)}`;
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        return `Field "${field}": expected array, got ${actualType(value)}`;
      }
      break;
    case "object":
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        return `Field "${field}": expected object, got ${actualType(value)}`;
      }
      break;
    // Unknown/unsupported types are permissively ignored
  }
  return undefined;
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
