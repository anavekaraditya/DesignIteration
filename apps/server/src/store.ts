import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import initSqlJs, { type BindParams, type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import type { Change, Changelog, Checkpoint, Iteration, NormalizedNode, Project, Section, SectionTimeline, Snapshot } from "@deltaframe/core";

export type CreateCheckpointInput = {
  projectName: string;
  projectId?: string;
  figmaFileKey?: string;
  figmaNodeId: string;
  name: string;
  description?: string;
  normalizedTree: NormalizedNode;
  screenshotPngBase64?: string;
  rawHash: string;
  normalizedHash: string;
  isImplementationBaseline: boolean;
};

export type CreateSectionInput = CreateCheckpointInput & {
  sectionName?: string;
};

export type CreateIterationInput = Omit<CreateCheckpointInput, "projectId" | "projectName" | "isImplementationBaseline"> & {
  previousIterationId?: string;
};

export class DeltaFrameStore {
  private constructor(
    private readonly SQL: SqlJsStatic,
    private readonly db: Database,
    private readonly dbPath: string
  ) {}

  static async open(dbPath = process.env.DELTAFRAME_DB_PATH ?? "data/deltaframe.sqlite"): Promise<DeltaFrameStore> {
    const SQL = await initSqlJs();
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });
    const db = existsSync(resolved) ? new SQL.Database(readFileSync(resolved)) : new SQL.Database();
    const store = new DeltaFrameStore(SQL, db, resolved);
    store.migrate();
    return store;
  }

  listProjects(): Project[] {
    return this.all<Project>("select * from projects order by updatedAt desc");
  }

  getProject(id: string): Project | undefined {
    return this.get<Project>("select * from projects where id = ?", [id]);
  }

  listCheckpoints(projectId: string): Checkpoint[] {
    return this.all<Checkpoint>("select * from checkpoints where projectId = ? order by createdAt desc", [projectId]).map(
      reviveCheckpoint
    );
  }

  getCheckpoint(id: string): Checkpoint | undefined {
    const checkpoint = this.get<Checkpoint>("select * from checkpoints where id = ?", [id]);
    return checkpoint ? reviveCheckpoint(checkpoint) : undefined;
  }

  getSnapshot(id: string): Snapshot | undefined {
    const row = this.get<Record<string, unknown>>("select * from snapshots where id = ?", [id]);
    return row ? reviveSnapshot(row) : undefined;
  }

  listSections(projectId?: string): Section[] {
    const rows = projectId
      ? this.all<Section>("select * from sections where projectId = ? order by updatedAt desc", [projectId])
      : this.all<Section>("select * from sections order by updatedAt desc");
    return rows.map(reviveSection);
  }

  getSection(id: string): Section | undefined {
    const section = this.get<Section>("select * from sections where id = ?", [id]);
    return section ? reviveSection(section) : undefined;
  }

  getIteration(id: string): Iteration | undefined {
    const iteration = this.get<Iteration>("select * from iterations where id = ?", [id]);
    return iteration ? reviveIteration(iteration) : undefined;
  }

  listSectionIterations(sectionId: string): Iteration[] {
    return this.all<Iteration>("select * from iterations where sectionId = ? order by createdAt asc", [sectionId]).map(
      reviveIteration
    );
  }

  getLatestIteration(sectionId: string): Iteration | undefined {
    const iteration = this.get<Iteration>("select * from iterations where sectionId = ? order by createdAt desc", [sectionId]);
    return iteration ? reviveIteration(iteration) : undefined;
  }

  getSectionTimeline(sectionId: string): SectionTimeline | undefined {
    const section = this.getSection(sectionId);
    if (!section) return undefined;
    const iterations = this.listSectionIterations(sectionId).map((iteration) => ({
      ...iteration,
      changelog: iteration.changelogId ? this.getChangelog(iteration.changelogId) : undefined
    }));
    return { section, iterations };
  }

  createSectionBaseline(input: CreateSectionInput): {
    project: Project;
    section: Section;
    iteration: Iteration;
    checkpoint: Checkpoint;
    snapshot: Snapshot;
  } {
    const created = this.createCheckpoint({ ...input, isImplementationBaseline: true });
    const now = new Date().toISOString();
    const sectionId = id("section");
    const iterationId = id("iter");
    const section: Section = {
      id: sectionId,
      projectId: created.project.id,
      name: input.sectionName ?? input.name,
      figmaFileKey: input.figmaFileKey,
      baselineIterationId: iterationId,
      createdAt: now,
      updatedAt: now
    };
    const iteration: Iteration = {
      id: iterationId,
      sectionId,
      projectId: created.project.id,
      figmaNodeId: input.figmaNodeId,
      name: input.name,
      snapshotId: created.snapshot.id,
      checkpointId: created.checkpoint.id,
      isBaseline: true,
      createdAt: now
    };

    this.run(
      `insert into sections (id, projectId, name, figmaFileKey, baselineIterationId, createdAt, updatedAt)
      values (?, ?, ?, ?, ?, ?, ?)`,
      [section.id, section.projectId, section.name, section.figmaFileKey, section.baselineIterationId, section.createdAt, section.updatedAt]
    );
    this.insertIteration(iteration);
    this.persist();
    return { ...created, section, iteration };
  }

  createSectionIteration(sectionId: string, input: CreateIterationInput): {
    project: Project;
    section: Section;
    previousIteration: Iteration;
    iteration: Iteration;
    checkpoint: Checkpoint;
    snapshot: Snapshot;
    previousSnapshot: Snapshot;
  } | undefined {
    const section = this.getSection(sectionId);
    if (!section) return undefined;
    const previousIteration = input.previousIterationId
      ? this.getIteration(input.previousIterationId)
      : this.getLatestIteration(sectionId);
    if (!previousIteration) return undefined;
    const previousSnapshot = this.getSnapshot(previousIteration.snapshotId);
    if (!previousSnapshot) return undefined;

    const created = this.createCheckpoint({
      ...input,
      projectId: section.projectId,
      projectName: section.name,
      isImplementationBaseline: false
    });
    const now = new Date().toISOString();
    const iteration: Iteration = {
      id: id("iter"),
      sectionId,
      projectId: section.projectId,
      figmaNodeId: input.figmaNodeId,
      name: input.name,
      previousIterationId: previousIteration.id,
      snapshotId: created.snapshot.id,
      checkpointId: created.checkpoint.id,
      isBaseline: false,
      createdAt: now
    };
    this.insertIteration(iteration);
    this.run("update sections set updatedAt = ? where id = ?", [now, sectionId]);
    this.persist();
    return {
      ...created,
      section,
      previousIteration,
      previousSnapshot,
      iteration
    };
  }

  createCheckpoint(input: CreateCheckpointInput): { project: Project; checkpoint: Checkpoint; snapshot: Snapshot } {
    const now = new Date().toISOString();
    const project = this.ensureProject(input.projectId, input.projectName, input.figmaFileKey, now);
    const checkpointId = id("cp");
    const snapshotId = id("snap");
    const checkpoint: Checkpoint = {
      id: checkpointId,
      projectId: project.id,
      figmaFileKey: input.figmaFileKey,
      figmaNodeId: input.figmaNodeId,
      name: input.name,
      description: input.description,
      snapshotId,
      isImplementationBaseline: input.isImplementationBaseline,
      createdAt: now
    };
    const snapshot: Snapshot = {
      id: snapshotId,
      checkpointId,
      rawHash: input.rawHash,
      normalizedHash: input.normalizedHash,
      normalizedTree: input.normalizedTree,
      screenshotPngBase64: input.screenshotPngBase64,
      createdAt: now
    };

    this.run(
      `insert into checkpoints
      (id, projectId, figmaFileKey, figmaNodeId, name, description, snapshotId, isImplementationBaseline, createdAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkpoint.id,
        checkpoint.projectId,
        checkpoint.figmaFileKey,
        checkpoint.figmaNodeId,
        checkpoint.name,
        checkpoint.description,
        checkpoint.snapshotId,
        checkpoint.isImplementationBaseline ? 1 : 0,
        checkpoint.createdAt
      ]
    );
    this.run(
      `insert into snapshots (id, checkpointId, rawHash, normalizedHash, normalizedTree, screenshotPngBase64, createdAt)
      values (?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.checkpointId,
        snapshot.rawHash,
        snapshot.normalizedHash,
        JSON.stringify(snapshot.normalizedTree),
        snapshot.screenshotPngBase64,
        snapshot.createdAt
      ]
    );
    this.persist();
    return { project, checkpoint, snapshot };
  }

  saveChangelog(changelog: Changelog): Changelog {
    this.run(
      `insert into changelogs
      (id, projectId, sectionId, iterationId, fromCheckpointId, toCheckpointId, title, summary, status, markdown, createdAt, approvedAt, implementedAt, implementationRef, implementationNotes)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        changelog.id,
        changelog.projectId,
        changelog.sectionId,
        changelog.iterationId,
        changelog.fromCheckpointId,
        changelog.toCheckpointId,
        changelog.title,
        changelog.summary,
        changelog.status,
        changelog.markdown,
        changelog.createdAt,
        changelog.approvedAt,
        changelog.implementedAt,
        changelog.implementationRef,
        changelog.implementationNotes
      ]
    );
    this.replaceChanges(changelog.id, changelog.changes);
    this.persist();
    return changelog;
  }

  linkIterationChangelog(iterationId: string, changelogId: string): Iteration | undefined {
    this.run("update iterations set changelogId = ? where id = ?", [changelogId, iterationId]);
    this.persist();
    return this.getIteration(iterationId);
  }

  getChangelog(id: string): Changelog | undefined {
    const row = this.get<Record<string, unknown>>("select * from changelogs where id = ?", [id]);
    return row ? this.reviveChangelog(row) : undefined;
  }

  listChangelogs(projectId: string, includeDrafts = false): Changelog[] {
    const statuses = includeDrafts ? ["draft", "approved", "implemented"] : ["approved", "implemented"];
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.all<Record<string, unknown>>(
      `select * from changelogs where projectId = ? and status in (${placeholders}) order by createdAt desc`,
      [projectId, ...statuses]
    );
    return rows.map((row) => this.reviveChangelog(row));
  }

  getLatestChangelog(projectId: string, nodeId?: string, includeDrafts = false): Changelog | undefined {
    const changelogs = this.listChangelogs(projectId, includeDrafts);
    if (!nodeId) return changelogs[0];
    return changelogs.find((changelog) => changelog.changes.some((change) => change.nodeId === nodeId));
  }

  getProjectStatus(projectId: string): {
    project?: Project;
    checkpointCount: number;
    changelogCount: number;
    latestCheckpoint?: Checkpoint;
    latestChangelog?: Changelog;
    latestApprovedChangelog?: Changelog;
  } {
    const checkpoints = this.listCheckpoints(projectId);
    const changelogs = this.listChangelogs(projectId, true);
    return {
      project: this.getProject(projectId),
      checkpointCount: checkpoints.length,
      changelogCount: changelogs.length,
      latestCheckpoint: checkpoints[0],
      latestChangelog: changelogs[0],
      latestApprovedChangelog: changelogs.find((changelog) => changelog.status === "approved" || changelog.status === "implemented")
    };
  }

  getLatestApprovedChangelog(projectId: string, nodeId?: string): Changelog | undefined {
    const rows = this.all<Record<string, unknown>>(
      `select * from changelogs where projectId = ? and status in ('approved', 'implemented') order by createdAt desc`,
      [projectId]
    );
    const changelogs = rows.map((row) => this.reviveChangelog(row));
    if (!nodeId) return changelogs[0];
    return changelogs.find((changelog) => changelog.changes.some((change) => change.nodeId === nodeId));
  }

  listApprovedChangelogsSince(projectId: string, checkpointId: string, nodeIds: string[] = []): Changelog[] {
    const changelogs = this.listChangelogs(projectId, false).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const chain: Changelog[] = [];
    let cursor = checkpointId;
    let changed = true;
    while (changed) {
      changed = false;
      for (const changelog of changelogs) {
        if (chain.some((item) => item.id === changelog.id)) continue;
        if (changelog.fromCheckpointId !== cursor) continue;
        chain.push(changelog);
        cursor = changelog.toCheckpointId;
        changed = true;
      }
    }

    return chain
      .map((changelog) =>
        nodeIds.length === 0
          ? changelog
          : { ...changelog, changes: changelog.changes.filter((change) => nodeIds.includes(change.nodeId)) }
      )
      .filter((changelog) => changelog.changes.length > 0);
  }

  updateChangelog(id: string, patch: Partial<Pick<Changelog, "title" | "summary" | "changes">>): Changelog | undefined {
    const current = this.getChangelog(id);
    if (!current) return undefined;
    const next = {
      ...current,
      ...patch,
      markdown: patch.changes || patch.title || patch.summary ? current.markdown : current.markdown
    };
    this.run("update changelogs set title = ?, summary = ?, markdown = ? where id = ?", [
      next.title,
      next.summary,
      next.markdown,
      id
    ]);
    if (patch.changes) this.replaceChanges(id, patch.changes);
    this.persist();
    return this.getChangelog(id);
  }

  approveChangelog(id: string): Changelog | undefined {
    const approvedAt = new Date().toISOString();
    this.run("update changelogs set status = 'approved', approvedAt = ? where id = ?", [approvedAt, id]);
    this.persist();
    return this.getChangelog(id);
  }

  markImplemented(id: string, implementationRef?: string, implementationNotes?: string): Changelog | undefined {
    const implementedAt = new Date().toISOString();
    this.run(
      `update changelogs
      set status = 'implemented', implementedAt = ?, implementationRef = ?, implementationNotes = ?
      where id = ?`,
      [implementedAt, implementationRef, implementationNotes, id]
    );
    this.persist();
    return this.getChangelog(id);
  }

  private ensureProject(projectId: string | undefined, name: string, figmaFileKey: string | undefined, now: string): Project {
    if (projectId) {
      const existing = this.getProject(projectId);
      if (existing) {
        this.run("update projects set updatedAt = ? where id = ?", [now, projectId]);
        return { ...existing, updatedAt: now };
      }
    }

    const project: Project = {
      id: projectId ?? id("project"),
      name,
      figmaFileKey,
      createdAt: now,
      updatedAt: now
    };
    this.run("insert into projects (id, name, figmaFileKey, createdAt, updatedAt) values (?, ?, ?, ?, ?)", [
      project.id,
      project.name,
      project.figmaFileKey,
      project.createdAt,
      project.updatedAt
    ]);
    return project;
  }

  private replaceChanges(changelogId: string, changes: Change[]): void {
    this.run("delete from changes where changelogId = ?", [changelogId]);
    for (const change of changes) {
      this.run(
        `insert into changes
        (id, changelogId, category, impact, nodeId, nodePath, beforeValue, afterValue, implementationNote, confidence, approved)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          change.id,
          changelogId,
          change.category,
          change.impact,
          change.nodeId,
          change.nodePath,
          JSON.stringify(change.before),
          JSON.stringify(change.after),
          change.implementationNote,
          change.confidence,
          change.approved ? 1 : 0
        ]
      );
    }
  }

  private reviveChangelog(row: Record<string, unknown>): Changelog {
    const changes = this.all<Record<string, unknown>>("select * from changes where changelogId = ? order by id", [
      String(row.id)
    ]).map(reviveChange);
    return {
      id: String(row.id),
      projectId: String(row.projectId),
      sectionId: optionalString(row.sectionId),
      iterationId: optionalString(row.iterationId),
      fromCheckpointId: String(row.fromCheckpointId),
      toCheckpointId: String(row.toCheckpointId),
      title: String(row.title),
      summary: String(row.summary),
      status: row.status as Changelog["status"],
      changes,
      markdown: String(row.markdown),
      createdAt: String(row.createdAt),
      approvedAt: optionalString(row.approvedAt),
      implementedAt: optionalString(row.implementedAt),
      implementationRef: optionalString(row.implementationRef),
      implementationNotes: optionalString(row.implementationNotes)
    };
  }

  private migrate(): void {
    this.db.run(`
      create table if not exists projects (
        id text primary key,
        name text not null,
        figmaFileKey text,
        createdAt text not null,
        updatedAt text not null
      );
      create table if not exists checkpoints (
        id text primary key,
        projectId text not null,
        figmaFileKey text,
        figmaNodeId text not null,
        name text not null,
        description text,
        snapshotId text not null,
        isImplementationBaseline integer not null default 0,
        createdAt text not null
      );
      create table if not exists snapshots (
        id text primary key,
        checkpointId text not null,
        rawHash text not null,
        normalizedHash text not null,
        normalizedTree text not null,
        screenshotPngBase64 text,
        createdAt text not null
      );
      create table if not exists changelogs (
        id text primary key,
        projectId text not null,
        sectionId text,
        iterationId text,
        fromCheckpointId text not null,
        toCheckpointId text not null,
        title text not null,
        summary text not null,
        status text not null,
        markdown text not null,
        createdAt text not null,
        approvedAt text,
        implementedAt text,
        implementationRef text,
        implementationNotes text
      );
      create table if not exists sections (
        id text primary key,
        projectId text not null,
        name text not null,
        figmaFileKey text,
        baselineIterationId text,
        createdAt text not null,
        updatedAt text not null
      );
      create table if not exists iterations (
        id text primary key,
        sectionId text not null,
        projectId text not null,
        figmaNodeId text not null,
        name text not null,
        previousIterationId text,
        snapshotId text not null,
        checkpointId text not null,
        changelogId text,
        isBaseline integer not null default 0,
        createdAt text not null
      );
      create table if not exists changes (
        id text primary key,
        changelogId text not null,
        category text not null,
        impact text not null,
        nodeId text not null,
        nodePath text not null,
        beforeValue text,
        afterValue text,
        implementationNote text not null,
        confidence real not null,
        approved integer not null
      );
    `);
    this.addColumnIfMissing("snapshots", "screenshotPngBase64", "text");
    this.addColumnIfMissing("changelogs", "sectionId", "text");
    this.addColumnIfMissing("changelogs", "iterationId", "text");
    this.persist();
  }

  private insertIteration(iteration: Iteration): void {
    this.run(
      `insert into iterations
      (id, sectionId, projectId, figmaNodeId, name, previousIterationId, snapshotId, checkpointId, changelogId, isBaseline, createdAt)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        iteration.id,
        iteration.sectionId,
        iteration.projectId,
        iteration.figmaNodeId,
        iteration.name,
        iteration.previousIterationId,
        iteration.snapshotId,
        iteration.checkpointId,
        iteration.changelogId,
        iteration.isBaseline ? 1 : 0,
        iteration.createdAt
      ]
    );
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const columns = this.all<Record<string, unknown>>(`pragma table_info(${table})`);
    if (columns.some((item) => item.name === column)) return;
    this.db.run(`alter table ${table} add column ${column} ${type}`);
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql, bind(params));
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    stmt.free();
    return rows;
  }

  private get<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  private run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, bind(params));
  }

  private persist(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}

function reviveCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return { ...checkpoint, isImplementationBaseline: Boolean(checkpoint.isImplementationBaseline) };
}

function reviveSection(section: Section): Section {
  return {
    ...section,
    baselineIterationId: optionalString(section.baselineIterationId)
  };
}

function reviveIteration(iteration: Iteration): Iteration {
  return {
    ...iteration,
    previousIterationId: optionalString(iteration.previousIterationId),
    changelogId: optionalString(iteration.changelogId),
    isBaseline: Boolean(iteration.isBaseline)
  };
}

function reviveSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: String(row.id),
    checkpointId: String(row.checkpointId),
    rawHash: String(row.rawHash),
    normalizedHash: String(row.normalizedHash),
    normalizedTree: JSON.parse(String(row.normalizedTree)) as NormalizedNode,
    screenshotPngBase64: optionalString(row.screenshotPngBase64),
    createdAt: String(row.createdAt)
  };
}

function reviveChange(row: Record<string, unknown>): Change {
  return {
    id: String(row.id),
    changelogId: String(row.changelogId),
    category: row.category as Change["category"],
    impact: row.impact as Change["impact"],
    nodeId: String(row.nodeId),
    nodePath: String(row.nodePath),
    before: parseOptionalJson(row.beforeValue),
    after: parseOptionalJson(row.afterValue),
    implementationNote: String(row.implementationNote),
    confidence: Number(row.confidence),
    approved: Boolean(row.approved)
  };
}

function parseOptionalJson(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  return JSON.parse(String(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function bind(params: unknown[]): BindParams {
  return params.map((param) => (param === undefined ? null : param)) as SqlValue[];
}
