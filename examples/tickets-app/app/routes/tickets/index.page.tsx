import { createElement } from "react";

/**
 * Sample ticket data matching the API response shape.
 * In a real app this would be fetched via a loader or client-side call.
 */
const sampleTickets = [
  {
    id: "tkt_001",
    title: "Login page returns 500 on invalid email format",
    status: "open",
    priority: "high",
    assignee: "Alice Chen",
    createdAt: "2026-03-25T09:14:00Z",
  },
  {
    id: "tkt_002",
    title: "Add dark mode toggle to settings page",
    status: "in_progress",
    priority: "medium",
    assignee: "Bob Martinez",
    createdAt: "2026-03-24T14:30:00Z",
  },
  {
    id: "tkt_003",
    title: "Update onboarding copy for enterprise plan",
    status: "open",
    priority: "low",
    assignee: null,
    createdAt: "2026-03-23T11:00:00Z",
  },
  {
    id: "tkt_004",
    title: "CSV export times out for large datasets",
    status: "open",
    priority: "high",
    assignee: "Alice Chen",
    createdAt: "2026-03-22T16:45:00Z",
  },
  {
    id: "tkt_005",
    title: "Migrate user avatars to CDN",
    status: "closed",
    priority: "medium",
    assignee: "Carol Wu",
    createdAt: "2026-03-20T10:00:00Z",
  },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TicketsPage() {
  const openCount = sampleTickets.filter((t) => t.status === "open").length;
  const inProgressCount = sampleTickets.filter((t) => t.status === "in_progress").length;
  const closedCount = sampleTickets.filter((t) => t.status === "closed").length;

  return createElement("div", null,
    createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" } },
      createElement("h1", null, "Tickets"),
      createElement("div", { style: { display: "flex", gap: "0.75rem" } },
        createElement("span", { className: "status status-open" }, `${openCount} Open`),
        createElement("span", { className: "status status-in_progress" }, `${inProgressCount} In Progress`),
        createElement("span", { className: "status status-closed" }, `${closedCount} Closed`)
      )
    ),

    createElement("div", { className: "card", style: { padding: 0, overflow: "hidden" } },
      createElement("table", null,
        createElement("thead", null,
          createElement("tr", null,
            createElement("th", null, "ID"),
            createElement("th", null, "Title"),
            createElement("th", null, "Status"),
            createElement("th", null, "Priority"),
            createElement("th", null, "Assignee"),
            createElement("th", null, "Created")
          )
        ),
        createElement("tbody", null,
          ...sampleTickets.map((ticket) =>
            createElement("tr", { key: ticket.id },
              createElement("td", null, createElement("code", null, ticket.id)),
              createElement("td", null, ticket.title),
              createElement("td", null,
                createElement("span", {
                  className: `status status-${ticket.status}`,
                }, ticket.status.replace("_", " "))
              ),
              createElement("td", null,
                createElement("span", {
                  className: `priority priority-${ticket.priority}`,
                }, ticket.priority)
              ),
              createElement("td", { className: ticket.assignee ? "" : "muted" },
                ticket.assignee ?? "Unassigned"
              ),
              createElement("td", { className: "muted" }, formatDate(ticket.createdAt))
            )
          )
        )
      )
    ),

    createElement("div", { className: "card", style: { marginTop: "1.5rem" } },
      createElement("h2", { style: { fontSize: "1rem" } }, "Try the API"),
      createElement("p", { style: { marginBottom: "0.75rem" }, className: "muted" },
        "These endpoints are available for both human clients and AI agents:"
      ),
      createElement("pre", { style: { background: "#1a1a2e", color: "#e2e8f0", padding: "1rem", borderRadius: "6px", overflow: "auto", fontSize: "0.85rem", lineHeight: "1.6" } },
        "# List all tickets\n" +
        "curl http://localhost:3000/tickets\n\n" +
        "# Filter by status\n" +
        "curl http://localhost:3000/tickets?status=open\n\n" +
        "# Get a single ticket\n" +
        "curl http://localhost:3000/tickets/tkt_001\n\n" +
        "# Create a ticket (requires API key)\n" +
        "curl -X POST http://localhost:3000/tickets \\\n" +
        "  -H \"Authorization: Bearer sk_test_demo\" \\\n" +
        "  -H \"Content-Type: application/json\" \\\n" +
        "  -d '{\"title\": \"New bug report\", \"priority\": \"high\"}'"
      )
    )
  );
}
