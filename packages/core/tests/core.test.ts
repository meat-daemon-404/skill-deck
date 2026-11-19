import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeWorkspace,
  compileWorkflowToSkill,
  detectSecretInValue,
  estimateTokens,
  exportBundle,
  parseSkillMarkdown,
  redactMcpEnvironment,
  simulatePromptRouting,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_WORKSPACE = path.resolve(__dirname, '../../../examples/demo-workspace');

describe('@skilldeck/core — token estimator & frontmatter parser', () => {
  it('estimates English and Chinese tokens sensibly', () => {
    expect(estimateTokens('')).toBe(0);
    const enTokens = estimateTokens('Deploy a Cloudflare Worker with Wrangler bindings.');
    const zhTokens = estimateTokens('帮我把这集漫剧剧本拆成分镜表并生成首帧提示词。');
    expect(enTokens).toBeGreaterThan(6);
    expect(enTokens).toBeLessThan(30);
    expect(zhTokens).toBeGreaterThan(10);
    expect(zhTokens).toBeLessThan(35);
  });

  it('extracts frontmatter, bilingual triggers, negative boundaries, and relative links while skipping code blocks', () => {
    const sample = `---
name: sample-skill
description: "Build React tables. Trigger on: 'data table', 'sticky header'. Do NOT use for SQL migrations."
---

# Sample

Read [Guide](./references/guide.md) and visit [External](https://example.com).

\`\`\`md
[IgnoredLink](./does-not-exist-in-code.md)
\`\`\`
`;

    const parsed = parseSkillMarkdown(sample);
    expect(parsed.frontmatterValid).toBe(true);
    expect(parsed.frontmatter.name).toBe('sample-skill');
    expect(parsed.triggerPhrases).toContain('data table');
    expect(parsed.triggerPhrases).toContain('sticky header');
    expect(parsed.negativeTriggers.some((n) => n.toLowerCase().includes('sql migrations'))).toBe(true);
    expect(parsed.localLinks).toEqual(['./references/guide.md']);
  });
});

