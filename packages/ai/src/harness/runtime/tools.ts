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
        description:
          "Take a PNG screenshot of the current page. Returns an inline base64 image that the model sees directly on the next turn (multimodal user message), AND persists the bytes as an artifact for later download.",
        parameters: {
          inline: {
            type: "boolean",
            description: "If true (default), include the image bytes inline so the model can see it. Set false to only persist as artifact.",
          },
        },
        async execute(args) {
          const inline = args["inline"] === undefined ? true : Boolean(args["inline"]);
          const image = await browser.session.screenshot();
          const artifact = await writeArtifact({
            kind: "screenshot",
            content: image,
            extension: ".png",
            mimeType: "image/png",
            metadata: { url: browser.session.url() },
          });
          const base = {
            artifactId: artifact.id,
            path: artifact.path,
            url: browser.session.url(),
            mimeType: artifact.mimeType,
            size: artifact.size,
          };
          if (!inline) return base;
          // Surface as the engine's inline-image envelope: the loop's
          // formatToolResult detects the `image: { mediaType, base64 }` shape
          // and constructs a multimodal user message so providers like OpenAI
          // deliver the actual pixels back to the model.
          return {
            ...base,
            image: {
              mediaType: "image/png",
              base64: image.toString("base64"),
            },
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
      {
        name: "browser_snapshot",
        description:
          "Return a text snapshot of the current page: URL, title, and a flattened list of interactive elements (role, name/text, CSS selector, coordinates). Use this AFTER navigate/click so the model knows what is on screen before the next click or type. Cheaper than browser_screenshot when you do not need to see pixels.",
        parameters: {
          includeInvisible: {
            type: "boolean",
            description: "If true, include hidden/off-screen elements. Default false.",
          },
          max: {
            type: "number",
            description: "Maximum number of elements to return (default 80).",
          },
        },
        isConcurrencySafe: true,
        async execute(args) {
          const includeInvisible = Boolean(args["includeInvisible"]);
          const rawMax = Number(args["max"] ?? 80);
          const max =
            Number.isFinite(rawMax) && rawMax > 0 && rawMax <= 400 ? Math.floor(rawMax) : 80;
          const snapshot = await browser.session.evaluate<{
            url: string;
            title: string;
            elements: Array<{
              role: string;
              name: string;
              tag: string;
              selector: string;
              x: number;
              y: number;
              visible: boolean;
            }>;
          }>(
            `(() => {
              const seenSelectors = new Set();
              const uniqueSelector = (el) => {
                if (el.id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(el.id)) return '#' + el.id;
                const parts = [];
                let node = el;
                while (node && node.nodeType === 1 && parts.length < 6) {
                  const tag = node.tagName.toLowerCase();
                  let part = tag;
                  if (node.classList && node.classList.length > 0) {
                    const cls = [...node.classList].slice(0, 2).map((c) => '.' + c).join('');
                    if (cls) part += cls;
                  }
                  const parent = node.parentElement;
                  if (parent) {
                    const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
                    if (siblings.length > 1) {
                      const idx = siblings.indexOf(node) + 1;
                      part += ':nth-of-type(' + idx + ')';
                    }
                  }
                  parts.unshift(part);
                  node = parent;
                }
                let sel = parts.join(' > ');
                if (seenSelectors.has(sel)) sel += '[data-dup=' + seenSelectors.size + ']';
                seenSelectors.add(sel);
                return sel;
              };
              const INCLUDE = ${includeInvisible ? "true" : "false"};
              const MAX = ${max};
              const isVisible = (el) => {
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return false;
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
                return true;
              };
              const nodes = Array.from(
                document.querySelectorAll(
                  'a, button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=radio], [role=switch], [role=combobox], [contenteditable=true], [onclick], [tabindex]'
                )
              );
              const elements = [];
              for (const el of nodes) {
                const visible = isVisible(el);
                if (!visible && !INCLUDE) continue;
                const rect = el.getBoundingClientRect();
                const role = el.getAttribute('role') || el.tagName.toLowerCase();
                const labelAttr =
                  el.getAttribute('aria-label') ||
                  el.getAttribute('alt') ||
                  el.getAttribute('title') ||
                  el.getAttribute('placeholder') ||
                  '';
                let name = labelAttr;
                if (!name && el instanceof HTMLInputElement) {
                  name = el.value || el.name || '';
                }
                if (!name) name = (el.innerText || el.textContent || '').trim().slice(0, 80);
                elements.push({
                  role,
                  name: name.replace(/\\s+/g, ' ').trim(),
                  tag: el.tagName.toLowerCase(),
                  selector: uniqueSelector(el),
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2),
                  visible,
                });
                if (elements.length >= MAX) break;
              }
              return {
                url: location.href,
                title: document.title,
                elements,
              };
            })()`,
          );
          return snapshot;
        },
      },
      {
        name: "browser_press",
        description:
          "Press a single keyboard key (Enter, Tab, Escape, ArrowDown, etc.) on the currently focused element. Use after browser_type when the form needs a keystroke to submit.",
        parameters: {
          key: {
            type: "string",
            description: "Key name: Enter | Tab | Escape | Backspace | ArrowUp | ArrowDown | ArrowLeft | ArrowRight | a-z | etc.",
          },
          selector: {
            type: "string",
            description: "Optional CSS selector to focus before pressing. If omitted, uses current focus.",
          },
        },
        async execute(args) {
          const key = String(args["key"] ?? "");
          if (!key) return { error: "browser_press: 'key' is required" };
          const selector = typeof args["selector"] === "string" ? (args["selector"] as string) : "";
          const escapedSelector = selector.replace(/'/g, "\\'");
          const escapedKey = key.replace(/'/g, "\\'");
          await browser.session.evaluate<void>(
            `(() => {
              const k = '${escapedKey}';
              const sel = '${escapedSelector}';
              let target = sel ? document.querySelector(sel) : document.activeElement;
              if (!target) target = document.body;
              if (sel && target && typeof target.focus === 'function') target.focus();
              const opts = { key: k, code: k, bubbles: true, cancelable: true };
              target.dispatchEvent(new KeyboardEvent('keydown', opts));
              target.dispatchEvent(new KeyboardEvent('keypress', opts));
              if (k === 'Enter' && target instanceof HTMLFormElement) target.submit();
              else if (k === 'Enter') {
                const form = target.closest && target.closest('form');
                if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
              }
              target.dispatchEvent(new KeyboardEvent('keyup', opts));
            })()`,
          );
          return { pressed: key, ...(selector ? { selector } : {}) };
        },
      },
      {
        name: "browser_wait",
        description:
          "Wait for the current page to settle (navigation finish or network idle). Call before browser_snapshot after actions that trigger navigation.",
        parameters: {
          timeoutMs: {
            type: "number",
            description: "Maximum wait in milliseconds (default 8000).",
          },
        },
        async execute(args) {
          const rawTimeout = Number(args["timeoutMs"] ?? 8000);
          const timeout =
            Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout <= 60_000
              ? rawTimeout
              : 8000;
          try {
            await browser.session.waitForNavigation(timeout);
            return { settled: true, url: browser.session.url() };
          } catch (error) {
            return {
              settled: false,
              url: browser.session.url(),
              note: error instanceof Error ? error.message : String(error),
            };
          }
        },
      },
      {
        name: "browser_url",
        description: "Return the current URL of the page.",
        isConcurrencySafe: true,
        async execute() {
          return { url: browser.session.url() };
        },
      },
      {
        name: "browser_get_text",
        description:
          "Return the visible innerText of an element matched by CSS selector. Useful to read prices, error messages, or confirmation text.",
        parameters: {
          selector: { type: "string", description: "CSS selector" },
          maxChars: { type: "number", description: "Truncate output (default 2000)." },
        },
        isConcurrencySafe: true,
        async execute(args) {
          const selector = String(args["selector"] ?? "");
          if (!selector) return { error: "browser_get_text: 'selector' is required" };
          const rawMax = Number(args["maxChars"] ?? 2000);
          const max =
            Number.isFinite(rawMax) && rawMax > 0 && rawMax <= 20_000
              ? Math.floor(rawMax)
              : 2000;
          const escaped = selector.replace(/'/g, "\\'");
          const text = await browser.session.evaluate<string | null>(
            `(() => {
              const el = document.querySelector('${escaped}');
              if (!el) return null;
              return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
            })()`,
          );
          if (text === null) return { found: false };
          return {
            found: true,
            selector,
            text: text.slice(0, max),
            truncated: text.length > max,
          };
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
