import type { ReactNode, ReactElement } from "react";
import type { ActionDefinition, ActionResult } from "@zauso-ai/capstan-core";

export interface MetadataTitleObject {
  default?: string;
  template?: string;
  absolute?: string;
}

export type MetadataTitle = string | MetadataTitleObject;

export interface MetadataRobotsObject {
  index?: boolean;
  follow?: boolean;
  noarchive?: boolean;
  nosnippet?: boolean;
  noimageindex?: boolean;
  notranslate?: boolean;
  unavailableAfter?: string;
  maxImagePreview?: "none" | "standard" | "large";
  maxSnippet?: number;
  maxVideoPreview?: number;
}

export interface MetadataOpenGraph {
  title?: string;
  description?: string;
  type?: string;
  url?: string;
  image?: string;
  siteName?: string;
}

export interface MetadataTwitter {
  card?: "summary" | "summary_large_image";
  title?: string;
  description?: string;
  image?: string;
}

export interface MetadataLinkDescriptor {
  url: string;
  type?: string;
  sizes?: string;
  media?: string;
  color?: string;
  title?: string;
}

export type MetadataLinkInput = string | MetadataLinkDescriptor;

export interface MetadataIcons {
  icon?: MetadataLinkInput | MetadataLinkInput[];
  apple?: MetadataLinkInput | MetadataLinkInput[];
  shortcut?: MetadataLinkInput | MetadataLinkInput[];
  other?: Array<MetadataLinkDescriptor & { rel: string }>;
}

export interface MetadataAlternatesObject {
  languages?: Record<string, string>;
  media?: Record<string, string>;
  types?: Record<string, string>;
}

export type MetadataAlternates = Record<string, string> | MetadataAlternatesObject;

export interface Metadata {
  title?: MetadataTitle;
  description?: string;
  keywords?: string[];
  robots?: string | MetadataRobotsObject;
  openGraph?: MetadataOpenGraph;
  twitter?: MetadataTwitter;
  icons?: MetadataIcons;
  canonical?: string;
  alternates?: MetadataAlternates;
}

export interface ResolvedMetadataLinkDescriptor extends MetadataLinkDescriptor {}

export interface ResolvedMetadataIcons {
  icon: ResolvedMetadataLinkDescriptor[];
  apple: ResolvedMetadataLinkDescriptor[];
  shortcut: ResolvedMetadataLinkDescriptor[];
  other: Array<ResolvedMetadataLinkDescriptor & { rel: string }>;
}

export interface ResolvedMetadataAlternates {
  languages: Record<string, string>;
  media: Record<string, string>;
  types: Record<string, string>;
}

export interface ResolvedMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  robots?: string;
  openGraph?: MetadataOpenGraph;
  twitter?: MetadataTwitter;
  icons?: ResolvedMetadataIcons;
  canonical?: string;
  alternates?: ResolvedMetadataAlternates;
}

export interface LoaderArgs {
  params: Record<string, string>;
  request: Request;
  ctx: {
    auth: {
      isAuthenticated: boolean;
      type: "human" | "agent" | "anonymous" | "workload";
      userId?: string;
      role?: string;
      email?: string;
      agentId?: string;
      agentName?: string;
      permissions?: string[];
      actor?: {
        kind: "user" | "agent" | "workload" | "system" | "anonymous";
        id: string;
        displayName?: string;
        role?: string;
        email?: string;
        claims?: Record<string, unknown>;
      };
      credential?: {
        kind:
          | "session"
          | "oauth"
          | "api_key"
          | "mtls"
          | "dpop"
          | "run_token"
          | "approval_token"
          | "anonymous";
        subjectId: string;
        presentedAt: string;
        expiresAt?: string;
        metadata?: Record<string, unknown>;
      };
      execution?: {
        kind:
          | "request"
          | "run"
          | "tool_call"
          | "approval"
          | "schedule"
          | "release"
          | "mcp_invocation";
        id: string;
        parentId?: string;
        metadata?: Record<string, unknown>;
      };
      delegation?: Array<{
        from: { kind: string; id: string };
        to: { kind: string; id: string };
        reason: string;
        issuedAt: string;
        metadata?: Record<string, unknown>;
      }>;
      grants?: Array<{
        resource: string;
        action: string;
        scope?: Record<string, string>;
        effect?: "allow" | "deny";
        expiresAt?: string;
      }>;
      envelope?: {
        actor: NonNullable<LoaderArgs["ctx"]["auth"]["actor"]>;
        credential: NonNullable<LoaderArgs["ctx"]["auth"]["credential"]>;
        execution?: NonNullable<LoaderArgs["ctx"]["auth"]["execution"]>;
        delegation: NonNullable<LoaderArgs["ctx"]["auth"]["delegation"]>;
        grants: NonNullable<LoaderArgs["ctx"]["auth"]["grants"]>;
      };
    };
  };
  /** In-process fetch to call API routes without HTTP round-trip */
  fetch: {
    get: <T = unknown>(path: string, params?: Record<string, string>) => Promise<T>;
    post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
    put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
    delete: <T = unknown>(path: string) => Promise<T>;
  };
}

export type LoaderFunction<T = unknown> = (args: LoaderArgs) => Promise<T>;

export type HydrationMode = "full" | "visible" | "none";

export type RenderMode = "ssr" | "ssg" | "isr" | "streaming";

export interface PageModule {
  default: (props: Record<string, unknown>) => ReactElement;
  loader?: LoaderFunction;
  action?: ActionDefinition;
  metadata?: Metadata;
  /** Page-level hydration strategy export */
  hydration?: HydrationMode;
  /** Whether the component is a server or client component */
  componentType?: "server" | "client";
  /** Rendering strategy (default: "ssr") */
  renderMode?: RenderMode;
  /** ISR revalidation interval in seconds */
  revalidate?: number;
  /** Cache tags for ISR invalidation */
  cacheTags?: string[];
  /** SSG: return param sets to pre-render at build time */
  generateStaticParams?: () => Promise<Array<Record<string, string>>>;
}

export interface LayoutModule {
  default: (props: { children?: ReactNode }) => ReactElement;
  metadata?: Metadata;
}

export interface RenderPageOptions {
  pageModule: PageModule;
  layouts: LayoutModule[];
  params: Record<string, string>;
  request: Request;
  loaderArgs: LoaderArgs;
  /** Hydration strategy (default: "full") */
  hydration?: HydrationMode;
  /** Whether the component is a server or client component */
  componentType?: "server" | "client";
  /** Error boundary component from nearest _error.tsx */
  errorComponent?: (props: { error: Error; reset: () => void }) => ReactElement;
  /** Loading/Suspense fallback component from nearest _loading.tsx */
  loadingComponent?: () => ReactElement;
  /** Layout keys for data-capstan-layout/outlet attributes (parallel to layouts) */
  layoutKeys?: string[];
  /** Action result to inject into ActionContext during SSR (after form POST) */
  actionResult?: ActionResult<unknown>;
  /** Submitted form data to inject into ActionContext during SSR (after form POST) */
  actionFormData?: Record<string, unknown>;
}

export interface RenderResult {
  html: string;
  loaderData: unknown;
  statusCode: number;
}

export interface RenderStreamResult {
  stream: ReadableStream<Uint8Array>;
  /** Resolves when the entire document has been emitted (useful for bots/crawlers). */
  allReady: Promise<void>;
  loaderData: unknown;
  statusCode: number;
}

export interface CapstanPageContext {
  loaderData: unknown;
  params: Record<string, string>;
  auth: LoaderArgs["ctx"]["auth"];
  actionResult?: ActionResult<unknown>;
  formData?: Record<string, unknown>;
}
