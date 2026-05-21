import type { LLMContentPart, LLMMessage } from "../types.js";

/** Plain-text view of message content (concatenates text parts, strips images). */
export function messageText(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** Length used for token / size estimation; counts each image as ~1500 chars
 * (roughly the cost of a low-detail image patch in OpenAI tokenizers). */
export function messageContentLength(content: string | LLMContentPart[]): number {
  if (typeof content === "string") return content.length;
  return content.reduce((acc, part) => {
    if (part.type === "text") return acc + part.text.length;
    return acc + 1500;
  }, 0);
}

/** True if the message carries any image part. */
export function messageHasImage(content: string | LLMContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => part.type === "image");
}

/** Combine two contents while preserving multimodal parts. Used by the
 * normalize step that merges consecutive same-role messages. */
export function concatContent(
  a: string | LLMContentPart[],
  b: string | LLMContentPart[],
): string | LLMContentPart[] {
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (!aIsArr && !bIsArr) {
    return `${a}\n${b}`;
  }
  const aParts: LLMContentPart[] = aIsArr ? a : [{ type: "text", text: a as string }];
  const bParts: LLMContentPart[] = bIsArr ? b : [{ type: "text", text: b as string }];
  return [...aParts, ...bParts];
}

/** Detect whether a tool result is an image envelope (image bytes the engine
 * should surface to the LLM as an inline image part). The convention:
 * `{ image: { mediaType: string, base64: string } }` (other keys allowed). */
export function extractImageEnvelope(
  value: unknown,
): { mediaType: string; data: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const img = record["image"];
  if (!img || typeof img !== "object") return undefined;
  const i = img as Record<string, unknown>;
  const mediaType = typeof i["mediaType"] === "string" ? i["mediaType"] : "image/png";
  const data = typeof i["base64"] === "string" ? i["base64"] : undefined;
  if (!data) return undefined;
  return { mediaType, data };
}

/** Build a multimodal user message that combines a tool-result text body
 * with an inline image. */
export function buildToolResultMessageWithImage(
  text: string,
  image: { mediaType: string; data: string },
): LLMMessage {
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image", mediaType: image.mediaType, data: image.data },
    ],
  };
}
