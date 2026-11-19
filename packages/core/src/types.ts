export type AgentPlatform =
  | 'antigravity'
  | 'claude-code'
  | 'cursor'
  | 'gemini-cli'
  | 'codex'
  | 'dsh'
  | 'zcode'
  | 'custom';

export type LintSeverity = 'error' | 'warning' | 'info';

export type ConflictSeverity = 'high' | 'medium' | 'low';

export type ImmuneVerdict = 'safe' | 'caution' | 'quarantine';

export type ImmuneSeverity = 'critical' | 'high' | 'medium' | 'low';

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
  disabled?: boolean;
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

export interface ImmuneFinding {
  id: string;
  ruleId: string;
  severity: ImmuneSeverity;
  vector:
    | 'prompt-injection'
    | 'exfiltration'
    | 'destructive-exec'
    | 'tool-poisoning'
    | 'unicode-smuggling'
    | 'privilege-escalation'
    | 'custom-antibody';
  targetId: string;
  targetName: string;
  filePath: string;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ImmuneSkillReport {
  skillId: string;
  skillName: string;
  platform: AgentPlatform;
  verdict: ImmuneVerdict;
  threatScore: number;
  findings: ImmuneFinding[];
}

export interface ImmuneAntibody {
  id: string;
  name: string;
  vector: ImmuneFinding['vector'];
  severity: ImmuneSeverity;
  pattern: string;
  flags?: string;
  description: string;
  source: 'builtin' | 'learned';
  createdAt: string;
  hits: number;
}

export interface PitfallAntibody {
  id: string;
  numericId?: number;
  trigger_pattern: string;
  symptom: string;
  prescription: string;
  status: 'active' | 'retired' | 'quarantined';
  quality_grade: 'advice' | 'tactic' | 'quarantined';
  rubric_score: number;
  root_cause: string;
  hit_count: number;
  fail_count: number;
  tool_name: string | null;
  project_scope: string;
  sourceDb: string;
  created_at: number;
}

export interface AgentImmuneBridgeReport {
  detectedStores: Array<{
    path: string;
    kind: 'sqlite' | 'jsonl';
    exists: boolean;
    antibodyCount: number;
    error?: string;
  }>;
  pitfallAntibodies: PitfallAntibody[];
  activePitfallCount: number;
  totalHits: number;
}

export interface ImmuneWorkspaceReport {
  immunityScore: number;
  safeCount: number;
  cautionCount: number;
  quarantineCount: number;
  totalFindings: number;
  skillReports: ImmuneSkillReport[];
  findings: ImmuneFinding[];
  activeAntibodies: ImmuneAntibody[];
  agentImmuneBridge: AgentImmuneBridgeReport;
}

export interface ImmuneFirewallDecision {
  allowed: boolean;
  action: 'allow' | 'quarantine' | 'block';
  reason: string;
  matchedRules: string[];
  threatScore: number;
  loopDetected: boolean;
}

export interface QuarantineItem {
  id: string;
  createdAt: string;
  source: 'hub' | 'superagent' | 'workflow';
  serverName: string;
  toolName: string;
  redactedArgs: unknown;
  reason: string;
  matchedRules: string[];
  threatScore: number;
  status: 'pending' | 'approved' | 'rejected' | 'immunized';
  resolvedAt?: string;
}

export interface HubTraceEvent {
  id: string;
  timestamp: string;
  source: 'mcp-stdio' | 'hub-api' | 'superagent' | 'workflow';
  serverName: string;
  toolName: string;
  durationMs: number;
  status: 'ok' | 'blocked' | 'quarantined' | 'error' | 'dry-run';
  immuneAction: ImmuneFirewallDecision['action'];
  summary: string;
  redactedArgsPreview?: string;
  resultPreview?: string;
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
  immunityScore: number;
  skillCount: number;
  mcpServerCount: number;
  activeMcpCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  highConflictCount: number;
  secretFindingCount: number;
  quarantineSkillCount: number;
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
  immune: ImmuneWorkspaceReport;
}

export interface WorkflowNodeInput {
  id: string;
  type: 'trigger' | 'skill' | 'mcp' | 'agent' | 'gate' | 'output';
  label: string;
  refId?: string;
  description?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  agentEngine?: string;
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

export interface WorkflowStepExecution {
  step: number;
  nodeId: string;
  type: WorkflowNodeInput['type'];
  label: string;
  status: 'ok' | 'blocked' | 'quarantined' | 'skipped' | 'error';
  durationMs: number;
  immuneVerdict: ImmuneFirewallDecision['action'];
  output: string;
  engineUsed: string;
}

export interface WorkflowRunResult {
  runId: string;
  workflowName: string;
  mode: 'dry-run' | 'live';
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  status: 'completed' | 'blocked' | 'failed';
  steps: WorkflowStepExecution[];
  finalSummary: string;
}

export interface DetectedLocalAgent {
  id: string;
  name: string;
  command: string;
  available: boolean;
  resolvedPath?: string;
  capabilities: string[];
  models?: string[];
  statusNote: string;
}

export interface SuperAgentStep {
  id: string;
  order: number;
  title: string;
  role: 'planner' | 'skill-worker' | 'mcp-worker' | 'cli-agent' | 'immune-gate' | 'synthesizer';
  engine: string;
  skillNames: string[];
  mcpServer?: string;
  instruction: string;
  estimatedTokens: number;
  immuneStatus: ImmuneVerdict;
}

export interface SuperAgentPlan {
  planId: string;
  goal: string;
  plannerEngine: string;
  createdAt: string;
  selectedSkills: Array<{
    name: string;
    platform: AgentPlatform;
    score: number;
    immuneVerdict: ImmuneVerdict;
  }>;
  skippedQuarantinedSkills: string[];
  selectedMcps: string[];
  estimatedTotalTokens: number;
  steps: SuperAgentStep[];
  workflowGraph: WorkflowGraph;
}

export interface VaultSkillEntry {
  slug: string;
  name: string;
  vaultPath: string;
  description: string;
  importedFrom?: string;
  importedAt: string;
  contentHash: string;
}

export interface VaultTransactionOp {
  kind: 'copy' | 'rename' | 'write';
  sourcePath?: string;
  targetPath: string;
  backupPath?: string;
  existedBefore: boolean;
}

export interface VaultTransaction {
  id: string;
  timestamp: string;
  action: 'import' | 'sync' | 'disable' | 'enable' | 'quarantine' | 'rollback';
  summary: string;
  rolledBack: boolean;
  operations: VaultTransactionOp[];
}

export interface VaultSyncPreviewItem {
  skillName: string;
  slug: string;
  targetPath: string;
  change: 'create' | 'update' | 'unchanged';
}

export interface VaultStatus {
  vaultRoot: string;
  skills: VaultSkillEntry[];
  transactions: VaultTransaction[];
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
  customAntibodies?: ImmuneAntibody[];
}
