import type { NormalizedNode, SectionMatchCandidate, SectionMatchResult } from "./types.js";

export function suggestSectionMatches(
  selectedTree: NormalizedNode,
  candidates: SectionMatchCandidate[]
): SectionMatchResult[] {
  return candidates
    .map((candidate) => scoreCandidate(selectedTree, candidate))
    .sort((a, b) => b.confidence - a.confidence);
}

function scoreCandidate(selectedTree: NormalizedNode, candidate: SectionMatchCandidate): SectionMatchResult {
  const latestTree = candidate.latestSnapshot.normalizedTree;
  const nameScore = textSimilarity(normalizeName(selectedTree.name), normalizeName(candidate.section.name || latestTree.name));
  const rootNameScore = textSimilarity(normalizeName(selectedTree.name), normalizeName(latestTree.name));
  const childNameScore = jaccard(tokens(collectNames(selectedTree)), tokens(collectNames(latestTree)));
  const textScore = jaccard(tokens(collectText(selectedTree)), tokens(collectText(latestTree)));
  const componentScore = jaccard(collectComponents(selectedTree), collectComponents(latestTree));
  const structureScore = structureSimilarity(selectedTree, latestTree);
  const sizeScore = sizeSimilarity(selectedTree, latestTree);
  const typeScore = selectedTree.type === latestTree.type ? 1 : 0;

  const confidence =
    nameScore * 0.18 +
    rootNameScore * 0.14 +
    childNameScore * 0.18 +
    textScore * 0.16 +
    componentScore * 0.14 +
    structureScore * 0.1 +
    sizeScore * 0.06 +
    typeScore * 0.04;

  const reasons = [
    reason("section name", nameScore),
    reason("root name", rootNameScore),
    reason("layer names", childNameScore),
    reason("text", textScore),
    reason("components", componentScore),
    reason("structure", structureScore),
    reason("size", sizeScore)
  ]
    .filter(Boolean)
    .join(", ");

  return {
    section: candidate.section,
    latestIteration: candidate.latestIteration,
    confidence: round(confidence),
    reason: reasons || "weak similarity"
  };
}

function collectNames(node: NormalizedNode): string[] {
  return flatten(node).map((item) => item.name);
}

function collectText(node: NormalizedNode): string[] {
  return flatten(node)
    .map((item) => item.text)
    .filter((value): value is string => Boolean(value));
}

function collectComponents(node: NormalizedNode): string[] {
  return flatten(node)
    .flatMap((item) => [item.component?.key, item.component?.mainComponentId, item.component?.componentId])
    .filter((value): value is string => Boolean(value));
}

function flatten(node: NormalizedNode): NormalizedNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}

function structureSimilarity(a: NormalizedNode, b: NormalizedNode): number {
  const aTypes = flatten(a).map((node) => node.type);
  const bTypes = flatten(b).map((node) => node.type);
  const countRatio = Math.min(aTypes.length, bTypes.length) / Math.max(aTypes.length, bTypes.length, 1);
  return (jaccard(aTypes, bTypes) + countRatio) / 2;
}

function sizeSimilarity(a: NormalizedNode, b: NormalizedNode): number {
  if (!a.width || !a.height || !b.width || !b.height) return 0.5;
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return Math.min(aArea, bArea) / Math.max(aArea, bArea);
}

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return jaccard(tokens([a]), tokens([b]));
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a.filter(Boolean));
  const right = new Set(b.filter(Boolean));
  if (left.size === 0 && right.size === 0) return 0.5;
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function tokens(values: string[]): string[] {
  return values.flatMap((value) => normalizeName(value).split(" ")).filter((token) => token.length > 2);
}

function normalizeName(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/copy\s*\d*|v\d+|iteration\s*\d*|baseline/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function reason(label: string, score: number): string {
  if (score >= 0.75) return `strong ${label}`;
  if (score >= 0.45) return `similar ${label}`;
  return "";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
