/**
 * MCP Client — connect to external MCP servers and consume their tools.
 *
 * Uses the official `@modelcontextprotocol/sdk` Client and
 * StreamableHTTPClientTransport for spec-compliant communication.
 * Falls back to a raw JSON-RPC 2.0 implementation when the SDK
 * transport encounters issues (e.g. the remote server does not
 * support Streamable HTTP).
 */

// SDK imports are dynamic to avoid resolution failures when subpath
// exports are not declared in the package.json exports map.
import { withSpan } from "./telemetry.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options for connecting to a remote MCP server. */
export interface McpClientOptions {
  /** MCP server URL (Streamable HTTP endpoint). */
  url: string;
  /** Optional authorization header value (e.g. "Bearer <token>"). */
  authorization?: string;
  /** Client name for identification during the MCP handshake. */
  clientName?: string;
}

/** A tool exposed by a remote MCP server. */
export interface McpTool {
  name: string;
  description?: string | undefined;
  inputSchema?: Record<string, unknown> | undefined;
}

/** A connected MCP client that can list and invoke remote tools. */
export interface McpClient {
  /** List available tools on the remote server. */
  listTools(): Promise<McpTool[]>;
  /** Call a tool by name with optional arguments. */
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Close the connection. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// SDK-backed implementation
// ---------------------------------------------------------------------------

class SdkMcpClient implements McpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private transport: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(client: any, transport: any) {
    this.client = client;
    this.transport = transport;
  }

  async listTools(): Promise<McpTool[]> {
    return withSpan(
      "capstan.mcp_client.listTools",
      {},
      async () => {
        const result = await this.client.listTools();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return result.tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }));
      },
    );
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    return withSpan(
      `capstan.mcp_client.callTool.${name}`,
      { "capstan.mcp_client.tool": name },
      async () => {
        const result = await this.client.callTool({
          name,
          arguments: args,
        });

        // The SDK returns a union type; the standard shape has a `content`
        // array of text/image/audio/resource items.
        if ("content" in result && Array.isArray(result.content)) {
          // If there's a single text content item, unwrap it for convenience.
          if (
            result.content.length === 1 &&
            result.content[0] != null &&
            "type" in result.content[0] &&
            result.content[0].type === "text"
          ) {
            const text = (result.content[0] as { text: string }).text;
            try {
              return JSON.parse(text) as unknown;
            } catch {
              return text;
            }
          }
          return result.content;
        }

        // Compatibility result shape (`toolResult` field).
        if ("toolResult" in result) {
          return result.toolResult;
        }

        return result;
      },
    );
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

// ---------------------------------------------------------------------------
// Raw JSON-RPC 2.0 fallback implementation
// ---------------------------------------------------------------------------

