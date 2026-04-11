import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "capstan-docs",
    title: "Capstan Documentation",
    description: "Official documentation for Capstan \u2014 the AI Agent Native full-stack framework. Query docs via MCP for AI-assisted development.",
  },
  agent: {
    manifest: true,
    mcp: true,
    openapi: true,
  },
});
