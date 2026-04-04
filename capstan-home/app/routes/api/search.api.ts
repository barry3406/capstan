import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { DOC_PAGES } from "../../data/docs-index.js";

export const GET = defineAPI({
  input: z.object({
    q: z.string().min(1).describe("Search query string"),
    topic: z.string().optional().describe("Filter by topic: routing, database, auth, deployment, api, testing, ai, policy"),
    limit: z.coerce.number().int().min(1).max(50).optional().describe("Max results to return (default 10)"),
  }),
  output: z.object({
    query: z.string(),
    results: z.array(z.object({
      title: z.string(),
      section: z.string(),
      url: z.string(),
      snippet: z.string(),
      score: z.number(),
      topics: z.array(z.string()),
    })),
    total: z.number(),
  }),
  description: "Search the Capstan documentation. Returns matching doc sections ranked by relevance. Use this to find information about Capstan APIs, configuration, patterns, and best practices. Available via HTTP and MCP.",
  capability: "read",
  resource: "documentation",
  async handler({ input }) {
    const query = input.q.toLowerCase();
    const limit = input.limit ?? 10;
    const terms = query.split(/\s+/).filter(Boolean);

    let pages = DOC_PAGES;
    if (input.topic) {
      pages = pages.filter(p => p.topics.includes(input.topic!));
    }

    const scored = pages.map((page) => {
      const searchable = `${page.title} ${page.section} ${page.content} ${page.keywords.join(" ")}`.toLowerCase();
      let score = 0;

      for (const term of terms) {
        if (page.title.toLowerCase().includes(term)) score += 10;
        if (page.keywords.some(k => k.toLowerCase().includes(term))) score += 5;
        const contentMatches = (searchable.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        score += contentMatches;
      }

      let snippet = page.content;
      for (const term of terms) {
        const idx = page.content.toLowerCase().indexOf(term);
        if (idx !== -1) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(page.content.length, idx + term.length + 120);
          snippet = (start > 0 ? "..." : "") + page.content.slice(start, end) + (end < page.content.length ? "..." : "");
          break;
        }
      }

      return { title: page.title, section: page.section, url: page.url, snippet, score, topics: page.topics };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      query: input.q,
      results: scored,
      total: scored.length,
    };
  },
});
