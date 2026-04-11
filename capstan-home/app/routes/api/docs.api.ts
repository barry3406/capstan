import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { DOC_PAGES, DOC_SECTIONS } from "../../data/docs-index.js";

export const GET = defineAPI({
  input: z.object({
    slug: z.string().optional().describe("Document slug (e.g. 'getting-started', 'core-concepts', 'database'). Omit to list all documents."),
    section: z.string().optional().describe("Section heading within a document (e.g. 'defineAPI', 'File-Based Routing'). Requires slug."),
  }),
  output: z.object({
    documents: z.array(z.object({
      slug: z.string(),
      title: z.string(),
      section: z.string(),
      url: z.string(),
      topics: z.array(z.string()),
      content: z.string(),
    })),
    total: z.number(),
  }),
  description: "Query Capstan documentation. Without parameters, lists all available documents with summaries. With slug, returns the full content of a specific document. With slug+section, returns a specific section. Use this as the primary tool for looking up Capstan framework APIs, patterns, and configuration.",
  capability: "read",
  resource: "documentation",
  async handler({ input }) {
    // List all documents
    if (!input.slug) {
      const docs = DOC_SECTIONS.map(s => ({
        slug: s.slug,
        title: s.title,
        section: s.category,
        url: s.url,
        topics: s.topics,
        content: s.summary,
      }));
      return { documents: docs, total: docs.length };
    }

    // Get specific document
    const docSections = DOC_PAGES.filter(p => p.slug === input.slug);
    if (docSections.length === 0) {
      return { documents: [], total: 0 };
    }

    // Filter by section if specified
    if (input.section) {
      const sectionLower = input.section.toLowerCase();
      const matched = docSections.filter(p =>
        p.title.toLowerCase().includes(sectionLower) ||
        p.keywords.some(k => k.toLowerCase().includes(sectionLower))
      );
      if (matched.length > 0) {
        return {
          documents: matched.map(m => ({
            slug: m.slug,
            title: m.title,
            section: m.section,
            url: m.url,
            topics: m.topics,
            content: m.content,
          })),
          total: matched.length,
        };
      }
    }

    // Return all sections of the document
    return {
      documents: docSections.map(m => ({
        slug: m.slug,
        title: m.title,
        section: m.section,
        url: m.url,
        topics: m.topics,
        content: m.content,
      })),
      total: docSections.length,
    };
  },
});
