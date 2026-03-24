import type {
  CapabilitySpec,
  FieldSpec,
  InputFieldSpec,
  NormalizedAppGraph,
  PolicySpec,
  ResourceSpec,
  ViewSpec
} from "@capstan/app-graph";

export interface HumanSurfaceStateSet {
  loading: string;
  empty: string;
  error: string;
}

export interface HumanSurfaceAction {
  key: string;
  capability: string;
  title: string;
  mode: CapabilitySpec["mode"];
  resources: string[];
  task?: string;
  taskKind?: "sync" | "durable";
  taskTitle?: string;
  label: string;
  policyState: "allowed" | "approval_required" | "blocked" | "redacted";
  policyLabel: string;
  note: string;
}

export interface HumanSurfaceField {
  key: string;
  label: string;
  type: FieldSpec["type"];
  required: boolean;
  description?: string;
}

export interface HumanSurfaceTableProjection {
  columns: HumanSurfaceField[];
  sampleRow: Record<string, string>;
}

export interface HumanSurfaceRelationProjection {
  key: string;
  label: string;
  resourceKey: string;
  kind: "one" | "many";
  routeKey: string;
  routeTitle: string;
  path: string;
  description?: string;
}

export type HumanSurfaceAttentionQueueStatus =
  | "approval_required"
  | "input_required"
  | "blocked"
  | "failed"
  | "paused"
  | "cancelled";

export interface HumanSurfaceAttentionFilterProjection {
  taskKey?: string;
  resourceKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: HumanSurfaceAttentionQueueStatus;
}

export type HumanSurfaceAttentionScopeFilter = Omit<
  HumanSurfaceAttentionFilterProjection,
  "status"
>;

export interface HumanSurfaceAttentionQueueProjection {
  key: string;
  label: string;
  status: HumanSurfaceAttentionQueueStatus;
  actionKey: string;
  actionTitle: string;
  taskKey: string;
  taskTitle: string;
  filter: HumanSurfaceAttentionFilterProjection;
}

export interface HumanSurfaceGlobalAttentionInboxProjection {
  key: string;
  label: string;
}

export interface HumanSurfaceGlobalAttentionQueueProjection {
  key: string;
  label: string;
  status: HumanSurfaceAttentionQueueStatus;
}

export type HumanSurfaceAttentionPresetScope = "task" | "resource" | "route";
export type HumanSurfaceSupervisionWorkspaceSlotKey =
  | "primary"
  | "secondary"
  | "watchlist";

export interface HumanSurfaceAttentionPresetQueueProjection {
  key: string;
  label: string;
  status: HumanSurfaceAttentionQueueStatus;
  filter: HumanSurfaceAttentionFilterProjection;
}

export interface HumanSurfaceAttentionPresetProjection {
  key: string;
  label: string;
  scope: HumanSurfaceAttentionPresetScope;
  autoSlotKey: HumanSurfaceSupervisionWorkspaceSlotKey;
  description: string;
  filter: HumanSurfaceAttentionScopeFilter;
  inbox: {
    key: string;
    label: string;
    filter: HumanSurfaceAttentionScopeFilter;
  };
  queues: HumanSurfaceAttentionPresetQueueProjection[];
}

export interface HumanSurfaceAttentionProjection {
  inbox?: HumanSurfaceGlobalAttentionInboxProjection;
  queues: HumanSurfaceGlobalAttentionQueueProjection[];
  presets: HumanSurfaceAttentionPresetProjection[];
}

export interface HumanSurfaceRoute {
  key: string;
  path: string;
  title: string;
  kind: "workspace" | ViewSpec["kind"];
  navigationLabel: string;
  navigable: boolean;
  description: string;
  resourceKey?: string;
  capabilityKey?: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  generated: boolean;
  actions: HumanSurfaceAction[];
  states: HumanSurfaceStateSet;
  fields: HumanSurfaceField[];
  relations: HumanSurfaceRelationProjection[];
  attentionQueues: HumanSurfaceAttentionQueueProjection[];
  table?: HumanSurfaceTableProjection;
}

export interface HumanSurfaceNavigationItem {
  key: string;
  label: string;
  path: string;
  routeKey: string;
}

export interface HumanSurfaceProjection {
  domain: {
    key: string;
    title: string;
    description?: string;
  };
  summary: {
    resourceCount: number;
    capabilityCount: number;
    routeCount: number;
  };
  attention: HumanSurfaceAttentionProjection;
  navigation: HumanSurfaceNavigationItem[];
  routes: HumanSurfaceRoute[];
}

export type HumanSurfaceRuntimeMode = "ready" | keyof HumanSurfaceStateSet;

const attentionQueueStatusOrder: HumanSurfaceAttentionQueueStatus[] = [
  "approval_required",
  "input_required",
  "blocked",
  "failed",
  "paused",
  "cancelled"
];

const supervisionWorkspaceSlots = [
  {
    key: "primary" as const,
    label: "Primary"
  },
  {
    key: "secondary" as const,
    label: "Secondary"
  },
  {
    key: "watchlist" as const,
    label: "Watchlist"
  }
] as const;

export function projectHumanSurface(graph: NormalizedAppGraph): HumanSurfaceProjection {
  const policiesByKey = new Map(graph.policies.map((policy) => [policy.key, policy]));
  const resourcesByKey = new Map(graph.resources.map((resource) => [resource.key, resource]));
  const tasksByKey = new Map(graph.tasks.map((task) => [task.key, task]));
  const capabilitiesByResource = groupCapabilitiesByResource(graph.capabilities);
  const routes = [
    projectWorkspaceRoute(graph),
    ...graph.resources.flatMap((resource) =>
      projectResourceRoutes(resource, graph.views, capabilitiesByResource, policiesByKey, tasksByKey)
    ),
    ...graph.resources.flatMap((resource) =>
      projectRelationRoutes(
        resource,
        resourcesByKey,
        graph.views,
        capabilitiesByResource,
        policiesByKey,
        tasksByKey
      )
    ),
    ...graph.views
      .filter((view) => !view.resource && (view.kind === "workspace" || view.kind === "dashboard"))
      .map((view) => projectStandaloneViewRoute(view, graph.capabilities, policiesByKey, tasksByKey))
  ];

  const uniqueRoutes = dedupeRoutes(routes).sort((left, right) => left.path.localeCompare(right.path));

  return {
    domain: graph.domain,
    summary: {
      resourceCount: graph.resources.length,
      capabilityCount: graph.capabilities.length,
      routeCount: uniqueRoutes.length
    },
    attention: projectGlobalAttention(uniqueRoutes, tasksByKey, resourcesByKey),
    navigation: uniqueRoutes.filter((route) => route.navigable).map((route) => ({
      key: route.key,
      label: route.navigationLabel,
      path: route.path,
      routeKey: route.key
    })),
    routes: uniqueRoutes
  };
}

