import { z } from "zod";
import { defineAPI } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Sample data — mirrors the data in index.api.ts
// In a real app both files would query the same database via the Ticket model.
// ---------------------------------------------------------------------------

const tickets = [
  {
    id: "tkt_001",
    title: "Login page returns 500 on invalid email format",
    description: "When a user enters an email without an @ symbol, the server returns a 500 instead of a validation error. This affects the signup and login flows.",
    status: "open" as const,
    priority: "high" as const,
    assignee: "Alice Chen",
    createdAt: "2026-03-25T09:14:00Z",
    updatedAt: "2026-03-25T09:14:00Z",
  },
  {
    id: "tkt_002",
    title: "Add dark mode toggle to settings page",
    description: "Users have requested a dark mode option. The toggle should persist the preference to localStorage and respect the system preference by default.",
    status: "in_progress" as const,
    priority: "medium" as const,
    assignee: "Bob Martinez",
    createdAt: "2026-03-24T14:30:00Z",
    updatedAt: "2026-03-26T10:00:00Z",
  },
  {
    id: "tkt_003",
    title: "Update onboarding copy for enterprise plan",
    description: "The onboarding wizard still references the old 'Business' plan name. Needs to be updated to 'Enterprise' across all steps.",
    status: "open" as const,
    priority: "low" as const,
    assignee: null,
    createdAt: "2026-03-23T11:00:00Z",
    updatedAt: "2026-03-23T11:00:00Z",
  },
  {
    id: "tkt_004",
    title: "CSV export times out for large datasets",
    description: "Exporting more than 10,000 rows to CSV causes a gateway timeout. Need to implement streaming or background job processing.",
    status: "open" as const,
    priority: "high" as const,
    assignee: "Alice Chen",
    createdAt: "2026-03-22T16:45:00Z",
    updatedAt: "2026-03-23T08:30:00Z",
  },
  {
    id: "tkt_005",
    title: "Migrate user avatars to CDN",
    description: "User avatars are currently served from the app server. Migrating to the CDN will reduce latency and server load.",
    status: "closed" as const,
    priority: "medium" as const,
    assignee: "Carol Wu",
    createdAt: "2026-03-20T10:00:00Z",
    updatedAt: "2026-03-27T15:20:00Z",
  },
];

// ---------------------------------------------------------------------------
// GET /tickets/:id — Retrieve a single ticket
// ---------------------------------------------------------------------------

const GetInput = z.object({
  id: z.string().min(1),
});

const GetOutput = z.object({
  ticket: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum(["open", "in_progress", "closed"]),
    priority: z.enum(["low", "medium", "high"]),
    assignee: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const GET = defineAPI({
  description: "Retrieve a single ticket by its ID. Returns full ticket details including description.",
  capability: "read",
  resource: "ticket",
  input: GetInput,
  output: GetOutput,
  async handler({ input }) {
    const ticket = tickets.find((t) => t.id === input.id);

    if (!ticket) {
      throw new Error(`Ticket not found: ${input.id}`);
    }

    return { ticket };
  },
});
