import type { AgentTool } from "../../types.js";
import type {
  BrowserSandbox,
  FsSandbox,
  HarnessArtifactInput,
  HarnessArtifactRecord,
} from "../types.js";

export function buildHarnessTools(
  browser: BrowserSandbox | null,
  fs: FsSandbox | null,
  writeArtifact: (input: HarnessArtifactInput) => Promise<HarnessArtifactRecord>,
): AgentTool[] {
  const tools: AgentTool[] = [];

  if (browser) {
    tools.push(
      {
        name: "browser_navigate",
        description: "Navigate the browser to a URL",
        parameters: { url: { type: "string", description: "URL to navigate to" } },
        async execute(args) {
          await browser.session.goto(args["url"] as string);
          return { url: browser.session.url() };
        },
      },
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current page and persist it as an artifact",
        async execute() {
          const image = await browser.session.screenshot();
          const artifact = await writeArtifact({
            kind: "screenshot",
            content: image,
            extension: ".png",
            mimeType: "image/png",
            metadata: { url: browser.session.url() },
          });
          return {
            artifactId: artifact.id,
            path: artifact.path,
            url: browser.session.url(),
            mimeType: artifact.mimeType,
            size: artifact.size,
          };
        },
      },
      {
        name: "browser_click",
        description: "Click at specific coordinates on the page",
        parameters: {
          x: { type: "number", description: "X coordinate" },
          y: { type: "number", description: "Y coordinate" },
        },
        async execute(args) {
          await browser.session.click(args["x"] as number, args["y"] as number);
          return { clicked: true };
        },
      },
      {
        name: "browser_type",
        description: "Type text into an input element",
        parameters: {
          selector: { type: "string", description: "CSS selector" },
          text: { type: "string", description: "Text to type" },
        },
        async execute(args) {
          await browser.session.type(
            args["selector"] as string,
            args["text"] as string,
          );
          return { typed: true };
        },
      },
      {
        name: "browser_scroll",
        description: "Scroll the page up or down",
        parameters: {
          direction: { type: "string", description: "up or down" },
        },
        async execute(args) {
          await browser.session.scroll(
            (args["direction"] as "up" | "down") ?? "down",
          );
          return { scrolled: true };
        },
      },
      {
        name: "browser_act",
        description:
          "High-level browser automation: takes a goal and autonomously navigates, clicks, types, and scrolls using vision to achieve it",
        parameters: {
          goal: { type: "string", description: "What to accomplish in the browser" },
          maxSteps: { type: "number", description: "Max steps (default 15)" },
        },
        async execute(args) {
          const actions = await browser.act(
            args["goal"] as string,
            args["maxSteps"] as number | undefined,
          );
          return { actions, finalUrl: browser.session.url() };
        },
      },
    );
  }

  if (fs) {
    tools.push(
      {
        name: "fs_read",
        description: "Read a file from the sandbox filesystem",
        parameters: {
          path: { type: "string", description: "File path (relative to sandbox root)" },
        },
        async execute(args) {
          return { content: await fs.read(args["path"] as string) };
        },
      },
      {
        name: "fs_write",
        description: "Write content to a file in the sandbox filesystem",
        parameters: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "File content" },
        },
        async execute(args) {
          await fs.write(args["path"] as string, args["content"] as string);
          return { written: true };
        },
      },
      {
        name: "fs_list",
        description: "List files in a directory within the sandbox",
        parameters: {
          dir: { type: "string", description: "Directory path (default: root)" },
        },
        async execute(args) {
          return {
            files: await fs.list((args["dir"] as string) ?? "."),
          };
        },
      },
      {
        name: "fs_exists",
        description: "Check if a file exists in the sandbox",
        parameters: {
          path: { type: "string", description: "File path" },
        },
        async execute(args) {
          return { exists: await fs.exists(args["path"] as string) };
        },
      },
      {
        name: "fs_delete",
        description: "Delete a file from the sandbox filesystem",
        parameters: {
          path: { type: "string", description: "File path" },
        },
        async execute(args) {
          await fs.delete(args["path"] as string);
          return { deleted: true };
        },
      },
    );
  }

  return tools;
}
