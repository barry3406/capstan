type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };
type PlainRecord = Record<string, unknown>;

export class AgentFrameworkValidationError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "AgentFrameworkValidationError";
    this.code = code;
    this.path = path;
  }
}

export function frameworkError(code: string, message: string, path?: string): AgentFrameworkValidationError {
  return new AgentFrameworkValidationError(code, message, path);
}

export function assertPlainObject<T extends PlainRecord>(value: unknown, path: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw frameworkError("invalid_type", `${path} must be a plain object`, path);
  }

  return value as T;
}

export function optionalPlainObject<T extends PlainRecord>(value: unknown, path: string): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertPlainObject<T>(value, path);
}

export function normalizeText(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw frameworkError("invalid_type", `${path} must be a string`, path);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw frameworkError("invalid_text", `${path} must not be empty`, path);
  }

  return normalized;
}

export function normalizeId(value: unknown, path: string): string {
  const normalized = normalizeText(value, path)
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9./:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-./:]+|[-./:]+$/g, "");

  if (!normalized || !/^[a-z0-9](?:[a-z0-9./:-]*[a-z0-9])?$/.test(normalized)) {
    throw frameworkError(
      "invalid_id",
      `${path} must resolve to a stable machine-readable identifier`,
      path,
    );
  }

  return normalized;
}

export function titleFromId(id: string): string {
  return id
    .replace(/[./:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeTitle(value: unknown, fallbackId: string, path: string): string {
  if (value === undefined) {
    return titleFromId(fallbackId);
  }

  return normalizeText(value, path);
}

export function normalizeStringList(
  value: readonly string[] | undefined,
  path: string,
  { mode = "text" }: { mode?: "text" | "id" } = {},
): readonly string[] {
  if (value === undefined) {
    return Object.freeze([]) as readonly string[];
  }

  if (!Array.isArray(value)) {
    throw frameworkError("invalid_type", `${path} must be an array`, path);
  }

  const seen = new Set<string>();
  const items: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const item = mode === "id"
      ? normalizeId(value[index], itemPath)
      : normalizeText(value[index], itemPath);

    if (seen.has(item)) {
      continue;
    }

    seen.add(item);
    items.push(item);
  }

  return Object.freeze(items) as readonly string[];
}

export function normalizeInteger(
  value: unknown,
  path: string,
  { min = 1 }: { min?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw frameworkError("invalid_integer", `${path} must be an integer`, path);
  }

  if (value < min) {
    throw frameworkError("invalid_integer", `${path} must be >= ${min}`, path);
  }

  return value;
}

export function normalizeScore(
  value: unknown,
  path: string,
  defaultValue: number,
): number {
  const candidate = value ?? defaultValue;
  if (
    typeof candidate !== "number"
    || Number.isNaN(candidate)
    || candidate < 0
    || candidate > 1
  ) {
    throw frameworkError("invalid_score", `${path} must be between 0 and 1`, path);
  }

  return candidate;
}

export function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) {
      freezeDeep(entry);
    }
    return Object.freeze(value) as T;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      freezeDeep(entry);
    }
    return Object.freeze(value);
  }

  return value;
}

function canonicalize(value: unknown): JsonLike {
  if (value === undefined) {
    return null;
  }

  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const normalized: Record<string, JsonLike> = {};
    for (const key of Object.keys(object).sort()) {
      const entry = object[key];
      if (entry === undefined) {
        continue;
      }
      normalized[key] = canonicalize(entry);
    }
    return normalized;
  }

  throw frameworkError("invalid_type", "value must be JSON-compatible");
}

export function normalizeJsonObject(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const object = assertPlainObject<Record<string, unknown>>(value, path);
  return freezeDeep(canonicalize(object)) as Readonly<Record<string, unknown>>;
}

export function normalizeSchema(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> | undefined {
  return normalizeJsonObject(value, path);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function dedupeContracts<T extends { readonly id: string }>(
  kind: string,
  items: readonly T[],
): readonly T[] {
  const output: T[] = [];
  const seen = new Map<string, string>();

  for (const item of items) {
    const signature = stableJson(item);
    const previous = seen.get(item.id);

    if (previous === undefined) {
      seen.set(item.id, signature);
      output.push(item);
      continue;
    }

    if (previous !== signature) {
      throw frameworkError(
        "conflicting_contract",
        `${kind}.${item.id} conflicts with another contract using the same id`,
        `${kind}.${item.id}`,
      );
    }
  }

  return Object.freeze(output) as readonly T[];
}

export function makeCatalog<T extends { readonly id: string }>(items: readonly T[]): Readonly<Record<string, T>> {
  const catalog: Record<string, T> = {};

  for (const item of items) {
    catalog[item.id] = item;
  }

  return freezeDeep(catalog) as Readonly<Record<string, T>>;
}

export function assertReferencedIds(
  ids: readonly string[],
  catalog: Readonly<Record<string, unknown>>,
  path: string,
): void {
  for (const id of ids) {
    if (!(id in catalog)) {
      throw frameworkError("missing_reference", `${path} references unknown id "${id}"`, path);
    }
  }
}
