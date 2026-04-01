// Vite-based build pipeline for Capstan client-side code.
// Vite is an optional peer dependency — all functions gracefully degrade
// when it is not installed.

export interface CapstanViteConfig {
  rootDir: string;
  isDev: boolean;
  clientEntry?: string;
}

export function createViteConfig(config: CapstanViteConfig): Record<string, unknown> {
  return {
    root: config.rootDir,
    mode: config.isDev ? "development" : "production",
    build: {
      outDir: "dist/client",
      manifest: true,
      rollupOptions: { input: config.clientEntry ?? "app/client.tsx" },
      sourcemap: config.isDev,
      minify: !config.isDev,
    },
    server: { middlewareMode: true },
    optimizeDeps: { include: ["react", "react-dom"] },
  };
}

export async function createViteDevMiddleware(config: CapstanViteConfig): Promise<{
  middleware: unknown;
  close: () => Promise<void>;
} | null> {
  try {
    const vite = await import("vite");
    const server = await vite.createServer({
      ...createViteConfig(config),
      server: { middlewareMode: true },
    } as any);
    return {
      middleware: server.middlewares,
      close: () => server.close(),
    };
  } catch {
    return null;
  }
}

export async function buildClient(config: CapstanViteConfig): Promise<void> {
  try {
    const vite = await import("vite");
    await vite.build(createViteConfig(config) as any);
  } catch (err) {
    if ((err as Error).message?.includes("Cannot find module")) {
      return;
    }
    throw err;
  }
}
