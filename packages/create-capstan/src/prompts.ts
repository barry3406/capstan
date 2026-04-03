import * as p from "@clack/prompts";

export async function prompt(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const opts: Parameters<typeof p.text>[0] = { message: question };
  if (defaultValue !== undefined) {
    opts.placeholder = defaultValue;
    opts.defaultValue = defaultValue;
  }
  const result = await p.text(opts);

  if (p.isCancel(result)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return result || defaultValue || "";
}

export async function select(
  question: string,
  options: string[],
): Promise<string> {
  const result = await p.select({
    message: question,
    options: options.map((o) => ({ value: o, label: o })),
  });

  if (p.isCancel(result)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return result;
}

export async function confirmPrompt(message: string): Promise<boolean> {
  const result = await p.confirm({ message });

  if (p.isCancel(result)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return result;
}

export async function runPrompts(): Promise<{
  projectName: string;
  template: "blank" | "tickets";
  deploy: "none" | "docker" | "vercel-node" | "vercel-edge" | "cloudflare" | "fly";
}> {
  const projectName = await prompt("Project name", "my-capstan-app");

  const template = await select("Which template?", ["blank", "tickets"]);
  const deploy = await select("Deployment target?", [
    "none",
    "docker",
    "vercel-node",
    "vercel-edge",
    "cloudflare",
    "fly",
  ]);

  return {
    projectName,
    template: template as "blank" | "tickets",
    deploy: deploy as "none" | "docker" | "vercel-node" | "vercel-edge" | "cloudflare" | "fly",
  };
}
