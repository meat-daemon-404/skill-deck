import fs from 'node:fs';
import path from 'node:path';
import {
  getDefaultAgentImmuneStores,
  loadAgentImmuneBridge,
  readAntibodiesFromJsonl,
} from './agent-immune-bridge.js';
import { detectTriggerConflicts } from './conflicts.js';
import { runImmuneWorkspaceAudit } from './immune.js';
import { lintWorkspace } from './linter.js';
import {
  getDefaultLocalScanRoots,
  inferPlatformFromPath,
  scanRoots,
  type ScanRootSpec,
} from './scanner.js';
import type {
  AgentImmuneBridgeReport,
  AgentPlatform,
  McpServerRecord,
  PitfallAntibody,
  ScanOptions,
  SkillRecord,
  TokenBudgetSummary,
  WorkspaceReport,
} from './types.js';

export * from './types.js';
export * from './tokens.js';
export * from './frontmatter.js';
export * from './secrets.js';
export * from './scanner.js';
export * from './conflicts.js';
export * from './router.js';
export * from './linter.js';
export * from './exporter.js';
export * from './immune.js';
export * from './agent-immune-bridge.js';
export * from './vault.js';
export * from './superagent.js';

export function computeTokenBudget(
  skills: SkillRecord[],
  mcpServers: McpServerRecord[],
  recommendedStartupLimit = 12000,
): TokenBudgetSummary {
  const totalStartupSkillTokens = skills.reduce((sum, s) => sum + s.tokens.startupTokens, 0);
  const totalStartupMcpTokens = mcpServers.reduce((sum, m) => sum + m.estimatedSchemaTokens, 0);
  const totalAlwaysOnTokens = totalStartupSkillTokens + totalStartupMcpTokens;
  const totalOnDemandBodyTokens = skills.reduce((sum, s) => sum + s.tokens.bodyTokens, 0);
  const totalResourceTokens = skills.reduce((sum, s) => sum + s.tokens.resourceTokens, 0);
  const startupUtilizationPct = Number(
    Math.min(999, (totalAlwaysOnTokens / Math.max(1, recommendedStartupLimit)) * 100).toFixed(1),
  );

  const platformMap = new Map<
    AgentPlatform,
    { platform: AgentPlatform; skillCount: number; mcpCount: number; startupTokens: number; bodyTokens: number }
  >();

  const ensurePlatform = (platform: AgentPlatform) => {
    let entry = platformMap.get(platform);
    if (!entry) {
      entry = { platform, skillCount: 0, mcpCount: 0, startupTokens: 0, bodyTokens: 0 };
      platformMap.set(platform, entry);
    }
    return entry;
  };

  for (const s of skills) {
    const p = ensurePlatform(s.platform);
    p.skillCount += 1;
    p.startupTokens += s.tokens.startupTokens;
    p.bodyTokens += s.tokens.bodyTokens;
  }

  for (const m of mcpServers) {
    const p = ensurePlatform(m.platform);
    p.mcpCount += 1;
    p.startupTokens += m.estimatedSchemaTokens;
  }

  const allStartupConsumers = [
    ...skills.map((s) => ({
      id: s.id,
      name: s.name,
      type: 'skill' as const,
      platform: s.platform,
      startupTokens: s.tokens.startupTokens,
    })),
    ...mcpServers
      .filter((m) => !m.disabled && m.estimatedSchemaTokens > 0)
      .map((m) => ({
        id: m.id,
        name: m.name,
        type: 'mcp' as const,
        platform: m.platform,
        startupTokens: m.estimatedSchemaTokens,
      })),
  ].sort((a, b) => b.startupTokens - a.startupTokens);

  const topStartupConsumers = allStartupConsumers.slice(0, 12).map((item) => ({
    ...item,
    sharePct:
      totalAlwaysOnTokens > 0
        ? Number(((item.startupTokens / totalAlwaysOnTokens) * 100).toFixed(1))
        : 0,
  }));

  return {
    totalStartupSkillTokens,
    totalStartupMcpTokens,
    totalAlwaysOnTokens,
    totalOnDemandBodyTokens,
    totalResourceTokens,
    recommendedStartupLimit,
    startupUtilizationPct,
    byPlatform: Array.from(platformMap.values()).sort((a, b) => b.startupTokens - a.startupTokens),
    topStartupConsumers,
  };
}

