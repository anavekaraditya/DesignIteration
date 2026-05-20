export type Project = {
  id: string;
  name: string;
  figmaFileKey?: string;
  createdAt: string;
  updatedAt: string;
};

export type Checkpoint = {
  id: string;
  projectId: string;
  figmaFileKey?: string;
  figmaNodeId: string;
  name: string;
  description?: string;
  snapshotId: string;
  isImplementationBaseline: boolean;
  createdBy?: string;
  createdAt: string;
};

export type Section = {
  id: string;
  projectId: string;
  name: string;
  figmaFileKey?: string;
  baselineIterationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Iteration = {
  id: string;
  sectionId: string;
  projectId: string;
  figmaNodeId: string;
  name: string;
  previousIterationId?: string;
  snapshotId: string;
  checkpointId: string;
  changelogId?: string;
  isBaseline: boolean;
  createdAt: string;
};

export type SectionTimeline = {
  section: Section;
  iterations: Array<Iteration & { changelog?: Changelog }>;
};

export type Snapshot = {
  id: string;
  checkpointId: string;
  rawHash: string;
  normalizedHash: string;
  normalizedTree: NormalizedNode;
  screenshotPngBase64?: string;
  createdAt: string;
};

export type SectionMatchCandidate = {
  section: Section;
  latestIteration: Iteration;
  latestSnapshot: Snapshot;
};

export type SectionMatchResult = {
  section: Section;
  latestIteration: Iteration;
  confidence: number;
  reason: string;
};

export type NormalizedPaint = {
  type: string;
  color?: string;
  opacity?: number;
  visible?: boolean;
  styleId?: string;
};

export type NormalizedLayout = {
  mode?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutGrow?: number;
  layoutAlign?: string;
};

export type NormalizedComponentRef = {
  key?: string;
  name?: string;
  componentId?: string;
  mainComponentId?: string;
  variantProperties?: Record<string, string>;
  componentProperties?: Record<string, unknown>;
};

export type NormalizedVariableRef = {
  property: string;
  id: string;
  name?: string;
};

export type NormalizedTypography = {
  fontFamily?: string;
  fontPostScriptName?: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
};

export type NormalizedNode = {
  id: string;
  name: string;
  type: string;
  path: string;
  visible: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  text?: string;
  typography?: NormalizedTypography;
  fills?: NormalizedPaint[];
  strokes?: NormalizedPaint[];
  effects?: unknown[];
  cornerRadius?: number | string;
  layout?: NormalizedLayout;
  constraints?: unknown;
  component?: NormalizedComponentRef;
  variables?: NormalizedVariableRef[];
  children?: NormalizedNode[];
};

export type ChangeCategory =
  | "copy"
  | "layout"
  | "style"
  | "token"
  | "component"
  | "variant"
  | "prototype"
  | "visibility"
  | "structure"
  | "asset"
  | "unknown";

export type ChangeImpact =
  | "code_required"
  | "copy_only"
  | "style_token_update"
  | "layout_update"
  | "component_api_change"
  | "new_state_or_variant"
  | "removed_element"
  | "prototype_only"
  | "no_implementation_impact"
  | "needs_clarification";

export type RawDiff = {
  id: string;
  kind: "added" | "removed" | "changed" | "renamed";
  nodeId: string;
  beforeNodeId?: string;
  afterNodeId?: string;
  nodePath: string;
  beforeNodePath?: string;
  afterNodePath?: string;
  nodeName: string;
  property: string;
  before?: unknown;
  after?: unknown;
  matchConfidence?: number;
  matchReason?: string;
};

export type DesignerChangeType =
  | "moved"
  | "resized"
  | "spacing_changed"
  | "layout_changed"
  | "color_changed"
  | "typography_changed"
  | "copy_changed"
  | "visibility_changed"
  | "element_added"
  | "element_removed"
  | "component_variant_changed"
  | "token_changed"
  | "renamed"
  | "unknown_changed";

export type DesignerChange = {
  id: string;
  type: DesignerChangeType;
  category: ChangeCategory;
  impact: ChangeImpact;
  nodeId: string;
  nodePath: string;
  nodeName: string;
  summary: string;
  implementationHint: string;
  before?: unknown;
  after?: unknown;
  rawDiffIds: string[];
  confidence: number;
  matchReason?: string;
};

export type Change = {
  id: string;
  changelogId: string;
  category: ChangeCategory;
  impact: ChangeImpact;
  nodeId: string;
  nodePath: string;
  before?: unknown;
  after?: unknown;
  implementationNote: string;
  confidence: number;
  approved: boolean;
};

export type ChangelogStatus = "draft" | "approved" | "implemented" | "archived";

export type Changelog = {
  id: string;
  projectId: string;
  sectionId?: string;
  iterationId?: string;
  fromCheckpointId: string;
  toCheckpointId: string;
  title: string;
  summary: string;
  status: ChangelogStatus;
  changes: Change[];
  markdown: string;
  createdAt: string;
  approvedAt?: string;
  implementedAt?: string;
  implementationRef?: string;
  implementationNotes?: string;
};
