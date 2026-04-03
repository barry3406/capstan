import * as p from "@clack/prompts";
import { deployOptions, templateOptions, type DeployTarget, type Template } from "./options.js";

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

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
  options: readonly (string | SelectOption)[],
): Promise<string> {
  const result = await p.select({
    message: question,
    options: options.map((option) => typeof option === "string"
      ? { value: option, label: option }
      : option),
  });

  if (p.isCancel(result)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return result;
}

export async function confirmPrompt(message: string): Promise<boolean> {
  const result = await p.confirm({ message, initialValue: true });

  if (p.isCancel(result)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return result;
}

export async function runPrompts(): Promise<{
  projectName: string;
  template: Template;
  deploy: DeployTarget;
}> {
  p.note(
    [
      "Capstan scaffolds a real app shell, a health route, deployment scripts, and an AGENTS.md guide for coding agents.",
      "Pick a template, choose whether you want deploy files now, and you can start shipping immediately.",
    ].join("\n"),
    "What you'll get",
  );

  const projectName = await prompt("What should we call your app?", "my-capstan-app");

  const template = await select("What kind of starting point do you want?", templateOptions);
  const deploy = await select("Do you want deployment files from day one?", deployOptions);

  return {
    projectName,
    template: template as Template,
    deploy: deploy as DeployTarget,
  };
}
