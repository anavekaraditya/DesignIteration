import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  generateChangelog,
  groupDesignerChanges,
  normalizeFigmaRestExport,
  suggestSectionMatches,
  type Iteration,
  type NormalizedNode,
  type Section,
  type Snapshot
} from "../src/index.js";

const checkoutV1 = {
  document: {
    id: "1:1",
    name: "Checkout",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 480 },
    children: [
      {
        id: "1:2",
        name: "Primary CTA",
        type: "TEXT",
        characters: "Continue",
        absoluteBoundingBox: { x: 20, y: 420, width: 120, height: 24 },
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }]
      },
      {
        id: "1:3",
        name: "Notes",
        type: "TEXT",
        visible: false,
        characters: "Internal only"
      }
    ]
  }
};

const checkoutV2 = {
  document: {
    id: "1:1",
    name: "Checkout",
    type: "FRAME",
    absoluteBoundingBox: { x: 1, y: 1, width: 320, height: 484 },
    children: [
      {
        id: "1:2",
        name: "Primary CTA",
        type: "TEXT",
        characters: "Review order",
        absoluteBoundingBox: { x: 21, y: 421, width: 140, height: 24 },
        fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }]
      },
      {
        id: "1:4",
        name: "Expired card error",
        type: "TEXT",
        characters: "Card expired"
      }
    ]
  }
};

