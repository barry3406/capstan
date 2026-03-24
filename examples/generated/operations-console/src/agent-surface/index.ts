export const agentSurface = {
  "domain": {
    "key": "operations",
    "title": "Operations Console",
    "description": "A simple example graph used to validate the first Capstan loop."
  },
  "summary": {
    "capabilityCount": 1,
    "taskCount": 0,
    "artifactCount": 0
  },
  "entrypoints": [
    "search",
    "execute",
    "task",
    "artifact",
    "startTask",
    "getTaskRun",
    "listTaskRuns",
    "getArtifactRecord",
    "listArtifactRecords"
  ],
  "transport": {
    "adapter": "local",
    "projections": [
      {
        "key": "local",
        "protocol": "in_process",
        "status": "active",
        "entrypoint": "handleAgentSurfaceRequest",
        "methods": [
          "call"
        ]
      },
      {
        "key": "http_rpc",
        "protocol": "http",
        "status": "preview",
        "entrypoint": "/rpc",
        "methods": [
          "GET",
          "POST"
        ]
      },
      {
        "key": "mcp",
        "protocol": "mcp",
        "status": "preview",
        "entrypoint": "createAgentSurfaceMcpAdapter",
        "methods": [
          "tools/list",
          "tools/call"
        ]
      },
      {
        "key": "a2a",
        "protocol": "a2a",
        "status": "preview",
        "entrypoint": "createAgentSurfaceA2aAdapter",
        "methods": [
          "agent/card",
          "message/send"
        ]
      }
    ],
    "auth": {
      "mode": "hook_optional",
      "effects": [
        "allow",
        "approve",
        "deny",
        "redact"
      ]
    },
    "operations": [
      {
        "key": "manifest",
        "kind": "query",
        "params": []
      },
      {
        "key": "search",
        "kind": "query",
        "params": [
          "query"
        ]
      },
      {
        "key": "execute",
        "kind": "mutation",
        "params": [
          "key",
          "input"
        ]
      },
      {
        "key": "task",
        "kind": "query",
        "params": [
          "key"
        ]
      },
      {
        "key": "artifact",
        "kind": "query",
        "params": [
          "key"
        ]
      },
      {
        "key": "startTask",
        "kind": "mutation",
        "params": [
          "key",
          "input"
        ]
      },
      {
        "key": "getTaskRun",
        "kind": "query",
        "params": [
          "id"
        ]
      },
      {
        "key": "listTaskRuns",
        "kind": "query",
        "params": [
          "taskKey"
        ]
      },
      {
        "key": "getArtifactRecord",
        "kind": "query",
        "params": [
          "id"
        ]
      },
      {
        "key": "listArtifactRecords",
        "kind": "query",
        "params": [
          "artifactKey"
        ]
      }
    ]
  },
  "semantics": {
    "capabilityStatuses": [
      "not_implemented",
      "completed",
      "failed",
      "blocked",
      "approval_required",
      "input_required",
      "cancelled"
    ],
    "taskRunStatuses": [
      "pending",
      "running",
      "input_required",
      "approval_required",
      "completed",
      "failed",
      "cancelled",
      "blocked"
    ],
    "taskStatuses": [
      "ready",
      "awaiting_execution",
      "running",
      "input_required",
      "approval_required",
      "completed",
      "failed",
      "cancelled",
      "blocked"
    ]
  },
  "capabilities": [
    {
      "key": "listTickets",
      "title": "List Tickets",
      "mode": "read",
      "resources": [
        "ticket"
      ],
      "searchTerms": [
        "listTickets",
        "List Tickets",
        "ticket"
      ]
    }
  ],
  "tasks": [],
  "artifacts": []
} as const;

