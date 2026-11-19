export type AgentPlatform =
  | 'antigravity'
  | 'claude-code'
  | 'cursor'
  | 'gemini-cli'
  | 'codex'
  | 'custom';

export type LintSeverity = 'error' | 'warning' | 'info';

export type ConflictSeverity = 'high' | 'medium' | 'low';

export type ExportTarget =
  | 'claude-code'
  | 'cursor'
  | 'gemini-cli'
  | 'antigravity'
  | 'portable-json';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  'allowed-tools'?: string | string[];
  metadata?: Record<string, string>;
  globs?: string | string[];
  alwaysApply?: boolean;
  [key: string]: unknown;
}

export interface SkillResourceFile {
  relativePath: string;
  category: 'scripts' | 'references' | 'assets' | 'other';
  bytes: number;
  estimatedTokens: number;
}

export interface SkillTokenMetrics {
  /** Tokens injected into the system prompt at session startup (name + description + header metadata). */
  startupTokens: number;
  /** Tokens loaded on demand when the skill is activated (markdown body). */
  bodyTokens: number;
  /** Combined estimated tokens across bundled text files (references/scripts). */
  resourceTokens: number;
  /** Total tokens if both SKILL.md and bundled text resources are loaded. */
  totalTokens: number;
  bodyLineCount: number;
  descriptionChars: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  directoryName: string;
  platform: AgentPlatform;
  sourceRoot: string;
  filePath: string;
  relativePath: string;
  kind: 'skill' | 'rule';
  frontmatter: SkillFrontmatter;
  frontmatterRaw: string;
  frontmatterValid: boolean;
  frontmatterError?: string;
  description: string;
  body: string;
  triggerPhrases: string[];
  negativeTriggers: string[];
  localLinks: string[];
  resources: SkillResourceFile[];
  tokens: SkillTokenMetrics;
  contentHash: string;
}

export interface SecretFinding {
  fieldPath: string;
  patternName: string;
  maskedPreview: string;
}

export interface McpServerRecord {
  id: string;
  name: string;
  platform: AgentPlatform;
  configPath: string;
  transport: 'stdio' | 'sse' | 'http' | 'unknown';
  command?: string;
  args: string[];
  url?: string;
  disabled: boolean;
  envKeys: string[];
  /** Always redacted so raw secrets never leave the core scanner. */
  redactedEnv: Record<string, string>;
  redactedArgs: string[];
  secretFindings: SecretFinding[];
  commandAvailable: boolean | null;
  estimatedSchemaTokens: number;
}

export interface LintIssue {
  id: string;
  ruleId: string;
  severity: LintSeverity;
  category: 'spec' | 'budget' | 'security' | 'hygiene' | 'mcp';
  targetType: 'skill' | 'mcp' | 'workspace';
  targetId: string;
  targetName: string;
  filePath: string;
  message: string;
  suggestion: string;
}

export interface ConflictPair {
  id: string;
  skillA: { id: string; name: string; platform: AgentPlatform };
  skillB: { id: string; name: string; platform: AgentPlatform };
  similarity: number;
  severity: ConflictSeverity;
  sharedKeywords: string[];
  sharedPhrases: string[];
  suggestion: string;
}

export interface RouteMatch {
  skillId: string;
  skillName: string;
  platform: AgentPlatform;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  matchedTerms: string[];
  matchedPhrases: string[];
  negativeHits: string[];
  suppressedByNegative: boolean;
  startupTokens: number;
  bodyTokens: number;
  description: string;
}

export interface RouteResult {
  prompt: string;
  matches: RouteMatch[];
  ambiguous: boolean;
  ambiguityReason?: string;
  baselineStartupTokens: number;
  projectedActivatedTokens: number;
  totalProjectedTokens: number;
}

export interface TokenBudgetSummary {
  totalStartupSkillTokens: number;
  totalStartupMcpTokens: number;
  totalAlwaysOnTokens: number;
  totalOnDemandBodyTokens: number;
  totalResourceTokens: number;
  recommendedStartupLimit: number;
  startupUtilizationPct: number;
  byPlatform: Array<{
    platform: AgentPlatform;
    skillCount: number;
    mcpCount: number;
    startupTokens: number;
    bodyTokens: number;
  }>;
  topStartupConsumers: Array<{
    id: string;
    name: string;
    type: 'skill' | 'mcp';
    platform: AgentPlatform;
    startupTokens: number;
    sharePct: number;
  }>;
}

export interface ScanSourceInfo {
  rootPath: string;
  platform: AgentPlatform;
  exists: boolean;
  skillCount: number;
  mcpCount: number;
}

export interface WorkspaceSummary {
  healthScore: number;
  skillCount: number;
  mcpServerCount: number;
  activeMcpCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  highConflictCount: number;
  secretFindingCount: number;
}

export interface WorkspaceReport {
  generatedAt: string;
  mode: 'demo' | 'local' | 'custom';
  scannedSources: ScanSourceInfo[];
  summary: WorkspaceSummary;
  budget: TokenBudgetSummary;
  skills: SkillRecord[];
  mcpServers: McpServerRecord[];
  conflicts: ConflictPair[];
  issues: LintIssue[];
}

export interface WorkflowNodeInput {
  id: string;
  type: 'trigger' | 'skill' | 'mcp' | 'gate' | 'output';
  label: string;
  refId?: string;
  description?: string;
  position?: { x: number; y: number };
}

export interface WorkflowEdgeInput {
  id: string;
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNodeInput[];
  edges: WorkflowEdgeInput[];
}

export interface CompiledWorkflowResult {
  slug: string;
  orderedSteps: Array<{
    step: number;
    nodeId: string;
    type: WorkflowNodeInput['type'];
    label: string;
    refId?: string;
    dependsOn: string[];
  }>;
  hasCycle: boolean;
  estimatedTokens: number;
  orchestratorSkillMd: string;
}

export interface ExportedFile {
  relativePath: string;
  content: string;
}

export interface ExportBundleResult {
  target: ExportTarget;
  generatedAt: string;
  skillCount: number;
  mcpCount: number;
  redactedSecretCount: number;
  files: ExportedFile[];
}

export interface ScanOptions {
  mode?: 'demo' | 'local' | 'custom';
  paths?: string[];
  includeBuiltin?: boolean;
  conflictThreshold?: number;
  startupBudgetLimit?: number;
}
