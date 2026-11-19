#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeWorkspaceAsync,
  createSuperAgentPlan,
  detectLocalAgents,
  executeWorkflowGraph,
  exportBundle,
  simulatePromptRouting,
  type ExportTarget,
  type ScanOptions,
} from '@skilldeck/core';
import { startStdioMcpHubServer } from '@skilldeck/hub';
import {
  resolveDefaultDemoWorkspace,
  startSkillDeckServer,
} from '@skilldeck/server';

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
};

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

const VALUE_FLAGS = new Set([
  'path',
  'target',
  'out',
  'port',
  'host',
  'threshold',
  'limit',
]);

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const rest = command === 'help' && argv[0]?.startsWith('-') ? argv : argv.slice(1);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        if (key === 'path') {
          const existing = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
          existing.push(val);
          flags[key] = existing;
        } else {
          flags[key] = val;
        }
        continue;
      }

      const key = token.slice(2);
      const next = rest[i + 1];
      if (VALUE_FLAGS.has(key) && next && !next.startsWith('--')) {
        if (key === 'path') {
          const existing = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
          existing.push(next);
          flags[key] = existing;
        } else {
          flags[key] = next;
        }
        i += 1;
      } else {
        flags[key] = true;
      }
    } else if (token === '-h') {
      flags.help = true;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

function buildScanOptionsFromFlags(flags: ParsedArgs['flags']): ScanOptions {
  const customPaths = Array.isArray(flags.path)
    ? flags.path
    : typeof flags.path === 'string'
      ? [flags.path]
      : undefined;

  if (customPaths && customPaths.length > 0) {
    return {
      mode: 'custom',
      paths: customPaths,
      conflictThreshold: flags.threshold ? Number(flags.threshold) : undefined,
      startupBudgetLimit: flags.limit ? Number(flags.limit) : undefined,
    };
  }

  if (flags.demo) {
    return {
      mode: 'demo',
      paths: [resolveDefaultDemoWorkspace()],
      conflictThreshold: flags.threshold ? Number(flags.threshold) : undefined,
      startupBudgetLimit: flags.limit ? Number(flags.limit) : undefined,
    };
  }

  return {
    mode: 'local',
    includeBuiltin: Boolean(flags['include-builtin']),
    conflictThreshold: flags.threshold ? Number(flags.threshold) : undefined,
    startupBudgetLimit: flags.limit ? Number(flags.limit) : undefined,
  };
}

function printHelp(): void {
  console.log(`
${c.bold('SkillDeck CLI')} ${c.dim('v0.2.0')} — Local-first SuperAgent Control Tower, MCP Hub & Agent-Immune Shield

${c.bold('USAGE')}
  skilldeck <command> [options]

${c.bold('COMMANDS')}
  scan                  Scan Agent Skills (Antigravity/Claude/Cursor/Codex/DSH/ZCode) & MCP configs
  lint                  Audit spec compliance, broken links, and hardcoded secrets
  immune                Run dual-layer Agent-Immune audit (ToxicSkills + agent-immune SQLite/JSONL pitfall antibodies)
  budget                Analyze always-on startup vs. on-demand context token costs
  conflicts             Detect overlapping bilingual trigger phrases across skills
  route "<prompt>"      Simulate which skills activate for a user prompt
  agents                Detect locally installed CLI agents (agy, ollama, claude, gemini, codex, gh)
  run "<goal>"          Plan and run a SuperAgent workflow under Agent-Immune guardrails
  hub                   Start the real stdio MCP Aggregation Gateway (Meta-Server)
  export                Export sanitized cross-platform bundle (secrets stripped)
  serve                 Launch the local REST API + bilingual Web Control Tower

${c.bold('COMMON OPTIONS')}
  --demo                Use bundled bilingual demo workspace
  --local               Scan standard local agent dirs (~/.gemini, ~/.claude, ~/.cursor, ~/.codex, ~/.dsh, ~/.zcode)
  --path <dir>          Scan one or more custom directories (repeatable)
  --include-builtin     Include built-in Antigravity skills during --local scan
  --json                Output machine-readable JSON (ideal for CI)
`);
}

function renderBar(ratio: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const { command, positionals, flags } = parsed;

  if (command === 'help' || flags.help) {
    printHelp();
    return;
  }

  const asJson = Boolean(flags.json);

  if (command === 'hub') {
    const scanOptions = buildScanOptionsFromFlags(flags);
    startStdioMcpHubServer({ scanOptions });
    return;
  }

  if (command === 'serve') {
    const port = flags.port ? Number(flags.port) : 4173;
    const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
    const defaultMode = flags.local ? 'local' : 'demo';

    const { url } = await startSkillDeckServer({ port, host, defaultMode });
    console.log(`\n  ${c.bold(c.cyan('SkillDeck Control Tower v0.2'))} running at ${c.bold(url)}`);
    console.log(`  ${c.dim(`Default workspace mode: ${defaultMode} (switchable live inside the UI)`)}`);
    console.log(`  ${c.dim('Press Ctrl+C to stop.')}\n`);
    return;
  }

  if (command === 'agents') {
    const agents = await detectLocalAgents();
    if (asJson) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }
    console.log(`\n${c.bold('Detected Local AI CLI Agents & Runtimes')}\n`);
    for (const a of agents) {
      const badge = a.available ? c.green('READY  ') : c.dim('MISSING');
      console.log(`  ${badge} ${c.cyan(a.name.padEnd(22))} (${a.command}) — ${a.statusNote}`);
      if (a.models && a.models.length > 0) {
        console.log(`          Models: ${a.models.join(', ')}`);
      }
    }
    console.log('');
    return;
  }

  const scanOpts = buildScanOptionsFromFlags(flags);
  const report = await analyzeWorkspaceAsync(scanOpts);

  if (command === 'scan') {
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const scoreColor =
      report.summary.healthScore >= 85
        ? c.green
        : report.summary.healthScore >= 60
          ? c.yellow
          : c.red;

    console.log(`\n${c.bold('SkillDeck Scan Report')} ${c.dim(`(${report.mode})`)}`);
    console.log(
      `Health: ${scoreColor(c.bold(`${report.summary.healthScore}/100`))}  |  ` +
        `Immunity: ${c.bold(`${report.summary.immunityScore}/100`)}  |  ` +
        `Skills: ${c.bold(String(report.summary.skillCount))}  |  ` +
        `MCP Servers: ${c.bold(String(report.summary.mcpServerCount))}  |  ` +
        `Always-On: ${c.bold(report.budget.totalAlwaysOnTokens.toLocaleString())}t`,
    );
    console.log(
      `Issues: ${c.red(`${report.summary.errorCount} errors`)}, ` +
        `${c.yellow(`${report.summary.warningCount} warnings`)}  |  ` +
        `Quarantined Skills: ${c.red(String(report.summary.quarantineSkillCount))}  |  ` +
        `Pitfall Antibodies (agent-immune): ${c.cyan(String(report.immune.agentImmuneBridge.activePitfallCount))}\n`,
    );
    return;
  }

  if (command === 'immune') {
    if (asJson) {
      console.log(JSON.stringify(report.immune, null, 2));
      return;
    }
    const { immune } = report;
    console.log(
      `\n${c.bold('Agent-Immune Dual-Layer Report')} — Immunity ${c.bold(`${immune.immunityScore}/100`)} ` +
        `(Safe=${immune.safeCount}, Caution=${immune.cautionCount}, Quarantine=${immune.quarantineCount})\n`,
    );
    if (immune.findings.length > 0) {
      console.log(c.bold('Security Findings (ToxicSkills / Prompt Injection):'));
      for (const f of immune.findings) {
        console.log(`  ${c.red(f.severity.toUpperCase().padEnd(8))} ${c.bold(f.ruleId)} [${f.targetName}] ${f.title}`);
        console.log(`           Evidence: ${c.dim(f.evidence)}`);
      }
      console.log('');
    }
    console.log(
      c.bold(
        `agent-immune Pitfall Antibodies (${immune.agentImmuneBridge.activePitfallCount} active across ${immune.agentImmuneBridge.detectedStores.filter((s) => s.exists).length} store(s)):`,
      ),
    );
    for (const ab of immune.agentImmuneBridge.pitfallAntibodies.slice(0, 8)) {
      console.log(`  • [${c.cyan(ab.trigger_pattern)}] AVOID: ${ab.symptom} -> DO: ${ab.prescription}`);
    }
    console.log('');
    if (immune.quarantineCount > 0 && flags.strict) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'run') {
    const goal = positionals.join(' ').trim();
    if (!goal) {
      console.error(c.red('Error: Please provide a goal, e.g. skilldeck run --demo "Deploy Cloudflare Worker"'));
      process.exitCode = 1;
      return;
    }
    const plan = await createSuperAgentPlan({ goal, report });
    const run = await executeWorkflowGraph({
      graph: plan.workflowGraph,
      report,
      mode: flags.live ? 'live' : 'dry-run',
      goalContext: goal,
    });
    if (asJson) {
      console.log(JSON.stringify({ plan, run }, null, 2));
      return;
    }
    console.log(`\n${c.bold('SuperAgent Execution')} (${run.mode}, status=${run.status}, ${run.totalDurationMs}ms)`);
    for (const st of run.steps) {
      const badge = st.status === 'ok' ? c.green('OK   ') : c.red(st.status.toUpperCase().padEnd(5));
      console.log(`  ${st.step}. ${badge} [${st.type}] ${c.cyan(st.label)} (${st.durationMs}ms)`);
      console.log(`     ${c.dim(st.output.split('\n')[0] ?? '')}`);
    }
    console.log('');
    return;
  }

  if (command === 'lint') {
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            healthScore: report.summary.healthScore,
            immunityScore: report.summary.immunityScore,
            errorCount: report.summary.errorCount,
            warningCount: report.summary.warningCount,
            issues: report.issues,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `\n${c.bold('SkillDeck Lint')} — Health ${c.bold(`${report.summary.healthScore}/100`)} ` +
          `(${report.summary.errorCount} errors, ${report.summary.warningCount} warnings, ${report.summary.infoCount} info)\n`,
      );
      for (const issue of report.issues) {
        const badge =
          issue.severity === 'error'
            ? c.red('ERROR')
            : issue.severity === 'warning'
              ? c.yellow('WARN ')
              : c.dim('INFO ');
        console.log(`  ${badge} ${c.bold(issue.ruleId)} [${issue.targetName}] ${issue.message}`);
      }
      console.log('');
    }
    const strict = Boolean(flags.strict);
    if (report.summary.errorCount > 0 || (strict && report.summary.warningCount > 0)) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'budget') {
    if (asJson) {
      console.log(JSON.stringify(report.budget, null, 2));
      return;
    }
    const { budget } = report;
    const ratio = budget.totalAlwaysOnTokens / Math.max(1, budget.recommendedStartupLimit);
    console.log(`\n${c.bold('Context Budget Analysis')}`);
    console.log(
      `Always-On Startup: ${c.bold(budget.totalAlwaysOnTokens.toLocaleString())} / ` +
        `${budget.recommendedStartupLimit.toLocaleString()} tokens (${budget.startupUtilizationPct}%)`,
    );
    console.log(`  ${c.cyan(renderBar(ratio, 32))}\n`);
    return;
  }

  if (command === 'conflicts') {
    if (asJson) {
      console.log(JSON.stringify(report.conflicts, null, 2));
      return;
    }
    console.log(`\n${c.bold('Trigger Conflict Radar')} (${report.conflicts.length} pairs)\n`);
    for (const pair of report.conflicts) {
      console.log(
        `  ${pair.severity.toUpperCase().padEnd(6)} ${Math.round(pair.similarity * 100)}%  ${c.cyan(pair.skillA.name)} ↔ ${c.cyan(pair.skillB.name)}`,
      );
    }
    console.log('');
    return;
  }

  if (command === 'route') {
    const prompt = positionals.join(' ').trim();
    if (!prompt) {
      console.error(c.red('Error: Please provide a prompt string.'));
      process.exitCode = 1;
      return;
    }
    const result = simulatePromptRouting(prompt, report.skills, report.mcpServers);
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\n${c.bold('Prompt Routing Simulation')}: "${result.prompt}"`);
    for (const m of result.matches) {
      console.log(`  ${Math.round(m.score * 100)}%  ${c.cyan(m.skillName)} (+${m.bodyTokens}t)`);
    }
    console.log('');
    return;
  }

  if (command === 'export') {
    const target = (typeof flags.target === 'string' ? flags.target : 'claude-code') as ExportTarget;
    const bundle = exportBundle(target, report.skills, report.mcpServers);
    if (typeof flags.out === 'string' && flags.out.trim().length > 0) {
      const outDir = path.resolve(flags.out);
      for (const file of bundle.files) {
        const dest = path.join(outDir, file.relativePath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.content, 'utf8');
      }
    }
    if (asJson) {
      console.log(JSON.stringify(bundle, null, 2));
    } else {
      console.log(`Exported ${bundle.files.length} files for ${target} (${bundle.redactedSecretCount} secrets redacted).`);
    }
    return;
  }

  console.error(c.red(`Unknown command: "${command}". Run "skilldeck --help" for usage.`));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
