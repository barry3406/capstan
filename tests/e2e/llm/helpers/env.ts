import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { openaiProvider, anthropicProvider } from "../../../../packages/agent/src/llm.js";
import type { LLMProvider } from "../../../../packages/agent/src/llm.js";

export interface LLMTestConfig {
  provider: LLMProvider;
  name: string;
}

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

function buildProvider(type: string, apiKey: string, baseUrl?: string, model?: string): LLMProvider | null {
  if (type === "openai") return openaiProvider({ apiKey, baseUrl, model });
  if (type === "anthropic") return anthropicProvider({ apiKey, baseUrl, model });
  return null;
}

function loadTestProviders(): LLMTestConfig[] {
  const envPath = join(process.cwd(), ".env.test");
  if (!existsSync(envPath)) return [];

  const env = parseEnvFile(envPath);
  const providers: LLMTestConfig[] = [];

  // Primary
  const p = buildProvider(env.LLM_PROVIDER ?? "", env.LLM_API_KEY ?? "", env.LLM_BASE_URL, env.LLM_MODEL);
  if (p) providers.push({ provider: p, name: `${env.LLM_PROVIDER}${env.LLM_MODEL ? ` (${env.LLM_MODEL})` : ""}` });

  // Secondary (optional)
  const s = buildProvider(env.LLM_SECONDARY_PROVIDER ?? "", env.LLM_SECONDARY_API_KEY ?? "", env.LLM_SECONDARY_BASE_URL, env.LLM_SECONDARY_MODEL);
  if (s) providers.push({ provider: s, name: `${env.LLM_SECONDARY_PROVIDER}${env.LLM_SECONDARY_MODEL ? ` (${env.LLM_SECONDARY_MODEL})` : ""}` });

  return providers;
}

export const testProviders = loadTestProviders();
export const hasProviders = testProviders.length > 0;

/**
 * Wrapper that runs a describe block once per configured LLM provider.
 * If no .env.test is found, the entire block is skipped.
 */
export function describeWithLLM(
  name: string,
  fn: (provider: LLMProvider, providerName: string) => void,
): void {
  if (!hasProviders) {
    describe.skip(`[LLM] ${name} — no .env.test`, () => {
      it("skipped", () => {});
    });
    return;
  }
  for (const { provider, name: pName } of testProviders) {
    describe(`[LLM:${pName}] ${name}`, () => {
      fn(provider, pName);
    });
  }
}
