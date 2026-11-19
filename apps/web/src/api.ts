import type {
  CompiledWorkflowResult,
  DetectedLocalAgent,
  ExportBundleResult,
  ExportTarget,
  HubTraceEvent,
  ImmuneAntibody,
  ImmuneFinding,
  ImmuneVerdict,
  LlmProbeResult,
  PitfallAntibody,
  QuarantineItem,
  RouteResult,
  SuperAgentChatResult,
  SuperAgentLlmConfig,
  SuperAgentPlan,
  VaultStatus,
  VaultSyncPreviewItem,
  VaultTransaction,
  WorkflowGraph,
  WorkflowRunResult,
  WorkspaceReport,
} from '@skilldeck/core';

export type WorkspaceMode = 'demo' | 'local' | 'custom';

export interface WorkspaceQuery {
  mode: WorkspaceMode;
  customPath?: string;
  includeBuiltin?: boolean;
}

export interface HubConnectSnippet {
  platform: string;
  configPathHint: string;
  snippet: string;
}

export interface HubStatusSnapshot {
  metaToolCount: number;
  estimatedHubStartupTokens: number;
  directStartupTokens: number;
  estimatedTokenSavingsPct: number;
  requireApprovalForHighRisk: boolean;
  traces: HubTraceEvent[];
  quarantineQueue: QuarantineItem[];
  customAntibodies: ImmuneAntibody[];
  connectSnippets: HubConnectSnippet[];
}

export interface DownstreamPingResult {
  serverName: string;
  ok: boolean;
  latencyMs: number;
  transport: string;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
}

function buildQueryParams(query: WorkspaceQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', query.mode);
  if (query.mode === 'custom' && query.customPath?.trim()) {
    params.set('paths', query.customPath.trim());
  }
  if (query.includeBuiltin) {
    params.set('includeBuiltin', 'true');
  }
  return params;
}