export function renderHumanSurfaceDocument(
  projection: HumanSurfaceProjection,
  options: { runtimeModulePath?: string } = {}
): string {
  const runtimeModulePath = options.runtimeModulePath ?? "./dist/human-surface/index.js";
  const navigation = projection.navigation
    .map((item, index) => {
      const activeClass = index === 0 ? " is-active" : "";

      return `<a class="capstan-nav-link${activeClass}" href="#${escapeHtml(item.routeKey)}" data-route-nav="${escapeHtml(item.routeKey)}"><span>${escapeHtml(item.label)}</span><span class="capstan-nav-path">${escapeHtml(item.path)}</span></a>`;
    })
    .join("");

  const routes = projection.routes
    .map((route, index) => renderRouteSection(route, index === 0))
    .join("");
  const runtimeConsole = renderRuntimeConsole(projection);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(projection.domain.title)} · Capstan Human Surface</title>
    <style>
      :root {
        color-scheme: light;
        --capstan-bg: #f5f3ef;
        --capstan-panel: rgba(255, 255, 255, 0.9);
        --capstan-border: rgba(27, 31, 35, 0.12);
        --capstan-text: #111827;
        --capstan-muted: #5b6470;
        --capstan-accent: #1356d7;
        --capstan-accent-soft: rgba(19, 86, 215, 0.08);
        --capstan-success: #0f8a5f;
        --capstan-warning: #9a6700;
        --capstan-danger: #a53d2d;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(19, 86, 215, 0.08), transparent 28%),
          linear-gradient(180deg, #faf7f2 0%, var(--capstan-bg) 100%);
        color: var(--capstan-text);
      }

      .capstan-shell {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: 100vh;
      }

      .capstan-sidebar {
        padding: 28px 22px;
        border-right: 1px solid var(--capstan-border);
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(18px);
        position: sticky;
        top: 0;
        align-self: start;
        min-height: 100vh;
      }

      .capstan-brand {
        margin-bottom: 24px;
      }

      .capstan-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: var(--capstan-accent-soft);
        color: var(--capstan-accent);
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .capstan-brand h1 {
        margin: 14px 0 10px;
        font-size: 24px;
        line-height: 1.1;
      }

      .capstan-brand p {
        margin: 0;
        color: var(--capstan-muted);
        line-height: 1.6;
      }

      .capstan-nav {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .capstan-nav-link {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid transparent;
        color: inherit;
        text-decoration: none;
        background: rgba(255, 255, 255, 0.6);
      }

      .capstan-nav-link:hover {
        border-color: var(--capstan-border);
        background: white;
      }

      .capstan-nav-link.is-active {
        border-color: rgba(19, 86, 215, 0.18);
        background: rgba(19, 86, 215, 0.08);
      }

      .capstan-nav-path {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 11px;
        color: var(--capstan-muted);
      }

      .capstan-main {
        padding: 28px 28px 40px;
      }

      .capstan-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 20px;
      }

      .capstan-summary-card,
      .capstan-route,
      .capstan-card {
        border: 1px solid var(--capstan-border);
        border-radius: 22px;
        background: var(--capstan-panel);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);
      }

      .capstan-summary-card {
        padding: 18px 20px;
      }

      .capstan-summary-card span {
        display: block;
        color: var(--capstan-muted);
        font-size: 13px;
        margin-bottom: 10px;
      }

      .capstan-summary-card strong {
        font-size: 28px;
      }

      .capstan-route {
        padding: 24px;
        margin-bottom: 18px;
      }

      .capstan-route[hidden] {
        display: none;
      }

      .capstan-route[data-runtime-state="loading"] .capstan-grid,
      .capstan-route[data-runtime-state="empty"] .capstan-grid,
      .capstan-route[data-runtime-state="error"] .capstan-grid {
        opacity: 0.52;
      }

      .capstan-route header {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        align-items: flex-start;
        margin-bottom: 20px;
      }

      .capstan-route h2 {
        margin: 0 0 8px;
        font-size: 24px;
      }

      .capstan-route p {
        margin: 0;
        color: var(--capstan-muted);
        line-height: 1.6;
      }

      .capstan-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .capstan-badge {
        border-radius: 999px;
        padding: 7px 10px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid var(--capstan-border);
        background: white;
      }

      .capstan-badge[data-tone="approval_required"] {
        color: var(--capstan-warning);
        background: rgba(154, 103, 0, 0.08);
      }

      .capstan-badge[data-tone="blocked"] {
        color: var(--capstan-danger);
        background: rgba(165, 61, 45, 0.08);
      }

      .capstan-badge[data-tone="redacted"] {
        color: var(--capstan-accent);
        background: var(--capstan-accent-soft);
      }

      .capstan-badge[data-tone="allowed"] {
        color: var(--capstan-success);
        background: rgba(15, 138, 95, 0.08);
      }

      .capstan-grid {
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 16px;
      }

      .capstan-card {
        padding: 18px;
      }

      .capstan-card h3 {
        margin: 0 0 14px;
        font-size: 16px;
      }

      .capstan-table {
        width: 100%;
        border-collapse: collapse;
      }

      .capstan-table th,
      .capstan-table td {
        text-align: left;
        padding: 10px 0;
        border-bottom: 1px solid var(--capstan-border);
        font-size: 14px;
      }

      .capstan-table th {
        color: var(--capstan-muted);
        font-size: 12px;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      .capstan-form-grid,
      .capstan-fields {
        display: grid;
        gap: 12px;
      }

      .capstan-related-grid {
        display: grid;
        gap: 12px;
      }

      .capstan-attention-grid {
        margin-top: 14px;
      }

      .capstan-attention-count {
        display: inline-flex;
        align-items: center;
        margin-top: 10px;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
        background: rgba(17, 24, 39, 0.05);
        color: var(--capstan-text);
      }

      .capstan-attention-count[data-open-count="0"] {
        color: var(--capstan-muted);
        background: rgba(17, 24, 39, 0.04);
      }

      .capstan-field {
        border: 1px solid var(--capstan-border);
        border-radius: 16px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.78);
      }

      .capstan-field strong {
        display: block;
        margin-bottom: 6px;
      }

      .capstan-related-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        color: var(--capstan-accent);
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
      }

      .capstan-related-link:hover {
        text-decoration: underline;
      }

      .capstan-field span,
      .capstan-action-note,
      .capstan-state-copy {
        color: var(--capstan-muted);
        font-size: 13px;
        line-height: 1.5;
      }

      .capstan-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .capstan-action {
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--capstan-border);
        background: white;
      }

      .capstan-action strong {
        display: block;
        margin-bottom: 4px;
      }

      .capstan-action-button,
      .capstan-state-toggle {
        margin-top: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: 999px;
        background: var(--capstan-text);
        color: white;
        padding: 9px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .capstan-action-button:hover,
      .capstan-state-toggle:hover {
        background: #1f2937;
      }

      .capstan-action-button:disabled,
      .capstan-state-toggle:disabled {
        cursor: not-allowed;
        opacity: 0.56;
      }

      .capstan-state-toggle {
        background: white;
        color: var(--capstan-text);
        border-color: var(--capstan-border);
      }

      .capstan-state-toggle.is-active {
        background: rgba(19, 86, 215, 0.08);
        color: var(--capstan-accent);
        border-color: rgba(19, 86, 215, 0.2);
      }

      .capstan-runtime-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 14px;
      }

      .capstan-runtime-pill {
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: rgba(19, 86, 215, 0.08);
        color: var(--capstan-accent);
      }

      .capstan-runtime-pill[data-route-result-state="idle"] {
        background: rgba(17, 24, 39, 0.04);
        color: var(--capstan-muted);
      }

      .capstan-runtime-pill[data-route-attention-state="idle"],
      .capstan-runtime-pill[data-route-attention-state="cancelled"] {
        background: rgba(17, 24, 39, 0.04);
        color: var(--capstan-muted);
      }

      .capstan-runtime-pill[data-route-result-state="completed"] {
        background: rgba(15, 138, 95, 0.08);
        color: var(--capstan-success);
      }

      .capstan-runtime-pill[data-route-result-state="redacted"] {
        background: var(--capstan-accent-soft);
        color: var(--capstan-accent);
      }

      .capstan-runtime-pill[data-route-result-state="approval_required"],
      .capstan-runtime-pill[data-route-result-state="not_implemented"] {
        background: rgba(154, 103, 0, 0.08);
        color: var(--capstan-warning);
      }

      .capstan-runtime-pill[data-route-attention-state="approval_required"],
      .capstan-runtime-pill[data-route-attention-state="input_required"],
      .capstan-runtime-pill[data-route-attention-state="paused"] {
        background: rgba(154, 103, 0, 0.08);
        color: var(--capstan-warning);
      }

      .capstan-runtime-pill[data-route-result-state="blocked"],
      .capstan-runtime-pill[data-route-result-state="error"] {
        background: rgba(165, 61, 45, 0.08);
        color: var(--capstan-danger);
      }

      .capstan-runtime-pill[data-route-attention-state="blocked"],
      .capstan-runtime-pill[data-route-attention-state="failed"] {
        background: rgba(165, 61, 45, 0.08);
        color: var(--capstan-danger);
      }

      .capstan-runtime-toggles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }

      .capstan-states {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .capstan-state {
        border-radius: 18px;
        padding: 16px;
        background: rgba(17, 24, 39, 0.02);
        border: 1px dashed var(--capstan-border);
      }

      .capstan-state strong {
        display: block;
        margin-bottom: 8px;
      }

      .capstan-state.is-active {
        border-style: solid;
        border-color: rgba(19, 86, 215, 0.25);
        background: rgba(19, 86, 215, 0.06);
      }

      .capstan-state-bars {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 12px;
      }

      .capstan-state-bar {
        height: 8px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(19, 86, 215, 0.18), rgba(19, 86, 215, 0.05));
      }

      .capstan-input,
      .capstan-textarea {
        width: 100%;
        margin-top: 10px;
        border: 1px solid var(--capstan-border);
        border-radius: 14px;
        background: white;
        color: var(--capstan-text);
        padding: 10px 12px;
        font: inherit;
      }

      .capstan-textarea {
        min-height: 110px;
        resize: vertical;
      }

      .capstan-console {
        border: 1px solid var(--capstan-border);
        border-radius: 22px;
        background: rgba(17, 24, 39, 0.96);
        color: #f8fafc;
        padding: 20px 22px;
        margin-bottom: 18px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.16);
      }

      .capstan-console header {
        display: flex;
        justify-content: space-between;
        gap: 14px;
        align-items: flex-start;
        margin-bottom: 14px;
      }

      .capstan-console h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      .capstan-console p {
        margin: 0;
        color: rgba(248, 250, 252, 0.72);
        line-height: 1.5;
      }

      .capstan-console-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }

      .capstan-console-card {
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 18px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.04);
      }

      .capstan-console-card span {
        display: block;
        font-size: 12px;
        color: rgba(248, 250, 252, 0.68);
        margin-bottom: 6px;
      }

      .capstan-console-card strong {
        display: block;
      }

      .capstan-console-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 14px 0;
      }

      .capstan-console-scope-group + .capstan-console-scope-group {
        margin-top: 18px;
      }

      .capstan-console-scope-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      .capstan-console-copy {
        margin-top: 10px;
        color: rgba(248, 250, 252, 0.72);
        font-size: 13px;
        line-height: 1.5;
      }

      .capstan-console-lane-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .capstan-console-card .capstan-action-button {
        width: 100%;
        margin-top: 12px;
      }

      .capstan-console-card .capstan-attention-count {
        margin-top: 10px;
      }

      .capstan-attention-breadcrumbs {
        margin: 10px 0 12px;
      }

      .capstan-attention-handoff-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: -4px 0 12px;
      }

      .capstan-attention-handoff-controls .capstan-state-toggle {
        margin-top: 0;
      }

      .capstan-console-lane-grid .capstan-state-toggle {
        width: 100%;
        margin-top: 0;
      }

      .capstan-console-workspace-lanes {
        margin-top: 12px;
      }

      .capstan-console pre {
        margin: 0;
        overflow: auto;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        padding: 16px;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 12px;
        line-height: 1.6;
      }

      .capstan-route-result {
        margin: 0;
        overflow: auto;
        border-radius: 18px;
        background: rgba(17, 24, 39, 0.04);
        border: 1px solid var(--capstan-border);
        padding: 16px;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 12px;
        line-height: 1.6;
      }

      @media (max-width: 1024px) {
        .capstan-shell {
          grid-template-columns: 1fr;
        }

        .capstan-sidebar {
          position: static;
          min-height: auto;
          border-right: none;
          border-bottom: 1px solid var(--capstan-border);
        }

        .capstan-grid,
        .capstan-summary,
        .capstan-console-grid,
        .capstan-console-actions,
        .capstan-console-scope-grid,
        .capstan-console-lane-grid,
        .capstan-states {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="capstan-shell">
      <aside class="capstan-sidebar">
        <div class="capstan-brand">
          <span class="capstan-eyebrow">Capstan Human Surface</span>
          <h1>${escapeHtml(projection.domain.title)}</h1>
          <p>${escapeHtml(projection.domain.description ?? "Generated from the App Graph with a deterministic human-facing shell.")}</p>
        </div>
        <nav class="capstan-nav">
          ${navigation}
        </nav>
      </aside>
      <main class="capstan-main">
        <section class="capstan-summary">
          <article class="capstan-summary-card"><span>Resources</span><strong>${projection.summary.resourceCount}</strong></article>
          <article class="capstan-summary-card"><span>Capabilities</span><strong>${projection.summary.capabilityCount}</strong></article>
          <article class="capstan-summary-card"><span>Projected Routes</span><strong>${projection.summary.routeCount}</strong></article>
        </section>
        ${runtimeConsole}
        ${routes}
      </main>
    </div>
    <script type="module">
      import { mountHumanSurfaceBrowser } from "${escapeHtml(runtimeModulePath)}";

      mountHumanSurfaceBrowser(document);
    </script>
  </body>
</html>
`;
}

function projectWorkspaceRoute(graph: NormalizedAppGraph): HumanSurfaceRoute {
  return {
    key: "workspaceHome",
    path: "/",
    title: `${graph.domain.title} Workspace`,
    kind: "workspace",
    navigationLabel: "Workspace",
    navigable: true,
    description:
      graph.domain.description ??
      "A generated workspace view that summarizes the human-facing routes derived from the App Graph.",
    generated: true,
    actions: graph.capabilities.slice(0, 3).map((capability) => projectAction(capability)),
    states: createStates(`${graph.domain.title} workspace`),
    fields: [],
    relations: [],
    attentionQueues: []
  };
}

function projectResourceRoutes(
  resource: ResourceSpec,
  views: ViewSpec[],
  capabilitiesByResource: Map<string, CapabilitySpec[]>,
  policiesByKey: Map<string, PolicySpec>,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>
): HumanSurfaceRoute[] {
  const resourceViews = views.filter((view) => view.resource === resource.key);
  const resourceCapabilities = capabilitiesByResource.get(resource.key) ?? [];
  const actions = (capabilitiesByResource.get(resource.key) ?? []).map((capability) =>
    projectAction(
      capability,
      policiesByKey.get(capability.policy ?? ""),
      capability.task ? tasksByKey.get(capability.task) : undefined
    )
  );
  const listView = resourceViews.find((view) => view.kind === "list");
  const detailView = resourceViews.find((view) => view.kind === "detail");
  const formView = resourceViews.find((view) => view.kind === "form");

  return [
    createResourceRoute(resource, listView, "list", actions, resourceCapabilities),
    createResourceRoute(resource, detailView, "detail", actions, resourceCapabilities),
    createResourceRoute(resource, formView, "form", actions, resourceCapabilities)
  ];
}

function projectStandaloneViewRoute(
  view: ViewSpec,
  capabilities: CapabilitySpec[],
  policiesByKey: Map<string, PolicySpec>,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>
): HumanSurfaceRoute {
  const matchedActions = capabilities
    .filter((capability) => capability.key === view.capability)
    .map((capability) =>
      projectAction(
        capability,
        policiesByKey.get(capability.policy ?? ""),
        capability.task ? tasksByKey.get(capability.task) : undefined
      )
    );

  return {
    key: view.key,
    path: `/${toKebabCase(view.key)}`,
    title: view.title,
    kind: view.kind,
    navigationLabel: view.title,
    navigable: true,
    description:
      view.description ??
      "A projected standalone surface derived from the App Graph view definition.",
    ...optionalProperty("resourceKey", view.resource),
    ...optionalProperty("capabilityKey", view.capability),
    generated: false,
    actions: matchedActions,
    states: createStates(view.title),
    fields: [],
    relations: [],
    attentionQueues: projectRouteAttentionQueues(view.key, matchedActions)
  };
}

function createResourceRoute(
  resource: ResourceSpec,
  explicitView: ViewSpec | undefined,
  kind: "list" | "detail" | "form",
  actions: HumanSurfaceAction[],
  capabilities: CapabilitySpec[]
): HumanSurfaceRoute {
  const routeKey = explicitView?.key ?? `${resource.key}${startCase(kind).replace(/\s+/g, "")}`;
  const matchedCapability = selectRouteCapability(kind, explicitView, capabilities);
  const projectedFields = projectRouteFields(kind, resource, matchedCapability);
  const projectedRelations = projectRouteRelations(resource);
  const projectedAttentionQueues = projectRouteAttentionQueues(routeKey, actions);
  const title = explicitView?.title ?? `${resource.title} ${startCase(kind)}`;
  const description =
    explicitView?.description ??
    `A generated ${kind} route derived from the "${resource.key}" resource schema.`;
  const table =
    kind === "list"
      ? {
          columns: projectedFields.slice(0, 4),
          sampleRow: Object.fromEntries(
            projectedFields.slice(0, 4).map((field) => [field.key, sampleValueForField(field)])
          )
        }
      : undefined;

  return {
    key: routeKey,
    path: `/resources/${toKebabCase(resource.key)}/${kind}`,
    title,
    kind,
    navigationLabel: title,
    navigable: true,
    description,
    resourceKey: resource.key,
    ...optionalProperty("capabilityKey", explicitView?.capability ?? matchedCapability?.key),
    generated: !explicitView,
    actions,
    states: createStates(title),
    fields: projectedFields,
    relations: projectedRelations,
    attentionQueues: projectedAttentionQueues,
    ...optionalProperty("table", table)
  };
}

function projectRelationRoutes(
  resource: ResourceSpec,
  resourcesByKey: Map<string, ResourceSpec>,
  views: ViewSpec[],
  capabilitiesByResource: Map<string, CapabilitySpec[]>,
  policiesByKey: Map<string, PolicySpec>,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>
): HumanSurfaceRoute[] {
  return Object.entries(resource.relations ?? {}).flatMap(([relationKey, relation]) => {
    const targetResource = resourcesByKey.get(relation.resource);

    if (!targetResource) {
      return [];
    }

    const targetViews = views.filter((view) => view.resource === targetResource.key);
    const targetCapabilities = capabilitiesByResource.get(targetResource.key) ?? [];

    return [
      createRelationRoute(
        resource,
        relationKey,
        relation,
        targetResource,
        targetViews,
        targetCapabilities,
        policiesByKey,
        tasksByKey
      )
    ];
  });
}

function createRelationRoute(
  sourceResource: ResourceSpec,
  relationKey: string,
  relation: NonNullable<ResourceSpec["relations"]>[string],
  targetResource: ResourceSpec,
  targetViews: ViewSpec[],
  targetCapabilities: CapabilitySpec[],
  policiesByKey: Map<string, PolicySpec>,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>
): HumanSurfaceRoute {
  const routeReference = createRelationRouteReference(sourceResource, relationKey, relation);
  const kind = relation.kind === "many" ? "list" : "detail";
  const explicitView = targetViews.find((view) => view.kind === kind);
  const matchedCapability = selectRouteCapability(kind, explicitView, targetCapabilities);
  const actions = targetCapabilities.map((capability) =>
    projectAction(
      capability,
      policiesByKey.get(capability.policy ?? ""),
      capability.task ? tasksByKey.get(capability.task) : undefined
    )
  );
  const projectedFields = projectRouteFields(kind, targetResource, matchedCapability);
  const projectedRelations = projectRouteRelations(targetResource);
  const projectedAttentionQueues = projectRouteAttentionQueues(routeReference.key, actions);
  const table =
    kind === "list"
      ? {
          columns: projectedFields.slice(0, 4),
          sampleRow: Object.fromEntries(
            projectedFields.slice(0, 4).map((field) => [field.key, sampleValueForField(field)])
          )
        }
      : undefined;

  return {
    key: routeReference.key,
    path: routeReference.path,
    title: routeReference.title,
    kind,
    navigationLabel: routeReference.title,
    navigable: false,
    description: relation.description
      ? `${relation.description} This generated route is scoped from the "${sourceResource.key}.${relationKey}" relation.`
      : `A generated ${kind} route scoped from the "${sourceResource.key}.${relationKey}" relation onto the "${targetResource.key}" resource.`,
    resourceKey: targetResource.key,
    ...optionalProperty("capabilityKey", explicitView?.capability ?? matchedCapability?.key),
    sourceResourceKey: sourceResource.key,
    sourceRelationKey: relationKey,
    generated: true,
    actions,
    states: createStates(routeReference.title),
    fields: projectedFields,
    relations: projectedRelations,
    attentionQueues: projectedAttentionQueues,
    ...optionalProperty("table", table)
  };
}

function projectRouteFields(
  kind: "list" | "detail" | "form",
  resource: ResourceSpec,
  capability: CapabilitySpec | undefined
): HumanSurfaceField[] {
  const fieldSource =
    kind === "form"
      ? capability?.input ?? resource.fields
      : capability?.output ?? resource.fields;

  return Object.entries(fieldSource).map(([key, field]) => createHumanSurfaceField(key, field));
}

function projectRouteRelations(resource: ResourceSpec): HumanSurfaceRelationProjection[] {
  return Object.entries(resource.relations ?? {}).map(([relationKey, relation]) => {
    const routeReference = createRelationRouteReference(resource, relationKey, relation);

    return {
      key: relationKey,
      label: startCase(relationKey),
      resourceKey: relation.resource,
      kind: relation.kind,
      routeKey: routeReference.key,
      routeTitle: routeReference.title,
      path: routeReference.path,
      ...optionalProperty("description", relation.description)
    };
  });
}

function groupCapabilitiesByResource(capabilities: CapabilitySpec[]): Map<string, CapabilitySpec[]> {
  const grouped = new Map<string, CapabilitySpec[]>();

  for (const capability of capabilities) {
    for (const resourceKey of capability.resources ?? []) {
      const current = grouped.get(resourceKey) ?? [];
      current.push(capability);
      grouped.set(resourceKey, current);
    }
  }

  return grouped;
}

function projectAction(
  capability: CapabilitySpec,
  policy?: PolicySpec,
  task?: NormalizedAppGraph["tasks"][number]
): HumanSurfaceAction {
  const policyState = resolvePolicyState(policy);

  return {
    key: capability.key,
    capability: capability.key,
    title: capability.title,
    mode: capability.mode,
    resources: capability.resources ?? [],
    ...optionalProperty("task", capability.task),
    ...optionalProperty("taskKind", task?.kind),
    ...optionalProperty("taskTitle", task?.title),
    label: actionLabelForMode(capability.mode),
    policyState,
    policyLabel: policyLabelForState(policyState),
    note: actionNote(capability, policyState)
  };
}

function projectRouteAttentionQueues(
  routeKey: string,
  actions: HumanSurfaceAction[]
): HumanSurfaceAttentionQueueProjection[] {
  return actions.flatMap((action) => {
    const taskKey = action.task;

    if (!taskKey || action.taskKind !== "durable") {
      return [];
    }

    return attentionQueueStatusOrder.map((status) => ({
      key: `${routeKey}:${action.key}:${status}`,
      label: attentionQueueLabel(status),
      status,
      actionKey: action.key,
      actionTitle: action.title,
      taskKey,
      taskTitle: action.taskTitle ?? startCase(taskKey),
      filter: {
        taskKey,
        routeKey,
        actionKey: action.key,
        status
      }
    }));
  });
}

function projectGlobalAttention(
  routes: HumanSurfaceRoute[],
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  resourcesByKey: Map<string, ResourceSpec>
): HumanSurfaceAttentionProjection {
  const durableRouteActions = routes.flatMap((route) =>
    route.actions.flatMap((action) =>
      action.task && action.taskKind === "durable"
        ? [
            {
              route,
              action
            }
          ]
        : []
    )
  );

  if (!durableRouteActions.length) {
    return {
      queues: [],
      presets: []
    };
  }

  const taskPresets = new Map<string, HumanSurfaceAttentionPresetProjection>();
  const resourcePresets = new Map<string, HumanSurfaceAttentionPresetProjection>();
  const routePresets = new Map<string, HumanSurfaceAttentionPresetProjection>();

  for (const { route, action } of durableRouteActions) {
    const taskKey = action.task;

    if (taskKey && !taskPresets.has(taskKey)) {
      taskPresets.set(
        taskKey,
        createAttentionPreset(
          "task",
          taskKey,
          tasksByKey.get(taskKey)?.title ?? action.taskTitle ?? startCase(taskKey),
          `Durable runs started by task:${taskKey}.`,
          {
            taskKey
          }
        )
      );
    }

    for (const resourceKey of new Set(
      [route.resourceKey, route.sourceResourceKey].filter((value): value is string => Boolean(value))
    )) {
      if (resourcePresets.has(resourceKey)) {
        continue;
      }

      resourcePresets.set(
        resourceKey,
        createAttentionPreset(
          "resource",
          resourceKey,
          resourcesByKey.get(resourceKey)?.title ?? startCase(resourceKey),
          `Durable runs whose route or relation scope touches resource:${resourceKey}.`,
          {
            resourceKey
          }
        )
      );
    }

    if (!routePresets.has(route.key)) {
      routePresets.set(
        route.key,
        createAttentionPreset(
          "route",
          route.key,
          route.title,
          attentionPresetDescriptionForRoute(route),
          {
            routeKey: route.key
          }
        )
      );
    }
  }

  return {
    inbox: {
      key: "workflowAttentionInbox",
      label: "Open Attention Inbox"
    },
    queues: attentionQueueStatusOrder.map((status) => ({
      key: `workflowAttentionQueue:${status}`,
      label: attentionQueueLabel(status),
      status
    })),
    presets: [...taskPresets.values(), ...resourcePresets.values(), ...routePresets.values()]
  };
}

function createAttentionPreset(
  scope: HumanSurfaceAttentionPresetScope,
  key: string,
  label: string,
  description: string,
  filter: HumanSurfaceAttentionScopeFilter
): HumanSurfaceAttentionPresetProjection {
  const presetKey = `${scope}:${key}`;

  return {
    key: presetKey,
    label,
    scope,
    autoSlotKey: attentionPresetAutoSlotKey(scope),
    description,
    filter,
    inbox: {
      key: `${presetKey}:inbox`,
      label: `Open ${label} Attention Inbox`,
      filter
    },
    queues: attentionQueueStatusOrder.map((status) => ({
      key: `${presetKey}:queue:${status}`,
      label: attentionQueueLabel(status),
      status,
      filter: {
        ...filter,
        status
      }
    }))
  };
}

function attentionPresetDescriptionForRoute(route: HumanSurfaceRoute): string {
  if (route.sourceResourceKey && route.sourceRelationKey) {
    return `Durable runs scoped to relation route:${route.key} for ${route.sourceResourceKey}.${route.sourceRelationKey} at ${route.path}.`;
  }

  return `Durable runs scoped to route:${route.key} at ${route.path}.`;
}

function createHumanSurfaceField(key: string, field: FieldSpec | InputFieldSpec): HumanSurfaceField {
  return {
    key,
    label: startCase(key),
    type: field.type,
    required: field.required ?? false,
    ...optionalProperty("description", field.description)
  };
}

function selectRouteCapability(
  kind: "list" | "detail" | "form",
  explicitView: ViewSpec | undefined,
  capabilities: CapabilitySpec[]
): CapabilitySpec | undefined {
  if (explicitView?.capability) {
    return capabilities.find((capability) => capability.key === explicitView.capability);
  }

  switch (kind) {
    case "list":
      return capabilities.find((capability) => capability.mode === "read");
    case "form":
      return capabilities.find((capability) => capability.mode === "write");
    case "detail":
      return (
        capabilities.find((capability) => capability.mode === "external") ??
        capabilities.find((capability) => capability.mode === "read")
      );
  }
}

function renderRouteSection(route: HumanSurfaceRoute, isActive: boolean): string {
  const routeBadges = [
    `<span class="capstan-badge">${escapeHtml(route.kind)}</span>`,
    route.generated
      ? `<span class="capstan-badge">generated</span>`
      : `<span class="capstan-badge">graph-defined</span>`,
    route.sourceResourceKey && route.sourceRelationKey
      ? `<span class="capstan-badge">relation:${escapeHtml(route.sourceResourceKey)}.${escapeHtml(route.sourceRelationKey)}</span>`
      : "",
    route.resourceKey
      ? `<span class="capstan-badge">resource:${escapeHtml(route.resourceKey)}</span>`
      : ""
  ]
    .filter(Boolean)
    .join("");

  const actionCards = route.actions.length
    ? route.actions
        .map(
          (action) => `<article class="capstan-action">
  <strong>${escapeHtml(action.title)}</strong>
  <div class="capstan-badges">
    <span class="capstan-badge" data-tone="${escapeHtml(action.policyState)}">${escapeHtml(action.policyLabel)}</span>
    <span class="capstan-badge">${escapeHtml(action.label)}</span>
    ${
      action.task && action.taskKind === "durable"
        ? `<span class="capstan-badge">workflow:${escapeHtml(action.task)}</span>`
        : ""
    }
  </div>
  <p class="capstan-action-note">${escapeHtml(action.note)}</p>
  <button type="button" class="capstan-action-button" data-route-action="${escapeHtml(route.key)}" data-action-key="${escapeHtml(action.key)}">${escapeHtml(action.label)} · ${escapeHtml(action.title)}</button>
</article>`
        )
        .join("")
    : `<article class="capstan-action"><strong>No actions yet</strong><p class="capstan-action-note">Add capabilities that reference this route's resource to surface executable actions here.</p></article>`;

  const content = route.kind === "list" && route.table
    ? renderTableProjection(route)
    : renderFieldProjection(route);
  const relatedRecords = renderRelatedRecords(route);
  const attentionQueues = renderAttentionQueues(route);
  const attentionQueueResult = renderAttentionQueueResult(route);

  return `<section class="capstan-route" id="${escapeHtml(route.key)}" data-route-key="${escapeHtml(route.key)}"${isActive ? "" : " hidden"}>
  <header>
    <div>
      <h2>${escapeHtml(route.title)}</h2>
      <p>${escapeHtml(route.description)}</p>
    </div>
    <div class="capstan-badges">
      ${routeBadges}
      <span class="capstan-badge">${escapeHtml(route.path)}</span>
    </div>
  </header>
  <div class="capstan-grid">
    ${content}
    <div class="capstan-card">
      <h3>Capability Actions</h3>
      <div class="capstan-actions">${actionCards}</div>
    </div>
  </div>
  ${relatedRecords}
  ${attentionQueues}
  ${attentionQueueResult}
  <div class="capstan-card" style="margin-top: 16px;">
    <div class="capstan-runtime-header">
      <h3>Route Runtime</h3>
      <span class="capstan-runtime-pill" data-route-mode-label="${escapeHtml(route.key)}">ready</span>
    </div>
    <div class="capstan-runtime-toggles">
      <button type="button" class="capstan-state-toggle is-active" data-route-mode-target="${escapeHtml(route.key)}" data-route-mode="ready">Ready</button>
      <button type="button" class="capstan-state-toggle" data-route-mode-target="${escapeHtml(route.key)}" data-route-mode="loading">Loading</button>
      <button type="button" class="capstan-state-toggle" data-route-mode-target="${escapeHtml(route.key)}" data-route-mode="empty">Empty</button>
      <button type="button" class="capstan-state-toggle" data-route-mode-target="${escapeHtml(route.key)}" data-route-mode="error">Error</button>
    </div>
    <p class="capstan-state-copy" data-route-state-copy="${escapeHtml(route.key)}">${escapeHtml(readyCopyForRoute(route))}</p>
    <div class="capstan-states">
      ${renderStateCard(route.key, "Ready", readyCopyForRoute(route), false, "ready", true)}
      ${renderStateCard(route.key, "Loading", route.states.loading, true, "loading", false)}
      ${renderStateCard(route.key, "Empty", route.states.empty, false, "empty", false)}
      ${renderStateCard(route.key, "Error", route.states.error, false, "error", false)}
    </div>
  </div>
  <div class="capstan-card" style="margin-top: 16px;">
    <div class="capstan-runtime-header">
      <h3>Execution Result</h3>
      <span class="capstan-runtime-pill" data-route-result-status="${escapeHtml(route.key)}" data-route-result-state="idle">idle</span>
    </div>
    <p class="capstan-state-copy">The last execution payload for this route is captured here so the projected surface, the operator, and future agent consumers stay aligned.</p>
    <pre class="capstan-route-result" data-route-result-output="${escapeHtml(route.key)}">{
  "event": "route.idle",
  "routeKey": ${JSON.stringify(route.key)},
  "message": "No capability has been executed for this route yet."
}</pre>
  </div>
</section>`;
}

function renderRelatedRecords(route: HumanSurfaceRoute): string {
  if (!route.relations.length) {
    return "";
  }

  const items = route.relations
    .map(
      (relation) => `<article class="capstan-field">
  <strong>${escapeHtml(relation.label)}</strong>
  <span>${escapeHtml(relation.kind)} · resource:${escapeHtml(relation.resourceKey)}${relation.description ? ` · ${escapeHtml(relation.description)}` : ""}</span>
  <a class="capstan-related-link" href="#${escapeHtml(relation.path)}" data-related-path="${escapeHtml(relation.path)}">Open ${escapeHtml(relation.routeTitle)}</a>
</article>`
    )
    .join("");

  return `<div class="capstan-card" style="margin-top: 16px;">
  <h3>Related Records</h3>
  <div class="capstan-related-grid">${items}</div>
</div>`;
}

function renderAttentionQueues(route: HumanSurfaceRoute): string {
  if (!route.attentionQueues.length) {
    return "";
  }

  const items = route.attentionQueues
    .map(
      (queue) => `<article class="capstan-field">
  <strong>${escapeHtml(queue.label)}</strong>
  <span>${escapeHtml(queue.actionTitle)} · task:${escapeHtml(queue.taskKey)} · route:${escapeHtml(route.key)}</span>
  <span class="capstan-attention-count" data-attention-open-count-route="${escapeHtml(route.key)}" data-attention-action-key="${escapeHtml(queue.actionKey)}" data-attention-status="${escapeHtml(queue.status)}">0 open</span>
  <button type="button" class="capstan-action-button" data-attention-queue="true" data-attention-route-key="${escapeHtml(route.key)}" data-attention-action-key="${escapeHtml(queue.actionKey)}" data-attention-task-key="${escapeHtml(queue.taskKey)}" data-attention-queue-status="${escapeHtml(queue.status)}">Open ${escapeHtml(queue.label)} Queue</button>
</article>`
    )
    .join("");

  return `<div class="capstan-card" style="margin-top: 16px;">
  <h3>Attention Queues</h3>
  <p class="capstan-state-copy">Durable route actions automatically project grouped approval, input, block, failure, pause, and cancellation queues for operator supervision.</p>
  <div class="capstan-related-grid capstan-attention-grid">${items}</div>
</div>`;
}

function renderAttentionQueueResult(route: HumanSurfaceRoute): string {
  if (!route.attentionQueues.length) {
    return "";
  }

  return `<div class="capstan-card" style="margin-top: 16px;">
  <div class="capstan-runtime-header">
    <h3>Attention Queue Result</h3>
    <span class="capstan-runtime-pill" data-route-attention-status="${escapeHtml(route.key)}" data-route-attention-state="idle">idle</span>
  </div>
  <div class="capstan-badges capstan-attention-breadcrumbs" data-route-attention-handoff="${escapeHtml(route.key)}">
    <span class="capstan-badge">No Console Handoff</span>
  </div>
  <div class="capstan-attention-handoff-controls" data-route-attention-handoff-controls="${escapeHtml(route.key)}"></div>
  <p class="capstan-state-copy" data-route-attention-handoff-copy="${escapeHtml(route.key)}">Open a task-, resource-, or route-scoped attention preset from the operator console to carry breadcrumb context into this route-local queue lane.</p>
  <p class="capstan-state-copy">The last attention queue opened from this route is captured here so operators can inspect the exact filter, open count, and matching runs.</p>
  <pre class="capstan-route-result" data-route-attention-output="${escapeHtml(route.key)}">{
  "event": "route.attention.idle",
  "routeKey": ${JSON.stringify(route.key)},
  "message": "No attention queue lane has been opened for this route yet."
}</pre>
</div>`;
}

function renderTableProjection(route: HumanSurfaceRoute): string {
  const rows = route.table?.columns
    .map(
      (column) =>
        `<th>${escapeHtml(column.label)}</th>`
    )
    .join("");
  const cells = route.table?.columns
    .map((column) => `<td>${escapeHtml(route.table?.sampleRow[column.key] ?? "")}</td>`)
    .join("");

  return `<div class="capstan-card">
  <h3>List Projection</h3>
  <table class="capstan-table">
    <thead><tr>${rows}</tr></thead>
    <tbody data-route-table-body="${escapeHtml(route.key)}"><tr>${cells}</tr></tbody>
  </table>
</div>`;
}

function renderFieldProjection(route: HumanSurfaceRoute): string {
  if (route.kind === "form") {
    const fields = route.fields.length
      ? route.fields
          .map(
            (field) => `<label class="capstan-field">
  <strong>${escapeHtml(field.label)}</strong>
  <span>${escapeHtml(field.type)}${field.required ? " · required" : ""}${field.description ? ` · ${escapeHtml(field.description)}` : ""}</span>
  ${renderInputControl(route, field)}
</label>`
          )
          .join("")
      : `<div class="capstan-field"><strong>No form fields projected</strong><span>Add resource fields or capability input schemas to make this route interactive.</span></div>`;

    return `<div class="capstan-card">
  <h3>Form Projection</h3>
  <div class="capstan-form-grid">${fields}</div>
</div>`;
  }

  const fields = route.fields.length
    ? route.fields
        .map(
          (field) => `<div class="capstan-field">
  <strong>${escapeHtml(field.label)}</strong>
  <span>${escapeHtml(field.type)}${field.required ? " · required" : ""}${field.description ? ` · ${escapeHtml(field.description)}` : ""}</span>
  ${
    route.kind === "detail"
      ? `<div class="capstan-input" style="margin-top: 10px;" data-route-detail-value-route="${escapeHtml(route.key)}" data-field-key="${escapeHtml(field.key)}">${escapeHtml(sampleValueForField(field))}</div>`
      : ""
  }
</div>`
        )
        .join("")
    : `<div class="capstan-field"><strong>No fields projected</strong><span>This route is driven by higher-level graph semantics rather than a direct resource schema.</span></div>`;

  const title = route.kind === "detail" ? "Detail Projection" : "Field Projection";

  return `<div class="capstan-card">
  <h3>${title}</h3>
  <div class="capstan-fields">${fields}</div>
</div>`;
}

function renderStateCard(
  routeKey: string,
  title: string,
  copy: string,
  includeBars: boolean,
  mode: HumanSurfaceRuntimeMode,
  active: boolean
): string {
  return `<article class="capstan-state${active ? " is-active" : ""}" data-state-card-route="${escapeHtml(routeKey)}" data-state-card-value="${escapeHtml(mode)}">
  <strong>${escapeHtml(title)}</strong>
  <p class="capstan-state-copy">${escapeHtml(copy)}</p>
  ${
    includeBars
      ? `<div class="capstan-state-bars"><div class="capstan-state-bar"></div><div class="capstan-state-bar" style="width: 74%;"></div><div class="capstan-state-bar" style="width: 56%;"></div></div>`
      : ""
  }
</article>`;
}

function createStates(title: string): HumanSurfaceStateSet {
  return {
    loading: `Loading ${title.toLowerCase()} from the generated human surface runtime.`,
    empty: `No ${title.toLowerCase()} data is available yet. Connect a capability handler or seed data to populate this route.`,
    error: `This route is projected, but its backing runtime path has not been connected yet.`
  };
}

function resolvePolicyState(
  policy?: PolicySpec
): HumanSurfaceAction["policyState"] {
  switch (policy?.effect) {
    case "approve":
      return "approval_required";
    case "deny":
      return "blocked";
    case "redact":
      return "redacted";
    default:
      return "allowed";
  }
}

function readyCopyForRoute(route: HumanSurfaceRoute): string {
  return `Ready to operate ${route.title.toLowerCase()} from the generated human surface.`;
}

function renderInputControl(route: HumanSurfaceRoute, field: HumanSurfaceField): string {
  const sample = escapeHtml(sampleValueForField(field));
  const routeKey = escapeHtml(route.key);
  const fieldKey = escapeHtml(field.key);

  if (field.type === "json") {
    return `<textarea class="capstan-textarea" data-route-input-key="${routeKey}" data-field-key="${fieldKey}">${sample}</textarea>`;
  }

  return `<input class="capstan-input" data-route-input-key="${routeKey}" data-field-key="${fieldKey}" type="${inputTypeForField(field)}" value="${sample}" />`;
}

function inputTypeForField(field: HumanSurfaceField): string {
  switch (field.type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}

function renderRuntimeConsole(projection: HumanSurfaceProjection): string {
  const firstRoute = projection.routes[0];
  const attentionConsole = renderGlobalAttentionConsole(projection.attention);

  return `<section class="capstan-console" aria-live="polite">
  <header>
    <div>
      <h2>Operator Console</h2>
      <p>Navigate between projected routes, preview runtime states, and trigger generated actions without leaving the human surface shell.</p>
    </div>
    <span class="capstan-runtime-pill" data-console-mode>ready</span>
  </header>
  <div class="capstan-console-grid">
    <article class="capstan-console-card">
      <span>Active Route</span>
      <strong data-console-route>${escapeHtml(firstRoute?.title ?? "none")}</strong>
    </article>
    <article class="capstan-console-card">
      <span>Navigation</span>
      <strong>${projection.navigation.length} projected entries</strong>
    </article>
    <article class="capstan-console-card">
      <span>Action Reachability</span>
      <strong>${projection.routes.reduce((count, route) => count + route.actions.length, 0)} surfaced actions</strong>
    </article>
  </div>
  ${attentionConsole}
  <pre data-console-output>{
  "event": "human_surface.ready",
  "activeRoute": ${JSON.stringify(firstRoute?.key ?? "")},
  "routes": ${projection.routes.length}
}</pre>
</section>`;
}

function renderGlobalAttentionConsole(attention: HumanSurfaceAttentionProjection): string {
  if (!attention.inbox && !attention.queues.length && !attention.presets.length) {
    return "";
  }

  const inboxCard = attention.inbox
    ? `<article class="capstan-console-card">
  <span>Attention Inbox</span>
  <strong data-console-attention-total>0 open</strong>
  <button type="button" class="capstan-action-button" data-console-attention-inbox="${escapeHtml(attention.inbox.key)}">${escapeHtml(attention.inbox.label)}</button>
</article>`
    : "";

  const queueCards = attention.queues
    .map(
      (queue) => `<article class="capstan-console-card">
  <span>${escapeHtml(queue.label)}</span>
  <strong data-console-attention-count="${escapeHtml(queue.status)}">0 open</strong>
  <button type="button" class="capstan-action-button" data-console-attention-queue="${escapeHtml(queue.status)}">Open ${escapeHtml(queue.label)} Queue</button>
</article>`
    )
    .join("");

  const taskPresetGroup = renderAttentionPresetGroup(
    "Task Attention Presets",
    "Open durable work grouped by task before deciding which route or run to inspect next.",
    attention.presets.filter((preset) => preset.scope === "task")
  );
  const resourcePresetGroup = renderAttentionPresetGroup(
    "Resource Attention Presets",
    "Open durable work grouped by resource or relation context when one part of the domain needs supervision.",
    attention.presets.filter((preset) => preset.scope === "resource")
  );
  const routePresetGroup = renderAttentionPresetGroup(
    "Route Attention Presets",
    "Open durable work grouped by projected route when you want to move from global supervision into one concrete operator flow.",
    attention.presets.filter((preset) => preset.scope === "route")
  );
  const supervisionWorkspace = renderSupervisionWorkspace();

  return `<div class="capstan-card" style="margin-bottom: 18px;">
  <div class="capstan-runtime-header">
    <h3>Attention Inbox</h3>
    <span class="capstan-runtime-pill" data-console-attention-status="idle" data-console-attention-state="idle">idle</span>
  </div>
  <p class="capstan-state-copy">Open the global durable-work inbox first when you need to discover approvals, input requests, blocks, failures, pauses, or cancellations before targeting a specific route.</p>
  <div class="capstan-console-actions">
    ${inboxCard}
    ${queueCards}
  </div>
  ${taskPresetGroup}
  ${resourcePresetGroup}
  ${routePresetGroup}
  ${supervisionWorkspace}
  <pre class="capstan-route-result" data-console-attention-output>{
  "event": "console.attention.idle",
  "message": "No global attention inbox or queue has been opened yet."
}</pre>
</div>`;
}

function renderSupervisionWorkspace(): string {
  return `<div class="capstan-console-scope-group">
  <div class="capstan-runtime-header" style="margin-bottom: 8px;">
    <h4 style="margin: 0;">Supervision Workspace</h4>
    <span class="capstan-runtime-pill" data-console-supervision-status="idle" data-console-supervision-state="idle">idle</span>
  </div>
  <p class="capstan-console-copy" data-console-supervision-copy>Open a task-, resource-, or route-scoped attention preset to pin a reusable supervision workspace.</p>
  <div class="capstan-badges capstan-attention-breadcrumbs" data-console-supervision-trail>
    <span class="capstan-badge">No Pinned Workspace</span>
  </div>
  <div class="capstan-console-actions">
    <article class="capstan-console-card">
      <span>Pinned Trail</span>
      <strong data-console-supervision-total>0 open</strong>
      <button type="button" class="capstan-action-button" data-console-supervision-refresh disabled>Refresh Workspace</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-inbox disabled>Open Workspace Inbox</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-clear-active disabled>Clear Active</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-clear-history disabled>Clear History</button>
    </article>
  </div>
  <div class="capstan-console-lane-grid capstan-console-workspace-lanes">
    ${attentionQueueStatusOrder
      .map(
        (status) => `<button
    type="button"
    class="capstan-state-toggle"
    data-console-supervision-queue-status="${escapeHtml(status)}"
    data-console-supervision-queue-label="${escapeHtml(attentionQueueLabel(status))}"
    disabled
  >Open ${escapeHtml(attentionQueueLabel(status))} Queue · 0 open</button>`
      )
      .join("")}
  </div>
  <div class="capstan-runtime-header" style="margin: 12px 0 8px;">
    <h4 style="margin: 0;">Slot Attention Summary</h4>
    <span class="capstan-badge" data-console-supervision-slot-summary-count>0 active</span>
  </div>
  <div class="capstan-console-scope-grid" data-console-supervision-slot-summaries>
    ${supervisionWorkspaceSlots
      .map(
        (slot) => `<article class="capstan-console-card">
      <span>No Workspace</span>
      <strong>${escapeHtml(slot.label)}</strong>
      <div class="capstan-badges">
        <span class="capstan-badge">${escapeHtml(supervisionWorkspaceSlotRoleBadge(slot.key))}</span>
        <span class="capstan-badge">Waiting For Save</span>
      </div>
      <p class="capstan-console-copy">${escapeHtml(supervisionWorkspaceSlotSummaryPlaceholderCopy(slot.key))}</p>
      <span class="capstan-attention-count">0 open</span>
      <button type="button" class="capstan-action-button" data-console-supervision-slot-summary-open="${escapeHtml(slot.key)}" disabled>Open Slot Summary</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-slot-summary-queue="${escapeHtml(slot.key)}" disabled>Open Priority Queue</button>
    </article>`
      )
      .join("")}
  </div>
  <div class="capstan-runtime-header" style="margin: 12px 0 8px;">
    <h4 style="margin: 0;">Workspace Slots</h4>
    <span class="capstan-badge" data-console-supervision-slot-count>0 named</span>
  </div>
  <div class="capstan-console-scope-grid" data-console-supervision-slots>
    ${supervisionWorkspaceSlots
      .map(
        (slot) => `<article class="capstan-console-card">
      <span>Empty Slot</span>
      <strong>${escapeHtml(slot.label)}</strong>
      <div class="capstan-badges">
        <span class="capstan-badge">${escapeHtml(slot.label)} Slot</span>
        <span class="capstan-badge">${escapeHtml(supervisionWorkspaceSlotRoleBadge(slot.key))}</span>
      </div>
      <p class="capstan-console-copy">${escapeHtml(supervisionWorkspaceSlotRoleCopy(slot.key))}</p>
      <span class="capstan-attention-count">0 open</span>
      <button type="button" class="capstan-action-button" data-console-supervision-slot-open="${escapeHtml(slot.key)}" disabled>Open Slot</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-slot-save="${escapeHtml(slot.key)}" disabled>Save Active Here</button>
      <button type="button" class="capstan-state-toggle" data-console-supervision-slot-clear="${escapeHtml(slot.key)}" disabled>Clear Slot</button>
    </article>`
      )
      .join("")}
  </div>
  <div class="capstan-runtime-header" style="margin: 12px 0 8px;">
    <h4 style="margin: 0;">Saved Workspaces</h4>
    <span class="capstan-badge" data-console-supervision-history-count>0 saved</span>
  </div>
  <div class="capstan-console-scope-grid" data-console-supervision-history>
    <article class="capstan-console-card">
      <span>No Saved Workspaces</span>
      <strong>Pin an attention trail to recover it later.</strong>
    </article>
  </div>
</div>`;
}

function renderAttentionPresetGroup(
  title: string,
  description: string,
  presets: HumanSurfaceAttentionPresetProjection[]
): string {
  if (!presets.length) {
    return "";
  }

  return `<div class="capstan-console-scope-group">
  <div class="capstan-runtime-header" style="margin-bottom: 8px;">
    <h4 style="margin: 0;">${escapeHtml(title)}</h4>
    <span class="capstan-badge">${presets.length} preset${presets.length === 1 ? "" : "s"}</span>
  </div>
  <p class="capstan-console-copy">${escapeHtml(description)}</p>
  <div class="capstan-console-scope-grid">
    ${presets.map((preset) => renderAttentionPresetCard(preset)).join("")}
  </div>
</div>`;
}

function renderAttentionPresetCard(preset: HumanSurfaceAttentionPresetProjection): string {
  const queueButtons = preset.queues
    .map(
      (queue) => `<button
    type="button"
    class="capstan-state-toggle"
    data-console-attention-preset-queue="${escapeHtml(preset.key)}"
    data-console-attention-preset-status="${escapeHtml(queue.status)}"
    data-console-attention-preset-queue-label="${escapeHtml(queue.label)}"
  >Open ${escapeHtml(queue.label)} Queue · 0 open</button>`
    )
    .join("");

  return `<article class="capstan-console-card" data-console-attention-preset-auto-slot="${escapeHtml(preset.autoSlotKey)}">
  <span>${escapeHtml(attentionPresetScopeLabel(preset.scope))}</span>
  <strong>${escapeHtml(preset.label)}</strong>
  <div class="capstan-badges">
    <span class="capstan-badge">Auto Slot</span>
    <span class="capstan-badge">${escapeHtml(supervisionWorkspaceSlotLabel(preset.autoSlotKey))} Slot</span>
  </div>
  <p class="capstan-console-copy">${escapeHtml(`${preset.description} ${attentionPresetAutoSlotCopy(preset.autoSlotKey)}`)}</p>
  <span class="capstan-attention-count" data-console-attention-preset-total="${escapeHtml(preset.key)}">0 open</span>
  <button type="button" class="capstan-action-button" data-console-attention-preset-inbox="${escapeHtml(preset.key)}">${escapeHtml(preset.inbox.label)}</button>
  <div class="capstan-console-lane-grid">
    ${queueButtons}
  </div>
</article>`;
}


function policyLabelForState(state: HumanSurfaceAction["policyState"]): string {
  switch (state) {
    case "approval_required":
      return "approval required";
    case "blocked":
      return "blocked";
    case "redacted":
      return "redacted";
    default:
      return "ready";
  }
}

function attentionQueueLabel(status: HumanSurfaceAttentionQueueStatus): string {
  switch (status) {
    case "approval_required":
      return "Approval Required";
    case "input_required":
      return "Input Required";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
  }
}

function attentionPresetScopeLabel(scope: HumanSurfaceAttentionPresetScope): string {
  switch (scope) {
    case "task":
      return "Task Attention";
    case "resource":
      return "Resource Attention";
    case "route":
      return "Route Attention";
  }
}

function attentionPresetAutoSlotKey(
  scope: HumanSurfaceAttentionPresetScope
): HumanSurfaceSupervisionWorkspaceSlotKey {
  switch (scope) {
    case "task":
      return "primary";
    case "resource":
      return "secondary";
    case "route":
      return "watchlist";
  }
}

function supervisionWorkspaceSlotLabel(
  slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
): string {
  return (
    supervisionWorkspaceSlots.find((slot) => slot.key === slotKey)?.label ?? startCase(slotKey)
  );
}

function supervisionWorkspaceSlotRoleBadge(
  slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
): string {
  switch (slotKey) {
    case "primary":
      return "Task Auto Slot";
    case "secondary":
      return "Resource Auto Slot";
    case "watchlist":
      return "Route Auto Slot";
  }
}

function attentionPresetAutoSlotCopy(
  slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
): string {
  return `Opening this preset auto-saves it into the ${supervisionWorkspaceSlotLabel(slotKey)} slot unless you manually replace that slot.`;
}

function supervisionWorkspaceSlotSummaryPlaceholderCopy(
  slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
): string {
  return `When this ${supervisionWorkspaceSlotLabel(slotKey).toLowerCase()} slot is tracking a workspace, the console will show its live open count, new-since-open delta, and highest-priority attention lane here.`;
}

function supervisionWorkspaceSlotRoleCopy(
  slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
): string {
  switch (slotKey) {
    case "primary":
      return "Task attention presets auto-save here unless you manually replace the slot.";
    case "secondary":
      return "Resource attention presets auto-save here unless you manually replace the slot.";
    case "watchlist":
      return "Route attention presets auto-save here unless you manually replace the slot.";
  }
}

function actionLabelForMode(mode: CapabilitySpec["mode"]): string {
  switch (mode) {
    case "write":
      return "submit action";
    case "external":
      return "launch action";
    default:
      return "run action";
  }
}

function actionNote(
  capability: CapabilitySpec,
  policyState: HumanSurfaceAction["policyState"]
): string {
  const base = capability.description ?? `Execute the "${capability.key}" capability from the projected human surface.`;

  switch (policyState) {
    case "approval_required":
      return `${base} This action is present, but the graph marks it as approval-gated.`;
    case "blocked":
      return `${base} The current policy projection blocks direct execution.`;
    case "redacted":
      return `${base} Outputs from this action may be redacted before they reach the operator.`;
    default:
      return base;
  }
}

function sampleValueForField(field: HumanSurfaceField): string {
  switch (field.type) {
    case "integer":
      return "7";
    case "number":
      return "42.5";
    case "boolean":
      return "true";
    case "date":
      return "2026-03-22";
    case "datetime":
      return "2026-03-22T10:00:00Z";
    case "json":
      return '{"ok":true}';
    default:
      return `${field.label} sample`;
  }
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

function dedupeRoutes(routes: HumanSurfaceRoute[]): HumanSurfaceRoute[] {
  const seen = new Set<string>();
  const unique: HumanSurfaceRoute[] = [];

  for (const route of routes) {
    if (seen.has(route.key)) {
      continue;
    }

    seen.add(route.key);
    unique.push(route);
  }

  return unique;
}

function createRelationRouteReference(
  resource: ResourceSpec,
  relationKey: string,
  relation: NonNullable<ResourceSpec["relations"]>[string]
): {
  key: string;
  path: string;
  title: string;
} {
  const routeKind = relation.kind === "many" ? "list" : "detail";
  const relationStem = startCase(relationKey).replace(/\s+/g, "");
  const routeKindStem = startCase(routeKind).replace(/\s+/g, "");

  return {
    key: `${resource.key}${relationStem}Relation${routeKindStem}`,
    path: `/resources/${toKebabCase(resource.key)}/relations/${toKebabCase(relationKey)}/${routeKind}`,
    title: `${resource.title} ${startCase(relationKey)} ${startCase(routeKind)}`
  };
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function startCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