class RawMcpClient implements McpClient {
  private url: string;
  private headers: Record<string, string>;
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  /** Perform the MCP initialize handshake. */
  async initialize(clientName: string): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: clientName, version: "1.0.0" },
    });

    // Send initialized notification (no response expected).
    await this.sendNotification("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    return withSpan(
      "capstan.mcp_client.listTools",
      {},
      async () => {
        const result = (await this.sendRequest("tools/list", {})) as {
          tools?: Array<{
            name: string;
            description?: string;
            inputSchema?: Record<string, unknown>;
          }>;
        };
        return (result.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
      },
    );
  }

  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    return withSpan(
      `capstan.mcp_client.callTool.${name}`,
      { "capstan.mcp_client.tool": name },
      async () => {
        const result = (await this.sendRequest("tools/call", {
          name,
          arguments: args ?? {},
        })) as {
          content?: Array<{ type: string; text?: string }>;
          toolResult?: unknown;
        };

        if (result.content && Array.isArray(result.content)) {
          if (
            result.content.length === 1 &&
            result.content[0]?.type === "text" &&
            result.content[0].text != null
          ) {
            try {
              return JSON.parse(result.content[0].text) as unknown;
            } catch {
              return result.content[0].text;
            }
          }
          return result.content;
        }

        if (result.toolResult !== undefined) {
          return result.toolResult;
        }

        return result;
      },
    );
  }

  async close(): Promise<void> {
    if (this.sessionId) {
      try {
        await fetch(this.url, {
          method: "DELETE",
          headers: {
            ...this.headers,
            "Mcp-Session-Id": this.sessionId,
          },
        });
      } catch {
        // Best-effort session termination — ignore errors.
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    const body = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params,
    };

    const reqHeaders: Record<string, string> = {
      ...this.headers,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(body),
    });

    // Capture session ID from the response.
    const newSessionId = res.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `MCP request ${method} failed: HTTP ${String(res.status)} ${text}`,
      );
    }

    const contentType = res.headers.get("content-type") ?? "";

    // The server may respond with SSE (text/event-stream) or plain JSON.
    if (contentType.includes("text/event-stream")) {
      return this.parseSseResponse(res, id);
    }

    const json = (await res.json()) as {
      id?: number;
      result?: unknown;
      error?: { code: number; message: string };
    };

    if (json.error) {
      throw new Error(
        `MCP error ${String(json.error.code)}: ${json.error.message}`,
      );
    }

    return json.result;
  }

  private async sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const body = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };

    const reqHeaders: Record<string, string> = {
      ...this.headers,
      "Content-Type": "application/json",
    };
    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    const res = await fetch(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(body),
    });

    // Capture session ID.
    const newSessionId = res.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    // Notifications may return 202 Accepted or 204 No Content — either is fine.
    if (!res.ok && res.status !== 202 && res.status !== 204) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `MCP notification ${method} failed: HTTP ${String(res.status)} ${text}`,
      );
    }
  }

  private async parseSseResponse(
    res: Response,
    expectedId: number,
  ): Promise<unknown> {
    const text = await res.text();
    // Parse SSE events and find the JSON-RPC response matching our request ID.
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6)) as {
            id?: number;
            result?: unknown;
            error?: { code: number; message: string };
          };
          if (parsed.id === expectedId) {
            if (parsed.error) {
              throw new Error(
                `MCP error ${String(parsed.error.code)}: ${parsed.error.message}`,
              );
            }
            return parsed.result;
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("MCP error")) {
            throw e;
          }
          // Skip unparseable SSE data lines.
        }
      }
    }
    throw new Error("No matching JSON-RPC response found in SSE stream");
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create an MCP client connected to a remote server.
 *
 * Attempts to connect using the official SDK `Client` +
 * `StreamableHTTPClientTransport` first. Falls back to a raw JSON-RPC 2.0
 * implementation if the SDK transport fails (e.g. unsupported server).
 *
 * @param options - Connection options (URL, auth, client name).
 * @returns A connected `McpClient` ready to list and call tools.
 */
export async function createMcpClient(
  options: McpClientOptions,
): Promise<McpClient> {
  const clientName = options.clientName ?? "capstan-mcp-client";
  const url = new URL(options.url);

  const requestInit: RequestInit = {};
  if (options.authorization) {
    requestInit.headers = {
      Authorization: options.authorization,
    };
  }

  // --- Attempt 1: SDK transport (lazy import) ---
  try {
    const clientMod = await import("@modelcontextprotocol/sdk/client/index.js");
    const transportMod = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const SdkClient = clientMod.Client;
    const SdkTransport = transportMod.StreamableHTTPClientTransport;

    const transport = new SdkTransport(url, { requestInit });
    const client = new SdkClient(
      { name: clientName, version: "1.0.0" },
      { capabilities: {} },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.connect(transport as any);
    return new SdkMcpClient(client, transport);
  } catch {
    // SDK transport failed or not available — fall back to raw JSON-RPC.
  }

  // --- Attempt 2: Raw JSON-RPC 2.0 ---
  const headers: Record<string, string> = {};
  if (options.authorization) {
    headers["Authorization"] = options.authorization;
  }

  const rawClient = new RawMcpClient(options.url, headers);
  await rawClient.initialize(clientName);
  return rawClient;
}
