import type { NavigationPayload } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function buildPayloadError(url: string, reason: string): Error {
  return new Error(`Invalid navigation payload for ${url}: ${reason}`);
}

export function normalizeNavigationPayload(url: string, value: unknown): NavigationPayload {
  if (!isRecord(value)) {
    throw buildPayloadError(url, "expected a JSON object");
  }

  if (typeof value.url !== "string") {
    throw buildPayloadError(url, "missing string url");
  }

  if (typeof value.layoutKey !== "string") {
    throw buildPayloadError(url, "missing string layoutKey");
  }

  if (value.componentType !== "server" && value.componentType !== "client") {
    throw buildPayloadError(url, "missing valid componentType");
  }

  if (!("loaderData" in value)) {
    throw buildPayloadError(url, "missing loaderData");
  }

  const payload: NavigationPayload = {
    url: value.url,
    layoutKey: value.layoutKey,
    loaderData: value.loaderData,
    componentType: value.componentType,
  };

  if ("html" in value && typeof value.html === "string") {
    payload.html = value.html;
  }

  if ("metadata" in value) {
    if (!isMetadataRecord(value.metadata)) {
      throw buildPayloadError(url, "metadata must be an object when present");
    }
    payload.metadata = value.metadata as NonNullable<NavigationPayload["metadata"]>;
  }

  return payload;
}
