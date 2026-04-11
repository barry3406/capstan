import { createElement } from "react";

export default function HomePage() {
  return createElement("div", null,
    createElement("h1", null, "Ticket Management System"),
    createElement("p", { style: { marginBottom: "2rem" }, className: "muted" },
      "Built with Capstan \u2014 the AI Agent Native full-stack framework."
    ),

    // Feature cards
    createElement("div", { className: "card" },
      createElement("h2", null, "AI Agent Endpoints"),
      createElement("p", { style: { marginBottom: "1rem" } },
        "Every API route is automatically exposed to AI agents via standard protocols:"
      ),
      createElement("ul", { style: { paddingLeft: "1.5rem", lineHeight: "2" } },
        createElement("li", null,
          createElement("code", null, "GET /.well-known/capstan.json"),
          " \u2014 Agent manifest (discover all capabilities)"
        ),
        createElement("li", null,
          createElement("code", null, "GET /openapi.json"),
          " \u2014 OpenAPI 3.1 specification"
        ),
        createElement("li", null,
          createElement("code", null, "MCP"),
          " \u2014 Model Context Protocol server for tool-use agents"
        )
      )
    ),

    createElement("div", { className: "card" },
      createElement("h2", null, "API Routes"),
      createElement("p", { style: { marginBottom: "1rem" } },
        "File-based routing with Zod-validated request and response schemas:"
      ),
      createElement("table", null,
        createElement("thead", null,
          createElement("tr", null,
            createElement("th", null, "Method"),
            createElement("th", null, "Path"),
            createElement("th", null, "Description")
          )
        ),
        createElement("tbody", null,
          createElement("tr", null,
            createElement("td", null, createElement("code", null, "GET")),
            createElement("td", null, createElement("code", null, "/tickets")),
            createElement("td", null, "List all tickets with optional status filter")
          ),
          createElement("tr", null,
            createElement("td", null, createElement("code", null, "POST")),
            createElement("td", null, createElement("code", null, "/tickets")),
            createElement("td", null, "Create a new ticket (requires auth)")
          ),
          createElement("tr", null,
            createElement("td", null, createElement("code", null, "GET")),
            createElement("td", null, createElement("code", null, "/tickets/:id")),
            createElement("td", null, "Retrieve a single ticket by ID")
          ),
          createElement("tr", null,
            createElement("td", null, createElement("code", null, "GET")),
            createElement("td", null, createElement("code", null, "/api/health")),
            createElement("td", null, "Health check endpoint")
          )
        )
      )
    ),

    createElement("div", { className: "card" },
      createElement("h2", null, "Framework Features Demonstrated"),
      createElement("ul", { style: { paddingLeft: "1.5rem", lineHeight: "2" } },
        createElement("li", null,
          createElement("strong", null, "File-based routing"),
          " \u2014 Pages and API routes live in ", createElement("code", null, "app/routes/")
        ),
        createElement("li", null,
          createElement("strong", null, "Zod validation"),
          " \u2014 Every API handler validates input/output with schemas"
        ),
        createElement("li", null,
          createElement("strong", null, "Models"),
          " \u2014 Typed data models with field definitions in ", createElement("code", null, "app/models/")
        ),
        createElement("li", null,
          createElement("strong", null, "Auth policies"),
          " \u2014 Declarative access control with ", createElement("code", null, "definePolicy()")
        ),
        createElement("li", null,
          createElement("strong", null, "Agent-native"),
          " \u2014 OpenAPI, MCP, and agent manifest generated automatically"
        ),
        createElement("li", null,
          createElement("strong", null, "React SSR"),
          " \u2014 Server-rendered pages with the layout system"
        )
      )
    )
  );
}
