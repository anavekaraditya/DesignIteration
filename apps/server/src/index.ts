import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  buildAgentBrief,
  changelogUpdateSchema,
  checkpointCreateSchema,
  compareCreateSchema,
  diffSnapshots,
  generateChangelog,
  hashValue,
  markImplementedSchema,
  sectionCreateSchema,
  sectionIterationCreateSchema,
  sectionSuggestMatchSchema,
  suggestSectionMatches,
  type SectionMatchCandidate
} from "@deltaframe/core";
import { DeltaFrameStore } from "./store.js";
import { enhanceChangelogWithGemini } from "./gemini.js";

const store = await DeltaFrameStore.open();
const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })
);

app.get("/health", (c) => c.json({ ok: true, service: "deltaframe-server" }));

app.get("/", (c) =>
  c.html(`<!doctype html>
    <html>
      <head>
        <title>DeltaFrame</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 48px; line-height: 1.5; }
          code { background: #f2f2f2; padding: 2px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>DeltaFrame backend is running</h1>
        <p>Use <code>/health</code> to verify the API, or point the Figma plugin to this host.</p>
      </body>
    </html>`)
);

app.get("/projects", (c) => c.json({ projects: store.listProjects() }));

app.get("/sections", (c) => {
  return c.json({ sections: store.listSections(c.req.query("projectId")) });
});

app.post("/sections/suggest-match", async (c) => {
  const body = sectionSuggestMatchSchema.parse(await c.req.json());
  const sections = store.listSections(body.projectId);
  const candidates: SectionMatchCandidate[] = sections.flatMap((section) => {
    const latestIteration = store.getLatestIteration(section.id);
    if (!latestIteration) return [];
    const latestSnapshot = store.getSnapshot(latestIteration.snapshotId);
    if (!latestSnapshot) return [];
    return [{ section, latestIteration, latestSnapshot }];
  });
  const matches = suggestSectionMatches(body.normalizedTree, candidates);
  return c.json({
    best: matches[0],
    candidates: matches.slice(0, 5)
  });
});

app.post("/sections", async (c) => {
  const body = sectionCreateSchema.parse(await c.req.json());
  const result = store.createSectionBaseline({
    projectId: body.projectId,
    projectName: body.projectName,
    sectionName: body.sectionName,
    figmaFileKey: body.figmaFileKey,
    figmaNodeId: body.figmaNodeId,
    name: body.name,
    description: body.description,
    normalizedTree: body.normalizedTree,
    screenshotPngBase64: body.screenshotPngBase64,
    rawHash: hashValue(body.rawSnapshot ?? body.normalizedTree),
    normalizedHash: hashValue(body.normalizedTree),
    isImplementationBaseline: true
  });
  return c.json(result, 201);
});

app.get("/sections/:sectionId/timeline", (c) => {
  const timeline = store.getSectionTimeline(c.req.param("sectionId"));
  if (!timeline) return c.json({ error: "Section not found." }, 404);
  return c.json(timeline);
});

app.post("/sections/:sectionId/iterations", async (c) => {
  const body = sectionIterationCreateSchema.parse(await c.req.json());
  const created = store.createSectionIteration(c.req.param("sectionId"), {
    figmaFileKey: body.figmaFileKey,
    figmaNodeId: body.figmaNodeId,
    name: body.name,
    description: body.description,
    previousIterationId: body.previousIterationId,
    normalizedTree: body.normalizedTree,
    screenshotPngBase64: body.screenshotPngBase64,
    rawHash: hashValue(body.rawSnapshot ?? body.normalizedTree),
    normalizedHash: hashValue(body.normalizedTree)
  });
  if (!created) return c.json({ error: "Section, previous iteration, or previous snapshot not found." }, 404);

  const diffs = diffSnapshots(created.previousSnapshot.normalizedTree, created.snapshot.normalizedTree);
  const draftChangelog = generateChangelog({
    id: makeId("chg"),
    projectId: created.section.projectId,
    sectionId: created.section.id,
    iterationId: created.iteration.id,
    fromCheckpointId: created.previousIteration.checkpointId,
    toCheckpointId: created.iteration.checkpointId,
    title: `${created.previousIteration.name} -> ${created.iteration.name}`,
    diffs
  });
  const changelog = await enhanceChangelogWithGemini({
    changelog: draftChangelog,
    diffs,
    beforeSnapshot: created.previousSnapshot,
    afterSnapshot: created.snapshot,
    apiKey: body.geminiApiKey
  });
  store.saveChangelog(changelog);
  const iteration = store.linkIterationChangelog(created.iteration.id, changelog.id) ?? created.iteration;
  return c.json({ section: created.section, previousIteration: created.previousIteration, iteration, changelog });
});