describe("DeltaFrame core", () => {
  it("normalizes Figma REST exports and ignores hidden annotation layers", () => {
    const normalized = normalizeFigmaRestExport(checkoutV1);
    expect(normalized.name).toBe("Checkout");
    expect(normalized.children?.map((child) => child.name)).toEqual(["Primary CTA"]);
  });

  it("detects implementation-relevant diffs with movement thresholds", () => {
    const before = normalizeFigmaRestExport(checkoutV1);
    const after = normalizeFigmaRestExport(checkoutV2);
    const diffs = diffSnapshots(before, after);

    expect(diffs.some((diff) => diff.property === "text")).toBe(true);
    expect(diffs.some((diff) => diff.property === "height")).toBe(true);
    expect(diffs.some((diff) => diff.kind === "added")).toBe(true);
    expect(diffs.some((diff) => diff.property === "x")).toBe(false);
  });

  it("generates editable implementation-aware changelogs", () => {
    const before = normalizeFigmaRestExport(checkoutV1);
    const after = normalizeFigmaRestExport(checkoutV2);
    const changelog = generateChangelog({
      id: "chg_1",
      projectId: "project_1",
      fromCheckpointId: "cp_1",
      toCheckpointId: "cp_2",
      title: "Checkout v1 -> v2",
      diffs: diffSnapshots(before, after)
    });

    expect(changelog.status).toBe("draft");
    expect(changelog.markdown).toContain("DeltaFrame Changelog");
    expect(changelog.changes.some((change) => change.impact === "copy_only")).toBe(true);
  });

  it("groups designer-level movement and resize changes", () => {
    const childBefore = node({
      id: "1:1",
      name: "Primary CTA",
      path: "Checkout / Primary CTA",
      x: 20,
      y: 420,
      width: 120,
      height: 40
    });
    const childAfter = { ...childBefore, x: 32, y: 428, width: 144, height: 44 };
    const before = node({ id: "0:1", name: "Checkout", path: "Checkout", children: [childBefore] });
    const after = node({ id: "0:1", name: "Checkout", path: "Checkout", children: [childAfter] });
    const changes = groupDesignerChanges(diffSnapshots(before, after));

    expect(changes.map((change) => change.type)).toEqual(["moved", "resized"]);
    expect(changes[0].summary).toContain("moved right by 12px and down by 8px");
    expect(changes[1].summary).toContain("width increased by 24px");
  });

  it("groups padding, typography, and color changes into designer-language events", () => {
    const before = node({
      layout: { paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, itemSpacing: 8 },
      typography: { fontFamily: "Inter", fontWeight: 400, fontSize: 14, lineHeightPx: 20 },
      fills: [{ type: "SOLID", color: "#111111", opacity: 1 }]
    });
    const after = node({
      layout: { paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 16, itemSpacing: 12 },
      typography: { fontFamily: "Inter", fontWeight: 600, fontSize: 16, lineHeightPx: 24 },
      fills: [{ type: "SOLID", color: "#222222", opacity: 1 }]
    });
    const changes = groupDesignerChanges(diffSnapshots(before, after));

    expect(changes.some((change) => change.type === "spacing_changed" && change.summary.includes("padding changed"))).toBe(true);
    expect(changes.some((change) => change.type === "spacing_changed" && change.summary.includes("spacing changed"))).toBe(true);
    expect(changes.some((change) => change.type === "typography_changed" && change.summary.includes("font changed"))).toBe(true);
    expect(changes.some((change) => change.type === "color_changed" && change.summary.includes("visual styling changed"))).toBe(true);
  });

  it("groups copy, visibility, added, removed, component, and token changes", () => {
    const before = node({
      id: "1:1",
      name: "Checkout",
      path: "Checkout",
      children: [
        node({ id: "1:2", name: "CTA", path: "Checkout / CTA", text: "Continue" }),
        node({ id: "1:3", name: "Helper", path: "Checkout / Helper", visible: true }),
        node({ id: "1:4", name: "Old badge", type: "RECTANGLE", path: "Checkout / Old badge" }),
        node({
          id: "1:5",
          name: "Button instance",
          path: "Checkout / Button instance",
          component: { variantProperties: { state: "default" } },
          variables: [{ property: "fill", id: "var_old", name: "color/old" }]
        })
      ]
    });
    const after = node({
      id: "1:1",
      name: "Checkout",
      path: "Checkout",
      children: [
        node({ id: "1:2", name: "CTA", path: "Checkout / CTA", text: "Review order" }),
        node({ id: "1:3", name: "Helper", path: "Checkout / Helper", visible: false }),
        node({ id: "1:6", name: "New badge", type: "TEXT", path: "Checkout / New badge" }),
        node({
          id: "1:5",
          name: "Button instance",
          path: "Checkout / Button instance",
          component: { variantProperties: { state: "pressed" } },
          variables: [{ property: "fill", id: "var_new", name: "color/new" }]
        })
      ]
    });
    const changes = groupDesignerChanges(diffSnapshots(before, after));

    expect(changes.some((change) => change.type === "copy_changed")).toBe(true);
    expect(changes.some((change) => change.type === "visibility_changed" && change.summary.includes("hidden"))).toBe(true);
    expect(changes.some((change) => change.type === "element_added")).toBe(true);
    expect(changes.some((change) => change.type === "element_removed")).toBe(true);
    expect(changes.some((change) => change.type === "component_variant_changed")).toBe(true);
    expect(changes.some((change) => change.type === "token_changed")).toBe(true);
  });

  it("ignores copied root frame offsets", () => {
    const before = node({ id: "1:1", name: "Checkout", path: "Checkout", x: 0, y: 0 });
    const after = { ...before, x: 480, y: 0 };

    expect(diffSnapshots(before, after)).toEqual([]);
  });

  it("suggests high-confidence section matches for copied iterations", () => {
    const base = node({
      id: "1:1",
      name: "Checkout Payment",
      path: "Checkout Payment",
      width: 390,
      height: 720,
      children: [
        node({ id: "1:2", name: "Payment title", path: "Checkout Payment / Payment title", text: "Payment" }),
        node({ id: "1:3", name: "Primary CTA", path: "Checkout Payment / Primary CTA", text: "Continue" })
      ]
    });
    const copied = {
      ...base,
      id: "2:1",
      name: "Checkout Payment Copy 2",
      path: "Checkout Payment Copy 2",
      x: 520,
      children: base.children?.map((child) => ({ ...child, id: child.id.replace("1:", "2:") }))
    };
    const unrelated = node({
      id: "9:1",
      name: "Settings",
      path: "Settings",
      children: [node({ id: "9:2", name: "Notifications", path: "Settings / Notifications", text: "Notifications" })]
    });
    const matches = suggestSectionMatches(copied, [
      matchCandidate("section_checkout", "Checkout Payment", base),
      matchCandidate("section_settings", "Settings", unrelated)
    ]);

    expect(matches[0].section.id).toBe("section_checkout");
    expect(matches[0].confidence).toBeGreaterThanOrEqual(0.72);
    expect(matches[1].confidence).toBeLessThan(0.58);
  });
});

function node(overrides: Partial<NormalizedNode> = {}): NormalizedNode {
  return {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    path: "Checkout / Card",
    visible: true,
    width: 320,
    height: 200,
    x: 0,
    y: 0,
    ...overrides
  };
}

function matchCandidate(id: string, name: string, tree: NormalizedNode) {
  const section: Section = {
    id,
    projectId: "project_1",
    name,
    baselineIterationId: "iter_" + id,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z"
  };
  const latestIteration: Iteration = {
    id: "iter_" + id,
    sectionId: id,
    projectId: "project_1",
    figmaNodeId: tree.id,
    name,
    snapshotId: "snap_" + id,
    checkpointId: "cp_" + id,
    isBaseline: false,
    createdAt: "2026-05-08T00:00:00.000Z"
  };
  const latestSnapshot: Snapshot = {
    id: "snap_" + id,
    checkpointId: "cp_" + id,
    rawHash: id,
    normalizedHash: id,
    normalizedTree: tree,
    createdAt: "2026-05-08T00:00:00.000Z"
  };
  return { section, latestIteration, latestSnapshot };
}
