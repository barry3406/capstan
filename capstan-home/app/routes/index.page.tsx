import { createElement } from "react";
import { useLoaderData } from "@zauso-ai/capstan-react";
import { t, locales, localeNames } from "../i18n/index.js";
import type { Locale } from "../i18n/index.js";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const param = url.searchParams.get("lang");
  const locale = (param && locales.includes(param as Locale)) ? param : "en";
  return { locale };
}

export default function HomePage() {
  const { locale: rawLocale } = useLoaderData<typeof loader>();
  const locale = (rawLocale as Locale) || "en";
  const l = t[locale]!;

  return createElement("div", null,

    // 1. Navbar
    createElement("header", { className: "navbar" },
      createElement("a", { href: `/?lang=${locale}`, className: "navbar-brand" },
        createElement("span", { className: "navbar-logo" }, "\u2693"),
        createElement("span", { className: "navbar-title" }, "Capstan"),
        createElement("span", { className: "navbar-badge" }, "beta")
      ),
      createElement("nav", { className: "navbar-links" },
        createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["nav.docs"]),
        createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["nav.api"]),
        createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"])
      ),
      createElement("div", { className: "lang-switcher desktop-only" },
        ...locales.map(loc => createElement("a", {
          key: loc,
          href: `?lang=${loc}`,
          className: locale === loc ? "active" : "",
        }, localeNames[loc]))
      ),
      createElement("button", { className: "mobile-menu-btn", "aria-label": "Toggle menu" },
        createElement("span", null),
        createElement("span", null),
        createElement("span", null)
      )
    ),

    // Mobile nav dropdown
    createElement("nav", { className: "mobile-nav" },
      createElement("a", { href: `/docs/getting-started?lang=${locale}` }, l["nav.docs"]),
      createElement("a", { href: `/docs/api-reference?lang=${locale}` }, l["nav.api"]),
      createElement("a", { href: "https://github.com/barry3406/capstan", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"]),
      createElement("div", { className: "lang-switcher mobile-nav-langs" },
        ...locales.map(loc => createElement("a", {
          key: loc,
          href: `?lang=${loc}`,
          className: locale === loc ? "active" : "",
        }, localeNames[loc]))
      )
    ),

    // Mobile nav script
    createElement("script", { dangerouslySetInnerHTML: { __html: `
      (function(){
        var btn = document.querySelector('.mobile-menu-btn');
        var nav = document.querySelector('.mobile-nav');
        if (!btn || !nav) return;
        btn.addEventListener('click', function() {
          nav.classList.toggle('open');
        });
        nav.addEventListener('click', function(e) {
          if (e.target.tagName === 'A') nav.classList.remove('open');
        });
      })();
    ` } }),

    // Page content
    createElement("div", { className: "page" },

      // 2. Hero
      createElement("div", { className: "hero" },
        createElement("h1", { className: "hero-title" },
          l["hero.title.line1"],
          createElement("br", null),
          createElement("code", null, l["hero.title.line2"]),
          createElement("br", null),
          l["hero.title.line3"],
          createElement("br", null),
          createElement("code", null, l["hero.title.line4"])
        ),
        createElement("p", { className: "hero-tagline" },
          l["hero.subtitle"]
        ),
        createElement("div", { className: "hero-actions" },
          createElement("div", { className: "terminal" },
            createElement("span", { className: "prompt" }, "$ "),
            "bunx create-capstan-app my-app"
          ),
          createElement("div", { className: "hero-buttons" },
            createElement("a", { href: `/docs/getting-started?lang=${locale}`, className: "btn btn-primary" }, l["btn.getStarted"]),
            createElement("a", { href: "https://github.com/barry3406/capstan", className: "btn btn-secondary", target: "_blank", rel: "noopener noreferrer" }, l["nav.github"])
          )
        )
      ),

      // 3. Callout
      createElement("div", { className: "callout callout-info" },
        createElement("p", null,
          l["callout"], " ",
          createElement("strong", null, l["callout.http"]), ", ",
          createElement("strong", null, l["callout.mcp"]), ", ",
          createElement("strong", null, l["callout.a2a"]), ", ",
          createElement("strong", null, l["callout.openapi"]), "."
        )
      ),

      // 4. Code example — unified defineAPI + createSmartAgent
      createElement("span", { className: "code-label" }, "app/routes/tickets/index.api.ts"),
      createElement("pre", null,
        createElement("code", null,
          'import { defineAPI } from "@zauso-ai/capstan-core";\n' +
          'import { z } from "zod";\n' +
          "\n" +
          "// One contract — humans use it via HTTP, agents via MCP/A2A\n" +
          "export const GET = defineAPI({\n" +
          "  input: z.object({\n" +
          '    status: z.enum(["open", "closed"]).optional(),\n' +
          "  }),\n" +
          "  output: z.object({\n" +
          "    tickets: z.array(z.object({\n" +
          "      id: z.string(),\n" +
          "      title: z.string(),\n" +
          "      status: z.string(),\n" +
          "    })),\n" +
          "  }),\n" +
          '  description: "List support tickets",\n' +
          '  capability: "read",\n' +
          '  resource: "ticket",\n' +
          "  async handler({ input }) {\n" +
          "    return { tickets: await db.tickets.list(input) };\n" +
          "  },\n" +
          "});"
        )
      ),
      createElement("span", { className: "code-label" }, "agents/triage.ts"),
      createElement("pre", null,
        createElement("code", null,
          'import { createSmartAgent } from "@zauso-ai/capstan-ai";\n' +
          'import { defineSkill } from "@zauso-ai/capstan-ai";\n' +
          "\n" +
          "// Smart agent with 12 production features\n" +
          "const agent = createSmartAgent({\n" +
          '  model: "claude-sonnet-4-20250514",\n' +
          "  tools: [listTickets, assignTicket, resolveTicket],\n" +
          "  skills: [triageSkill],\n" +
          "  maxTurns: 20,\n" +
          "  timeout: { total: 120_000, perTool: 30_000 },\n" +
          "  budget: { maxTokens: 100_000 },\n" +
          "  compression: { strategy: \"sliding-window\" },\n" +
          "});\n" +
          "\n" +
          "// Skills give agents strategic guidance\n" +
          "const triageSkill = defineSkill({\n" +
          '  name: "triage",\n' +
          '  when: "ticket needs priority assessment",\n' +
          '  strategy: "Check severity, customer tier, SLA deadline",\n' +
          "});"
        )
      ),

      // 5. Feature grid
      createElement("h2", null, l["section.whyCapstan"]),
      createElement("div", { className: "feature-grid" },
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.zeroWall.title"]),
          createElement("p", null, l["feature.zeroWall.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.smartAgent.title"]),
          createElement("p", null, l["feature.smartAgent.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.skillLayer.title"]),
          createElement("p", null, l["feature.skillLayer.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.evolution.title"]),
          createElement("p", null, l["feature.evolution.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.fullStack.title"]),
          createElement("p", null, l["feature.fullStack.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.security.title"]),
          createElement("p", null, l["feature.security.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.aiTdd.title"]),
          createElement("p", null, l["feature.aiTdd.desc"])
        ),
        createElement("div", { className: "card" },
          createElement("h3", null, l["feature.multiProtocol.title"]),
          createElement("p", null, l["feature.multiProtocol.desc"])
        )
      ),

      // 6. Comparison table — Next.js vs LangChain vs Capstan
      createElement("h2", null, l["section.comparison"]),
      createElement("table", null,
        createElement("thead", null,
          createElement("tr", null,
            createElement("th", null, l["compare.feature"]),
            createElement("th", null, "Next.js"),
            createElement("th", null, "LangChain"),
            createElement("th", null, "Capstan")
          )
        ),
        createElement("tbody", null,
          createElement("tr", null,
            createElement("td", null, l["compare.wall"]),
            createElement("td", null, "\uD83E\uDDF1"),
            createElement("td", null, "\uD83E\uDDF1"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "Multi-protocol (HTTP + MCP + A2A)"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.smartAgent"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.skillEvolution"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "React SSR"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "File-based routing"),
            createElement("td", { className: "check" }, "+"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.auth"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.database"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "AI TDD verifier"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, "OpenAPI auto-generation"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.memory"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "partial" }, "~"),
            createElement("td", { className: "check" }, "+")
          ),
          createElement("tr", null,
            createElement("td", null, l["compare.policy"]),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "cross" }, "\u2013"),
            createElement("td", { className: "check" }, "+")
          )
        )
      ),
      createElement("p", { className: "table-legend" },
        createElement("span", { className: "check" }, "+"),
        ` ${l["compare.legend.builtin"]}  `,
        createElement("span", { className: "partial" }, "~"),
        ` ${l["compare.legend.partial"]}  `,
        createElement("span", { className: "cross" }, "\u2013"),
        ` ${l["compare.legend.none"]}  `,
        "\uD83E\uDDF1",
        ` ${l["compare.legend.wall"]}  |  `,
        createElement("a", { href: `/docs/comparison?lang=${locale}` }, l["compare.fullLink"])
      ),

      // 7. Quick Start — two paths
      createElement("h2", null, l["section.quickStart"]),
      createElement("div", { className: "quickstart-grid" },
        createElement("div", { className: "quickstart-path" },
          createElement("h3", null, l["quickstart.agent.title"]),
          createElement("ol", { className: "steps" },
            createElement("li", null,
              createElement("strong", null, l["step.create"]),
              createElement("pre", null,
                createElement("code", null, "bunx create-capstan-app my-agent")
              )
            ),
            createElement("li", null,
              createElement("strong", null, l["quickstart.agent.define"]),
              createElement("pre", null,
                createElement("code", null,
                  'import { createSmartAgent } from "@zauso-ai/capstan-ai";\n\n' +
                  "const agent = createSmartAgent({\n" +
                  '  model: "claude-sonnet-4-20250514",\n' +
                  "  tools: [listTickets, assignTicket],\n" +
                  "  skills: [triageSkill],\n" +
                  "});"
                )
              )
            ),
            createElement("li", null,
              createElement("strong", null, l["quickstart.agent.run"]),
              createElement("pre", null,
                createElement("code", null, "bunx capstan dev\n# MCP server auto-available for Claude Desktop")
              )
            )
          )
        ),
        createElement("div", { className: "quickstart-path" },
          createElement("h3", null, l["quickstart.web.title"]),
          createElement("ol", { className: "steps" },
            createElement("li", null,
              createElement("strong", null, l["step.create"]),
              createElement("pre", null,
                createElement("code", null, "bunx create-capstan-app my-app")
              )
            ),
            createElement("li", null,
              createElement("strong", null, l["step.develop"]),
              createElement("pre", null,
                createElement("code", null, "cd my-app && bunx capstan dev")
              )
            ),
            createElement("li", null,
              createElement("strong", null, l["step.connect"]),
              createElement("p", null, l["step.connect.desc"]),
              createElement("pre", null,
                createElement("code", null,
                  "# Agent manifest\n" +
                  "curl http://localhost:3000/.well-known/capstan.json\n\n" +
                  "# OpenAPI spec\n" +
                  "curl http://localhost:3000/openapi.json\n\n" +
                  "# MCP server (for Claude Desktop / Cursor)\n" +
                  "bunx capstan mcp"
                )
              )
            )
          )
        )
      ),

      // 8. Smart Agent Runtime
      createElement("h2", null, l["section.smartAgentRuntime"]),
      createElement("p", null,
        createElement("code", null, "@zauso-ai/capstan-ai"),
        " ",
        l["smartAgent.desc"]
      ),
      createElement("pre", null,
        createElement("code", null,
          'import { createSmartAgent, defineSkill } from "@zauso-ai/capstan-ai";\n' +
          "\n" +
          "// Production-ready agent with 12 built-in features\n" +
          "const agent = createSmartAgent({\n" +
          '  model: "claude-sonnet-4-20250514",\n' +
          "  tools: [searchDocs, createTicket, sendEmail],\n" +
          "  skills: [customerSupport, escalation],\n" +
          "  maxTurns: 30,\n" +
          "  timeout: { total: 120_000, perTool: 30_000 },\n" +
          "  budget: { maxTokens: 200_000 },\n" +
          "  compression: { strategy: \"sliding-window\" },\n" +
          "  fallback: { model: \"claude-haiku-4\" },\n" +
          "  validation: { validateToolArgs: true },\n" +
          "  watchdog: { maxConsecutiveErrors: 3 },\n" +
          "});\n" +
          "\n" +
          "// Skills evolve from experience\n" +
          "const customerSupport = defineSkill({\n" +
          '  name: "customer-support",\n' +
          '  when: "user has a support question",\n' +
          '  strategy: "Search docs first, then check ticket history, escalate if unresolved",\n' +
          "});\n" +
          "\n" +
          "// Agent learns and improves over time\n" +
          "// Experience -> Strategy -> Skill -> Evolution"
        )
      ),

      // 9. Explore the Docs
      createElement("h2", null, l["section.explore"]),
      createElement("div", { className: "explore-grid" },
        createElement("a", { href: `/docs/getting-started?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.gettingStarted.title"]),
          createElement("p", null, l["explore.gettingStarted.desc"])
        ),
        createElement("a", { href: `/docs/core-concepts?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.coreConcepts.title"]),
          createElement("p", null, l["explore.coreConcepts.desc"])
        ),
        createElement("a", { href: `/docs/database?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.database.title"]),
          createElement("p", null, l["explore.database.desc"])
        ),
        createElement("a", { href: `/docs/api-reference?lang=${locale}`, className: "explore-card" },
          createElement("h3", null, l["explore.apiRef.title"]),
          createElement("p", null, l["explore.apiRef.desc"])
        )
      ),

      // 10. Footer
      createElement("footer", { className: "footer" },
        l["footer"]
      )
    )
  );
}
