import { createElement } from "react";

export default function RootLayout({ children }: { children?: React.ReactNode }) {
  return createElement("html", { lang: "en" },
    createElement("head", null,
      createElement("meta", { charSet: "utf-8" }),
      createElement("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      createElement("title", null, "Tickets — Capstan"),
      createElement("style", null, `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #1a1a1a; }
        .container { max-width: 960px; margin: 0 auto; padding: 2rem; }
        nav { background: #1a1a2e; padding: 1rem 2rem; display: flex; gap: 2rem; align-items: center; }
        nav a { color: #fff; text-decoration: none; font-weight: 500; transition: opacity 0.15s; }
        nav a:hover { opacity: 0.8; }
        nav .brand { font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em; }
        nav .links { display: flex; gap: 1.5rem; margin-left: auto; }
        nav .badge { background: #2dd4bf; color: #000; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
        h1 { margin-bottom: 1rem; }
        h2 { margin-bottom: 0.75rem; }
        p { line-height: 1.6; }
        .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e5e7eb; }
        th { font-weight: 600; font-size: 0.85rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
        .status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
        .status-open { background: #dbeafe; color: #1e40af; }
        .status-closed { background: #dcfce7; color: #166534; }
        .status-in_progress { background: #fef3c7; color: #92400e; }
        .priority { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
        .priority-high { background: #fee2e2; color: #991b1b; }
        .priority-medium { background: #fef3c7; color: #92400e; }
        .priority-low { background: #f1f5f9; color: #475569; }
        code { background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; font-family: "SF Mono", "Fira Code", monospace; }
        .muted { color: #6b7280; }
        .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; text-align: center; font-size: 0.85rem; color: #9ca3af; }
      `)
    ),
    createElement("body", null,
      createElement("nav", null,
        createElement("a", { href: "/", className: "brand" }, "Capstan Tickets"),
        createElement("span", { className: "badge" }, "AI Agent Native"),
        createElement("div", { className: "links" },
          createElement("a", { href: "/tickets" }, "Tickets"),
          createElement("a", { href: "/.well-known/capstan.json", target: "_blank" }, "Agent Manifest"),
          createElement("a", { href: "/openapi.json", target: "_blank" }, "OpenAPI"),
          createElement("a", { href: "/api/health" }, "Health")
        )
      ),
      createElement("div", { className: "container" },
        children,
        createElement("div", { className: "footer" },
          "Built with ",
          createElement("strong", null, "Capstan"),
          " — the AI Agent Native full-stack framework"
        )
      )
    )
  );
}
