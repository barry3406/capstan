// ---------------------------------------------------------------------------
// Embedding adapter interface and configuration
// ---------------------------------------------------------------------------

/**
 * Adapter that converts text into dense vector embeddings.
 *
 * Implementations call an external embedding model (e.g. OpenAI, Cohere,
 * a local ONNX model) and return fixed-length float arrays.
 */
export interface EmbeddingAdapter {
  /** Generate embeddings for one or more texts (batch). */
  embed(texts: string[]): Promise<number[][]>;
  /** Number of dimensions each embedding vector contains. */
  dimensions: number;
}

/**
 * Links a model's text field to a vector field via an embedding adapter so
 * embeddings can be generated automatically on insert / update.
 */
export interface EmbeddingConfig {
  /** The model field to embed (must be string or text type). */
  sourceField: string;
  /** The vector field to store embeddings in. */
  vectorField: string;
  /** The embedding adapter to use. */
  adapter: EmbeddingAdapter;
}

// ---------------------------------------------------------------------------
// defineEmbedding
// ---------------------------------------------------------------------------

/**
 * Register embedding configuration for a model.
 *
 * @example
 *   const articleEmbedding = defineEmbedding("Article", {
 *     sourceField: "body",
 *     vectorField: "embedding",
 *     adapter: openaiEmbeddings({ apiKey: process.env.OPENAI_KEY! }),
 *   });
 */
export function defineEmbedding(
  modelName: string,
  config: EmbeddingConfig,
): EmbeddingConfig & { modelName: string } {
  return { ...config, modelName };
}

// ---------------------------------------------------------------------------
// Built-in adapter factories
// ---------------------------------------------------------------------------

/** Options for the OpenAI-compatible embedding adapter. */
export interface OpenAIEmbeddingOptions {
  /** OpenAI (or compatible) API key. */
  apiKey: string;
  /** Model identifier. @default "text-embedding-3-small" */
  model?: string;
  /** Base URL for the embeddings API. @default "https://api.openai.com/v1" */
  baseUrl?: string;
  /** Number of dimensions to request. @default 1536 */
  dimensions?: number;
}

/**
 * Create an OpenAI-compatible embedding adapter.
 *
 * Works with any API that implements the OpenAI `/v1/embeddings` contract
 * (OpenAI, Azure OpenAI, Ollama, vLLM, etc.).
 *
 * @example
 *   const adapter = openaiEmbeddings({
 *     apiKey: process.env.OPENAI_KEY!,
 *     model: "text-embedding-3-small",
 *     dimensions: 1536,
 *   });
 */
export function openaiEmbeddings(opts: OpenAIEmbeddingOptions): EmbeddingAdapter {
  const dimensions = opts.dimensions ?? 1536;
  const baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  const model = opts.model ?? "text-embedding-3-small";

  return {
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: texts,
          dimensions,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Embedding request failed (${res.status}): ${body}`,
        );
      }

      const data = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data.map((d) => d.embedding);
    },
  };
}
