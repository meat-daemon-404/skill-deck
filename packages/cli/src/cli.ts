#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeWorkspace,
  exportBundle,
  simulatePromptRouting,
  type ExportTarget,
  type ScanOptions,
} from '@skilldeck/core';
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
${c.bold('SkillDeck CLI')} ${c.dim('v0.1.0')} — Local-first Control Tower for AI Agent Skills & MCP

${c.bold('USAGE')}
  skilldeck <command> [options]

${c.bold('COMMANDS')}
  scan                  Scan Agent Skills (SKILL.md / .mdc) and MCP configs
  lint                  Audit spec compliance, broken links, and hardcoded secrets
  budget                Analyze always-on startup vs. on-demand context token costs
  conflicts             Detect overlapping bilingual trigger phrases across skills
  route "<prompt>"      Simulate which skills activate for a user prompt
  export                Export sanitized cross-platform bundle (secrets stripped)
  serve                 Launch the local REST API + interactive Web Control Tower

${c.bold('COMMON OPTIONS')}
  --demo                Use bundled bilingual demo workspace
  --local               Scan standard local agent dirs (~/.gemini, ~/.claude, ~/.cursor, ~/.codex)
  --path <dir>          Scan one or more custom directories (repeatable)
  --include-builtin     Include built-in Antigravity skills during --local scan
  --json                Output machine-readable JSON (ideal for CI)

