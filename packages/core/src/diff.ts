import { stableStringify } from "./hash.js";
import type { NormalizedNode, RawDiff } from "./types.js";

export type DiffOptions = {
  movementThreshold?: number;
  matchThreshold?: number;
};

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  movementThreshold: 2,
  matchThreshold: 0.58
};

type FlatNode = {
  node: NormalizedNode;
  depth: number;
  index: number;
  parentPath: string;
};

type NodeMatch = {
  before: NormalizedNode;
  after: NormalizedNode;
  beforeDepth: number;
  afterDepth: number;
  confidence: number;
  reason: string;
};

type PropertyRule = {
  property: string;
  get: (node: NormalizedNode) => unknown;
  threshold?: number;
};

const PROPERTY_RULES: PropertyRule[] = [
  { property: "name", get: (node) => node.name },
  { property: "visible", get: (node) => node.visible },
  { property: "text", get: (node) => node.text },
  { property: "typography.fontFamily", get: (node) => node.typography?.fontFamily },
  { property: "typography.fontStyle", get: (node) => node.typography?.fontStyle },
  { property: "typography.fontWeight", get: (node) => node.typography?.fontWeight },
  { property: "typography.fontSize", get: (node) => node.typography?.fontSize },
  { property: "typography.lineHeightPx", get: (node) => node.typography?.lineHeightPx },
  { property: "typography.letterSpacing", get: (node) => node.typography?.letterSpacing },
  { property: "width", get: (node) => node.width },
  { property: "height", get: (node) => node.height },
  { property: "x", get: (node) => node.x, threshold: 2 },
  { property: "y", get: (node) => node.y, threshold: 2 },
  { property: "fills", get: (node) => node.fills },
  { property: "strokes", get: (node) => node.strokes },
  { property: "effects", get: (node) => node.effects },
  { property: "cornerRadius", get: (node) => node.cornerRadius },
  { property: "layout.mode", get: (node) => node.layout?.mode },
  { property: "layout.primaryAxisSizingMode", get: (node) => node.layout?.primaryAxisSizingMode },
  { property: "layout.counterAxisSizingMode", get: (node) => node.layout?.counterAxisSizingMode },
  { property: "layout.primaryAxisAlignItems", get: (node) => node.layout?.primaryAxisAlignItems },
  { property: "layout.counterAxisAlignItems", get: (node) => node.layout?.counterAxisAlignItems },
  { property: "layout.paddingLeft", get: (node) => node.layout?.paddingLeft },
  { property: "layout.paddingRight", get: (node) => node.layout?.paddingRight },
  { property: "layout.paddingTop", get: (node) => node.layout?.paddingTop },
  { property: "layout.paddingBottom", get: (node) => node.layout?.paddingBottom },
  { property: "layout.itemSpacing", get: (node) => node.layout?.itemSpacing },
  { property: "constraints", get: (node) => node.constraints },
  { property: "component.key", get: (node) => node.component?.key },
  { property: "component.mainComponentId", get: (node) => node.component?.mainComponentId },
  { property: "component.variantProperties", get: (node) => node.component?.variantProperties },
  { property: "component.componentProperties", get: (node) => node.component?.componentProperties },
  { property: "variables", get: (node) => node.variables }
];

