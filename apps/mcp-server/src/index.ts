#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.DELTAFRAME_API_URL ?? "http://localhost:8788";

const server = new McpServer({
  name: "deltaframe",
  version: "0.1.0"
});

server.tool(
  "list_projects",
  "List DeltaFrame projects available to the backend.",
  {},
  async () => textJson(await apiGet("/projects"))
);

server.tool(
  "list_sections",
  "List DeltaFrame section families. Use this before asking for a section timeline or latest section delta.",
  {
    project_id: z.string().optional()
  },
  async ({ project_id }) => {
    const query = project_id ? `?projectId=${encodeURIComponent(project_id)}` : "";
    return textJson(await apiGet(`/sections${query}`));
  }
);

server.tool(
  "get_section_timeline",
  "Return the baseline and iteration timeline for a tracked design section.",
  {
    section_id: z.string()
  },
  async ({ section_id }) => textJson(await apiGet(`/sections/${encodeURIComponent(section_id)}/timeline`))
);

server.tool(
  "get_latest_section_delta",
  "Return the latest approved section delta, or latest draft too when include_drafts is true.",
  {
    section_id: z.string(),
    include_drafts: z.boolean().optional()
  },
  async ({ section_id, include_drafts }) => {
    const query = include_drafts ? "?includeDrafts=true" : "";
    return textJson(await apiGet(`/sections/${encodeURIComponent(section_id)}/latest-delta${query}`));
  }
);

server.tool(
  "get_section_agent_brief",
  "Return a compact implementation brief for the latest delta in a section timeline.",
  {
    section_id: z.string(),
    include_drafts: z.boolean().optional()
  },
  async ({ section_id, include_drafts }) => {
    const query = include_drafts ? "?includeDrafts=true" : "";
    const response = await fetch(`${API_URL}/sections/${encodeURIComponent(section_id)}/agent-brief${query}`);
    if (!response.ok) throw new Error(await response.text());
    return {
      content: [{ type: "text" as const, text: await response.text() }]
    };
  }
);

server.tool(
  "mark_iteration_implemented",
  "Mark the changelog attached to a section iteration as implemented.",
  {
    iteration_id: z.string(),
    implementation_ref: z.string().optional(),
    notes: z.string().optional()
  },
  async ({ iteration_id, implementation_ref, notes }) =>
    textJson(
      await apiPost(`/iterations/${encodeURIComponent(iteration_id)}/implemented`, {
        implementationRef: implementation_ref,
        notes
      })
    )
);

server.tool(
  "list_checkpoints",
  "List checkpoints for a DeltaFrame project.",
  { project_id: z.string() },
  async ({ project_id }) => textJson(await apiGet(`/projects/${encodeURIComponent(project_id)}/checkpoints`))
);

server.tool(
  "get_project_status",
  "Explain what DeltaFrame data exists for a project, including latest checkpoint and latest draft/approved changelog.",
  { project_id: z.string() },
  async ({ project_id }) => textJson(await apiGet(`/projects/${encodeURIComponent(project_id)}/status`))
);

server.tool(
  "list_changelogs",
  "List changelogs for a project. Use include_drafts during design review before a changelog has been approved.",
  {
    project_id: z.string(),
    include_drafts: z.boolean().optional()
  },
  async ({ project_id, include_drafts }) => {
    const query = include_drafts ? "?includeDrafts=true" : "";
    return textJson(await apiGet(`/projects/${encodeURIComponent(project_id)}/changelogs${query}`));
  }
);

server.tool(
  "get_latest_changelog",
  "Return the latest approved or implemented changelog for a project or node.",
  {
    project_id: z.string(),
    node_id: z.string().optional(),
    include_drafts: z.boolean().optional()
  },
  async ({ project_id, node_id, include_drafts }) => {
    const params = new URLSearchParams();
    if (node_id) params.set("nodeId", node_id);
    if (include_drafts) params.set("includeDrafts", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    return textJson(await apiGet(`/projects/${encodeURIComponent(project_id)}/latest-changelog${query}`));
  }
);

server.tool(
  "get_changelog_by_id",
  "Return a changelog by ID.",
  { changelog_id: z.string() },
  async ({ changelog_id }) => textJson(await apiGet(`/changelogs/${encodeURIComponent(changelog_id)}`))
);

server.tool(
  "get_changes_since_checkpoint",
  "Return approved changes since an implementation checkpoint.",
  {
    project_id: z.string(),
    checkpoint_id: z.string(),
    node_ids: z.array(z.string()).optional()
  },
  async ({ project_id, checkpoint_id, node_ids }) => {
    const query = node_ids?.length ? `?nodeIds=${encodeURIComponent(node_ids.join(","))}` : "";
    return textJson(
      await apiGet(
        `/projects/${encodeURIComponent(project_id)}/changes-since/${encodeURIComponent(checkpoint_id)}${query}`
      )
    );
  }
);

server.tool(
  "get_affected_nodes",
  "Return affected node IDs and paths for a changelog.",
  { changelog_id: z.string() },
  async ({ changelog_id }) => {
    const data = await apiGet(`/changelogs/${encodeURIComponent(changelog_id)}`);
    const nodes = data.changelog.changes.map((change: { nodeId: string; nodePath: string; impact: string }) => ({
      nodeId: change.nodeId,
      nodePath: change.nodePath,
      impact: change.impact
    }));
    return textJson({ changelogId: changelog_id, affectedNodes: nodes });
  }
);

server.tool(
  "get_agent_brief",
  "Return a compact Markdown implementation brief for a coding agent.",
  {
    project_id: z.string(),
    node_id: z.string().optional(),
    include_drafts: z.boolean().optional()
  },
  async ({ project_id, node_id, include_drafts }) => {
    const params = new URLSearchParams();
    if (node_id) params.set("nodeId", node_id);
    if (include_drafts) params.set("includeDrafts", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${API_URL}/projects/${encodeURIComponent(project_id)}/agent-brief${query}`);
    if (!response.ok) throw new Error(await response.text());
    return {
      content: [{ type: "text" as const, text: await response.text() }]
    };
  }
);

server.tool(
  "mark_implemented",
  "Mark a changelog as implemented by code.",
  {
    changelog_id: z.string(),
    implementation_ref: z.string().optional(),
    notes: z.string().optional()
  },
  async ({ changelog_id, implementation_ref, notes }) =>
    textJson(
      await apiPost(`/changelogs/${encodeURIComponent(changelog_id)}/implemented`, {
        implementationRef: implementation_ref,
        notes
      })
    )
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function apiGet(path: string): Promise<any> {
  const response = await fetch(`${API_URL}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function textJson(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
  };
}
