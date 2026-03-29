export { generateAgentManifest } from "./manifest.js";
export {
  createMcpServer,
  serveMcpStdio,
  routeToToolName,
  inputSchemaToZodShape,
} from "./mcp.js";
export { generateOpenApiSpec } from "./openapi.js";
export {
  generateA2AAgentCard,
  createA2AHandler,
  formatSseEvent,
} from "./a2a.js";
export type { A2AAgentCard, A2ATask, A2AStreamEvent } from "./a2a.js";
export { CapabilityRegistry } from "./registry.js";
export type { AgentManifest, RouteRegistryEntry, AgentConfig } from "./types.js";