app.get("/sections/:sectionId/latest-delta", (c) => {
  const timeline = store.getSectionTimeline(c.req.param("sectionId"));
  if (!timeline) return c.json({ error: "Section not found." }, 404);
  const includeDrafts = c.req.query("includeDrafts") === "true";
  const latest = [...timeline.iterations]
    .reverse()
    .find((iteration) => iteration.changelog && (includeDrafts || iteration.changelog.status !== "draft"));
  if (!latest?.changelog) return c.json({ error: includeDrafts ? "No section changelog found." : "No approved section changelog found." }, 404);
  return c.json({ section: timeline.section, iteration: latest, changelog: latest.changelog });
});

app.get("/sections/:sectionId/agent-brief", (c) => {
  const timeline = store.getSectionTimeline(c.req.param("sectionId"));
  if (!timeline) return c.json({ error: "Section not found." }, 404);
  const includeDrafts = c.req.query("includeDrafts") === "true";
  const latest = [...timeline.iterations]
    .reverse()
    .find((iteration) => iteration.changelog && (includeDrafts || iteration.changelog.status !== "draft"));
  if (!latest?.changelog) return c.json({ error: includeDrafts ? "No section changelog found." : "No approved section changelog found." }, 404);
  return c.text(buildAgentBrief(latest.changelog));
});

app.post("/iterations/:iterationId/implemented", async (c) => {
  const iteration = store.getIteration(c.req.param("iterationId"));
  if (!iteration?.changelogId) return c.json({ error: "Iteration or changelog not found." }, 404);
  const body = markImplementedSchema.parse(await c.req.json());
  const changelog = store.markImplemented(iteration.changelogId, body.implementationRef, body.notes);
  if (!changelog) return c.json({ error: "Changelog not found." }, 404);
  return c.json({ iteration, changelog });
});

app.get("/projects/:projectId/checkpoints", (c) => {
  return c.json({ checkpoints: store.listCheckpoints(c.req.param("projectId")) });
});

app.get("/projects/:projectId/status", (c) => {
  return c.json(store.getProjectStatus(c.req.param("projectId")));
});

app.get("/projects/:projectId/changelogs", (c) => {
  return c.json({
    changelogs: store.listChangelogs(c.req.param("projectId"), c.req.query("includeDrafts") === "true")
  });
});

app.post("/checkpoints", async (c) => {
  const body = checkpointCreateSchema.parse(await c.req.json());
  const result = store.createCheckpoint({
    projectId: body.projectId,
    projectName: body.projectName,
    figmaFileKey: body.figmaFileKey,
    figmaNodeId: body.figmaNodeId,
    name: body.name,
    description: body.description,
    normalizedTree: body.normalizedTree,
    screenshotPngBase64: body.screenshotPngBase64,
    rawHash: hashValue(body.rawSnapshot ?? body.normalizedTree),
    normalizedHash: hashValue(body.normalizedTree),
    isImplementationBaseline: body.isImplementationBaseline
  });
  return c.json(result, 201);
});

