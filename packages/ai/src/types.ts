// Embedding adapter (for memory vector search)
export interface MemoryEmbedder { embed(texts: string[]): Promise<number[][]>; dimensions: number; }

// LLM types (moved from agent/llm.ts concept, but independent)
export interface LLMMessage { role: "system" | "user" | "assistant"; content: string; }
export interface LLMResponse { content: string; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined; finishReason?: string | undefined; }
export interface LLMStreamChunk { content: string; done: boolean; }
export interface LLMOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; responseFormat?: Record<string, unknown>; }
export interface LLMProvider { name: string; chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>; stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>; }

// Think/Generate options
export interface ThinkOptions<T = unknown> { schema?: { parse: (data: unknown) => T }; model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; memory?: boolean; about?: [string, string]; }
export interface GenerateOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; memory?: boolean; about?: [string, string]; }

// Memory types
export interface MemoryEntry { id: string; content: string; scope: MemoryScope; createdAt: string; updatedAt: string; metadata?: Record<string, unknown> | undefined; embedding?: number[] | undefined; importance?: "low" | "medium" | "high" | "critical" | undefined; type?: "fact" | "event" | "preference" | "instruction" | undefined; accessCount: number; lastAccessedAt: string; }
export interface MemoryScope { type: string; id: string; }
export interface RecallOptions { scope?: MemoryScope; limit?: number; minScore?: number; types?: string[]; }
export interface RememberOptions { scope?: MemoryScope; type?: "fact" | "event" | "preference" | "instruction"; importance?: "low" | "medium" | "high" | "critical"; metadata?: Record<string, unknown>; }
export interface AssembleContextOptions { query: string; maxTokens?: number; scopes?: MemoryScope[]; }

// Memory backend interface
export interface MemoryBackend { store(entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt" | "updatedAt">): Promise<string>; query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>; remove(id: string): Promise<boolean>; clear(scope: MemoryScope): Promise<void>; }

// Memory accessor (what developers use)
export interface MemoryAccessor { remember(content: string, opts?: RememberOptions): Promise<string>; recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>; forget(entryId: string): Promise<boolean>; about(type: string, id: string): MemoryAccessor; assembleContext(opts: AssembleContextOptions): Promise<string>; }

// Agent loop types
export interface AgentTool { name: string; description: string; parameters?: Record<string, unknown>; execute(args: Record<string, unknown>): Promise<unknown>; }
export interface AgentRunConfig { goal: string; about?: [string, string]; maxIterations?: number; memory?: boolean; tools?: AgentTool[]; systemPrompt?: string; excludeRoutes?: string[]; }
export interface AgentRunResult { result: unknown; iterations: number; toolCalls: Array<{ tool: string; args: unknown; result: unknown }>; status: "completed" | "max_iterations" | "approval_required"; pendingApproval?: { tool: string; args: unknown; reason: string }; }

// AI context (standalone, no Capstan dependency)
export interface AIContext { think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T>; generate(prompt: string, opts?: GenerateOptions): Promise<string>; thinkStream(prompt: string, opts?: Omit<ThinkOptions, "schema">): AsyncIterable<string>; generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>; remember(content: string, opts?: RememberOptions): Promise<string>; recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>; memory: { about(type: string, id: string): MemoryAccessor; forget(entryId: string): Promise<boolean>; assembleContext(opts: AssembleContextOptions): Promise<string>; }; agent: { run(config: AgentRunConfig): Promise<AgentRunResult>; }; }

// Config for creating an AI context
export interface AIConfig { llm: LLMProvider; memory?: { backend?: MemoryBackend; embedding?: { embed(texts: string[]): Promise<number[][]>; dimensions: number; }; autoExtract?: boolean; }; defaultScope?: MemoryScope; }