${c.bold('EXAMPLES')}
  skilldeck scan --demo
  skilldeck lint --local --strict
  skilldeck route --demo "Deploy a Cloudflare Worker with Wrangler"
  skilldeck export --demo --target claude-code --out .skilldeck-export/claude
  skilldeck serve --demo --port 4173
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

  if (command === 'serve') {
    const port = flags.port ? Number(flags.port) : 4173;
    const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
    const defaultMode = flags.local ? 'local' : 'demo';

    const { url } = await startSkillDeckServer({ port, host, defaultMode });
    console.log(`\n  ${c.bold(c.cyan('SkillDeck Control Tower'))} running at ${c.bold(url)}`);
    console.log(`  ${c.dim(`Default workspace mode: ${defaultMode} (switchable live inside the UI)`)}`);
    console.log(`  ${c.dim('Press Ctrl+C to stop.')}\n`);
    return;
  }

  const scanOpts = buildScanOptionsFromFlags(flags);
  const report = analyzeWorkspace(scanOpts);

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
        `Skills: ${c.bold(String(report.summary.skillCount))}  |  ` +
        `MCP Servers: ${c.bold(String(report.summary.mcpServerCount))}  |  ` +
        `Always-On Tokens: ${c.bold(report.budget.totalAlwaysOnTokens.toLocaleString())}`,
    );
    console.log(
      `Issues: ${c.red(`${report.summary.errorCount} errors`)}, ` +
        `${c.yellow(`${report.summary.warningCount} warnings`)}, ` +
        `${c.dim(`${report.summary.infoCount} info`)}  |  ` +
        `Trigger Conflicts: ${c.bold(String(report.conflicts.length))}\n`,
    );

    if (report.skills.length > 0) {
      console.log(c.bold('Discovered Skills:'));
      for (const s of report.skills) {
        console.log(
          `  • ${c.cyan(s.name.padEnd(28))} ${c.dim(s.platform.padEnd(12))} ` +
            `startup=${String(s.tokens.startupTokens).padStart(4)}t  body=${String(s.tokens.bodyTokens).padStart(5)}t`,
        );
      }
      console.log('');
    }

    if (report.mcpServers.length > 0) {
      console.log(c.bold('Discovered MCP Servers:'));
      for (const m of report.mcpServers) {
        const status = m.disabled
          ? c.dim('disabled')
          : m.secretFindings.length > 0
            ? c.red(`SECRET(${m.secretFindings.length})`)
            : m.commandAvailable === false
              ? c.yellow('bin-missing')
              : c.green('ready');
        console.log(
          `  • ${c.cyan(m.name.padEnd(24))} ${c.dim(m.transport.padEnd(7))} ${status}`,
        );
      }
      console.log('');
    }
    return;
  }

  if (command === 'lint') {
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            healthScore: report.summary.healthScore,
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
      if (report.issues.length === 0) {
        console.log(`  ${c.green('✓')} No issues found.\n`);
      } else {
        for (const issue of report.issues) {
          const badge =
            issue.severity === 'error'
              ? c.red('ERROR')
              : issue.severity === 'warning'
                ? c.yellow('WARN ')
                : c.dim('INFO ');
          console.log(`  ${badge} ${c.bold(issue.ruleId)} [${issue.targetName}] ${issue.message}`);
          console.log(`        ${c.dim(`Fix: ${issue.suggestion}`)}`);
        }
        console.log('');
      }
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
    console.log(`  ${c.cyan(renderBar(ratio, 32))}`);
    console.log(
      `  Skills Catalog: ${budget.totalStartupSkillTokens.toLocaleString()}t  |  ` +
        `MCP Schemas: ${budget.totalStartupMcpTokens.toLocaleString()}t  |  ` +
        `On-Demand Bodies: ${budget.totalOnDemandBodyTokens.toLocaleString()}t\n`,
    );

    console.log(c.bold('Top Startup Consumers:'));
    for (const item of budget.topStartupConsumers.slice(0, 10)) {
      console.log(
        `  ${item.type.toUpperCase().padEnd(5)} ${c.cyan(item.name.padEnd(28))} ` +
          `${String(item.startupTokens).padStart(5)}t  (${item.sharePct}%)`,
      );
    }
    console.log('');
    return;
  }

  if (command === 'conflicts') {
    if (asJson) {
      console.log(JSON.stringify(report.conflicts, null, 2));
      return;
    }

    console.log(`\n${c.bold('Trigger Conflict Radar')} (${report.conflicts.length} pairs detected)\n`);
    if (report.conflicts.length === 0) {
      console.log(`  ${c.green('✓')} No overlapping trigger pairs above threshold.\n`);
      return;
    }

    for (const pair of report.conflicts) {
      const sev =
        pair.severity === 'high'
          ? c.red('HIGH')
          : pair.severity === 'medium'
            ? c.yellow('MED ')
            : c.dim('LOW ');
      const pct = `${Math.round(pair.similarity * 100)}%`;
      console.log(
        `  ${sev} ${c.bold(pct)}  ${c.cyan(pair.skillA.name)} ↔ ${c.cyan(pair.skillB.name)}`,
      );
      if (pair.sharedPhrases.length > 0) {
        console.log(`       Shared phrases : ${pair.sharedPhrases.join(', ')}`);
      }
      if (pair.sharedKeywords.length > 0) {
        console.log(`       Shared keywords: ${pair.sharedKeywords.join(', ')}`);
      }
      console.log(`       ${c.dim(pair.suggestion)}\n`);
    }
    return;
  }

  if (command === 'route') {
    const prompt = positionals.join(' ').trim();
    if (!prompt) {
      console.error(c.red('Error: Please provide a prompt string, e.g. skilldeck route --demo "Deploy Cloudflare Worker"'));
      process.exitCode = 1;
      return;
    }

    const result = simulatePromptRouting(prompt, report.skills, report.mcpServers);
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\n${c.bold('Prompt Routing Simulation')}`);
    console.log(`Prompt: ${c.cyan(`"${result.prompt}"`)}`);
    console.log(
      `Projected Context: ${result.baselineStartupTokens.toLocaleString()}t startup + ` +
        `${result.projectedActivatedTokens.toLocaleString()}t activated = ` +
        `${c.bold(result.totalProjectedTokens.toLocaleString())}t\n`,
    );

    if (result.ambiguous && result.ambiguityReason) {
      console.log(`  ${c.yellow('⚠ AMBIGUOUS ROUTING:')} ${result.ambiguityReason}\n`);
    }

    if (result.matches.length === 0) {
      console.log(`  ${c.dim('No matching skills triggered for this prompt.')}\n`);
      return;
    }

    for (const m of result.matches) {
      const scorePct = `${Math.round(m.score * 100)}%`.padStart(4);
      const badge = m.suppressedByNegative
        ? c.dim('SUPPRESSED')
        : m.confidence === 'high'
          ? c.green('ACTIVATE  ')
          : m.confidence === 'medium'
            ? c.yellow('CANDIDATE ')
            : c.dim('WEAK      ');
      console.log(`  ${badge} ${c.bold(scorePct)}  ${c.cyan(m.skillName.padEnd(28))} (+${m.bodyTokens}t body)`);
      if (m.matchedPhrases.length > 0 || m.matchedTerms.length > 0) {
        const hits = [...m.matchedPhrases.map((p) => `"${p}"`), ...m.matchedTerms].slice(0, 8);
        console.log(`             Matched: ${hits.join(', ')}`);
      }
      if (m.negativeHits.length > 0) {
        console.log(`             ${c.yellow(`Negative boundary hit: ${m.negativeHits.join(', ')}`)}`);
      }
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
      if (asJson) {
        console.log(JSON.stringify({ outDir, ...bundle }, null, 2));
      } else {
        console.log(
          `\n${c.green('✓')} Exported ${bundle.files.length} files for ${c.bold(target)} → ${c.cyan(outDir)} ` +
            `(${bundle.redactedSecretCount} secrets automatically redacted)\n`,
        );
      }
      return;
    }

    if (asJson) {
      console.log(JSON.stringify(bundle, null, 2));
    } else {
      console.log(
        `\n${c.bold(`Export Preview (${target})`)} — ${bundle.files.length} files ` +
          `(${bundle.redactedSecretCount} secrets redacted). Pass --out <dir> to write to disk:\n`,
      );
      for (const f of bundle.files) {
        console.log(`  • ${c.cyan(f.relativePath)} (${f.content.length} bytes)`);
      }
      console.log('');
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