export function diffSnapshots(before: NormalizedNode, after: NormalizedNode, options: DiffOptions = {}): RawDiff[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const beforeNodes = flattenTree(before);
  const afterNodes = flattenTree(after);
  const matches = matchNodes(beforeNodes, afterNodes, resolved.matchThreshold);
  const matchedBeforeIds = new Set(matches.map((match) => match.before.id));
  const matchedAfterIds = new Set(matches.map((match) => match.after.id));
  const diffs: RawDiff[] = [];

  for (const match of matches) {
    for (const rule of PROPERTY_RULES) {
      const beforeValue = rule.get(match.before);
      const afterValue = rule.get(match.after);
      const threshold = rule.threshold ?? (rule.property === "x" || rule.property === "y" ? resolved.movementThreshold : undefined);
      if (isIgnorableNumberChange(beforeValue, afterValue, threshold)) continue;
      if (stableStringify(beforeValue) === stableStringify(afterValue)) continue;
      const diff = makeDiff(rule.property === "name" ? "renamed" : "changed", match, rule.property, beforeValue, afterValue);
      if (diff) diffs.push(diff);
    }
  }

  for (const item of beforeNodes) {
    if (!matchedBeforeIds.has(item.node.id)) {
      diffs.push(makeUnmatchedDiff("removed", item.node, "node", item.node.name, undefined));
    }
  }

  for (const item of afterNodes) {
    if (!matchedAfterIds.has(item.node.id)) {
      diffs.push(makeUnmatchedDiff("added", item.node, "node", undefined, item.node.name));
    }
  }

  return diffs.sort((a, b) => impactSort(a.property) - impactSort(b.property) || a.nodePath.localeCompare(b.nodePath));
}

export function flattenTree(root: NormalizedNode): FlatNode[] {
  const nodes: FlatNode[] = [];
  const visit = (node: NormalizedNode, depth: number, index: number, parentPath: string) => {
    nodes.push({ node, depth, index, parentPath });
    node.children?.forEach((child, childIndex) => visit(child, depth + 1, childIndex, node.path));
  };
  visit(root, 0, 0, "");
  return nodes;
}

