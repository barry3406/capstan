import { execute } from "../control-plane/index.js";

export const humanSurface = {
  "domain": {
    "key": "operations",
    "title": "Operations Console",
    "description": "A simple example graph used to validate the first Capstan loop."
  },
  "summary": {
    "resourceCount": 1,
    "capabilityCount": 1,
    "routeCount": 4
  },
  "navigation": [
    {
      "key": "workspaceHome",
      "label": "Workspace",
      "path": "/",
      "routeKey": "workspaceHome"
    },
    {
      "key": "ticketDetail",
      "label": "Ticket Detail",
      "path": "/resources/ticket/detail",
      "routeKey": "ticketDetail"
    },
    {
      "key": "ticketForm",
      "label": "Ticket Form",
      "path": "/resources/ticket/form",
      "routeKey": "ticketForm"
    },
    {
      "key": "ticketList",
      "label": "Ticket List",
      "path": "/resources/ticket/list",
      "routeKey": "ticketList"
    }
  ],
  "routes": [
    {
      "key": "workspaceHome",
      "path": "/",
      "title": "Operations Console Workspace",
      "kind": "workspace",
      "navigationLabel": "Workspace",
      "description": "A simple example graph used to validate the first Capstan loop.",
      "generated": true,
      "actions": [
        {
          "key": "listTickets",
          "capability": "listTickets",
          "title": "List Tickets",
          "mode": "read",
          "resources": [
            "ticket"
          ],
          "label": "run action",
          "policyState": "allowed",
          "policyLabel": "ready",
          "note": "Execute the \"listTickets\" capability from the projected human surface."
        }
      ],
      "states": {
        "loading": "Loading operations console workspace from the generated human surface runtime.",
        "empty": "No operations console workspace data is available yet. Connect a capability handler or seed data to populate this route.",
        "error": "This route is projected, but its backing runtime path has not been connected yet."
      },
      "fields": []
    },
    {
      "key": "ticketDetail",
      "path": "/resources/ticket/detail",
      "title": "Ticket Detail",
      "kind": "detail",
      "navigationLabel": "Ticket Detail",
      "description": "A generated detail route derived from the \"ticket\" resource schema.",
      "resourceKey": "ticket",
      "generated": true,
      "actions": [
        {
          "key": "listTickets",
          "capability": "listTickets",
          "title": "List Tickets",
          "mode": "read",
          "resources": [
            "ticket"
          ],
          "label": "run action",
          "policyState": "allowed",
          "policyLabel": "ready",
          "note": "Execute the \"listTickets\" capability from the projected human surface."
        }
      ],
      "states": {
        "loading": "Loading ticket detail from the generated human surface runtime.",
        "empty": "No ticket detail data is available yet. Connect a capability handler or seed data to populate this route.",
        "error": "This route is projected, but its backing runtime path has not been connected yet."
      },
      "fields": [
        {
          "key": "status",
          "label": "Status",
          "type": "string",
          "required": true
        },
        {
          "key": "title",
          "label": "Title",
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "key": "ticketForm",
      "path": "/resources/ticket/form",
      "title": "Ticket Form",
      "kind": "form",
      "navigationLabel": "Ticket Form",
      "description": "A generated form route derived from the \"ticket\" resource schema.",
      "resourceKey": "ticket",
      "generated": true,
      "actions": [
        {
          "key": "listTickets",
          "capability": "listTickets",
          "title": "List Tickets",
          "mode": "read",
          "resources": [
            "ticket"
          ],
          "label": "run action",
          "policyState": "allowed",
          "policyLabel": "ready",
          "note": "Execute the \"listTickets\" capability from the projected human surface."
        }
      ],
      "states": {
        "loading": "Loading ticket form from the generated human surface runtime.",
        "empty": "No ticket form data is available yet. Connect a capability handler or seed data to populate this route.",
        "error": "This route is projected, but its backing runtime path has not been connected yet."
      },
      "fields": [
        {
          "key": "status",
          "label": "Status",
          "type": "string",
          "required": true
        },
        {
          "key": "title",
          "label": "Title",
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "key": "ticketList",
      "path": "/resources/ticket/list",
      "title": "Ticket List",
      "kind": "list",
      "navigationLabel": "Ticket List",
      "description": "A generated list route derived from the \"ticket\" resource schema.",
      "resourceKey": "ticket",
      "capabilityKey": "listTickets",
      "generated": false,
      "actions": [
        {
          "key": "listTickets",
          "capability": "listTickets",
          "title": "List Tickets",
          "mode": "read",
          "resources": [
            "ticket"
          ],
          "label": "run action",
          "policyState": "allowed",
          "policyLabel": "ready",
          "note": "Execute the \"listTickets\" capability from the projected human surface."
        }
      ],
      "states": {
        "loading": "Loading ticket list from the generated human surface runtime.",
        "empty": "No ticket list data is available yet. Connect a capability handler or seed data to populate this route.",
        "error": "This route is projected, but its backing runtime path has not been connected yet."
      },
      "fields": [
        {
          "key": "status",
          "label": "Status",
          "type": "string",
          "required": true
        },
        {
          "key": "title",
          "label": "Title",
          "type": "string",
          "required": true
        }
      ],
      "table": {
        "columns": [
          {
            "key": "status",
            "label": "Status",
            "type": "string",
            "required": true
          },
          {
            "key": "title",
            "label": "Title",
            "type": "string",
            "required": true
          }
        ],
        "sampleRow": {
          "status": "Status sample",
          "title": "Title sample"
        }
      }
    }
  ]
};

export const humanSurfaceHtml = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>Operations Console · Capstan Human Surface</title>\n    <style>\n      :root {\n        color-scheme: light;\n        --capstan-bg: #f5f3ef;\n        --capstan-panel: rgba(255, 255, 255, 0.9);\n        --capstan-border: rgba(27, 31, 35, 0.12);\n        --capstan-text: #111827;\n        --capstan-muted: #5b6470;\n        --capstan-accent: #1356d7;\n        --capstan-accent-soft: rgba(19, 86, 215, 0.08);\n        --capstan-success: #0f8a5f;\n        --capstan-warning: #9a6700;\n        --capstan-danger: #a53d2d;\n      }\n\n      * {\n        box-sizing: border-box;\n      }\n\n      body {\n        margin: 0;\n        font-family: \"IBM Plex Sans\", \"Segoe UI\", sans-serif;\n        background:\n          radial-gradient(circle at top left, rgba(19, 86, 215, 0.08), transparent 28%),\n          linear-gradient(180deg, #faf7f2 0%, var(--capstan-bg) 100%);\n        color: var(--capstan-text);\n      }\n\n      .capstan-shell {\n        display: grid;\n        grid-template-columns: 280px minmax(0, 1fr);\n        min-height: 100vh;\n      }\n\n      .capstan-sidebar {\n        padding: 28px 22px;\n        border-right: 1px solid var(--capstan-border);\n        background: rgba(255, 255, 255, 0.72);\n        backdrop-filter: blur(18px);\n        position: sticky;\n        top: 0;\n        align-self: start;\n        min-height: 100vh;\n      }\n\n      .capstan-brand {\n        margin-bottom: 24px;\n      }\n\n      .capstan-eyebrow {\n        display: inline-flex;\n        align-items: center;\n        gap: 8px;\n        border-radius: 999px;\n        background: var(--capstan-accent-soft);\n        color: var(--capstan-accent);\n        padding: 6px 10px;\n        font-size: 12px;\n        font-weight: 600;\n        letter-spacing: 0.04em;\n        text-transform: uppercase;\n      }\n\n      .capstan-brand h1 {\n        margin: 14px 0 10px;\n        font-size: 24px;\n        line-height: 1.1;\n      }\n\n      .capstan-brand p {\n        margin: 0;\n        color: var(--capstan-muted);\n        line-height: 1.6;\n      }\n\n      .capstan-nav {\n        display: flex;\n        flex-direction: column;\n        gap: 10px;\n      }\n\n      .capstan-nav-link {\n        display: flex;\n        flex-direction: column;\n        gap: 4px;\n        padding: 12px 14px;\n        border-radius: 16px;\n        border: 1px solid transparent;\n        color: inherit;\n        text-decoration: none;\n        background: rgba(255, 255, 255, 0.6);\n      }\n\n      .capstan-nav-link:hover {\n        border-color: var(--capstan-border);\n        background: white;\n      }\n\n      .capstan-nav-link.is-active {\n        border-color: rgba(19, 86, 215, 0.18);\n        background: rgba(19, 86, 215, 0.08);\n      }\n\n      .capstan-nav-path {\n        font-family: \"IBM Plex Mono\", \"SFMono-Regular\", monospace;\n        font-size: 11px;\n        color: var(--capstan-muted);\n      }\n\n      .capstan-main {\n        padding: 28px 28px 40px;\n      }\n\n      .capstan-summary {\n        display: grid;\n        grid-template-columns: repeat(3, minmax(0, 1fr));\n        gap: 14px;\n        margin-bottom: 20px;\n      }\n\n      .capstan-summary-card,\n      .capstan-route,\n      .capstan-card {\n        border: 1px solid var(--capstan-border);\n        border-radius: 22px;\n        background: var(--capstan-panel);\n        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.06);\n      }\n\n      .capstan-summary-card {\n        padding: 18px 20px;\n      }\n\n      .capstan-summary-card span {\n        display: block;\n        color: var(--capstan-muted);\n        font-size: 13px;\n        margin-bottom: 10px;\n      }\n\n      .capstan-summary-card strong {\n        font-size: 28px;\n      }\n\n      .capstan-route {\n        padding: 24px;\n        margin-bottom: 18px;\n      }\n\n      .capstan-route[hidden] {\n        display: none;\n      }\n\n      .capstan-route[data-runtime-state=\"loading\"] .capstan-grid,\n      .capstan-route[data-runtime-state=\"empty\"] .capstan-grid,\n      .capstan-route[data-runtime-state=\"error\"] .capstan-grid {\n        opacity: 0.52;\n      }\n\n      .capstan-route header {\n        display: flex;\n        justify-content: space-between;\n        gap: 18px;\n        align-items: flex-start;\n        margin-bottom: 20px;\n      }\n\n      .capstan-route h2 {\n        margin: 0 0 8px;\n        font-size: 24px;\n      }\n\n      .capstan-route p {\n        margin: 0;\n        color: var(--capstan-muted);\n        line-height: 1.6;\n      }\n\n      .capstan-badges {\n        display: flex;\n        gap: 8px;\n        flex-wrap: wrap;\n      }\n\n      .capstan-badge {\n        border-radius: 999px;\n        padding: 7px 10px;\n        font-size: 12px;\n        font-weight: 600;\n        border: 1px solid var(--capstan-border);\n        background: white;\n      }\n\n      .capstan-badge[data-tone=\"approval_required\"] {\n        color: var(--capstan-warning);\n        background: rgba(154, 103, 0, 0.08);\n      }\n\n      .capstan-badge[data-tone=\"blocked\"] {\n        color: var(--capstan-danger);\n        background: rgba(165, 61, 45, 0.08);\n      }\n\n      .capstan-badge[data-tone=\"redacted\"] {\n        color: var(--capstan-accent);\n        background: var(--capstan-accent-soft);\n      }\n\n      .capstan-badge[data-tone=\"allowed\"] {\n        color: var(--capstan-success);\n        background: rgba(15, 138, 95, 0.08);\n      }\n\n      .capstan-grid {\n        display: grid;\n        grid-template-columns: 1.5fr 1fr;\n        gap: 16px;\n      }\n\n      .capstan-card {\n        padding: 18px;\n      }\n\n      .capstan-card h3 {\n        margin: 0 0 14px;\n        font-size: 16px;\n      }\n\n      .capstan-table {\n        width: 100%;\n        border-collapse: collapse;\n      }\n\n      .capstan-table th,\n      .capstan-table td {\n        text-align: left;\n        padding: 10px 0;\n        border-bottom: 1px solid var(--capstan-border);\n        font-size: 14px;\n      }\n\n      .capstan-table th {\n        color: var(--capstan-muted);\n        font-size: 12px;\n        letter-spacing: 0.03em;\n        text-transform: uppercase;\n      }\n\n      .capstan-form-grid,\n      .capstan-fields {\n        display: grid;\n        gap: 12px;\n      }\n\n      .capstan-field {\n        border: 1px solid var(--capstan-border);\n        border-radius: 16px;\n        padding: 14px;\n        background: rgba(255, 255, 255, 0.78);\n      }\n\n      .capstan-field strong {\n        display: block;\n        margin-bottom: 6px;\n      }\n\n      .capstan-field span,\n      .capstan-action-note,\n      .capstan-state-copy {\n        color: var(--capstan-muted);\n        font-size: 13px;\n        line-height: 1.5;\n      }\n\n      .capstan-actions {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 12px;\n      }\n\n      .capstan-action {\n        padding: 12px 14px;\n        border-radius: 16px;\n        border: 1px solid var(--capstan-border);\n        background: white;\n      }\n\n      .capstan-action strong {\n        display: block;\n        margin-bottom: 4px;\n      }\n\n      .capstan-action-button,\n      .capstan-state-toggle {\n        margin-top: 12px;\n        display: inline-flex;\n        align-items: center;\n        justify-content: center;\n        gap: 8px;\n        border: 1px solid transparent;\n        border-radius: 999px;\n        background: var(--capstan-text);\n        color: white;\n        padding: 9px 12px;\n        font-size: 12px;\n        font-weight: 600;\n        cursor: pointer;\n      }\n\n      .capstan-action-button:hover,\n      .capstan-state-toggle:hover {\n        background: #1f2937;\n      }\n\n      .capstan-action-button:disabled,\n      .capstan-state-toggle:disabled {\n        cursor: not-allowed;\n        opacity: 0.56;\n      }\n\n      .capstan-state-toggle {\n        background: white;\n        color: var(--capstan-text);\n        border-color: var(--capstan-border);\n      }\n\n      .capstan-state-toggle.is-active {\n        background: rgba(19, 86, 215, 0.08);\n        color: var(--capstan-accent);\n        border-color: rgba(19, 86, 215, 0.2);\n      }\n\n      .capstan-runtime-header {\n        display: flex;\n        justify-content: space-between;\n        gap: 12px;\n        align-items: center;\n        margin-bottom: 14px;\n      }\n\n      .capstan-runtime-pill {\n        display: inline-flex;\n        align-items: center;\n        padding: 7px 10px;\n        border-radius: 999px;\n        font-size: 12px;\n        font-weight: 600;\n        background: rgba(19, 86, 215, 0.08);\n        color: var(--capstan-accent);\n      }\n\n      .capstan-runtime-pill[data-route-result-state=\"idle\"] {\n        background: rgba(17, 24, 39, 0.04);\n        color: var(--capstan-muted);\n      }\n\n      .capstan-runtime-pill[data-route-result-state=\"completed\"] {\n        background: rgba(15, 138, 95, 0.08);\n        color: var(--capstan-success);\n      }\n\n      .capstan-runtime-pill[data-route-result-state=\"redacted\"] {\n        background: var(--capstan-accent-soft);\n        color: var(--capstan-accent);\n      }\n\n      .capstan-runtime-pill[data-route-result-state=\"approval_required\"],\n      .capstan-runtime-pill[data-route-result-state=\"not_implemented\"] {\n        background: rgba(154, 103, 0, 0.08);\n        color: var(--capstan-warning);\n      }\n\n      .capstan-runtime-pill[data-route-result-state=\"blocked\"],\n      .capstan-runtime-pill[data-route-result-state=\"error\"] {\n        background: rgba(165, 61, 45, 0.08);\n        color: var(--capstan-danger);\n      }\n\n      .capstan-runtime-toggles {\n        display: flex;\n        flex-wrap: wrap;\n        gap: 8px;\n        margin-bottom: 12px;\n      }\n\n      .capstan-states {\n        display: grid;\n        grid-template-columns: repeat(4, minmax(0, 1fr));\n        gap: 12px;\n      }\n\n      .capstan-state {\n        border-radius: 18px;\n        padding: 16px;\n        background: rgba(17, 24, 39, 0.02);\n        border: 1px dashed var(--capstan-border);\n      }\n\n      .capstan-state strong {\n        display: block;\n        margin-bottom: 8px;\n      }\n\n      .capstan-state.is-active {\n        border-style: solid;\n        border-color: rgba(19, 86, 215, 0.25);\n        background: rgba(19, 86, 215, 0.06);\n      }\n\n      .capstan-state-bars {\n        display: flex;\n        flex-direction: column;\n        gap: 6px;\n        margin-top: 12px;\n      }\n\n      .capstan-state-bar {\n        height: 8px;\n        border-radius: 999px;\n        background: linear-gradient(90deg, rgba(19, 86, 215, 0.18), rgba(19, 86, 215, 0.05));\n      }\n\n      .capstan-input,\n      .capstan-textarea {\n        width: 100%;\n        margin-top: 10px;\n        border: 1px solid var(--capstan-border);\n        border-radius: 14px;\n        background: white;\n        color: var(--capstan-text);\n        padding: 10px 12px;\n        font: inherit;\n      }\n\n      .capstan-textarea {\n        min-height: 110px;\n        resize: vertical;\n      }\n\n      .capstan-console {\n        border: 1px solid var(--capstan-border);\n        border-radius: 22px;\n        background: rgba(17, 24, 39, 0.96);\n        color: #f8fafc;\n        padding: 20px 22px;\n        margin-bottom: 18px;\n        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.16);\n      }\n\n      .capstan-console header {\n        display: flex;\n        justify-content: space-between;\n        gap: 14px;\n        align-items: flex-start;\n        margin-bottom: 14px;\n      }\n\n      .capstan-console h2 {\n        margin: 0 0 8px;\n        font-size: 18px;\n      }\n\n      .capstan-console p {\n        margin: 0;\n        color: rgba(248, 250, 252, 0.72);\n        line-height: 1.5;\n      }\n\n      .capstan-console-grid {\n        display: grid;\n        grid-template-columns: repeat(3, minmax(0, 1fr));\n        gap: 12px;\n        margin-bottom: 14px;\n      }\n\n      .capstan-console-card {\n        border: 1px solid rgba(255, 255, 255, 0.12);\n        border-radius: 18px;\n        padding: 14px;\n        background: rgba(255, 255, 255, 0.04);\n      }\n\n      .capstan-console-card span {\n        display: block;\n        font-size: 12px;\n        color: rgba(248, 250, 252, 0.68);\n        margin-bottom: 6px;\n      }\n\n      .capstan-console-card strong {\n        display: block;\n      }\n\n      .capstan-console pre {\n        margin: 0;\n        overflow: auto;\n        border-radius: 18px;\n        background: rgba(255, 255, 255, 0.04);\n        padding: 16px;\n        font-family: \"IBM Plex Mono\", \"SFMono-Regular\", monospace;\n        font-size: 12px;\n        line-height: 1.6;\n      }\n\n      .capstan-route-result {\n        margin: 0;\n        overflow: auto;\n        border-radius: 18px;\n        background: rgba(17, 24, 39, 0.04);\n        border: 1px solid var(--capstan-border);\n        padding: 16px;\n        font-family: \"IBM Plex Mono\", \"SFMono-Regular\", monospace;\n        font-size: 12px;\n        line-height: 1.6;\n      }\n\n      @media (max-width: 1024px) {\n        .capstan-shell {\n          grid-template-columns: 1fr;\n        }\n\n        .capstan-sidebar {\n          position: static;\n          min-height: auto;\n          border-right: none;\n          border-bottom: 1px solid var(--capstan-border);\n        }\n\n        .capstan-grid,\n        .capstan-summary,\n        .capstan-console-grid,\n        .capstan-states {\n          grid-template-columns: 1fr;\n        }\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"capstan-shell\">\n      <aside class=\"capstan-sidebar\">\n        <div class=\"capstan-brand\">\n          <span class=\"capstan-eyebrow\">Capstan Human Surface</span>\n          <h1>Operations Console</h1>\n          <p>A simple example graph used to validate the first Capstan loop.</p>\n        </div>\n        <nav class=\"capstan-nav\">\n          <a class=\"capstan-nav-link is-active\" href=\"#workspaceHome\" data-route-nav=\"workspaceHome\"><span>Workspace</span><span class=\"capstan-nav-path\">/</span></a><a class=\"capstan-nav-link\" href=\"#ticketDetail\" data-route-nav=\"ticketDetail\"><span>Ticket Detail</span><span class=\"capstan-nav-path\">/resources/ticket/detail</span></a><a class=\"capstan-nav-link\" href=\"#ticketForm\" data-route-nav=\"ticketForm\"><span>Ticket Form</span><span class=\"capstan-nav-path\">/resources/ticket/form</span></a><a class=\"capstan-nav-link\" href=\"#ticketList\" data-route-nav=\"ticketList\"><span>Ticket List</span><span class=\"capstan-nav-path\">/resources/ticket/list</span></a>\n        </nav>\n      </aside>\n      <main class=\"capstan-main\">\n        <section class=\"capstan-summary\">\n          <article class=\"capstan-summary-card\"><span>Resources</span><strong>1</strong></article>\n          <article class=\"capstan-summary-card\"><span>Capabilities</span><strong>1</strong></article>\n          <article class=\"capstan-summary-card\"><span>Projected Routes</span><strong>4</strong></article>\n        </section>\n        <section class=\"capstan-console\" aria-live=\"polite\">\n  <header>\n    <div>\n      <h2>Operator Console</h2>\n      <p>Navigate between projected routes, preview runtime states, and trigger generated actions without leaving the human surface shell.</p>\n    </div>\n    <span class=\"capstan-runtime-pill\" data-console-mode>ready</span>\n  </header>\n  <div class=\"capstan-console-grid\">\n    <article class=\"capstan-console-card\">\n      <span>Active Route</span>\n      <strong data-console-route>Operations Console Workspace</strong>\n    </article>\n    <article class=\"capstan-console-card\">\n      <span>Navigation</span>\n      <strong>4 projected entries</strong>\n    </article>\n    <article class=\"capstan-console-card\">\n      <span>Action Reachability</span>\n      <strong>4 surfaced actions</strong>\n    </article>\n  </div>\n  <pre data-console-output>{\n  \"event\": \"human_surface.ready\",\n  \"activeRoute\": \"workspaceHome\",\n  \"routes\": 4\n}</pre>\n</section>\n        <section class=\"capstan-route\" id=\"workspaceHome\" data-route-key=\"workspaceHome\">\n  <header>\n    <div>\n      <h2>Operations Console Workspace</h2>\n      <p>A simple example graph used to validate the first Capstan loop.</p>\n    </div>\n    <div class=\"capstan-badges\">\n      <span class=\"capstan-badge\">workspace</span><span class=\"capstan-badge\">generated</span>\n      <span class=\"capstan-badge\">/</span>\n    </div>\n  </header>\n  <div class=\"capstan-grid\">\n    <div class=\"capstan-card\">\n  <h3>Field Projection</h3>\n  <div class=\"capstan-fields\"><div class=\"capstan-field\"><strong>No fields projected</strong><span>This route is driven by higher-level graph semantics rather than a direct resource schema.</span></div></div>\n</div>\n    <div class=\"capstan-card\">\n      <h3>Capability Actions</h3>\n      <div class=\"capstan-actions\"><article class=\"capstan-action\">\n  <strong>List Tickets</strong>\n  <div class=\"capstan-badges\">\n    <span class=\"capstan-badge\" data-tone=\"allowed\">ready</span>\n    <span class=\"capstan-badge\">run action</span>\n  </div>\n  <p class=\"capstan-action-note\">Execute the &quot;listTickets&quot; capability from the projected human surface.</p>\n  <button type=\"button\" class=\"capstan-action-button\" data-route-action=\"workspaceHome\" data-action-key=\"listTickets\">run action · List Tickets</button>\n</article></div>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Route Runtime</h3>\n      <span class=\"capstan-runtime-pill\" data-route-mode-label=\"workspaceHome\">ready</span>\n    </div>\n    <div class=\"capstan-runtime-toggles\">\n      <button type=\"button\" class=\"capstan-state-toggle is-active\" data-route-mode-target=\"workspaceHome\" data-route-mode=\"ready\">Ready</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"workspaceHome\" data-route-mode=\"loading\">Loading</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"workspaceHome\" data-route-mode=\"empty\">Empty</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"workspaceHome\" data-route-mode=\"error\">Error</button>\n    </div>\n    <p class=\"capstan-state-copy\" data-route-state-copy=\"workspaceHome\">Ready to operate operations console workspace from the generated human surface.</p>\n    <div class=\"capstan-states\">\n      <article class=\"capstan-state is-active\" data-state-card-route=\"workspaceHome\" data-state-card-value=\"ready\">\n  <strong>Ready</strong>\n  <p class=\"capstan-state-copy\">Ready to operate operations console workspace from the generated human surface.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"workspaceHome\" data-state-card-value=\"loading\">\n  <strong>Loading</strong>\n  <p class=\"capstan-state-copy\">Loading operations console workspace from the generated human surface runtime.</p>\n  <div class=\"capstan-state-bars\"><div class=\"capstan-state-bar\"></div><div class=\"capstan-state-bar\" style=\"width: 74%;\"></div><div class=\"capstan-state-bar\" style=\"width: 56%;\"></div></div>\n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"workspaceHome\" data-state-card-value=\"empty\">\n  <strong>Empty</strong>\n  <p class=\"capstan-state-copy\">No operations console workspace data is available yet. Connect a capability handler or seed data to populate this route.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"workspaceHome\" data-state-card-value=\"error\">\n  <strong>Error</strong>\n  <p class=\"capstan-state-copy\">This route is projected, but its backing runtime path has not been connected yet.</p>\n  \n</article>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Execution Result</h3>\n      <span class=\"capstan-runtime-pill\" data-route-result-status=\"workspaceHome\" data-route-result-state=\"idle\">idle</span>\n    </div>\n    <p class=\"capstan-state-copy\">The last execution payload for this route is captured here so the projected surface, the operator, and future agent consumers stay aligned.</p>\n    <pre class=\"capstan-route-result\" data-route-result-output=\"workspaceHome\">{\n  \"event\": \"route.idle\",\n  \"routeKey\": \"workspaceHome\",\n  \"message\": \"No capability has been executed for this route yet.\"\n}</pre>\n  </div>\n</section><section class=\"capstan-route\" id=\"ticketDetail\" data-route-key=\"ticketDetail\" hidden>\n  <header>\n    <div>\n      <h2>Ticket Detail</h2>\n      <p>A generated detail route derived from the &quot;ticket&quot; resource schema.</p>\n    </div>\n    <div class=\"capstan-badges\">\n      <span class=\"capstan-badge\">detail</span><span class=\"capstan-badge\">generated</span><span class=\"capstan-badge\">resource:ticket</span>\n      <span class=\"capstan-badge\">/resources/ticket/detail</span>\n    </div>\n  </header>\n  <div class=\"capstan-grid\">\n    <div class=\"capstan-card\">\n  <h3>Detail Projection</h3>\n  <div class=\"capstan-fields\"><div class=\"capstan-field\">\n  <strong>Status</strong>\n  <span>string · required</span>\n  <div class=\"capstan-input\" style=\"margin-top: 10px;\" data-route-detail-value-route=\"ticketDetail\" data-field-key=\"status\">Status sample</div>\n</div><div class=\"capstan-field\">\n  <strong>Title</strong>\n  <span>string · required</span>\n  <div class=\"capstan-input\" style=\"margin-top: 10px;\" data-route-detail-value-route=\"ticketDetail\" data-field-key=\"title\">Title sample</div>\n</div></div>\n</div>\n    <div class=\"capstan-card\">\n      <h3>Capability Actions</h3>\n      <div class=\"capstan-actions\"><article class=\"capstan-action\">\n  <strong>List Tickets</strong>\n  <div class=\"capstan-badges\">\n    <span class=\"capstan-badge\" data-tone=\"allowed\">ready</span>\n    <span class=\"capstan-badge\">run action</span>\n  </div>\n  <p class=\"capstan-action-note\">Execute the &quot;listTickets&quot; capability from the projected human surface.</p>\n  <button type=\"button\" class=\"capstan-action-button\" data-route-action=\"ticketDetail\" data-action-key=\"listTickets\">run action · List Tickets</button>\n</article></div>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Route Runtime</h3>\n      <span class=\"capstan-runtime-pill\" data-route-mode-label=\"ticketDetail\">ready</span>\n    </div>\n    <div class=\"capstan-runtime-toggles\">\n      <button type=\"button\" class=\"capstan-state-toggle is-active\" data-route-mode-target=\"ticketDetail\" data-route-mode=\"ready\">Ready</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketDetail\" data-route-mode=\"loading\">Loading</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketDetail\" data-route-mode=\"empty\">Empty</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketDetail\" data-route-mode=\"error\">Error</button>\n    </div>\n    <p class=\"capstan-state-copy\" data-route-state-copy=\"ticketDetail\">Ready to operate ticket detail from the generated human surface.</p>\n    <div class=\"capstan-states\">\n      <article class=\"capstan-state is-active\" data-state-card-route=\"ticketDetail\" data-state-card-value=\"ready\">\n  <strong>Ready</strong>\n  <p class=\"capstan-state-copy\">Ready to operate ticket detail from the generated human surface.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketDetail\" data-state-card-value=\"loading\">\n  <strong>Loading</strong>\n  <p class=\"capstan-state-copy\">Loading ticket detail from the generated human surface runtime.</p>\n  <div class=\"capstan-state-bars\"><div class=\"capstan-state-bar\"></div><div class=\"capstan-state-bar\" style=\"width: 74%;\"></div><div class=\"capstan-state-bar\" style=\"width: 56%;\"></div></div>\n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketDetail\" data-state-card-value=\"empty\">\n  <strong>Empty</strong>\n  <p class=\"capstan-state-copy\">No ticket detail data is available yet. Connect a capability handler or seed data to populate this route.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketDetail\" data-state-card-value=\"error\">\n  <strong>Error</strong>\n  <p class=\"capstan-state-copy\">This route is projected, but its backing runtime path has not been connected yet.</p>\n  \n</article>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Execution Result</h3>\n      <span class=\"capstan-runtime-pill\" data-route-result-status=\"ticketDetail\" data-route-result-state=\"idle\">idle</span>\n    </div>\n    <p class=\"capstan-state-copy\">The last execution payload for this route is captured here so the projected surface, the operator, and future agent consumers stay aligned.</p>\n    <pre class=\"capstan-route-result\" data-route-result-output=\"ticketDetail\">{\n  \"event\": \"route.idle\",\n  \"routeKey\": \"ticketDetail\",\n  \"message\": \"No capability has been executed for this route yet.\"\n}</pre>\n  </div>\n</section><section class=\"capstan-route\" id=\"ticketForm\" data-route-key=\"ticketForm\" hidden>\n  <header>\n    <div>\n      <h2>Ticket Form</h2>\n      <p>A generated form route derived from the &quot;ticket&quot; resource schema.</p>\n    </div>\n    <div class=\"capstan-badges\">\n      <span class=\"capstan-badge\">form</span><span class=\"capstan-badge\">generated</span><span class=\"capstan-badge\">resource:ticket</span>\n      <span class=\"capstan-badge\">/resources/ticket/form</span>\n    </div>\n  </header>\n  <div class=\"capstan-grid\">\n    <div class=\"capstan-card\">\n  <h3>Form Projection</h3>\n  <div class=\"capstan-form-grid\"><label class=\"capstan-field\">\n  <strong>Status</strong>\n  <span>string · required</span>\n  <input class=\"capstan-input\" data-route-input-key=\"ticketForm\" data-field-key=\"status\" type=\"text\" value=\"Status sample\" />\n</label><label class=\"capstan-field\">\n  <strong>Title</strong>\n  <span>string · required</span>\n  <input class=\"capstan-input\" data-route-input-key=\"ticketForm\" data-field-key=\"title\" type=\"text\" value=\"Title sample\" />\n</label></div>\n</div>\n    <div class=\"capstan-card\">\n      <h3>Capability Actions</h3>\n      <div class=\"capstan-actions\"><article class=\"capstan-action\">\n  <strong>List Tickets</strong>\n  <div class=\"capstan-badges\">\n    <span class=\"capstan-badge\" data-tone=\"allowed\">ready</span>\n    <span class=\"capstan-badge\">run action</span>\n  </div>\n  <p class=\"capstan-action-note\">Execute the &quot;listTickets&quot; capability from the projected human surface.</p>\n  <button type=\"button\" class=\"capstan-action-button\" data-route-action=\"ticketForm\" data-action-key=\"listTickets\">run action · List Tickets</button>\n</article></div>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Route Runtime</h3>\n      <span class=\"capstan-runtime-pill\" data-route-mode-label=\"ticketForm\">ready</span>\n    </div>\n    <div class=\"capstan-runtime-toggles\">\n      <button type=\"button\" class=\"capstan-state-toggle is-active\" data-route-mode-target=\"ticketForm\" data-route-mode=\"ready\">Ready</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketForm\" data-route-mode=\"loading\">Loading</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketForm\" data-route-mode=\"empty\">Empty</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketForm\" data-route-mode=\"error\">Error</button>\n    </div>\n    <p class=\"capstan-state-copy\" data-route-state-copy=\"ticketForm\">Ready to operate ticket form from the generated human surface.</p>\n    <div class=\"capstan-states\">\n      <article class=\"capstan-state is-active\" data-state-card-route=\"ticketForm\" data-state-card-value=\"ready\">\n  <strong>Ready</strong>\n  <p class=\"capstan-state-copy\">Ready to operate ticket form from the generated human surface.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketForm\" data-state-card-value=\"loading\">\n  <strong>Loading</strong>\n  <p class=\"capstan-state-copy\">Loading ticket form from the generated human surface runtime.</p>\n  <div class=\"capstan-state-bars\"><div class=\"capstan-state-bar\"></div><div class=\"capstan-state-bar\" style=\"width: 74%;\"></div><div class=\"capstan-state-bar\" style=\"width: 56%;\"></div></div>\n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketForm\" data-state-card-value=\"empty\">\n  <strong>Empty</strong>\n  <p class=\"capstan-state-copy\">No ticket form data is available yet. Connect a capability handler or seed data to populate this route.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketForm\" data-state-card-value=\"error\">\n  <strong>Error</strong>\n  <p class=\"capstan-state-copy\">This route is projected, but its backing runtime path has not been connected yet.</p>\n  \n</article>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Execution Result</h3>\n      <span class=\"capstan-runtime-pill\" data-route-result-status=\"ticketForm\" data-route-result-state=\"idle\">idle</span>\n    </div>\n    <p class=\"capstan-state-copy\">The last execution payload for this route is captured here so the projected surface, the operator, and future agent consumers stay aligned.</p>\n    <pre class=\"capstan-route-result\" data-route-result-output=\"ticketForm\">{\n  \"event\": \"route.idle\",\n  \"routeKey\": \"ticketForm\",\n  \"message\": \"No capability has been executed for this route yet.\"\n}</pre>\n  </div>\n</section><section class=\"capstan-route\" id=\"ticketList\" data-route-key=\"ticketList\" hidden>\n  <header>\n    <div>\n      <h2>Ticket List</h2>\n      <p>A generated list route derived from the &quot;ticket&quot; resource schema.</p>\n    </div>\n    <div class=\"capstan-badges\">\n      <span class=\"capstan-badge\">list</span><span class=\"capstan-badge\">graph-defined</span><span class=\"capstan-badge\">resource:ticket</span>\n      <span class=\"capstan-badge\">/resources/ticket/list</span>\n    </div>\n  </header>\n  <div class=\"capstan-grid\">\n    <div class=\"capstan-card\">\n  <h3>List Projection</h3>\n  <table class=\"capstan-table\">\n    <thead><tr><th>Status</th><th>Title</th></tr></thead>\n    <tbody data-route-table-body=\"ticketList\"><tr><td>Status sample</td><td>Title sample</td></tr></tbody>\n  </table>\n</div>\n    <div class=\"capstan-card\">\n      <h3>Capability Actions</h3>\n      <div class=\"capstan-actions\"><article class=\"capstan-action\">\n  <strong>List Tickets</strong>\n  <div class=\"capstan-badges\">\n    <span class=\"capstan-badge\" data-tone=\"allowed\">ready</span>\n    <span class=\"capstan-badge\">run action</span>\n  </div>\n  <p class=\"capstan-action-note\">Execute the &quot;listTickets&quot; capability from the projected human surface.</p>\n  <button type=\"button\" class=\"capstan-action-button\" data-route-action=\"ticketList\" data-action-key=\"listTickets\">run action · List Tickets</button>\n</article></div>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Route Runtime</h3>\n      <span class=\"capstan-runtime-pill\" data-route-mode-label=\"ticketList\">ready</span>\n    </div>\n    <div class=\"capstan-runtime-toggles\">\n      <button type=\"button\" class=\"capstan-state-toggle is-active\" data-route-mode-target=\"ticketList\" data-route-mode=\"ready\">Ready</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketList\" data-route-mode=\"loading\">Loading</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketList\" data-route-mode=\"empty\">Empty</button>\n      <button type=\"button\" class=\"capstan-state-toggle\" data-route-mode-target=\"ticketList\" data-route-mode=\"error\">Error</button>\n    </div>\n    <p class=\"capstan-state-copy\" data-route-state-copy=\"ticketList\">Ready to operate ticket list from the generated human surface.</p>\n    <div class=\"capstan-states\">\n      <article class=\"capstan-state is-active\" data-state-card-route=\"ticketList\" data-state-card-value=\"ready\">\n  <strong>Ready</strong>\n  <p class=\"capstan-state-copy\">Ready to operate ticket list from the generated human surface.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketList\" data-state-card-value=\"loading\">\n  <strong>Loading</strong>\n  <p class=\"capstan-state-copy\">Loading ticket list from the generated human surface runtime.</p>\n  <div class=\"capstan-state-bars\"><div class=\"capstan-state-bar\"></div><div class=\"capstan-state-bar\" style=\"width: 74%;\"></div><div class=\"capstan-state-bar\" style=\"width: 56%;\"></div></div>\n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketList\" data-state-card-value=\"empty\">\n  <strong>Empty</strong>\n  <p class=\"capstan-state-copy\">No ticket list data is available yet. Connect a capability handler or seed data to populate this route.</p>\n  \n</article>\n      <article class=\"capstan-state\" data-state-card-route=\"ticketList\" data-state-card-value=\"error\">\n  <strong>Error</strong>\n  <p class=\"capstan-state-copy\">This route is projected, but its backing runtime path has not been connected yet.</p>\n  \n</article>\n    </div>\n  </div>\n  <div class=\"capstan-card\" style=\"margin-top: 16px;\">\n    <div class=\"capstan-runtime-header\">\n      <h3>Execution Result</h3>\n      <span class=\"capstan-runtime-pill\" data-route-result-status=\"ticketList\" data-route-result-state=\"idle\">idle</span>\n    </div>\n    <p class=\"capstan-state-copy\">The last execution payload for this route is captured here so the projected surface, the operator, and future agent consumers stay aligned.</p>\n    <pre class=\"capstan-route-result\" data-route-result-output=\"ticketList\">{\n  \"event\": \"route.idle\",\n  \"routeKey\": \"ticketList\",\n  \"message\": \"No capability has been executed for this route yet.\"\n}</pre>\n  </div>\n</section>\n      </main>\n    </div>\n    <script type=\"module\">\n      import { mountHumanSurfaceBrowser } from \"./dist/human-surface/index.js\";\n\n      mountHumanSurfaceBrowser(document);\n    </script>\n  </body>\n</html>\n";

export type HumanSurfaceRuntimeMode = "ready" | "loading" | "empty" | "error";
export type HumanSurfaceRouteResultStatus =
  | "idle"
  | "blocked"
  | "approval_required"
  | "not_implemented"
  | "completed"
  | "redacted"
  | "error";

type HumanSurfaceRouteDefinition = (typeof humanSurface.routes)[number];

export interface HumanSurfaceRouteResult {
  status: HumanSurfaceRouteResultStatus;
  payload: unknown;
}

export interface HumanSurfaceRuntimeSnapshot {
  activeRouteKey: string;
  modes: Record<string, HumanSurfaceRuntimeMode>;
  resourceRecords: Record<string, Array<Record<string, unknown>>>;
  results: Record<string, HumanSurfaceRouteResult>;
}

function sampleValue(type: string, label: string): string {
  switch (type) {
    case "integer":
      return "7";
    case "number":
      return "42.5";
    case "boolean":
      return "true";
    case "date":
      return "2026-03-22";
    case "datetime":
      return "2026-03-22T10:00";
    case "json":
      return '{"ok":true}';
    default:
      return `${label} sample`;
  }
}

function createSeedRecord(route: HumanSurfaceRouteDefinition): Record<string, unknown> {
  if (route.table?.sampleRow) {
    return route.table.sampleRow;
  }

  return Object.fromEntries(
    (route.fields ?? []).map((field) => [field.key, sampleValue(field.type, field.label)])
  );
}

function createSeedRecords(
  route: HumanSurfaceRouteDefinition
): Array<Record<string, unknown>> {
  if (!route.resourceKey) {
    return [];
  }

  const seedRecord = createSeedRecord(route);
  return Object.keys(seedRecord).length ? [seedRecord] : [];
}

export function renderHumanSurfaceDocument(): string {
  return humanSurfaceHtml;
}

export function createHumanSurfaceRuntimeSnapshot(): HumanSurfaceRuntimeSnapshot {
  const resourceRecords = new Map<string, Array<Record<string, unknown>>>();

  for (const route of humanSurface.routes) {
    if (!route.resourceKey || resourceRecords.has(route.resourceKey)) {
      continue;
    }

    resourceRecords.set(route.resourceKey, createSeedRecords(route));
  }

  return {
    activeRouteKey: humanSurface.routes[0]?.key ?? "",
    modes: Object.fromEntries(
      humanSurface.routes.map((route) => [route.key, "ready" as HumanSurfaceRuntimeMode])
    ) as Record<string, HumanSurfaceRuntimeMode>,
    resourceRecords: Object.fromEntries(resourceRecords.entries()) as Record<
      string,
      Array<Record<string, unknown>>
    >,
    results: Object.fromEntries(
      humanSurface.routes.map((route) => [
        route.key,
        {
          status: "idle" as HumanSurfaceRouteResultStatus,
          payload: {
            event: "route.idle",
            routeKey: route.key,
            message: "No capability has been executed for this route yet."
          }
        }
      ])
    ) as Record<string, HumanSurfaceRouteResult>
  };
}

export function mountHumanSurfaceBrowser(root: Document = document): HumanSurfaceRuntimeSnapshot {
  const runtime = createHumanSurfaceRuntimeSnapshot();
  const routeNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-route-key]"));
  const navNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-route-nav]"));
  const consoleRouteNode = root.querySelector<HTMLElement>("[data-console-route]");
  const consoleModeNode = root.querySelector<HTMLElement>("[data-console-mode]");
  const consoleOutputNode = root.querySelector<HTMLElement>("[data-console-output]");

  const findRoute = (routeKey: string) =>
    humanSurface.routes.find((route) => route.key === routeKey) as
      | HumanSurfaceRouteDefinition
      | undefined;

  const findField = (route: HumanSurfaceRouteDefinition, fieldKey: string) =>
    route.fields.find((field) => field.key === fieldKey);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const readyCopy = (route: HumanSurfaceRouteDefinition) =>
    `Ready to operate ${route.title.toLowerCase()} from the generated human surface.`;

  const stringifyValue = (value: unknown, type: string): string => {
    if (value === undefined || value === null) {
      return "";
    }

    if (type === "json") {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    return String(value);
  };

  const escapeHtml = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normalizeFieldValue = (value: string, type: string): unknown => {
    switch (type) {
      case "integer": {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? value : parsed;
      }
      case "number": {
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      case "boolean":
        return value === "true";
      case "json":
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  };

  const collectInput = (route: HumanSurfaceRouteDefinition): Record<string, unknown> => {
    const inputs = Array.from(
      root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        `[data-route-input-key="${route.key}"]`
      )
    );

    if (!inputs.length) {
      return Object.fromEntries(
        (route.fields ?? []).map((field) => [field.key, sampleValue(field.type, field.label)])
      );
    }

    const payload: Record<string, unknown> = {};

    for (const input of inputs) {
      const fieldKey = input.getAttribute("data-field-key");
      if (!fieldKey) {
        continue;
      }

      const field = findField(route, fieldKey);
      payload[fieldKey] = normalizeFieldValue(input.value, field?.type ?? "string");
    }

    return payload;
  };

  const writeConsole = (payload: unknown): void => {
    if (consoleOutputNode) {
      consoleOutputNode.textContent = JSON.stringify(payload, null, 2);
    }
  };

  const writeRouteResult = (
    routeKey: string,
    status: HumanSurfaceRouteResultStatus,
    payload: unknown
  ): void => {
    runtime.results[routeKey] = {
      status,
      payload
    };
  };

  const extractRecord = (
    route: HumanSurfaceRouteDefinition,
    candidate: unknown
  ): Record<string, unknown> | undefined => {
    if (!isRecord(candidate)) {
      return undefined;
    }

    const entries = route.fields
      .filter((field) => candidate[field.key] !== undefined)
      .map((field) => [field.key, candidate[field.key]]);

    return entries.length ? Object.fromEntries(entries) : undefined;
  };

  const deriveRecords = (
    route: HumanSurfaceRouteDefinition,
    result: { output?: unknown },
    input: Record<string, unknown>
  ): Array<Record<string, unknown>> => {
    const candidates: unknown[] = [];
    const output = result.output;

    if (Array.isArray(output)) {
      candidates.push(...output);
    } else if (isRecord(output)) {
      if (Array.isArray(output.records)) {
        candidates.push(...output.records);
      }

      if (Array.isArray(output.items)) {
        candidates.push(...output.items);
      }

      if (isRecord(output.record)) {
        candidates.push(output.record);
      }

      if (isRecord(output.item)) {
        candidates.push(output.item);
      }

      candidates.push(output);
    }

    if (!candidates.length && Object.keys(input).length) {
      candidates.push(input);
    }

    return candidates
      .map((candidate) => extractRecord(route, candidate))
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  };

  const renderTableRows = (
    route: HumanSurfaceRouteDefinition,
    records: Array<Record<string, unknown>>
  ): string => {
    const columns = route.table?.columns ?? [];
    const rows = records.length ? records : createSeedRecords(route);

    if (!rows.length) {
      return `<tr><td colspan="${Math.max(columns.length, 1)}">No records available.</td></tr>`;
    }

    return rows
      .map(
        (record) =>
          `<tr>${columns
            .map(
              (column) =>
                `<td>${escapeHtml(stringifyValue(record[column.key] ?? "", column.type))}</td>`
            )
            .join("")}</tr>`
      )
      .join("");
  };

  const renderRouteProjection = (route: HumanSurfaceRouteDefinition): void => {
    if (!route.resourceKey) {
      return;
    }

    const records = runtime.resourceRecords[route.resourceKey] ?? [];

    if (route.kind === "list") {
      const tableBody = root.querySelector<HTMLElement>(
        `[data-route-table-body="${route.key}"]`
      );

      if (tableBody) {
        tableBody.innerHTML = renderTableRows(route, records);
      }

      return;
    }

    const firstRecord = records[0] ?? createSeedRecord(route);

    if (route.kind === "detail") {
      const detailNodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          `[data-route-detail-value-route="${route.key}"]`
        )
      );

      detailNodes.forEach((node) => {
        const fieldKey = node.getAttribute("data-field-key");
        const field = fieldKey ? findField(route, fieldKey) : undefined;

        if (!fieldKey || !field) {
          return;
        }

        node.textContent = stringifyValue(
          firstRecord[fieldKey] ?? sampleValue(field.type, field.label),
          field.type
        );
      });

      return;
    }

    if (route.kind === "form") {
      const inputs = Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          `[data-route-input-key="${route.key}"]`
        )
      );

      inputs.forEach((input) => {
        const fieldKey = input.getAttribute("data-field-key");
        const field = fieldKey ? findField(route, fieldKey) : undefined;

        if (!fieldKey || !field) {
          return;
        }

        input.value = stringifyValue(
          firstRecord[fieldKey] ?? sampleValue(field.type, field.label),
          field.type
        );
      });
    }
  };

  const render = (): void => {
    routeNodes.forEach((node, index) => {
      const routeKey = node.getAttribute("data-route-key") ?? "";
      const active = routeKey === runtime.activeRouteKey || (!runtime.activeRouteKey && index === 0);
      const route = findRoute(routeKey);
      const mode = runtime.modes[routeKey] ?? "ready";

      node.hidden = !active;
      node.setAttribute("data-runtime-state", mode);

      const modeLabelNode = node.querySelector<HTMLElement>("[data-route-mode-label]");
      if (modeLabelNode) {
        modeLabelNode.textContent = mode;
      }

      const stateCopyNode = node.querySelector<HTMLElement>("[data-route-state-copy]");
      if (stateCopyNode && route) {
        stateCopyNode.textContent = mode === "ready" ? readyCopy(route) : route.states[mode];
      }

      node.querySelectorAll<HTMLElement>("[data-route-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-route-mode") === mode);
      });

      node.querySelectorAll<HTMLElement>("[data-state-card-value]").forEach((card) => {
        card.classList.toggle("is-active", card.getAttribute("data-state-card-value") === mode);
      });

      node.querySelectorAll<HTMLButtonElement>(".capstan-action-button").forEach((button) => {
        button.disabled = mode === "loading";
      });

      if (route) {
        renderRouteProjection(route);
      }

      const routeResult = runtime.results[routeKey];
      const resultStatusNode = root.querySelector<HTMLElement>(
        `[data-route-result-status="${routeKey}"]`
      );
      const resultOutputNode = root.querySelector<HTMLElement>(
        `[data-route-result-output="${routeKey}"]`
      );

      if (resultStatusNode) {
        resultStatusNode.textContent = routeResult?.status ?? "idle";
        resultStatusNode.setAttribute(
          "data-route-result-state",
          routeResult?.status ?? "idle"
        );
      }

      if (resultOutputNode) {
        resultOutputNode.textContent = JSON.stringify(
          routeResult?.payload ?? {
            event: "route.idle",
            routeKey,
            message: "No capability has been executed for this route yet."
          },
          null,
          2
        );
      }
    });

    navNodes.forEach((node) => {
      node.classList.toggle(
        "is-active",
        node.getAttribute("data-route-nav") === runtime.activeRouteKey
      );
    });

    const activeRoute = findRoute(runtime.activeRouteKey) ?? humanSurface.routes[0];

    if (activeRoute && consoleRouteNode) {
      consoleRouteNode.textContent = activeRoute.title;
    }

    if (activeRoute && consoleModeNode) {
      consoleModeNode.textContent = runtime.modes[activeRoute.key] ?? "ready";
    }

    if (activeRoute && root.defaultView) {
      const currentHash = root.defaultView.location.hash.replace(/^#/, "");

      if (currentHash !== activeRoute.key) {
        root.defaultView.location.hash = activeRoute.key;
      }
    }
  };

  const initialHash = root.defaultView?.location.hash.replace(/^#/, "");

  if (initialHash && findRoute(initialHash)) {
    runtime.activeRouteKey = initialHash;
  }

  const isElementTarget = (value: EventTarget | null): value is Element => {
    const elementConstructor = root.defaultView?.Element;
    return Boolean(elementConstructor && value instanceof elementConstructor);
  };

  root.addEventListener("click", async (event) => {
    const target =
      isElementTarget(event.target)
        ? event.target.closest<HTMLElement>("[data-route-nav], [data-route-mode], [data-action-key]")
        : null;

    if (!target) {
      return;
    }

    if (target.hasAttribute("data-route-nav")) {
      event.preventDefault();
      const routeKey = target.getAttribute("data-route-nav") ?? "";
      runtime.activeRouteKey = routeKey;
      render();
      const route = findRoute(routeKey);

      if (route) {
        writeConsole({
          event: "route.selected",
          routeKey,
          routeTitle: route.title,
          mode: runtime.modes[routeKey] ?? "ready"
        });
      }

      return;
    }

    if (target.hasAttribute("data-route-mode")) {
      const routeKey = target.getAttribute("data-route-mode-target") ?? "";
      const mode = (target.getAttribute("data-route-mode") ?? "ready") as HumanSurfaceRuntimeMode;
      runtime.activeRouteKey = routeKey || runtime.activeRouteKey;
      runtime.modes[routeKey] = mode;
      render();
      const route = findRoute(routeKey);

      if (route) {
        writeConsole({
          event: "route.state",
          routeKey,
          routeTitle: route.title,
          mode,
          message: mode === "ready" ? readyCopy(route) : route.states[mode]
        });
      }

      return;
    }

    if (!target.hasAttribute("data-action-key")) {
      return;
    }

    const routeKey = target.getAttribute("data-route-action") ?? runtime.activeRouteKey;
    const actionKey = target.getAttribute("data-action-key") ?? "";
    const route = findRoute(routeKey);
    const action = route?.actions.find((entry) => entry.key === actionKey);

    if (!route || !action) {
      return;
    }

    runtime.activeRouteKey = routeKey;
    const input = collectInput(route);
    const policyState = action.policyState as
      | "allowed"
      | "approval_required"
      | "blocked"
      | "redacted";

    if (policyState === "blocked") {
      runtime.modes[routeKey] = "error";
      const payload = {
        event: "capability.blocked",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        note: action.note
      };
      writeRouteResult(routeKey, "blocked", payload);
      render();
      writeConsole(payload);
      return;
    }

    if (policyState === "approval_required") {
      runtime.modes[routeKey] = "empty";
      const payload = {
        event: "capability.pending_approval",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        input,
        note: action.note
      };
      writeRouteResult(routeKey, "approval_required", payload);
      render();
      writeConsole(payload);
      return;
    }

    runtime.modes[routeKey] = "loading";
    render();

    try {
      const result = await execute(action.capability, input);
      const records = deriveRecords(route, result, input);
      const affectedResources = Array.from(
        new Set([route.resourceKey, ...action.resources].filter((value): value is string => Boolean(value)))
      );

      if (records.length) {
        affectedResources.forEach((resourceKey) => {
          runtime.resourceRecords[resourceKey] = records;
        });
      }

      runtime.modes[routeKey] = result.status === "completed" && records.length ? "ready" : "empty";

      const payload = {
        event:
          result.status === "completed"
            ? "capability.execute"
            : "capability.not_implemented",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        result,
        records,
        note:
          result.status === "not_implemented"
            ? result.note ?? "The generated capability stub has not been replaced yet."
            : policyState === "redacted"
              ? "Execution completed through the real handler. The surface is flagged as redacted."
              : action.note
      };

      writeRouteResult(
        routeKey,
        result.status === "completed"
          ? policyState === "redacted"
            ? "redacted"
            : "completed"
          : "not_implemented",
        payload
      );
      render();
      writeConsole(payload);
    } catch (error) {
      runtime.modes[routeKey] = "error";
      const payload = {
        event: "capability.error",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        input,
        error: error instanceof Error ? error.message : String(error)
      };
      writeRouteResult(routeKey, "error", payload);
      render();
      writeConsole(payload);
    }
  });

  render();

  if (runtime.activeRouteKey) {
    const initialRoute = findRoute(runtime.activeRouteKey);

    if (initialRoute) {
      writeConsole({
        event: "human_surface.ready",
        activeRoute: initialRoute.key,
        activeRouteTitle: initialRoute.title,
        routes: humanSurface.routes.length
      });
    }
  }

  return runtime;
}
