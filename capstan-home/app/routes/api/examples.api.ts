import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { CODE_EXAMPLES } from "../../data/docs-index.js";

export const GET = defineAPI({
  input: z.object({
    topic: z.string().describe("Topic to find examples for (e.g. 'defineAPI', 'defineModel', 'authentication', 'routing', 'deployment', 'policy', 'ai-toolkit', 'database', 'loader', 'middleware')"),
    limit: z.coerce.number().int().min(1).max(20).optional().describe("Max examples to return (default 5)"),
  }),
  output: z.object({
    topic: z.string(),
    examples: z.array(z.object({
      title: z.string(),
      description: z.string(),
      code: z.string(),
      language: z.string(),
      relatedDocs: z.string(),
    })),
    total: z.number(),
  }),
  description: "Get code examples for Capstan framework topics. Returns working code snippets with descriptions. Use this when you need concrete examples of how to use Capstan APIs.",
  capability: "read",
  resource: "documentation",
  async handler({ input }) {
    const limit = input.limit ?? 5;
    const topicLower = input.topic.toLowerCase();

    const matched = CODE_EXAMPLES
      .filter(ex =>
        ex.topics.some(t => t.toLowerCase().includes(topicLower)) ||
        ex.title.toLowerCase().includes(topicLower) ||
        ex.description.toLowerCase().includes(topicLower)
      )
      .slice(0, limit);

    return {
      topic: input.topic,
      examples: matched.map(ex => ({
        title: ex.title,
        description: ex.description,
        code: ex.code,
        language: ex.language,
        relatedDocs: ex.relatedDocs,
      })),
      total: matched.length,
    };
  },
});
