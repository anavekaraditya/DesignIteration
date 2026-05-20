import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffSnapshots, generateChangelog, hashValue, suggestSectionMatches, type NormalizedNode } from "@deltaframe/core";
import { DeltaFrameStore } from "../src/store.js";

const baseTree: NormalizedNode = {
  id: "1:1",
  name: "Checkout",
  type: "FRAME",
  path: "Checkout",
  visible: true,
  children: [
    {
      id: "1:2",
      name: "Primary CTA",
      type: "TEXT",
      path: "Checkout / Primary CTA",
      visible: true,
      text: "Continue"
    }
  ]
};

const nextTree: NormalizedNode = {
  ...baseTree,
  children: [{ ...baseTree.children![0], text: "Review order" }]
};

describe("DeltaFrameStore", () => {
  it("persists checkpoints and approved changelogs for MCP delivery", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "deltaframe-")), "test.sqlite");
    const store = await DeltaFrameStore.open(dbPath);

    const first = store.createCheckpoint({
      projectName: "Checkout",
      figmaNodeId: "1:1",
      name: "Checkout v1",
      normalizedTree: baseTree,
      rawHash: hashValue(baseTree),
      normalizedHash: hashValue(baseTree),
      isImplementationBaseline: true
    });
    const second = store.createCheckpoint({
      projectId: first.project.id,
      projectName: "Checkout",
      figmaNodeId: "1:1",
      name: "Checkout v2",
      normalizedTree: nextTree,
      rawHash: hashValue(nextTree),
      normalizedHash: hashValue(nextTree),
      isImplementationBaseline: false
    });

    const changelog = generateChangelog({
      id: "chg_test",
      projectId: first.project.id,
      fromCheckpointId: first.checkpoint.id,
      toCheckpointId: second.checkpoint.id,
      title: "Checkout v1 -> v2",
      diffs: diffSnapshots(baseTree, nextTree)
    });

    store.saveChangelog(changelog);
    store.approveChangelog(changelog.id);

    const latest = store.getLatestChangelog(first.project.id);
    expect(latest?.id).toBe(changelog.id);
    expect(latest?.changes[0].implementationNote).toContain("Review order");
  });

  it("creates section baselines and chained iterations", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "deltaframe-section-")), "test.sqlite");
    const store = await DeltaFrameStore.open(dbPath);

    const baseline = store.createSectionBaseline({
      projectName: "Checkout",
      sectionName: "Checkout Payment",
      figmaNodeId: "1:1",
      name: "Checkout baseline",
      normalizedTree: baseTree,
      rawHash: hashValue(baseTree),
      normalizedHash: hashValue(baseTree),
      isImplementationBaseline: true
    });

    const iteration = store.createSectionIteration(baseline.section.id, {
      figmaNodeId: "1:1",
      name: "Checkout iteration 1",
      normalizedTree: nextTree,
      rawHash: hashValue(nextTree),
      normalizedHash: hashValue(nextTree)
    });

    expect(iteration?.previousIteration.id).toBe(baseline.iteration.id);
    expect(iteration?.previousSnapshot.normalizedTree.children?.[0].text).toBe("Continue");

    const changelog = generateChangelog({
      id: "chg_section",
      projectId: baseline.project.id,
      sectionId: baseline.section.id,
      iterationId: iteration!.iteration.id,
      fromCheckpointId: baseline.iteration.checkpointId,
      toCheckpointId: iteration!.iteration.checkpointId,
      title: "Checkout baseline -> iteration 1",
      diffs: diffSnapshots(baseTree, nextTree)
    });
    store.saveChangelog(changelog);
    store.linkIterationChangelog(iteration!.iteration.id, changelog.id);

    const timeline = store.getSectionTimeline(baseline.section.id);
    expect(timeline?.iterations).toHaveLength(2);
    expect(timeline?.iterations[1].changelog?.id).toBe(changelog.id);
  });

  it("builds smart-match candidates from stored section timelines", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "deltaframe-match-")), "test.sqlite");
    const store = await DeltaFrameStore.open(dbPath);

    const checkout = store.createSectionBaseline({
      projectName: "Checkout",
      sectionName: "Checkout Payment",
      figmaNodeId: "1:1",
      name: "Checkout baseline",
      normalizedTree: baseTree,
      rawHash: hashValue(baseTree),
      normalizedHash: hashValue(baseTree),
      isImplementationBaseline: true
    });
    const settingsTree: NormalizedNode = {
      id: "9:1",
      name: "Settings",
      type: "FRAME",
      path: "Settings",
      visible: true,
      children: [{ id: "9:2", name: "Email toggle", type: "TEXT", path: "Settings / Email toggle", visible: true, text: "Email" }]
    };
    store.createSectionBaseline({
      projectName: "Checkout",
      projectId: checkout.project.id,
      sectionName: "Settings",
      figmaNodeId: "9:1",
      name: "Settings baseline",
      normalizedTree: settingsTree,
      rawHash: hashValue(settingsTree),
      normalizedHash: hashValue(settingsTree),
      isImplementationBaseline: true
    });

    const candidates = store.listSections(checkout.project.id).flatMap((section) => {
      const latestIteration = store.getLatestIteration(section.id);
      if (!latestIteration) return [];
      const latestSnapshot = store.getSnapshot(latestIteration.snapshotId);
      if (!latestSnapshot) return [];
      return [{ section, latestIteration, latestSnapshot }];
    });
    const copiedCheckout = { ...baseTree, id: "2:1", name: "Checkout Payment Copy", x: 480 };
    const matches = suggestSectionMatches(copiedCheckout, candidates);

    expect(matches[0].section.name).toBe("Checkout Payment");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(0.72);
    expect(matches[1].confidence).toBeLessThan(0.58);
  });
});