function queryBodyFields(query: WorkspaceQuery) {
  return {
    mode: query.mode,
    paths: query.mode === 'custom' && query.customPath?.trim() ? [query.customPath.trim()] : undefined,
    includeBuiltin: query.includeBuiltin,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchWorkspaceReport(query: WorkspaceQuery): Promise<WorkspaceReport> {
  const res = await fetch(`/api/report?${buildQueryParams(query).toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to load report (${res.status})`);
  }
  return res.json() as Promise<WorkspaceReport>;
}

export async function fetchDemoWorkflows(): Promise<WorkflowGraph[]> {
  const res = await fetch('/api/workflows/demo');
  if (!res.ok) return [];
  const data = (await res.json()) as { workflows?: WorkflowGraph[] };
  return data.workflows ?? [];
}

export async function runPromptRoute(prompt: string, query: WorkspaceQuery): Promise<RouteResult> {
  return postJson<RouteResult>('/api/route', { prompt, ...queryBodyFields(query) });
}

export async function compileWorkflowGraph(graph: WorkflowGraph): Promise<CompiledWorkflowResult> {
  return postJson<CompiledWorkflowResult>('/api/workflow/compile', graph);
}

export async function runWorkflowGraphApi(params: {
  graph: WorkflowGraph;
  query: WorkspaceQuery;
  runMode: 'dry-run' | 'live';
  goalContext?: string;
  llmConfig?: SuperAgentLlmConfig;
}): Promise<WorkflowRunResult> {
  return postJson<WorkflowRunResult>('/api/workflow/run', {
    graph: params.graph,
    runMode: params.runMode,
    goalContext: params.goalContext,
    llmConfig: params.llmConfig,
    ...queryBodyFields(params.query),
  });
}

export async function generateExportBundle(
  target: ExportTarget,
  query: WorkspaceQuery,
  skillIds?: string[],
  mcpIds?: string[],
): Promise<ExportBundleResult> {
  return postJson<ExportBundleResult>('/api/export', {
    target,
    skillIds,
    mcpIds,
    ...queryBodyFields(query),
  });
}

// === Agent-Immune APIs ===
export async function scanImmuneTextApi(
  text: string,
  query: WorkspaceQuery,
): Promise<{
  findings: ImmuneFinding[];
  verdict: ImmuneVerdict;
  pitfallRecall: {
    query: string;
    matches: Array<{ antibody: PitfallAntibody; score: number; matchedTerms: string[] }>;
    immuneMemoryBlock: string;
  };
}> {
  return postJson('/api/immune/scan-text', { text, ...queryBodyFields(query) });
}

export async function recordPitfallAntibodyApi(input: {
  trigger_pattern: string;
  symptom: string;
  prescription: string;
  tool_name?: string;
  root_cause?: string;
}): Promise<{ antibody: PitfallAntibody }> {
  return postJson('/api/immune/pitfall', input);
}

export async function createSecurityAntibodyApi(input: {
  name: string;
  sampleText: string;
  severity?: ImmuneAntibody['severity'];
}): Promise<{ antibody: ImmuneAntibody }> {
  return postJson('/api/immune/antibody', input);
}

export function getExportRulesJsonlUrl(query: WorkspaceQuery): string {
  return `/api/immune/export-jsonl?${buildQueryParams(query).toString()}`;
}

// === MCP Hub APIs ===
export async function fetchHubStatus(query: WorkspaceQuery): Promise<HubStatusSnapshot> {
  const res = await fetch(`/api/hub/status?${buildQueryParams(query).toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HubStatusSnapshot>;
}

export async function pingHubServerApi(
  serverName: string,
  query: WorkspaceQuery,
): Promise<DownstreamPingResult> {
  return postJson('/api/hub/ping', { serverName, ...queryBodyFields(query) });
}

export async function callHubToolApi(
  toolName: string,
  args: Record<string, unknown>,
  query: WorkspaceQuery,
): Promise<{ ok: boolean; contentText: string; data?: unknown; trace: HubTraceEvent }> {
  return postJson('/api/hub/call', {
    toolName,
    arguments: args,
    ...queryBodyFields(query),
  });
}

export async function updateHubPolicyApi(requireApprovalForHighRisk: boolean): Promise<void> {
  await postJson('/api/hub/policy', { requireApprovalForHighRisk });
}

export async function resolveQuarantineApi(
  id: string,
  decision: 'approve' | 'reject' | 'immunize',
): Promise<{ item: QuarantineItem; createdAntibody?: ImmuneAntibody }> {
  return postJson('/api/hub/quarantine/resolve', { id, decision });
}

// === Skill Vault APIs ===
export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch('/api/vault/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<VaultStatus>;
}

export async function importToVaultApi(
  query: WorkspaceQuery,
  skillIds?: string[],
): Promise<{ transaction: VaultTransaction; vault: VaultStatus }> {
  return postJson('/api/vault/import', { skillIds, ...queryBodyFields(query) });
}

export async function previewVaultSyncApi(
  targetRoot: string,
  slugs?: string[],
): Promise<{ targetRoot: string; items: VaultSyncPreviewItem[] }> {
  return postJson('/api/vault/sync-preview', { targetRoot, slugs });
}

export async function applyVaultSyncApi(
  targetRoot: string,
  slugs?: string[],
): Promise<{ transaction: VaultTransaction; vault: VaultStatus }> {
  return postJson('/api/vault/sync-apply', { targetRoot, slugs });
}

export async function toggleSkillStateApi(
  filePath: string,
  action: 'disable' | 'enable' | 'quarantine',
): Promise<{ transaction: VaultTransaction; vault: VaultStatus }> {
  return postJson('/api/vault/toggle-skill', { filePath, action });
}

export async function rollbackVaultApi(
  transactionId: string,
): Promise<{ transaction: VaultTransaction; vault: VaultStatus }> {
  return postJson('/api/vault/rollback', { transactionId });
}

// === SuperAgent APIs ===
export async function fetchLocalAgents(): Promise<DetectedLocalAgent[]> {
  const res = await fetch('/api/superagent/agents');
  if (!res.ok) return [];
  const data = (await res.json()) as { agents?: DetectedLocalAgent[] };
  return data.agents ?? [];
}

export async function createSuperAgentPlanApi(params: {
  goal: string;
  query: WorkspaceQuery;
  preferredEngine?: string;
  llmConfig?: SuperAgentLlmConfig;
}): Promise<SuperAgentPlan> {
  return postJson('/api/superagent/plan', {
    goal: params.goal,
    preferredEngine: params.preferredEngine,
    llmConfig: params.llmConfig,
    ...queryBodyFields(params.query),
  });
}

export async function probeLlmEndpointApi(
  endpoint: string,
  apiKey?: string,
): Promise<LlmProbeResult> {
  return postJson('/api/superagent/probe-llm', { endpoint, apiKey });
}

export async function runSuperAgentChatApi(params: {
  goal: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTurns?: number;
  query: WorkspaceQuery;
}): Promise<SuperAgentChatResult> {
  return postJson('/api/superagent/chat', {
    goal: params.goal,
    endpoint: params.endpoint,
    model: params.model,
    apiKey: params.apiKey,
    maxTurns: params.maxTurns,
    ...queryBodyFields(params.query),
  });
}

/**
 * Masks local OS home directory usernames (`C:\Users\name\...` -> `~/...`) before rendering in UI.
 */
export function maskLocalHomePath(p: string): string {
  return p
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~')
    .replace(/^\/(?:Users|home)\/[^/]+/, '~');
}