function matchNodes(beforeNodes: FlatNode[], afterNodes: FlatNode[], threshold: number): NodeMatch[] {
  const matches: NodeMatch[] = [];
  const unmatchedBefore = new Map(beforeNodes.map((item) => [item.node.id, item]));
  const unmatchedAfter = new Map(afterNodes.map((item) => [item.node.id, item]));

  for (const beforeItem of beforeNodes) {
    const afterItem = unmatchedAfter.get(beforeItem.node.id);
    if (!afterItem) continue;
    matches.push({
      before: beforeItem.node,
      after: afterItem.node,
      beforeDepth: beforeItem.depth,
      afterDepth: afterItem.depth,
      confidence: 1,
      reason: "same Figma node id"
    });
    unmatchedBefore.delete(beforeItem.node.id);
    unmatchedAfter.delete(afterItem.node.id);
  }

  const candidates: Array<{ before: FlatNode; after: FlatNode; score: number; reason: string }> = [];
  for (const beforeItem of unmatchedBefore.values()) {
    for (const afterItem of unmatchedAfter.values()) {
      const scored = scoreNodeSimilarity(beforeItem, afterItem);
      if (scored.score >= threshold) {
        candidates.push({ before: beforeItem, after: afterItem, score: scored.score, reason: scored.reason });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (!unmatchedBefore.has(candidate.before.node.id) || !unmatchedAfter.has(candidate.after.node.id)) continue;
    matches.push({
      before: candidate.before.node,
      after: candidate.after.node,
      beforeDepth: candidate.before.depth,
      afterDepth: candidate.after.depth,
      confidence: round(candidate.score),
      reason: candidate.reason
    });
    unmatchedBefore.delete(candidate.before.node.id);
    unmatchedAfter.delete(candidate.after.node.id);
  }

  return matches;
}

function scoreNodeSimilarity(before: FlatNode, after: FlatNode): { score: number; reason: string } {
  if (before.node.type !== after.node.type) return { score: 0, reason: "different node type" };

  const reasons: string[] = ["same type"];
  let score = 0.18;

  if (normalizeName(before.node.name) === normalizeName(after.node.name)) {
    score += 0.22;
    reasons.push("same name");
  } else if (nameTokens(before.node.name).some((token) => nameTokens(after.node.name).includes(token))) {
    score += 0.1;
    reasons.push("similar name");
  }

  if (before.node.text && after.node.text && normalizeName(before.node.text) === normalizeName(after.node.text)) {
    score += 0.18;
    reasons.push("same text");
  }

  if (before.node.component?.key && before.node.component.key === after.node.component?.key) {
    score += 0.28;
    reasons.push("same component key");
  }

  if (before.node.component?.mainComponentId && before.node.component.mainComponentId === after.node.component?.mainComponentId) {
    score += 0.2;
    reasons.push("same main component");
  }

  const sizeScore = sizeSimilarity(before.node, after.node);
  if (sizeScore > 0) {
    score += sizeScore * 0.12;
    reasons.push("similar size");
  }

  const positionScore = positionSimilarity(before.node, after.node);
  if (positionScore > 0) {
    score += positionScore * 0.1;
    reasons.push("similar position");
  }

  if (before.depth === after.depth) {
    score += 0.04;
    reasons.push("same depth");
  }

  if (normalizeName(lastPathSegment(before.parentPath)) === normalizeName(lastPathSegment(after.parentPath))) {
    score += 0.08;
    reasons.push("same parent role");
  }

  return { score: Math.min(score, 0.99), reason: reasons.join(", ") };
}

function makeDiff(kind: RawDiff["kind"], match: NodeMatch, property: string, before: unknown, after: unknown): RawDiff | undefined {
  const rootMovementNoise = match.beforeDepth === 0 && match.afterDepth === 0 && (property === "x" || property === "y");
  if (rootMovementNoise) return undefined;

  return {
    id: `${match.before.id}:${match.after.id}:${property}:${kind}`,
    kind,
    nodeId: match.after.id,
    beforeNodeId: match.before.id,
    afterNodeId: match.after.id,
    nodePath: match.after.path,
    beforeNodePath: match.before.path,
    afterNodePath: match.after.path,
    nodeName: match.after.name,
    property,
    before,
    after,
    matchConfidence: match.confidence,
    matchReason: match.reason
  };
}

function makeUnmatchedDiff(kind: "added" | "removed", node: NormalizedNode, property: string, before: unknown, after: unknown): RawDiff {
  return {
    id: `${node.id}:${property}:${kind}`,
    kind,
    nodeId: node.id,
    beforeNodeId: kind === "removed" ? node.id : undefined,
    afterNodeId: kind === "added" ? node.id : undefined,
    nodePath: node.path,
    beforeNodePath: kind === "removed" ? node.path : undefined,
    afterNodePath: kind === "added" ? node.path : undefined,
    nodeName: node.name,
    property,
    before,
    after,
    matchConfidence: 0,
    matchReason: "unmatched node"
  };
}

function isIgnorableNumberChange(beforeValue: unknown, afterValue: unknown, threshold?: number): boolean {
  if (threshold === undefined) return false;
  if (typeof beforeValue !== "number" || typeof afterValue !== "number") return false;
  return Math.abs(afterValue - beforeValue) < threshold;
}

function sizeSimilarity(before: NormalizedNode, after: NormalizedNode): number {
  const beforeArea = (before.width ?? 0) * (before.height ?? 0);
  const afterArea = (after.width ?? 0) * (after.height ?? 0);
  if (beforeArea <= 0 || afterArea <= 0) return 0;
  return Math.min(beforeArea, afterArea) / Math.max(beforeArea, afterArea);
}

function positionSimilarity(before: NormalizedNode, after: NormalizedNode): number {
  if (before.x === undefined || before.y === undefined || after.x === undefined || after.y === undefined) return 0;
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  return Math.max(0, 1 - distance / 240);
}

function impactSort(property: string): number {
  if (property === "text") return 1;
  if (property.startsWith("component")) return 2;
  if (property === "variables") return 3;
  if (property.startsWith("typography")) return 4;
  if (property.startsWith("layout") || ["width", "height"].includes(property)) return 5;
  if (["fills", "strokes", "effects", "cornerRadius"].includes(property)) return 6;
  return 9;
}

function normalizeName(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/copy\s*\d*|v\d+|iteration\s*\d*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function nameTokens(value: string | undefined): string[] {
  return normalizeName(value).split(" ").filter((token) => token.length > 2);
}

function lastPathSegment(path: string): string {
  const parts = path.split(" / ");
  return parts[parts.length - 1] ?? "";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
