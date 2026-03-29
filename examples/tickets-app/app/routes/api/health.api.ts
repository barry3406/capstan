import { z } from "zod";
import { defineAPI } from "@capstan/core";

// ---------------------------------------------------------------------------
// GET /api/health — Application health check
// ---------------------------------------------------------------------------

const HealthOutput = z.object({
  status: z.literal("ok"),
  app: z.string(),
  version: z.string(),
  uptime: z.number(),
  timestamp: z.string(),
});

export const GET = defineAPI({
  description: "Health check endpoint. Returns application status, version, and uptime.",
  capability: "read",
  resource: "system",
  output: HealthOutput,
  async handler() {
    return {
      status: "ok" as const,
      app: "tickets-app",
      version: "0.1.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  },
});
