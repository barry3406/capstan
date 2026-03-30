/**
 * Vercel serverless adapter for Capstan.
 * Converts the Hono app.fetch() to a Vercel serverless function.
 */
export function createVercelAdapter() {
  return {
    handler: (app: { fetch: (req: Request) => Promise<Response> }) => {
      return async (req: Request) => app.fetch(req);
    },
  };
}
