/**
 * Vision-based browser interaction.
 *
 * Core browser-use logic: screenshot → base64 → LLM vision → JSON action.
 * Extracted & generalized from crawlab-test/src/kernel/ai/captcha-solver.ts.
 *
 * Key difference: uses Capstan's LLMProvider interface instead of hardcoded OpenAI.
 */

import type { LLMProvider, LLMMessage } from "../../types.js";
import type { VisionAction, BrowserSession } from "../types.js";

// ---------------------------------------------------------------------------
// System prompt for the vision LLM
// ---------------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are a browser automation agent. You see a screenshot of a web page and must decide the next action to achieve the user's goal.

Respond with a single JSON object (no markdown, no explanation outside JSON):

{
  "action": "click" | "type" | "scroll" | "navigate" | "wait" | "done",
  "x": <number>,          // for click: x coordinate in pixels
  "y": <number>,          // for click: y coordinate in pixels
  "text": "<string>",     // for type: text to enter
  "selector": "<string>", // for type: CSS selector of the input
  "direction": "up"|"down", // for scroll
  "url": "<string>",      // for navigate
  "reason": "<string>"    // your reasoning (always required)
}

Rules:
- "done" means the goal is achieved or cannot be achieved.
- Coordinates are relative to the top-left corner of the screenshot.
- Prefer clicking on visible interactive elements (buttons, links, inputs).
- If the page needs loading, use "wait".
- Always include "reason" explaining why you chose this action.`;

// ---------------------------------------------------------------------------
// analyzeScreenshot — single-step vision analysis
// ---------------------------------------------------------------------------

export async function analyzeScreenshot(
  llm: LLMProvider,
  screenshot: Buffer,
  goal: string,
  history: VisionAction[],
): Promise<VisionAction> {
  const base64 = screenshot.toString("base64");

  const historyText =
    history.length > 0
      ? "\n\nPrevious actions:\n" +
        history
          .map(
            (a, i) =>
              `${i + 1}. ${a.action}${a.reason ? ` — ${a.reason}` : ""}`,
          )
          .join("\n")
      : "";

  const messages: LLMMessage[] = [
    { role: "system", content: VISION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Goal: ${goal}${historyText}\n\n[Screenshot attached as base64 image]\ndata:image/png;base64,${base64}`,
    },
  ];

  const response = await llm.chat(messages, {
    temperature: 0.1,
    maxTokens: 300,
  });

  return parseVisionResponse(response.content);
}

// ---------------------------------------------------------------------------
// runVisionLoop — multi-step: screenshot → action → repeat
// ---------------------------------------------------------------------------

export async function runVisionLoop(
  llm: LLMProvider,
  session: BrowserSession,
  goal: string,
  maxSteps = 15,
): Promise<VisionAction[]> {
  const history: VisionAction[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const screenshot = await session.screenshot();
    const action = await analyzeScreenshot(llm, screenshot, goal, history);
    history.push(action);

    if (action.action === "done") break;

    await executeVisionAction(session, action);

    // Brief pause between actions for page to settle
    await new Promise((r) => setTimeout(r, 500));
  }

  return history;
}

// ---------------------------------------------------------------------------
// executeVisionAction — translate VisionAction to BrowserSession calls
// ---------------------------------------------------------------------------

async function executeVisionAction(
  session: BrowserSession,
  action: VisionAction,
): Promise<void> {
  switch (action.action) {
    case "click":
      if (action.x != null && action.y != null) {
        await session.click(action.x, action.y);
      }
      break;
    case "type":
      if (action.selector && action.text != null) {
        await session.type(action.selector, action.text);
      }
      break;
    case "scroll":
      await session.scroll(action.direction ?? "down", 300);
      break;
    case "navigate":
      if (action.url) {
        await session.goto(action.url);
      }
      break;
    case "wait":
      await new Promise((r) => setTimeout(r, 2000));
      break;
    case "done":
      break;
  }
}

// ---------------------------------------------------------------------------
// parseVisionResponse — extract JSON from LLM response text
// ---------------------------------------------------------------------------

function parseVisionResponse(text: string): VisionAction {
  // Try to find JSON in the response (LLM might wrap it in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const result: VisionAction = {
        action: (parsed["action"] as VisionAction["action"]) ?? "done",
        reason: (parsed["reason"] as string) ?? "No reason provided",
      };
      if (typeof parsed["x"] === "number") result.x = parsed["x"];
      if (typeof parsed["y"] === "number") result.y = parsed["y"];
      if (typeof parsed["text"] === "string") result.text = parsed["text"];
      if (typeof parsed["selector"] === "string") result.selector = parsed["selector"];
      if (parsed["direction"] === "up" || parsed["direction"] === "down") result.direction = parsed["direction"];
      if (typeof parsed["url"] === "string") result.url = parsed["url"];
      return result;
    } catch {
      // JSON parse failed — fall through to default
    }
  }

  return {
    action: "done",
    reason: `Could not parse LLM response: ${text.slice(0, 100)}`,
  };
}
