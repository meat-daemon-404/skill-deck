import fs from 'node:fs';
import path from 'node:path';
import type {
  ConflictPair,
  LintIssue,
  McpServerRecord,
  SkillRecord,
} from './types.js';

const VALID_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRIGGER_CUE_RE =
  /\b(use when|use this|trigger|activate|invoke|when the user|when asked|for building|for debugging|when working)\b|用于|当用户|触发|时使用|时自动触发|适用于/i;

export function lintWorkspace(
  skills: SkillRecord[],
  mcpServers: McpServerRecord[],
  conflicts: ConflictPair[],
): { issues: LintIssue[]; healthScore: number } {
  const issues: LintIssue[] = [];
  let issueSeq = 0;

  const pushIssue = (issue: Omit<LintIssue, 'id'>): void => {
    issueSeq += 1;
    issues.push({
      id: `issue_${issueSeq}`,
      ...issue,
    });
  };

  // Track duplicate skill names
  const skillsByName = new Map<string, SkillRecord[]>();
  for (const skill of skills) {
    const list = skillsByName.get(skill.name) ?? [];
    list.push(skill);
    skillsByName.set(skill.name, list);
  }

  for (const skill of skills) {
    // SD001: Missing or invalid YAML frontmatter
    if (!skill.frontmatterValid) {
      pushIssue({
        ruleId: 'SD001',
        severity: 'error',
        category: 'spec',
        targetType: 'skill',
        targetId: skill.id,
        targetName: skill.name,
        filePath: skill.filePath,
        message: skill.frontmatterError ?? 'Invalid or missing YAML frontmatter.',
        suggestion: 'Add a valid YAML frontmatter block delimited by --- at the top of SKILL.md with `name` and `description`.',
      });
    }

    // SD002 & SD003: Required `name` & spec regex (for SKILL.md skills)
    if (skill.kind === 'skill') {
      const rawName = skill.frontmatter.name;
      if (typeof rawName !== 'string' || rawName.trim().length === 0) {
        pushIssue({
          ruleId: 'SD002',
          severity: 'error',
          category: 'spec',
          targetType: 'skill',
          targetId: skill.id,
          targetName: skill.name,
          filePath: skill.filePath,
          message: 'Missing required `name` field in YAML frontmatter.',
          suggestion: `Add \`name: ${skill.directoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\` to the frontmatter.`,
        });
      } else {
        const trimmedName = rawName.trim();
        if (trimmedName.length > 64 || !VALID_SKILL_NAME_RE.test(trimmedName)) {
          pushIssue({
            ruleId: 'SD003',
            severity: 'warning',
            category: 'spec',
            targetType: 'skill',
            targetId: skill.id,
            targetName: skill.name,
            filePath: skill.filePath,
            message: `Skill name "${trimmedName}" violates Agent Skills naming spec (1–64 chars, lowercase a-z, 0-9, single hyphens).`,
            suggestion: `Rename to "${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)}".`,
          });
        }

        // SD004: Name should match parent directory name
        if (
          skill.directoryName.toLowerCase() !== 'skills' &&
          trimmedName !== skill.directoryName
        ) {
          pushIssue({
            ruleId: 'SD004',
            severity: 'warning',
            category: 'spec',
            targetType: 'skill',
            targetId: skill.id,
            targetName: skill.name,
            filePath: skill.filePath,
            message: `Frontmatter name "${trimmedName}" does not match parent directory "${skill.directoryName}".`,
            suggestion: `Rename either the directory to "${trimmedName}" or the frontmatter \`name\` field to "${skill.directoryName}".`,
          });
        }
      }
    }

    // SD005: Missing description
    if (!skill.description) {
      pushIssue({
        ruleId: 'SD005',
        severity: 'error',
        category: 'spec',
        targetType: 'skill',
        targetId: skill.id,
        targetName: skill.name,
        filePath: skill.filePath,
        message: 'Missing `description` field; agents cannot discover when to trigger this skill.',
        suggestion: 'Add a concise 1–3 sentence `description` stating what the skill does and exact trigger conditions.',
      });
    } else {
      // SD006: Description length > 1024 chars (spec cap) or high startup bloat
      if (skill.tokens.descriptionChars > 1024) {
        pushIssue({
          ruleId: 'SD006',
          severity: 'warning',
          category: 'budget',
          targetType: 'skill',
          targetId: skill.id,
          targetName: skill.name,
          filePath: skill.filePath,
          message: `Description is ${skill.tokens.descriptionChars} chars (exceeds 1,024-char Agent Skills spec limit; ~${skill.tokens.startupTokens} always-on startup tokens).`,
          suggestion: 'Trim the frontmatter description to concise trigger conditions and move detailed rules into the SKILL.md body or references/.',
        });
      } else if (skill.tokens.startupTokens > 220) {
        pushIssue({
          ruleId: 'SD006',
          severity: 'info',
          category: 'budget',
          targetType: 'skill',
          targetId: skill.id,
          targetName: skill.name,
          filePath: skill.filePath,
          message: `Description uses ~${skill.tokens.startupTokens} always-on startup tokens every turn.`,
          suggestion: 'Tighten trigger wording to keep always-on catalog cost lean (<180 tokens per skill).',
        });
      }

      // SD007: Weak trigger guidance
      if (skill.description.length < 28 || !TRIGGER_CUE_RE.test(skill.description)) {
        pushIssue({
          ruleId: 'SD007',
          severity: 'info',
          category: 'hygiene',
          targetType: 'skill',
          targetId: skill.id,
          targetName: skill.name,
          filePath: skill.filePath,
          message: 'Description lacks explicit activation cues ("Use when...", "Trigger on...", "当用户...时使用").',
          suggestion: 'State concrete situations and negative boundaries ("Do NOT use for...") to improve routing accuracy.',
        });
      }
    }

    // SD008: Progressive disclosure bloat in SKILL.md body
    if (skill.tokens.bodyLineCount > 450 || skill.tokens.bodyTokens > 3800) {
      pushIssue({
        ruleId: 'SD008',
        severity: 'warning',
        category: 'budget',
        targetType: 'skill',
        targetId: skill.id,
        targetName: skill.name,
        filePath: skill.filePath,
        message: `Skill body is bulky (${skill.tokens.bodyLineCount} lines, ~${skill.tokens.bodyTokens} tokens loaded on activation).`,
        suggestion: 'Split deep reference tables and examples into `references/*.md` so they load lazily on demand.',
      });
    }

    // SD009: Broken relative Markdown links inside SKILL.md
    const skillDir = path.dirname(skill.filePath);
    for (const relLink of skill.localLinks) {
      const targetPath = path.resolve(skillDir, relLink);
      if (!fs.existsSync(targetPath)) {
        pushIssue({
          ruleId: 'SD009',
          severity: 'error',
          category: 'hygiene',
          targetType: 'skill',
          targetId: skill.id,
          targetName: skill.name,
          filePath: skill.filePath,
          message: `Broken relative reference link: "${relLink}" does not exist on disk.`,
          suggestion: `Create "${relLink}" inside the skill folder or fix the broken Markdown path.`,
        });
      }
    }
  }

  // SD010: Duplicate skill names across directories/platforms
  for (const [name, dupes] of skillsByName.entries()) {
    if (dupes.length > 1) {
      for (const skill of dupes) {
        pushIssue({
          ruleId: 'SD010',
          severity: 'warning',
          category: 'hygiene',
          targetType: 'skill',
          targetId: skill.id,
          targetName: name,
          filePath: skill.filePath,
          message: `Duplicate skill name "${name}" found in ${dupes.length} locations (${dupes.map((d) => d.platform).join(', ')}).`,
          suggestion: 'Consolidate into one source-of-truth skill and use SkillDeck Export to sync across platforms.',
        });
      }
    }
  }

  // MCP Audit Rules
  const mcpByName = new Map<string, McpServerRecord[]>();
  for (const server of mcpServers) {
    const list = mcpByName.get(server.name) ?? [];
    list.push(server);
    mcpByName.set(server.name, list);

    // SD101: Hardcoded plaintext secrets in MCP config
    for (const secret of server.secretFindings) {
      pushIssue({
        ruleId: 'SD101',
        severity: 'error',
        category: 'security',
        targetType: 'mcp',
        targetId: server.id,
        targetName: server.name,
        filePath: server.configPath,
        message: `Hardcoded secret detected in ${secret.fieldPath} (${secret.patternName}: ${secret.maskedPreview}).`,
        suggestion: 'Replace literal credentials with environment variable placeholders (e.g. "${MY_API_KEY}") or an OS keychain provider.',
      });
    }

    // SD103: Missing local CLI executable on PATH
    if (!server.disabled && server.transport === 'stdio' && server.commandAvailable === false) {
      pushIssue({
        ruleId: 'SD103',
        severity: 'warning',
        category: 'mcp',
        targetType: 'mcp',
        targetId: server.id,
        targetName: server.name,
        filePath: server.configPath,
        message: `MCP executable "${server.command}" was not found on system PATH.`,
        suggestion: `Install "${server.command}" or specify its full path, or mark this MCP server as disabled.`,
      });
    }

    // SD104: Unpinned remote package execution via npx/uvx @latest or unversioned
    if (
      !server.disabled &&
      server.command &&
      /^(npx|pnpx|uvx)$/i.test(path.basename(server.command)) &&
      server.args.some((a) => a.includes('@latest'))
    ) {
      pushIssue({
        ruleId: 'SD104',
        severity: 'info',
        category: 'security',
        targetType: 'mcp',
        targetId: server.id,
        targetName: server.name,
        filePath: server.configPath,
        message: `MCP server "${server.name}" pulls an unpinned "@latest" package on startup.`,
        suggestion: 'Pin an explicit semver version (e.g. @1.4.2) for supply-chain stability and faster startup.',
      });
    }
  }

  // SD102: Duplicate MCP server names
  for (const [name, dupes] of mcpByName.entries()) {
    if (dupes.length > 1) {
      for (const server of dupes) {
        pushIssue({
          ruleId: 'SD102',
          severity: 'warning',
          category: 'mcp',
          targetType: 'mcp',
          targetId: server.id,
          targetName: name,
          filePath: server.configPath,
          message: `MCP server "${name}" is declared in ${dupes.length} config files.`,
          suggestion: 'Deduplicate MCP server declarations to avoid conflicting tool registrations and wasted schema tokens.',
        });
      }
    }
  }

  // Compute size-aware 0–100 Health Score so large 200+ skill setups still get an actionable gradient
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;
  const securityErrorCount = issues.filter(
    (i) => i.severity === 'error' && i.category === 'security',
  ).length;
  const highConflictCount = conflicts.filter((c) => c.severity === 'high').length;

  const assetScale = Math.max(1, (skills.length + mcpServers.length) / 14);
  const rawPenalty =
    errorCount * 10 +
    warningCount * 3.5 +
    infoCount * 0.75 +
    highConflictCount * 5;
  // Security errors (hardcoded secrets) always apply an unscaled baseline penalty
  const normalizedPenalty = Math.round(rawPenalty / Math.sqrt(assetScale) + securityErrorCount * 6);
  const healthScore = Math.max(0, Math.min(100, 100 - normalizedPenalty));

  // Sort errors first, then warnings, then info
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.ruleId.localeCompare(b.ruleId));

  return { issues, healthScore };
}
