import type {
  NormalizedComponentRef,
  NormalizedLayout,
  NormalizedNode,
  NormalizedPaint,
  NormalizedTypography,
  NormalizedVariableRef
} from "./types.js";

type FigmaRestNode = Record<string, unknown> & {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaRestNode[];
};

export type NormalizeOptions = {
  movementThreshold?: number;
  ignoreHiddenAnnotations?: boolean;
};

const DEFAULT_OPTIONS: Required<NormalizeOptions> = {
  movementThreshold: 2,
  ignoreHiddenAnnotations: true
};

export function normalizeFigmaRestExport(rawExport: unknown, options: NormalizeOptions = {}): NormalizedNode {
  const root = extractDocumentNode(rawExport);
  return normalizeNode(root, [], { ...DEFAULT_OPTIONS, ...options });
}

export function normalizeNode(
  node: FigmaRestNode,
  parentPath: string[] = [],
  options: Required<NormalizeOptions> = DEFAULT_OPTIONS
): NormalizedNode {
  const id = stringValue(node.id, "unknown");
  const name = stringValue(node.name, "Untitled");
  const type = stringValue(node.type, "UNKNOWN");
  const currentPath = parentPath.concat(name);
  const path = currentPath.join(" / ");

  const normalized: NormalizedNode = {
    id,
    name,
    type,
    path,
    visible: node.visible !== false
  };

  assignNumber(normalized, "width", pickNumber(node, ["absoluteBoundingBox", "width"]) ?? numberValue(node.width));
  assignNumber(normalized, "height", pickNumber(node, ["absoluteBoundingBox", "height"]) ?? numberValue(node.height));
  assignNumber(normalized, "x", pickNumber(node, ["absoluteBoundingBox", "x"]) ?? numberValue(node.x));
  assignNumber(normalized, "y", pickNumber(node, ["absoluteBoundingBox", "y"]) ?? numberValue(node.y));

  if (typeof node.characters === "string") normalized.text = node.characters;
  const typography = normalizeTypography(node);
  if (Object.keys(typography).length > 0) normalized.typography = typography;
  if (Array.isArray(node.fills)) normalized.fills = normalizePaints(node.fills);
  if (Array.isArray(node.strokes)) normalized.strokes = normalizePaints(node.strokes);
  if (Array.isArray(node.effects)) normalized.effects = node.effects;

  const radius = normalizeCornerRadius(node);
  if (radius !== undefined) normalized.cornerRadius = radius;

  const layout = normalizeLayout(node);
  if (Object.keys(layout).length > 0) normalized.layout = layout;

  if (node.constraints) normalized.constraints = node.constraints;

  const component = normalizeComponent(node);
  if (Object.keys(component).length > 0) normalized.component = component;

  const variables = normalizeVariables(node);
  if (variables.length > 0) normalized.variables = variables;

  const children = Array.isArray(node.children)
    ? node.children
        .filter((child) => !shouldIgnoreNode(child, options))
        .map((child) => normalizeNode(child, currentPath, options))
    : [];

  if (children.length > 0) normalized.children = children;

  return normalized;
}

function extractDocumentNode(rawExport: unknown): FigmaRestNode {
  if (!rawExport || typeof rawExport !== "object") {
    throw new Error("Expected a Figma REST export object.");
  }

  const maybe = rawExport as Record<string, unknown>;
  const document = maybe.document;
  if (document && typeof document === "object") return document as FigmaRestNode;
  return maybe as FigmaRestNode;
}

function shouldIgnoreNode(node: FigmaRestNode, options: Required<NormalizeOptions>): boolean {
  if (!options.ignoreHiddenAnnotations) return false;
  const name = stringValue(node.name, "").toLowerCase();
  const isAnnotation = ["annotation", "annotations", "note", "notes", "comment", "comments"].some((term) =>
    name.includes(term)
  );
  return node.visible === false && isAnnotation;
}

function normalizePaints(paints: unknown[]): NormalizedPaint[] {
  return paints
    .filter((paint): paint is Record<string, unknown> => Boolean(paint && typeof paint === "object"))
    .map((paint) => ({
      type: stringValue(paint.type, "UNKNOWN"),
      color: normalizeColor(paint.color),
      opacity: numberValue(paint.opacity),
      visible: typeof paint.visible === "boolean" ? paint.visible : undefined,
      styleId: stringValue(paint.styleId)
    }))
    .filter((paint) => paint.visible !== false);
}

