import type { CapabilityExecutionResult } from "../types.js";

export async function configureIntegrationConnection(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { connectionId, provider, config } = input;

  if (!connectionId) {
    return {
      capability: "configureIntegrationConnection",
      status: "failed",
      input,
      note: "Missing required field: connectionId",
    };
  }

  const validProviders = ["salesforce", "hubspot", "stripe", "quickbooks", "netsuite", "slack", "zendesk"];
  if (!provider || !validProviders.includes(provider as string)) {
    return {
      capability: "configureIntegrationConnection",
      status: "failed",
      input,
      note: `Invalid or missing provider. Must be one of: ${validProviders.join(", ")}`,
    };
  }

  return {
    capability: "configureIntegrationConnection",
    status: "completed",
    input,
    output: {
      connectionId,
      provider,
      config: config ?? {},
      connectionStatus: "configured",
      configuredAt: new Date().toISOString(),
    },
  };
}
