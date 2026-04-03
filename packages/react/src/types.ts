import type { ReactNode, ReactElement } from "react";

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
}
