import type { AgentConfig, RouteRegistryEntry } from "./types.js";

/**
 * HTTP methods where the request body carries the input payload.
 */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Convert a Capstan route path (Express/Hono-style) to an OpenAPI path.
 *
 *   /tickets/:id  ->  /tickets/{id}
 */
function toOpenApiPath(path: string): string {
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
}

/**
 * Extract path parameter names from a route path.
 *
 *   /tickets/:id  ->  ["id"]
 *   /orgs/:orgId/members/:memberId  ->  ["orgId", "memberId"]
 */
function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    params.push(match[1]!);
  }
  return params;
}

/**
 * Build OpenAPI parameter objects for path parameters.
 */
function buildPathParameters(
  pathParams: string[],
): Array<Record<string, unknown>> {
  return pathParams.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

/**
 * Build OpenAPI query parameter objects from a JSON Schema input definition.
 *
 * For GET and DELETE requests, input properties are sent as query parameters.
 */
function buildQueryParameters(
  inputSchema: Record<string, unknown> | undefined,
  pathParams: string[],
): Array<Record<string, unknown>> {
  if (!inputSchema) return [];

  const properties = (inputSchema["properties"] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set(
    (inputSchema["required"] as string[] | undefined) ?? [],
  );
  const pathParamSet = new Set(pathParams);

  return Object.entries(properties)
    .filter(([name]) => !pathParamSet.has(name))
    .map(([name, schema]) => ({
      name,
      in: "query",
      required: required.has(name),
      schema,
    }));
}

/**
 * Build an OpenAPI operation object for a single route.
 */
function buildOperation(
  route: RouteRegistryEntry,
  pathParams: string[],
): Record<string, unknown> {
  const upperMethod = route.method.toUpperCase();
  const operation: Record<string, unknown> = {};

  // Operation ID derived from method + path (including param markers for uniqueness)
  const allSegments = route.path.split("/").filter((s) => s.length > 0);
  const idParts: string[] = [];
  for (const seg of allSegments) {
    if (seg.startsWith(":")) {
      idParts.push("By" + seg[1]!.toUpperCase() + seg.slice(2));
    } else if (seg.startsWith("{") && seg.endsWith("}")) {
      const name = seg.slice(1, -1);
      idParts.push("By" + name[0]!.toUpperCase() + name.slice(1));
    } else {
      idParts.push(seg[0]!.toUpperCase() + seg.slice(1));
    }
  }
  operation["operationId"] = upperMethod.toLowerCase() + idParts.join("");

  if (route.description) {
    operation["summary"] = route.description;
  }

  // Tags: use the resource name if available, otherwise derive from first path segment
  const staticSegments = allSegments.filter(
    (s) => !s.startsWith(":") && !s.startsWith("{"),
  );
  if (route.resource) {
    operation["tags"] = [route.resource];
  } else if (staticSegments.length > 0) {
    operation["tags"] = [staticSegments[0]!];
  }

  // Parameters: path params + query params for non-body methods
  const parameters: Array<Record<string, unknown>> = [
    ...buildPathParameters(pathParams),
  ];

  if (!BODY_METHODS.has(upperMethod)) {
    parameters.push(...buildQueryParameters(route.inputSchema, pathParams));
  }

  if (parameters.length > 0) {
    operation["parameters"] = parameters;
  }

  // Request body for POST/PUT/PATCH
  if (BODY_METHODS.has(upperMethod) && route.inputSchema) {
    operation["requestBody"] = {
      required: true,
      content: {
        "application/json": {
          schema: route.inputSchema,
        },
      },
    };
  }

  // Responses
  const responses: Record<string, unknown> = {};

  if (route.outputSchema) {
    responses["200"] = {
      description: "Successful response",
      content: {
        "application/json": {
          schema: route.outputSchema,
        },
      },
    };
  } else {
    responses["200"] = {
      description: "Successful response",
    };
  }

  responses["401"] = {
    description: "Unauthorized — missing or invalid authentication",
  };

  if (route.policy) {
    responses["403"] = {
      description: `Forbidden — policy "${route.policy}" denied access`,
    };
  }

  operation["responses"] = responses;

  // Security requirement
  operation["security"] = [{ bearerAuth: [] }];

  return operation;
}

/**
 * Generate an OpenAPI 3.1.0 specification from the agent configuration and
 * registered routes.
 *
 * The returned object is a plain JSON-serializable OpenAPI document.
 */
export function generateOpenApiSpec(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
): Record<string, unknown> {
  // Build paths
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    const pathParams = extractPathParams(route.path);

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    paths[openApiPath]![method] = buildOperation(route, pathParams);
  }

  // Build component schemas from resources
  const schemas: Record<string, unknown> = {};
  if (config.resources) {
    for (const resource of config.resources) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [fieldName, fieldDef] of Object.entries(resource.fields)) {
        const prop: Record<string, unknown> = { type: fieldDef.type };
        if (fieldDef.enum) {
          prop["enum"] = fieldDef.enum;
        }
        properties[fieldName] = prop;
        if (fieldDef.required) {
          required.push(fieldName);
        }
      }

      const schema: Record<string, unknown> = {
        type: "object",
        properties,
      };
      if (required.length > 0) {
        schema["required"] = required;
      }
      if (resource.description) {
        schema["description"] = resource.description;
      }

      schemas[resource.key] = schema;
    }
  }

  // Assemble the spec
  const spec: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: config.name,
      ...(config.description !== undefined
        ? { description: config.description }
        : {}),
      version: "0.1.0",
    },
    ...(config.baseUrl !== undefined
      ? { servers: [{ url: config.baseUrl }] }
      : {}),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Bearer token for authenticating API requests",
        },
      },
      ...(Object.keys(schemas).length > 0 ? { schemas } : {}),
    },
  };

  return spec;
}