function normalizeColor(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  const channels = color as Record<string, unknown>;
  const r = numberValue(channels.r);
  const g = numberValue(channels.g);
  const b = numberValue(channels.b);
  const a = numberValue(channels.a) ?? 1;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const toHex = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(a) : ""}`;
}

function normalizeCornerRadius(node: FigmaRestNode): number | string | undefined {
  const single = numberValue(node.cornerRadius);
  if (single !== undefined) return single;
  const radii = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"]
    .map((key) => numberValue(node[key]))
    .filter((value): value is number => value !== undefined);
  return radii.length > 0 ? radii.join(" ") : undefined;
}

function normalizeLayout(node: FigmaRestNode): NormalizedLayout {
  return {
    mode: stringValue(node.layoutMode),
    primaryAxisSizingMode: stringValue(node.primaryAxisSizingMode),
    counterAxisSizingMode: stringValue(node.counterAxisSizingMode),
    primaryAxisAlignItems: stringValue(node.primaryAxisAlignItems),
    counterAxisAlignItems: stringValue(node.counterAxisAlignItems),
    paddingLeft: numberValue(node.paddingLeft),
    paddingRight: numberValue(node.paddingRight),
    paddingTop: numberValue(node.paddingTop),
    paddingBottom: numberValue(node.paddingBottom),
    itemSpacing: numberValue(node.itemSpacing),
    layoutGrow: numberValue(node.layoutGrow),
    layoutAlign: stringValue(node.layoutAlign)
  };
}

function normalizeTypography(node: FigmaRestNode): NormalizedTypography {
  const style = recordValue(node.style) ?? {};
  return {
    fontFamily: stringValue(style.fontFamily) || stringValue(node.fontFamily),
    fontPostScriptName: stringValue(style.fontPostScriptName) || stringValue(node.fontPostScriptName),
    fontStyle: stringValue(style.fontStyle) || stringValue(node.fontStyle),
    fontWeight: numberValue(style.fontWeight) ?? numberValue(node.fontWeight),
    fontSize: numberValue(style.fontSize) ?? numberValue(node.fontSize),
    lineHeightPx: numberValue(style.lineHeightPx) ?? numberValue(node.lineHeightPx),
    lineHeightPercent: numberValue(style.lineHeightPercent) ?? numberValue(node.lineHeightPercent),
    letterSpacing: numberValue(style.letterSpacing) ?? numberValue(node.letterSpacing),
    textAlignHorizontal: stringValue(style.textAlignHorizontal) || stringValue(node.textAlignHorizontal),
    textAlignVertical: stringValue(style.textAlignVertical) || stringValue(node.textAlignVertical)
  };
}

function normalizeComponent(node: FigmaRestNode): NormalizedComponentRef {
  return {
    key: stringValue(node.key),
    name: stringValue(node.componentName),
    componentId: stringValue(node.componentId),
    mainComponentId: stringValue(node.mainComponentId),
    variantProperties: recordOfStrings(node.variantProperties),
    componentProperties: recordValue(node.componentProperties)
  };
}

function normalizeVariables(node: FigmaRestNode): NormalizedVariableRef[] {
  const refs = recordValue(node.boundVariables);
  if (!refs) return [];
  return Object.entries(refs).flatMap(([property, value]) => {
    if (value && typeof value === "object" && "id" in value) {
      return [{ property, id: String((value as Record<string, unknown>).id) }];
    }
    if (Array.isArray(value)) {
      return value
        .filter((item) => item && typeof item === "object" && "id" in item)
        .map((item) => ({ property, id: String((item as Record<string, unknown>).id) }));
    }
    return [];
  });
}

function assignNumber(target: NormalizedNode, key: "width" | "height" | "x" | "y", value: number | undefined): void {
  if (value !== undefined) target[key] = Math.round(value * 100) / 100;
}

function pickNumber(source: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return numberValue(current);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown, fallback?: string): string {
  return typeof value === "string" ? value : fallback ?? "";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, String(item)]));
}