app.post("/compare", async (c) => {
  const body = compareCreateSchema.parse(await c.req.json());
  const fromCheckpoint = store.getCheckpoint(body.fromCheckpointId);
  if (!fromCheckpoint) return c.json({ error: "Previous checkpoint not found." }, 404);
  const fromSnapshot = store.getSnapshot(fromCheckpoint.snapshotId);
  if (!fromSnapshot) return c.json({ error: "Previous snapshot not found." }, 404);

  const current = store.createCheckpoint({
    projectId: body.projectId,
    projectName: "Default Project",
    figmaFileKey: body.current.figmaFileKey,
    figmaNodeId: body.current.figmaNodeId,
    name: body.current.name,
    description: body.current.description,
    normalizedTree: body.current.normalizedTree,
    screenshotPngBase64: body.current.screenshotPngBase64,
    rawHash: hashValue(body.current.rawSnapshot ?? body.current.normalizedTree),
    normalizedHash: hashValue(body.current.normalizedTree),
    isImplementationBaseline: body.current.isImplementationBaseline
  });

  const diffs = diffSnapshots(fromSnapshot.normalizedTree, current.snapshot.normalizedTree);
  const draftChangelog = generateChangelog({
    id: makeId("chg"),
    projectId: body.projectId,
    fromCheckpointId: fromCheckpoint.id,
    toCheckpointId: current.checkpoint.id,
    title: `${fromCheckpoint.name} -> ${current.checkpoint.name}`,
    diffs
  });
  const changelog = await enhanceChangelogWithGemini({
    changelog: draftChangelog,
    diffs,
    beforeSnapshot: fromSnapshot,
    afterSnapshot: current.snapshot
  });

  store.saveChangelog(changelog);
  return c.json({ changelog });
});

app.get("/changelogs/:changelogId", (c) => {
  const changelog = store.getChangelog(c.req.param("changelogId"));
  if (!changelog) return c.json({ error: "Changelog not found." }, 404);
  return c.json({ changelog });
});

app.patch("/changelogs/:changelogId", async (c) => {
  const body = changelogUpdateSchema.parse(await c.req.json());
  const changelog = store.updateChangelog(c.req.param("changelogId"), body);
  if (!changelog) return c.json({ error: "Changelog not found." }, 404);
  return c.json({ changelog });
});

app.post("/changelogs/:changelogId/approve", (c) => {
  const changelog = store.approveChangelog(c.req.param("changelogId"));
  if (!changelog) return c.json({ error: "Changelog not found." }, 404);
  return c.json({ changelog });
});

app.post("/changelogs/:changelogId/implemented", async (c) => {
  const body = markImplementedSchema.parse(await c.req.json());
  const changelog = store.markImplemented(c.req.param("changelogId"), body.implementationRef, body.notes);
  if (!changelog) return c.json({ error: "Changelog not found." }, 404);
  return c.json({ changelog });
});

app.get("/projects/:projectId/latest-changelog", (c) => {
  const includeDrafts = c.req.query("includeDrafts") === "true";
  const changelog = store.getLatestChangelog(c.req.param("projectId"), c.req.query("nodeId"), includeDrafts);
  if (!changelog) return c.json({ error: includeDrafts ? "No changelog found." : "No approved changelog found." }, 404);
  return c.json({ changelog });
});

app.get("/projects/:projectId/agent-brief", (c) => {
  const includeDrafts = c.req.query("includeDrafts") === "true";
  const changelog = store.getLatestChangelog(c.req.param("projectId"), c.req.query("nodeId"), includeDrafts);
  if (!changelog) return c.json({ error: includeDrafts ? "No changelog found." : "No approved changelog found." }, 404);
  return c.text(buildAgentBrief(changelog));
});

app.get("/projects/:projectId/changes-since/:checkpointId", (c) => {
  const nodeIds = c.req.query("nodeIds")?.split(",").filter(Boolean) ?? [];
  const changelogs = store.listApprovedChangelogsSince(c.req.param("projectId"), c.req.param("checkpointId"), nodeIds);
  const changes = changelogs.flatMap((changelog) => changelog.changes);
  return c.json({
    changesSince: c.req.param("checkpointId"),
    totalChanges: changes.length,
    requiresCodeChanges: changes.filter((change) => change.impact === "code_required").length,
    copyOnly: changes.filter((change) => change.impact === "copy_only").length,
    noCodeImpact: changes.filter((change) => change.impact === "no_implementation_impact").length,
    changes
  });
});

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname });
console.log(`DeltaFrame server listening on http://${hostname}:${port}`);

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