describe('@skilldeck/core — secret scanner & redactor', () => {
  it('detects literal API keys while allowing safe env var placeholders', () => {
    expect(detectSecretInValue('${OPENAI_API_KEY}', 'OPENAI_API_KEY').matched).toBe(false);
    expect(detectSecretInValue('$GITHUB_TOKEN', 'GITHUB_TOKEN').matched).toBe(false);
    expect(
      detectSecretInValue('sk-demo-9876543210abcdefghijklmnop', 'OPENAI_API_KEY').matched,
    ).toBe(true);
    expect(
      detectSecretInValue('postgresql://user:superSecret99@localhost:5432/db').matched,
    ).toBe(true);
  });

  it('redacts detected secrets out of MCP env maps', () => {
    const { redactedEnv, findings } = redactMcpEnvironment({
      SAFE_REF: '${API_KEY}',
      OPENAI_API_KEY: 'sk-demo-9876543210abcdefghijklmnop',
    });
    expect(findings).toHaveLength(1);
    expect(redactedEnv.SAFE_REF).toBe('${API_KEY}');
    expect(redactedEnv.OPENAI_API_KEY).toMatch(/^\[REDACTED:/);
    expect(redactedEnv.OPENAI_API_KEY).not.toContain('9876543210');
  });
});

describe('@skilldeck/core — demo workspace end-to-end analysis', () => {
  const report = analyzeWorkspace({
    mode: 'demo',
    paths: [DEMO_WORKSPACE],
  });

  it('discovers all demo skills and MCP servers across platforms', () => {
    expect(report.skills.length).toBe(8);
    expect(report.mcpServers.length).toBe(8);
    expect(report.budget.totalAlwaysOnTokens).toBeGreaterThan(0);
    expect(report.summary.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.healthScore).toBeLessThan(100);
  });

  it('detects both English and Chinese high-severity trigger conflicts', () => {
    const cfConflict = report.conflicts.find(
      (c) =>
        [c.skillA.name, c.skillB.name].includes('cloudflare-workers-deploy') &&
        [c.skillA.name, c.skillB.name].includes('cloudflare-edge-deploy'),
    );
    expect(cfConflict).toBeDefined();
    expect(cfConflict?.severity).toBe('high');

    const zhConflict = report.conflicts.find(
      (c) =>
        [c.skillA.name, c.skillB.name].includes('short-drama-storyboard-zh') &&
        [c.skillA.name, c.skillB.name].includes('short-drama-director-zh'),
    );
    expect(zhConflict).toBeDefined();
    expect(zhConflict?.sharedPhrases.length).toBeGreaterThanOrEqual(2);
  });

  it('flags spec violations, bloat, broken links, secrets, duplicates, and missing binaries', () => {
    const ruleIds = new Set(report.issues.map((i) => i.ruleId));
    expect(ruleIds.has('SD003')).toBe(true); // LegacyAudit_V1 naming violation
    expect(ruleIds.has('SD004')).toBe(true); // directory mismatch
    expect(ruleIds.has('SD006')).toBe(true); // >1024 char description
    expect(ruleIds.has('SD009')).toBe(true); // missing ./references/missing-playbook.md
    expect(ruleIds.has('SD101')).toBe(true); // hardcoded secret in postgres-analytics
    expect(ruleIds.has('SD102')).toBe(true); // duplicate github MCP server
    expect(ruleIds.has('SD103')).toBe(true); // nonexistent-mcp-bin missing on PATH
  });

  it('simulates bilingual prompt routing and respects negative boundaries', () => {
    const cfRoute = simulatePromptRouting(
      'Deploy a Cloudflare Worker with wrangler.toml and R2 bindings',
      report.skills,
      report.mcpServers,
    );
    expect(cfRoute.matches.length).toBeGreaterThanOrEqual(2);
    expect(cfRoute.ambiguous).toBe(true);

    const zhRoute = simulatePromptRouting(
      '帮我拆分镜，生成分镜表和首帧提示词',
      report.skills,
      report.mcpServers,
    );
    expect(zhRoute.matches[0]?.skillName).toMatch(/short-drama/);

    // SQL migrations prompt should trigger postgres-schema-guardian, NOT react-ui-accessibility
    const sqlRoute = simulatePromptRouting(
      'Write PostgreSQL SQL migrations and RLS policies for tenant tables',
      report.skills,
      report.mcpServers,
    );
    expect(sqlRoute.matches[0]?.skillName).toBe('postgres-schema-guardian');
    const reactMatch = sqlRoute.matches.find((m) => m.skillName === 'react-ui-accessibility');
    if (reactMatch) {
      expect(reactMatch.negativeHits.length).toBeGreaterThan(0);
    }
  });

  it('exports cross-platform bundles without leaking any raw secrets', () => {
    const targets = [
      'claude-code',
      'cursor',
      'gemini-cli',
      'antigravity',
      'portable-json',
    ] as const;

    for (const target of targets) {
      const bundle = exportBundle(target, report.skills, report.mcpServers);
      expect(bundle.files.length).toBeGreaterThan(0);
      expect(bundle.redactedSecretCount).toBeGreaterThanOrEqual(2);
      const allContent = bundle.files.map((f) => f.content).join('\n');
      expect(allContent).not.toContain('sk-demo-9876543210abcdefghijklmnop');
      expect(allContent).not.toContain('demoPass99');
    }
  });

  it('compiles a visual workflow DAG in topological order and detects cycles', () => {
    const acyclic = compileWorkflowToSkill({
      id: 'release-flow',
      name: 'Release Flow',
      description: 'Test pipeline',
      nodes: [
        { id: 'c', type: 'output', label: 'Ship' },
        { id: 'a', type: 'trigger', label: 'Start' },
        { id: 'b', type: 'skill', label: 'postgres-schema-guardian' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    });

    expect(acyclic.hasCycle).toBe(false);
    expect(acyclic.orderedSteps.map((s) => s.nodeId)).toEqual(['a', 'b', 'c']);
    expect(acyclic.orchestratorSkillMd).toContain('name: release-flow');

    const cyclic = compileWorkflowToSkill({
      id: 'loop-flow',
      name: 'Loop Flow',
      description: 'Cycle test',
      nodes: [
        { id: 'x', type: 'skill', label: 'Step X' },
        { id: 'y', type: 'skill', label: 'Step Y' },
      ],
      edges: [
        { id: 'e1', source: 'x', target: 'y' },
        { id: 'e2', source: 'y', target: 'x' },
      ],
    });

    expect(cyclic.hasCycle).toBe(true);
    expect(cyclic.orchestratorSkillMd).toContain('dependency cycle');
  });
});
