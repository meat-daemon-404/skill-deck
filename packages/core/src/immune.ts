import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { detectSecretInValue } from './secrets.js';
import type {
  AgentImmuneBridgeReport,
  ImmuneAntibody,
  ImmuneFinding,
  ImmuneFirewallDecision,
  ImmuneSeverity,
  ImmuneSkillReport,
  ImmuneVerdict,
  ImmuneWorkspaceReport,
  SkillRecord,
} from './types.js';

interface BuiltinImmuneRule {
  ruleId: string;
  name: string;
  vector: ImmuneFinding['vector'];
  severity: ImmuneSeverity;
  regex: RegExp;
  title: string;
  recommendation: string;
}

const TRUSTED_INSTALLER_DOMAINS_RE =
  /https:\/\/(?:dl\.google\.com|raw\.githubusercontent\.com\/(?:google-gemini|astral-sh|nvm-sh|ohmyzsh)|astral\.sh|unity\.com|bun\.sh|sh\.rustup\.rs|get\.pnpm\.io|get\.docker\.com|brew\.sh)\b/i;

const TEXT_SCRIPT_EXTS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.rb',
  '.go',
  '.sql',
  '.yaml',
  '.yml',
  '.json',
  '.md',
  '.txt',
]);

const BUILTIN_IMMUNE_RULES: BuiltinImmuneRule[] = [
  {
    ruleId: 'IMM001',
    name: 'Prompt Injection Override',
    vector: 'prompt-injection',
    severity: 'critical',
    regex:
      /(?:ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)|disregard\s+(?:all\s+)?system\s+prompts?|you\s+are\s+now\s+in\s+(?:developer|unrestricted|dan)\s+mode|忽略(?:之前|以上|所有)(?:的)?(?:指令|规则|系统提示))/i,
    title: 'Prompt injection / instruction override attempt',
    recommendation:
      'Quarantine this skill immediately and inspect why it tries to override system or user instructions.',
  },
  {
    ruleId: 'IMM002',
    name: 'Credential & Data Exfiltration',
    vector: 'exfiltration',
    severity: 'critical',
    regex:
      /(?:(?:curl|wget|invoke-webrequest)\b[^\n]{0,140}(?:~\/\.ssh|~\/\.aws|id_rsa|\/etc\/shadow|\/etc\/passwd|\.env\b|-d\s+['"]?\$\(|--data[^\s]*\s+['"]?\$\(|printenv)|(?:cat|type|head|tail)\s+(?:~\/\.ssh\/id_rsa|~\/\.aws\/credentials|\/etc\/shadow)|\bexfiltrate\b|send\s+(?:all\s+)?(?:secrets?|env\s+vars?|api\s+keys?|private\s+keys?)\s+to\s+https?:\/\/)/i,
    title: 'Potential credential harvesting or outbound data exfiltration',
    recommendation:
      'Block outbound transmission of local credentials/env files and verify every external endpoint.',
  },
  {
    ruleId: 'IMM003',
    name: 'Destructive Shell / Unverified Remote Pipe',
    vector: 'destructive-exec',
    severity: 'critical',
    regex:
      /(?:\brm\s+-rf\s+(?:\/|~|\*|\.\.)|\b(?:curl|wget)\s+http:\/\/[^\n|]{4,140}\|\s*(?:sh|bash|zsh)\b|invoke-expression\s*\(\s*(?:irm|iwr|invoke-restmethod)\s+['"]?http:\/\/|\bformat\s+[a-z]:|\bdd\s+if=.*of=\/dev\/)/i,
    title: 'Destructive command or unencrypted remote script pipe execution',
    recommendation:
      'Never pipe unverified remote URLs directly into a shell or execute recursive root deletions inside a skill.',
  },
  {
    ruleId: 'IMM004',
    name: 'Covert HTML Comment / Tool Shadowing',
    vector: 'tool-poisoning',
    severity: 'high',
    regex:
      /(?:<!--(?:(?!-->)[\s\S]){0,220}(?:system\s+prompt|override\s+instructions?|exfiltrate|ignore\s+previous|hidden\s+instruction|silently\s+execute|do\s+not\s+tell\s+the\s+user)(?:(?!-->)[\s\S]){0,220}-->|<IMPORTANT>(?:(?!<\/IMPORTANT>)[\s\S]){0,220}(?:do\s+not\s+tell\s+the\s+user|hide\s+from\s+user|silently\s+execute))/i,
    title: 'Hidden instruction or covert MCP tool-poisoning directive',
    recommendation:
      'Remove concealed HTML comments or directives instructing the agent to act silently without informing the user.',
  },
  {
    ruleId: 'IMM005',
    name: 'Unicode Smuggling / Bidi Spoofing',
    vector: 'unicode-smuggling',
    severity: 'high',
    regex: /[\u202A-\u202E\u2066-\u2069\u200B\u200C\u200D]{3,}|[\u202E\u2066-\u2069]/,
    title: 'Suspicious zero-width characters or Unicode bidirectional override detected',
    recommendation:
      'Inspect raw bytes of the file; hidden bidi/zero-width characters can disguise malicious instructions.',
  },
  {
    ruleId: 'IMM006',
    name: 'Unrestricted Shell Privilege Grant',
    vector: 'privilege-escalation',
    severity: 'medium',
    regex: /allowed-tools:\s*['"]?[^\n]*(?:Bash\(\*\)|Shell\(\*\)|Write\(\/\*\))/i,
    title: 'Overly broad pre-approved shell/write tool permission',
    recommendation:
      'Scope `allowed-tools` to explicit safe commands (e.g., `Bash(git status:*)`) instead of wildcard `Bash(*)`.',
  },
  {
    ruleId: 'IMM007',
    name: 'Persistence / Startup Modification',
    vector: 'destructive-exec',
    severity: 'high',
    regex:
      /(?:>>\s*~\/\.(?:bashrc|zshrc|profile)|crontab\s+-[elr]|HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|schtasks\s+\/create)/i,
    title: 'Attempts to modify shell startup profiles or OS scheduled persistence',
    recommendation:
      'Review whether this skill legitimately manages OS schedules/startup tasks before approving.',
  },
  {
    ruleId: 'IMM008',
    name: 'Remote HTTPS Installer Pipe',
    vector: 'destructive-exec',
    severity: 'medium',
    regex: /\b(?:curl|wget)\s+[^\n|]*https:\/\/[^\n|]{4,140}\|\s*(?:sh|bash|zsh)\b/i,
    title: 'Remote HTTPS install script piped to shell (review origin before running)',
    recommendation:
      'Verify the installer URL domain and pin a checksum or version tag rather than piping mutable scripts directly to bash.',
  },
];

const SEVERITY_WEIGHT: Record<ImmuneSeverity, number> = {
  critical: 48,
  high: 28,
  medium: 14,
  low: 6,
};

export function getBuiltinAntibodies(): ImmuneAntibody[] {
  return BUILTIN_IMMUNE_RULES.map((r) => ({
    id: r.ruleId,
    name: r.name,
    vector: r.vector,
    severity: r.severity,
    pattern: r.regex.source,
    flags: r.regex.flags,
    description: r.title,
    source: 'builtin',
    createdAt: '2026-01-01T00:00:00.000Z',
    hits: 0,
  }));
}

function excerptEvidence(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 36);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return snippet.length > 140 ? `${snippet.slice(0, 137)}...` : snippet;
}

/**
 * Scans arbitrary text (a SKILL.md, script, user prompt, or MCP tool response)
 * against builtin Agent-Immune detectors and learned structural antibodies.
 */
export function scanContentForThreats(
  text: string,
  meta: { targetId: string; targetName: string; filePath: string },
  customAntibodies: ImmuneAntibody[] = [],
): ImmuneFinding[] {
  if (!text) return [];
  const findings: ImmuneFinding[] = [];
  let seq = 0;

  for (const rule of BUILTIN_IMMUNE_RULES) {
    const match = rule.regex.exec(text);
    if (match && match.index !== undefined) {
      // Elevate unknown-origin HTTPS shell pipes to high, keep well-known official installers as medium caution
      const severity =
        rule.ruleId === 'IMM008' && !TRUSTED_INSTALLER_DOMAINS_RE.test(match[0])
          ? 'high'
          : rule.severity;
      seq += 1;
      findings.push({
        id: `imm_${meta.targetId}_${rule.ruleId}_${seq}`,
        ruleId: rule.ruleId,
        severity,
        vector: rule.vector,
        targetId: meta.targetId,
        targetName: meta.targetName,
        filePath: meta.filePath,
        title: rule.title,
        evidence: excerptEvidence(text, match.index, match[0].length),
        recommendation: rule.recommendation,
      });
    }
  }

  for (const ab of customAntibodies) {
    if (ab.source === 'builtin') continue;
    try {
      const regex = new RegExp(ab.pattern, ab.flags ?? 'i');
      const match = regex.exec(text);
      if (match && match.index !== undefined) {
        seq += 1;
        findings.push({
          id: `imm_${meta.targetId}_${ab.id}_${seq}`,
          ruleId: ab.id,
          severity: ab.severity,
          vector: ab.vector,
          targetId: meta.targetId,
          targetName: meta.targetName,
          filePath: meta.filePath,
          title: `Learned Antibody Matched: ${ab.name}`,
          evidence: excerptEvidence(text, match.index, match[0].length),
          recommendation: `Blocked by custom antibody "${ab.name}". Review payload before allowing.`,
        });
      }
    } catch {
      // Ignore invalid user-supplied regex safely
    }
  }

  return findings;
}

/**
 * Runs a full Agent-Immune static vaccination audit across all discovered skills and bundled scripts.
 */
export function runImmuneWorkspaceAudit(
  skills: SkillRecord[],
  customAntibodies: ImmuneAntibody[] = [],
  agentImmuneBridge: AgentImmuneBridgeReport = {
    detectedStores: [],
    pitfallAntibodies: [],
    activePitfallCount: 0,
    totalHits: 0,
  },
): ImmuneWorkspaceReport {
  const antibodies = [
    ...getBuiltinAntibodies(),
    ...customAntibodies.filter((a) => a.source === 'learned'),
  ];
  const hitCounter = new Map<string, number>();

  const skillReports: ImmuneSkillReport[] = [];
  const allFindings: ImmuneFinding[] = [];

  for (const skill of skills) {
    const fullText = `${skill.frontmatterRaw}\n${skill.body}`;
    const findings = scanContentForThreats(
      fullText,
      { targetId: skill.id, targetName: skill.name, filePath: skill.filePath },
      customAntibodies,
    );

    // Also inspect bundled text/code scripts/ inside the skill directory (skip binary assets like .png/.pdf)
    const skillDir = path.dirname(skill.filePath);
    for (const res of skill.resources) {
      if (res.category !== 'scripts' || res.bytes > 256 * 1024) continue;
      const ext = path.extname(res.relativePath).toLowerCase();
      if (!TEXT_SCRIPT_EXTS.has(ext)) continue;
      const absScript = path.join(skillDir, res.relativePath);
      try {
        const scriptContent = fs.readFileSync(absScript, 'utf8');
        const scriptFindings = scanContentForThreats(
          scriptContent,
          { targetId: skill.id, targetName: `${skill.name}/${res.relativePath}`, filePath: absScript },
          customAntibodies,
        );
        findings.push(...scriptFindings);
      } catch {
        // Skip unreadable script
      }
    }

    for (const f of findings) {
      hitCounter.set(f.ruleId, (hitCounter.get(f.ruleId) ?? 0) + 1);
    }

    const threatScore = Math.min(
      100,
      findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0),
    );
    const hasCritical = findings.some((f) => f.severity === 'critical');
    const verdict: ImmuneVerdict =
      hasCritical || threatScore >= 45
        ? 'quarantine'
        : threatScore >= 14
          ? 'caution'
          : 'safe';

    skillReports.push({
      skillId: skill.id,
      skillName: skill.name,
      platform: skill.platform,
      verdict,
      threatScore,
      findings,
    });
    allFindings.push(...findings);
  }

  for (const ab of antibodies) {
    ab.hits = hitCounter.get(ab.id) ?? 0;
  }

  const safeCount = skillReports.filter((r) => r.verdict === 'safe').length;
  const cautionCount = skillReports.filter((r) => r.verdict === 'caution').length;
  const quarantineCount = skillReports.filter((r) => r.verdict === 'quarantine').length;

  const scale = Math.max(1, skills.length / 10);
  const rawPenalty = quarantineCount * 22 + cautionCount * 8;
  const immunityScore = Math.max(
    0,
    Math.min(100, Math.round(100 - rawPenalty / Math.sqrt(scale) - (quarantineCount > 0 ? 10 : 0))),
  );

  skillReports.sort((a, b) => b.threatScore - a.threatScore || a.skillName.localeCompare(b.skillName));

  return {
    immunityScore,
    safeCount,
    cautionCount,
    quarantineCount,
    totalFindings: allFindings.length,
    skillReports,
    findings: allFindings,
    activeAntibodies: antibodies,
    agentImmuneBridge,
  };
}

/**
 * Generates a content-free structural Antibody signature from a blocked payload or dangerous call
 * so future runs immunize against the same attack vector without storing private secrets.
 */
export function synthesizeAntibody(input: {
  name: string;
  vector?: ImmuneFinding['vector'];
  severity?: ImmuneSeverity;
  sampleText: string;
}): ImmuneAntibody {
  // Extract a clean regex token signature from the sample without keeping raw secrets
  const sanitized = input.sampleText
    .replace(/\b(?:sk-|ghp_|AIza)[A-Za-z0-9_-]{8,}\b/g, '[SECRET]')
    .trim();
  const escaped = sanitized
    .slice(0, 80)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');

  const idHash = createHash('sha256')
    .update(`${input.name}:${escaped}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();

  return {
    id: `AB-${idHash}`,
    name: input.name.trim() || `Antibody ${idHash}`,
    vector: input.vector ?? 'custom-antibody',
    severity: input.severity ?? 'high',
    pattern: escaped || 'BLOCK_EMPTY_SIGNATURE',
    flags: 'i',
    description: `Learned runtime antibody blocking signature derived from "${sanitized.slice(0, 48)}".`,
    source: 'learned',
    createdAt: new Date().toISOString(),
    hits: 0,
  };
}

export interface RuntimeCallWindowItem {
  fingerprint: string;
  timestamp: number;
}

const HIGH_RISK_TOOL_RE =
  /(?:delete|drop|truncate|destroy|exec|shell|bash|powershell|cmd|run_command|write_file|chmod|chown|transfer|pay|send_email|publish)/i;

/**
 * Runtime Agent-Immune Firewall evaluating every live MCP / SuperAgent / Workflow tool invocation
 * before execution:
 * 1. Loop / runaway circuit breaker (identical call repeated >= 4 times within 30s)
 * 2. Prompt injection / exfiltration / destructive payload scan against arguments
 * 3. Secret leakage check on outbound arguments
 * 4. High-risk tool quarantine gating when not explicitly approved
 */
export function evaluateRuntimeToolCall(params: {
  serverName: string;
  toolName: string;
  args: unknown;
  recentCalls?: RuntimeCallWindowItem[];
  customAntibodies?: ImmuneAntibody[];
  requireApprovalForHighRisk?: boolean;
}): ImmuneFirewallDecision {
  const serializedArgs =
    typeof params.args === 'string' ? params.args : JSON.stringify(params.args ?? {});
  const payload = `${params.serverName}.${params.toolName} ${serializedArgs}`;

  // 1. Runaway loop circuit breaker
  const now = Date.now();
  const fp = createHash('sha256').update(payload).digest('hex').slice(0, 16);
  const recentSameCount = (params.recentCalls ?? []).filter(
    (c) => c.fingerprint === fp && now - c.timestamp <= 30_000,
  ).length;

  if (recentSameCount >= 3) {
    return {
      allowed: false,
      action: 'block',
      reason: `Runaway loop circuit breaker tripped: "${params.serverName}:${params.toolName}" was invoked ${recentSameCount + 1} identical times within 30 seconds.`,
      matchedRules: ['IMM-LOOP'],
      threatScore: 85,
      loopDetected: true,
    };
  }

  // 2. Scan arguments for threats & learned antibodies
  const findings = scanContentForThreats(
    serializedArgs,
    {
      targetId: `${params.serverName}:${params.toolName}`,
      targetName: `${params.serverName}/${params.toolName}`,
      filePath: 'runtime-call',
    },
    params.customAntibodies,
  );

  const matchedRules = findings.map((f) => f.ruleId);
  let threatScore = Math.min(
    100,
    findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0),
  );

  // 3. Check outbound args for unredacted secret leakage
  const secretCheck = detectSecretInValue(serializedArgs);
  if (secretCheck.matched) {
    matchedRules.push('IMM-SECRET');
    threatScore = Math.min(100, threatScore + 45);
  }

  if (
    findings.some((f) => f.severity === 'critical' || f.vector === 'custom-antibody') ||
    threatScore >= 45
  ) {
    return {
      allowed: false,
      action: 'quarantine',
      reason:
        findings[0]?.title ??
        `Blocked potential secret leakage (${secretCheck.patternName}) in tool arguments.`,
      matchedRules,
      threatScore: Math.max(threatScore, 60),
      loopDetected: false,
    };
  }

  // 4. Optional HITL approval gate for high-risk mutation tools
  if (params.requireApprovalForHighRisk && HIGH_RISK_TOOL_RE.test(params.toolName)) {
    return {
      allowed: false,
      action: 'quarantine',
      reason: `High-risk mutating tool "${params.toolName}" requires human approval in Quarantine Queue.`,
      matchedRules: [...matchedRules, 'IMM-HITL'],
      threatScore: Math.max(threatScore, 35),
      loopDetected: false,
    };
  }

  return {
    allowed: true,
    action: 'allow',
    reason: 'Passed Agent-Immune runtime firewall checks.',
    matchedRules,
    threatScore,
    loopDetected: false,
  };
}
