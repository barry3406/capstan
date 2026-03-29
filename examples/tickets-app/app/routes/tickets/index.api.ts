import { z } from "zod";
import { defineAPI } from "@capstan/core";

// ---------------------------------------------------------------------------
// Sample data — in a real app this would come from the database via the model
// ---------------------------------------------------------------------------

interface TicketRecord {
  id: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "closed";
  priority: "low" | "medium" | "high";
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
}

const tickets: TicketRecord[] = [
  {
    id: "tkt_001",
    title: "Login page returns 500 on invalid email format",
    description: "When a user enters an email without an @ symbol, the server returns a 500 instead of a validation error. This affects the signup and login flows.",
    status: "open",
    priority: "high",
    assignee: "Alice Chen",
    createdAt: "2026-03-25T09:14:00Z",
    updatedAt: "2026-03-25T09:14:00Z",
  },
  {
    id: "tkt_002",
    title: "Add dark mode toggle to settings page",
    description: "Users have requested a dark mode option. The toggle should persist the preference to localStorage and respect the system preference by default.",
    status: "in_progress",
    priority: "medium",
    assignee: "Bob Martinez",
    createdAt: "2026-03-24T14:30:00Z",
    updatedAt: "2026-03-26T10:00:00Z",
  },
  {
    id: "tkt_003",
    title: "Update onboarding copy for enterprise plan",
    description: "The onboarding wizard still references the old 'Business' plan name. Needs to be updated to 'Enterprise' across all steps.",
    status: "open",
    priority: "low",
    assignee: null,
    createdAt: "2026-03-23T11:00:00Z",
    updatedAt: "2026-03-23T11:00:00Z",
  },
  {
    id: "tkt_004",
    title: "CSV export times out for large datasets",
    description: "Exporting more than 10,000 rows to CSV causes a gateway timeout. Need to implement streaming or background job processing.",
    status: "open",
    priority: "high",
    assignee: "Alice Chen",
    createdAt: "2026-03-22T16:45:00Z",
    updatedAt: "2026-03-23T08:30:00Z",
  },
  {
    id: "tkt_005",
    title: "Migrate user avatars to CDN",
    description: "User avatars are currently served from the app server. Migrating to the CDN will reduce latency and server load.",
    status: "closed",
    priority: "medium",
    assignee: "Carol Wu",
    createdAt: "2026-03-20T10:00:00Z",
    updatedAt: "2026-03-27T15:20:00Z",
  },
];

// ---------------------------------------------------------------------------
// GET /tickets — List tickets with optional status filter
// ---------------------------------------------------------------------------

const ListInput = z.object({
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const TicketSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "in_progress", "closed"]),
  priority: z.enum(["low", "medium", "high"]),
  assignee: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ListOutput = z.object({
  tickets: z.array(TicketSummary),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const GET = defineAPI({
  description: "List tickets with optional filtering by status and priority.",
  capability: "read",
  resource: "ticket",
  input: ListInput,
  output: ListOutput,
  async handler({ input }) {
    let filtered = [...tickets];

    if (input.status) {
      filtered = filtered.filter((t) => t.status === input.status);
    }
    if (input.priority) {
      filtered = filtered.filter((t) => t.priority === input.priority);
    }

    const total = filtered.length;
    const page = filtered.slice(input.offset, input.offset + input.limit);

    return {
      tickets: page.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      total,
      limit: input.limit,
      offset: input.offset,
    };
  },
});

// ---------------------------------------------------------------------------
// POST /tickets — Create a new ticket
// ---------------------------------------------------------------------------

const CreateInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(""),
  status: z.enum(["open", "in_progress", "closed"]).optional().default("open"),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  assignee: z.string().nullable().optional().default(null),
});

const CreateOutput = z.object({
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

export const POST = defineAPI({
  description: "Create a new ticket. Requires authentication. Agent callers trigger human-in-the-loop approval.",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  input: CreateInput,
  output: CreateOutput,
  async handler({ input }) {
    const now = new Date().toISOString();
    const id = `tkt_${String(tickets.length + 1).padStart(3, "0")}`;

    const newTicket: TicketRecord = {
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assignee: input.assignee,
      createdAt: now,
      updatedAt: now,
    };

    tickets.push(newTicket);

    return { ticket: newTicket };
  },
});