function loadJsonlStoresSync(
  extraRoots: string[],
  onlyExtraRoots: boolean,
): AgentImmuneBridgeReport {
  const candidates = onlyExtraRoots
    ? extraRoots.map((root) => ({
        path: path.resolve(root, '.immune', 'rules.jsonl'),
        kind: 'jsonl' as const,
      }))
    : getDefaultAgentImmuneStores(extraRoots).filter((s) => s.kind === 'jsonl');

  const detectedStores: AgentImmuneBridgeReport['detectedStores'] = [];
  const pitfallAntibodies: PitfallAntibody[] = [];

  for (const store of candidates) {
    const exists = fs.existsSync(store.path);
    if (!exists) {
      detectedStores.push({ ...store, exists: false, antibodyCount: 0 });
      continue;
    }
    const loaded = readAntibodiesFromJsonl(store.path);
    pitfallAntibodies.push(...loaded.rows);
    detectedStores.push({
      ...store,
      exists: true,
      antibodyCount: loaded.rows.length,
      error: loaded.error,
    });
  }

  return {
    detectedStores,
    pitfallAntibodies,
    activePitfallCount: pitfallAntibodies.filter((a) => a.status === 'active').length,
    totalHits: pitfallAntibodies.reduce((sum, a) => sum + a.hit_count, 0),
  };
}

function assembleReport(
  options: ScanOptions,
  agentImmuneBridge: AgentImmuneBridgeReport,
): WorkspaceReport {
  const mode = options.mode ?? (options.paths && options.paths.length > 0 ? 'custom' : 'local');
  let roots: ScanRootSpec[];

  if (options.paths && options.paths.length > 0) {
    roots = options.paths.map((p) => ({
      rootPath: path.resolve(p),
      platform: inferPlatformFromPath(p, 'custom'),
    }));
  } else {
    roots = getDefaultLocalScanRoots(Boolean(options.includeBuiltin));
  }

  const { scannedSources, skills, mcpServers } = scanRoots(roots);
  const conflicts = detectTriggerConflicts(skills, options.conflictThreshold ?? 0.24);
  const { issues, healthScore } = lintWorkspace(skills, mcpServers, conflicts);
  const budget = computeTokenBudget(skills, mcpServers, options.startupBudgetLimit ?? 12000);
  const immune = runImmuneWorkspaceAudit(skills, options.customAntibodies, agentImmuneBridge);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  const highConflictCount = conflicts.filter((c) => c.severity === 'high').length;
  const secretFindingCount = mcpServers.reduce((sum, m) => sum + m.secretFindings.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    mode,
    scannedSources,
    summary: {
      healthScore,
      immunityScore: immune.immunityScore,
      skillCount: skills.length,
      mcpServerCount: mcpServers.length,
      activeMcpCount: mcpServers.filter((m) => !m.disabled).length,
      errorCount,
      warningCount,
      infoCount,
      highConflictCount,
      secretFindingCount,
      quarantineSkillCount: immune.quarantineCount,
    },
    budget,
    skills,
    mcpServers,
    conflicts,
    issues,
    immune,
  };
}

/**
 * Synchronous workspace analysis (loads `.immune/rules.jsonl` pitfall antibodies + full ToxicSkills scan).
 */
export function analyzeWorkspace(options: ScanOptions = {}): WorkspaceReport {
  const extraRoots = options.paths ?? [];
  const onlyExtra = options.mode === 'demo' || options.mode === 'custom';
  const bridge = loadJsonlStoresSync(extraRoots, onlyExtra);
  return assembleReport(options, bridge);
}

/**
 * Async workspace analysis that additionally reads local `meat-daemon-404/agent-immune`
 * SQLite (`node:sqlite`) databases (`~/.dsh/immune.sqlite`, `~/.zcode/immune.sqlite`, etc.).
 */
export async function analyzeWorkspaceAsync(options: ScanOptions = {}): Promise<WorkspaceReport> {
  const extraRoots = options.paths ?? [];
  const onlyExtra = options.mode === 'demo';
  const bridge = await loadAgentImmuneBridge(extraRoots, onlyExtra);
  return assembleReport(options, bridge);
}
