import { z } from "zod";
import type { NormalizedNode } from "./types.js";

export const normalizedPaintSchema = z.object({
  type: z.string(),
  color: z.string().optional(),
  opacity: z.number().optional(),
  visible: z.boolean().optional(),
  styleId: z.string().optional()
});

export const normalizedLayoutSchema = z.object({
  mode: z.string().optional(),
  primaryAxisSizingMode: z.string().optional(),
  counterAxisSizingMode: z.string().optional(),
  primaryAxisAlignItems: z.string().optional(),
  counterAxisAlignItems: z.string().optional(),
  paddingLeft: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingBottom: z.number().optional(),
  itemSpacing: z.number().optional(),
  layoutGrow: z.number().optional(),
  layoutAlign: z.string().optional()
});

export const normalizedVariableRefSchema = z.object({
  property: z.string(),
  id: z.string(),
  name: z.string().optional()
});

export const normalizedTypographySchema = z.object({
  fontFamily: z.string().optional(),
  fontPostScriptName: z.string().optional(),
  fontStyle: z.string().optional(),
  fontWeight: z.number().optional(),
  fontSize: z.number().optional(),
  lineHeightPx: z.number().optional(),
  lineHeightPercent: z.number().optional(),
  letterSpacing: z.number().optional(),
  textAlignHorizontal: z.string().optional(),
  textAlignVertical: z.string().optional()
});

export const normalizedComponentRefSchema = z.object({
  key: z.string().optional(),
  name: z.string().optional(),
  componentId: z.string().optional(),
  mainComponentId: z.string().optional(),
  variantProperties: z.record(z.string()).optional(),
  componentProperties: z.record(z.unknown()).optional()
});

export const normalizedNodeSchema: z.ZodType<NormalizedNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    path: z.string(),
    visible: z.boolean(),
    width: z.number().optional(),
    height: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    text: z.string().optional(),
    typography: normalizedTypographySchema.optional(),
    fills: z.array(normalizedPaintSchema).optional(),
    strokes: z.array(normalizedPaintSchema).optional(),
    effects: z.array(z.unknown()).optional(),
    cornerRadius: z.union([z.number(), z.string()]).optional(),
    layout: normalizedLayoutSchema.optional(),
    constraints: z.unknown().optional(),
    component: normalizedComponentRefSchema.optional(),
    variables: z.array(normalizedVariableRefSchema).optional(),
    children: z.array(normalizedNodeSchema).optional()
  })
);

export const checkpointCreateSchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().default("Default Project"),
  figmaFileKey: z.string().optional(),
  figmaNodeId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  isImplementationBaseline: z.boolean().default(false),
  rawSnapshot: z.unknown().optional(),
  normalizedTree: normalizedNodeSchema,
  screenshotPngBase64: z.string().optional()
});

export const compareCreateSchema = z.object({
  projectId: z.string(),
  fromCheckpointId: z.string(),
  current: checkpointCreateSchema.omit({ projectId: true, projectName: true }).extend({
    projectId: z.string().optional()
  })
});

export const sectionCreateSchema = checkpointCreateSchema.extend({
  sectionName: z.string().min(1).optional()
});

export const sectionIterationCreateSchema = checkpointCreateSchema.omit({
  projectId: true,
  projectName: true,
  isImplementationBaseline: true
}).extend({
  previousIterationId: z.string().optional(),
  geminiApiKey: z.string().optional()
});

export const sectionSuggestMatchSchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().default("Default Project"),
  figmaNodeId: z.string(),
  name: z.string().min(1),
  normalizedTree: normalizedNodeSchema,
  screenshotPngBase64: z.string().optional()
});

export const changeSchema = z.object({
  id: z.string(),
  changelogId: z.string(),
  category: z.enum([
    "copy",
    "layout",
    "style",
    "token",
    "component",
    "variant",
    "prototype",
    "visibility",
    "structure",
    "asset",
    "unknown"
  ]),
  impact: z.enum([
    "code_required",
    "copy_only",
    "style_token_update",
    "layout_update",
    "component_api_change",
    "new_state_or_variant",
    "removed_element",
    "prototype_only",
    "no_implementation_impact",
    "needs_clarification"
  ]),
  nodeId: z.string(),
  nodePath: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  implementationNote: z.string(),
  confidence: z.number(),
  approved: z.boolean()
});

export const changelogUpdateSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  changes: z.array(changeSchema).optional()
});

export const markImplementedSchema = z.object({
  implementationRef: z.string().optional(),
  notes: z.string().optional()
});
