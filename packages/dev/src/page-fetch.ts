export type PageFetchMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface PageFetchClient {
  get<T = unknown>(path: string, params?: Record<string, string>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

export interface PageFetchOptions {
  fetchImpl?: (request: Request) => Promise<Response>;
  forwardHeaders?: readonly string[];
}

export interface PageFetchErrorDetails {
  method: PageFetchMethod;
  url: string;
  phase: "request" | "response" | "parse";
  status?: number;
  statusText?: string;
  body?: unknown;
}

const INTERNAL_FETCH_HEADER = "x-capstan-internal-fetch";
const INTERNAL_FETCH_DEPTH_HEADER = "x-capstan-internal-depth";
const CSRF_COOKIE_NAME = "__csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const MAX_INTERNAL_FETCH_DEPTH = 8;

const DEFAULT_FORWARD_HEADERS = [
  "authorization",
  "cookie",
  "origin",
  "referer",
  "x-request-id",
  "x-api-key",
  "x-client-cert",
  "x-csrf-token",
  "x-forwarded-client-cert",
  "x-spiffe-id",
  "x-xsrf-token",
] as const;

function uniq(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function createForwardHeaderSet(extraHeaders?: readonly string[]): Set<string> {
  const merged = extraHeaders
    ? [...DEFAULT_FORWARD_HEADERS, ...extraHeaders]
    : [...DEFAULT_FORWARD_HEADERS];
  return new Set(uniq(merged));
}

function cloneForwardHeaders(source: Headers, allowed: Set<string>): Headers {
  const headers = new Headers();
  for (const [name, value] of source.entries()) {
    if (allowed.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }
  return headers;
}

function buildUrl(baseRequest: Request, path: string, params?: Record<string, string>): URL {
  const url = new URL(path, baseRequest.url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function getCookieValue(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;

    return pair.slice(separator + 1).trim();
  }

  return undefined;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value);
}

function serializeBody(body: unknown): { body?: BodyInit; contentType?: string } {
  if (body === undefined) {
    return {};
  }

  if (body === null) {
    return { body: "null", contentType: "application/json;charset=UTF-8" };
  }

  if (typeof body === "string") {
    return { body, contentType: "text/plain;charset=UTF-8" };
  }

  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return { body };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { body };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { body };
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { body };
  }

  if (body instanceof ArrayBuffer) {
    return { body: new Uint8Array(body) };
  }

  if (isArrayBufferView(body)) {
    const bytes = new Uint8Array(body.byteLength);
    bytes.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    return { body: bytes };
  }

  if (typeof body === "object") {
    return {
      body: JSON.stringify(body),
      contentType: "application/json;charset=UTF-8",
    };
  }

  return {
    body: String(body),
    contentType: "text/plain;charset=UTF-8",
  };
}

function summarizeBody(body: unknown): string {
  if (body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    return body.length > 240 ? `${body.slice(0, 240)}…` : body;
  }

  try {
    const json = JSON.stringify(body);
    return json.length > 240 ? `${json.slice(0, 240)}…` : json;
  } catch {
    return String(body);
  }
}

function formatRequestLabel(method: PageFetchMethod, url: string): string {
  return `${method} ${url}`;
}

export class PageFetchError extends Error {
  readonly method: PageFetchMethod;
  readonly url: string;
  readonly phase: "request" | "response" | "parse";
  readonly status?: number;
  readonly statusText?: string;
  readonly body?: unknown;

  constructor(message: string, details: PageFetchErrorDetails, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PageFetchError";
    this.method = details.method;
    this.url = details.url;
    this.phase = details.phase;
    if (details.status !== undefined) {
      this.status = details.status;
    }
    if (details.statusText !== undefined) {
      this.statusText = details.statusText;
    }
    if (details.body !== undefined) {
      this.body = details.body;
    }
  }
}

async function readResponseBody(
  response: Response,
  method: PageFetchMethod,
  url: URL,
): Promise<unknown> {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return undefined;
  }

  if (!response.body) {
    return undefined;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  if (contentType.includes("json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new PageFetchError(
        `Failed to parse JSON response from ${formatRequestLabel(method, url.toString())}`,
        {
          method,
          url: url.toString(),
          phase: "parse",
          status: response.status,
          statusText: response.statusText,
          body: text,
        },
        error,
      );
    }
  }

  return text;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    const clone = response.clone();
    const contentType = clone.headers.get("content-type")?.toLowerCase() ?? "";
    const text = await clone.text();
    if (text.length === 0) {
      return undefined;
    }
    if (contentType.includes("json")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    return text;
  } catch {
    return await response.text().catch(() => undefined);
  }
}

function buildHttpErrorMessage(details: {
  method: PageFetchMethod;
  url: string;
  status: number;
  statusText: string;
  body: unknown;
}): string {
  const statusLabel = details.statusText ? `${details.status} ${details.statusText}` : `${details.status}`;
  const bodyLabel = summarizeBody(details.body);
  return bodyLabel
    ? `Page fetch failed: ${formatRequestLabel(details.method, details.url)} -> ${statusLabel}: ${bodyLabel}`
    : `Page fetch failed: ${formatRequestLabel(details.method, details.url)} -> ${statusLabel}`;
}

async function parseResponse<T>(method: PageFetchMethod, url: URL, response: Response): Promise<T> {
  const body = await readResponseBody(response, method, url);
  if (body === undefined) {
    return undefined as T;
  }

  return body as T;
}

async function buildResponseError(method: PageFetchMethod, url: URL, response: Response): Promise<PageFetchError> {
  const body = await readErrorBody(response);
  const message = buildHttpErrorMessage({
    method,
    url: url.toString(),
    status: response.status,
    statusText: response.statusText,
    body,
  });

  return new PageFetchError(
    message,
    {
      method,
      url: url.toString(),
      phase: "response",
      status: response.status,
      statusText: response.statusText,
      body,
    },
  );
}

async function executePageFetch<T>(
  baseRequest: Request,
  fetchImpl: (request: Request) => Promise<Response>,
  forwardHeaders: Set<string>,
  method: PageFetchMethod,
  path: string,
  paramsOrBody?: Record<string, string> | unknown,
  bodyMode = false,
): Promise<T> {
  const url = buildUrl(baseRequest, path, bodyMode ? undefined : (paramsOrBody as Record<string, string> | undefined));
  const headers = cloneForwardHeaders(baseRequest.headers, forwardHeaders);
  const bodyConfig = bodyMode ? serializeBody(paramsOrBody) : {};
  const currentDepth = Number.parseInt(
    baseRequest.headers.get(INTERNAL_FETCH_DEPTH_HEADER) ?? "0",
    10,
  );

  if (!Number.isFinite(currentDepth) || currentDepth >= MAX_INTERNAL_FETCH_DEPTH) {
    throw new PageFetchError(
      `Page fetch recursion limit reached: ${formatRequestLabel(method, url.toString())}`,
      {
        method,
        url: url.toString(),
        phase: "request",
      },
    );
  }

  if (bodyConfig.contentType && !headers.has("content-type")) {
    headers.set("content-type", bodyConfig.contentType);
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (
    (method === "POST" || method === "PUT" || method === "DELETE") &&
    !headers.has(CSRF_HEADER_NAME)
  ) {
    const csrfCookie = getCookieValue(headers.get("cookie"), CSRF_COOKIE_NAME);
    if (csrfCookie) {
      headers.set(CSRF_HEADER_NAME, csrfCookie);
    }
  }
  headers.set(INTERNAL_FETCH_HEADER, "1");
  headers.set(INTERNAL_FETCH_DEPTH_HEADER, String(currentDepth + 1));

  const requestInit: RequestInit = {
    method,
    headers,
  };

  if (bodyConfig.body !== undefined) {
    requestInit.body = bodyConfig.body;
  }

  let response: Response;
  try {
    response = await fetchImpl(new Request(url, requestInit));
  } catch (error) {
    throw new PageFetchError(
      `Page fetch failed: ${formatRequestLabel(method, url.toString())}`,
      {
        method,
        url: url.toString(),
        phase: "request",
      },
      error,
    );
  }

  if (!response.ok) {
    throw await buildResponseError(method, url, response);
  }

  return parseResponse<T>(method, url, response);
}

export function createPageFetch(
  request: Request,
  options: PageFetchOptions = {},
): PageFetchClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new Error("createPageFetch requires a fetch implementation");
  }

  const forwardHeaders = createForwardHeaderSet(options.forwardHeaders);

  return {
    get<T>(path: string, params?: Record<string, string>): Promise<T> {
      return executePageFetch<T>(request, fetchImpl, forwardHeaders, "GET", path, params, false);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return executePageFetch<T>(request, fetchImpl, forwardHeaders, "POST", path, body, true);
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return executePageFetch<T>(request, fetchImpl, forwardHeaders, "PUT", path, body, true);
    },
    delete<T>(path: string): Promise<T> {
      return executePageFetch<T>(request, fetchImpl, forwardHeaders, "DELETE", path, undefined, true);
    },
  };
}
