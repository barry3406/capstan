import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function prompt(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const rl = createInterface({ input, output });
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  try {
    const answer = await rl.question(`  ${question}${suffix}: `);
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}

export async function select(
  question: string,
  options: string[],
): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    console.log(`  ${question}`);
    for (let i = 0; i < options.length; i++) {
      console.log(`    ${i + 1}) ${options[i]}`);
    }
    const answer = await rl.question("  Choose a number: ");
    const index = parseInt(answer.trim(), 10) - 1;
    if (index >= 0 && index < options.length) {
      return options[index]!;
    }
    // Default to first option on invalid input
    return options[0]!;
  } finally {
    rl.close();
  }
}

export async function runPrompts(): Promise<{
  projectName: string;
  template: "blank" | "tickets";
}> {
  const projectName = await prompt("Project name", "my-capstan-app");

  const templateOptions = ["blank", "tickets"];
  const template = await select("Which template?", templateOptions);

  return {
    projectName,
    template: template as "blank" | "tickets",
  };
}
