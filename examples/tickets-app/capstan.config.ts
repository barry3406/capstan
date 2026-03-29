import { defineConfig, env } from "@capstan/core";

export default defineConfig({
  app: {
    name: "tickets-app",
    title: "Ticket Management System",
    description: "A full-stack ticket management app built with Capstan — AI Agent Native.",
  },
  database: {
    provider: "sqlite",
    url: "./tickets.db",
  },
  auth: {
    providers: [
      { type: "apiKey" },
    ],
    session: {
      secret: "dev-secret-change-in-production",
      maxAge: "7d",
    },
  },
  agent: {
    manifest: true,
    mcp: true,
    openapi: true,
  },
  server: {
    port: 3000,
  },
});