export const agentSurfaceManifest = "{\n  \"domain\": {\n    \"key\": \"operations\",\n    \"title\": \"Operations Console\",\n    \"description\": \"A simple example graph used to validate the first Capstan loop.\"\n  },\n  \"summary\": {\n    \"capabilityCount\": 1,\n    \"taskCount\": 0,\n    \"artifactCount\": 0\n  },\n  \"entrypoints\": [\n    \"search\",\n    \"execute\",\n    \"task\",\n    \"artifact\",\n    \"startTask\",\n    \"getTaskRun\",\n    \"listTaskRuns\",\n    \"getArtifactRecord\",\n    \"listArtifactRecords\"\n  ],\n  \"transport\": {\n    \"adapter\": \"local\",\n    \"projections\": [\n      {\n        \"key\": \"local\",\n        \"protocol\": \"in_process\",\n        \"status\": \"active\",\n        \"entrypoint\": \"handleAgentSurfaceRequest\",\n        \"methods\": [\n          \"call\"\n        ]\n      },\n      {\n        \"key\": \"http_rpc\",\n        \"protocol\": \"http\",\n        \"status\": \"preview\",\n        \"entrypoint\": \"/rpc\",\n        \"methods\": [\n          \"GET\",\n          \"POST\"\n        ]\n      },\n      {\n        \"key\": \"mcp\",\n        \"protocol\": \"mcp\",\n        \"status\": \"preview\",\n        \"entrypoint\": \"createAgentSurfaceMcpAdapter\",\n        \"methods\": [\n          \"tools/list\",\n          \"tools/call\"\n        ]\n      },\n      {\n        \"key\": \"a2a\",\n        \"protocol\": \"a2a\",\n        \"status\": \"preview\",\n        \"entrypoint\": \"createAgentSurfaceA2aAdapter\",\n        \"methods\": [\n          \"agent/card\",\n          \"message/send\"\n        ]\n      }\n    ],\n    \"auth\": {\n      \"mode\": \"hook_optional\",\n      \"effects\": [\n        \"allow\",\n        \"approve\",\n        \"deny\",\n        \"redact\"\n      ]\n    },\n    \"operations\": [\n      {\n        \"key\": \"manifest\",\n        \"kind\": \"query\",\n        \"params\": []\n      },\n      {\n        \"key\": \"search\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"query\"\n        ]\n      },\n      {\n        \"key\": \"execute\",\n        \"kind\": \"mutation\",\n        \"params\": [\n          \"key\",\n          \"input\"\n        ]\n      },\n      {\n        \"key\": \"task\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"key\"\n        ]\n      },\n      {\n        \"key\": \"artifact\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"key\"\n        ]\n      },\n      {\n        \"key\": \"startTask\",\n        \"kind\": \"mutation\",\n        \"params\": [\n          \"key\",\n          \"input\"\n        ]\n      },\n      {\n        \"key\": \"getTaskRun\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"id\"\n        ]\n      },\n      {\n        \"key\": \"listTaskRuns\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"taskKey\"\n        ]\n      },\n      {\n        \"key\": \"getArtifactRecord\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"id\"\n        ]\n      },\n      {\n        \"key\": \"listArtifactRecords\",\n        \"kind\": \"query\",\n        \"params\": [\n          \"artifactKey\"\n        ]\n      }\n    ]\n  },\n  \"semantics\": {\n    \"capabilityStatuses\": [\n      \"not_implemented\",\n      \"completed\",\n      \"failed\",\n      \"blocked\",\n      \"approval_required\",\n      \"input_required\",\n      \"cancelled\"\n    ],\n    \"taskRunStatuses\": [\n      \"pending\",\n      \"running\",\n      \"input_required\",\n      \"approval_required\",\n      \"completed\",\n      \"failed\",\n      \"cancelled\",\n      \"blocked\"\n    ],\n    \"taskStatuses\": [\n      \"ready\",\n      \"awaiting_execution\",\n      \"running\",\n      \"input_required\",\n      \"approval_required\",\n      \"completed\",\n      \"failed\",\n      \"cancelled\",\n      \"blocked\"\n    ]\n  },\n  \"capabilities\": [\n    {\n      \"key\": \"listTickets\",\n      \"title\": \"List Tickets\",\n      \"mode\": \"read\",\n      \"resources\": [\n        \"ticket\"\n      ],\n      \"searchTerms\": [\n        \"listTickets\",\n        \"List Tickets\",\n        \"ticket\"\n      ]\n    }\n  ],\n  \"tasks\": [],\n  \"artifacts\": []\n}\n";

export function renderAgentSurfaceManifest(): string {
  return agentSurfaceManifest;
}
