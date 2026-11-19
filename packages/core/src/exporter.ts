import { stringify as stringifyYaml } from 'yaml';
import { estimateTokens } from './tokens.js';
import type {
  CompiledWorkflowResult,
  ExportBundleResult,
  ExportTarget,
  ExportedFile,
  McpServerRecord,
  SkillRecord,
  WorkflowGraph,
} from './types.js';

function slugify(input: string): string {
  const clean = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return clean || 'custom-workflow';
}

function renderSkillMarkdown(skill: SkillRecord): string {
  const fm: Record<string, unknown> = {
    name: skill.name,
    description: skill.description || `Portable skill exported by SkillDeck (${skill.name}).`,
  };
  if (skill.frontmatter.license) fm.license = skill.frontmatter.license;
  if (skill.frontmatter.compatibility) fm.compatibility = skill.frontmatter.compatibility;
  if (skill.frontmatter['allowed-tools']) fm['allowed-tools'] = skill.frontmatter['allowed-tools'];
  if (skill.frontmatter.metadata) fm.metadata = skill.frontmatter.metadata;

  return `---\n${stringifyYaml(fm).trim()}\n---\n\n${skill.body.trim()}\n`;
}

function renderCursorMdc(skill: SkillRecord): string {
  const fm: Record<string, unknown> = {
    description: skill.description || skill.name,
    alwaysApply: Boolean(skill.frontmatter.alwaysApply ?? false),
  };
  if (skill.frontmatter.globs) {
    fm.globs = skill.frontmatter.globs;
  }
  return `---\n${stringifyYaml(fm).trim()}\n---\n\n# ${skill.name}\n\n${skill.body.trim()}\n`;
}

function buildSanitizedMcpMap(mcpServers: McpServerRecord[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const server of mcpServers) {
    const entry: Record<string, unknown> = {};
    if (server.command) entry.command = server.command;
    if (server.redactedArgs.length > 0) entry.args = server.redactedArgs;
    if (server.url) entry.url = server.url;
    if (Object.keys(server.redactedEnv).length > 0) {
      // Turn redacted entries into safe placeholder env references for portability
      const safeEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(server.redactedEnv)) {
        safeEnv[key] = val.startsWith('[REDACTED:') ? `\${${key}}` : val;
      }
      entry.env = safeEnv;
    }
    if (server.disabled) entry.disabled = true;
    map[server.name] = entry;
  }
  return map;
}

/**
 * Exports a curated selection of skills and redacted MCP configs to a target agent format.
 * Secrets are ALWAYS stripped/placeholderized before export.
 */
export function exportBundle(
  target: ExportTarget,
  skills: SkillRecord[],
  mcpServers: McpServerRecord[],
): ExportBundleResult {
  const files: ExportedFile[] = [];
  const mcpMap = buildSanitizedMcpMap(mcpServers);
  const redactedSecretCount = mcpServers.reduce((sum, m) => sum + m.secretFindings.length, 0);
  const generatedAt = new Date().toISOString();

  if (target === 'claude-code') {
    for (const skill of skills) {
      const slug = slugify(skill.name);
      files.push({
        relativePath: `.claude/skills/${slug}/SKILL.md`,
        content: renderSkillMarkdown(skill),
      });
    }
    if (mcpServers.length > 0) {
      files.push({
        relativePath: '.mcp.json',
        content: `${JSON.stringify({ mcpServers: mcpMap }, null, 2)}\n`,
      });
    }
  } else if (target === 'cursor') {
    for (const skill of skills) {
      const slug = slugify(skill.name);
      files.push({
        relativePath: `.cursor/rules/${slug}.mdc`,
        content: renderCursorMdc(skill),
      });
    }
    if (mcpServers.length > 0) {
      files.push({
        relativePath: '.cursor/mcp.json',
        content: `${JSON.stringify({ mcpServers: mcpMap }, null, 2)}\n`,
      });
    }
  } else if (target === 'gemini-cli') {
    for (const skill of skills) {
      const slug = slugify(skill.name);
      files.push({
        relativePath: `.gemini/skills/${slug}/SKILL.md`,
        content: renderSkillMarkdown(skill),
      });
    }
    if (mcpServers.length > 0) {
      files.push({
        relativePath: '.gemini/settings.json',
        content: `${JSON.stringify({ mcpServers: mcpMap }, null, 2)}\n`,
      });
    }
  } else if (target === 'antigravity') {
    const manifest = {
      name: 'skilldeck-exported-plugin',
      version: '0.1.0',
      description: 'Portable Agent Skills & MCP bundle exported by SkillDeck.',
      skills: skills.map((s) => `skills/${slugify(s.name)}/SKILL.md`),
      mcpConfig: mcpServers.length > 0 ? 'mcp.json' : undefined,
    };
    files.push({
      relativePath: 'plugin.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    });
    for (const skill of skills) {
      const slug = slugify(skill.name);
      files.push({
        relativePath: `skills/${slug}/SKILL.md`,
        content: renderSkillMarkdown(skill),
      });
    }
    if (mcpServers.length > 0) {
      files.push({
        relativePath: 'mcp.json',
        content: `${JSON.stringify({ mcpServers: mcpMap }, null, 2)}\n`,
      });
    }
  } else {
    // portable-json
    const payload = {
      schema: 'skilldeck.bundle.v1',
      generatedAt,
      redactedSecretCount,
      skills: skills.map((s) => ({
        name: s.name,
        platform: s.platform,
        description: s.description,
        contentHash: s.contentHash,
        frontmatter: s.frontmatter,
        body: s.body,
      })),
      mcpServers: mcpMap,
    };
    files.push({
      relativePath: 'skilldeck-bundle.json',
      content: `${JSON.stringify(payload, null, 2)}\n`,
    });
  }

  return {
    target,
    generatedAt,
    skillCount: skills.length,
    mcpCount: mcpServers.length,
    redactedSecretCount,
    files,
  };
}

/**
 * Compiles a visual Workflow DAG into a topologically ordered Orchestrator SKILL.md
 * ready to drop into any Agent Skills-compatible runtime.
 */
export function compileWorkflowToSkill(graph: WorkflowGraph): CompiledWorkflowResult {
  const slug = slugify(graph.name || graph.id);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const depsMap = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    depsMap.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    depsMap.get(edge.target)?.push(edge.source);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn's topological sort
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    orderedIds.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) {
        queue.push(next);
      }
    }
  }

  const hasCycle = orderedIds.length < graph.nodes.length;
  // Append any cycle members deterministically so output stays inspectable
  for (const node of graph.nodes) {
    if (!orderedIds.includes(node.id)) {
      orderedIds.push(node.id);
    }
  }

  const orderedSteps = orderedIds.map((id, idx) => {
    const node = nodeMap.get(id)!;
    return {
      step: idx + 1,
      nodeId: node.id,
      type: node.type,
      label: node.label,
      refId: node.refId,
      dependsOn: (depsMap.get(id) ?? []).map((depId) => nodeMap.get(depId)?.label ?? depId),
    };
  });

  const skillNodes = orderedSteps.filter((s) => s.type === 'skill');
  const mcpNodes = orderedSteps.filter((s) => s.type === 'mcp');

  const frontmatter = stringifyYaml({
    name: slug,
    description:
      graph.description?.trim() ||
      `Orchestrates the "${graph.name}" multi-step agent workflow across ${skillNodes.length} skills and ${mcpNodes.length} MCP servers. Use when executing this end-to-end pipeline.`,
    metadata: {
      generator: 'skilldeck-workflow-compiler',
      workflowId: graph.id,
    },
  }).trim();

  const lines: string[] = [
    '---',
    frontmatter,
    '---',
    '',
    `# ${graph.name}`,
    '',
    graph.description?.trim() || 'Compiled multi-stage agent workflow generated by SkillDeck.',
    '',
  ];

  if (hasCycle) {
    lines.push(
      '> **Warning**: A dependency cycle was detected in the visual graph. Review step ordering before running in production.',
      '',
    );
  }

  if (mcpNodes.length > 0) {
    lines.push('## Required MCP Servers', '');
    for (const m of mcpNodes) {
      lines.push(`- \`${m.label}\`${m.refId ? ` (ref: \`${m.refId}\`)` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Execution Pipeline', '');
  for (const step of orderedSteps) {
    const node = nodeMap.get(step.nodeId);
    const badge = step.type.toUpperCase();
    const depText = step.dependsOn.length > 0 ? ` — *after: ${step.dependsOn.join(', ')}*` : '';
    lines.push(`${step.step}. **[${badge}] ${step.label}**${depText}`);
    if (node?.description) {
      lines.push(`   - ${node.description}`);
    }
    if (step.type === 'skill') {
      lines.push(`   - Load and follow the \`${step.label}\` skill instructions before moving to the next stage.`);
    } else if (step.type === 'mcp') {
      lines.push(`   - Query or mutate external state via the \`${step.label}\` MCP server tools.`);
    } else if (step.type === 'gate') {
      lines.push('   - Pause and verify assertions or request explicit user confirmation before continuing.');
    }
  }

  lines.push(
    '',
    '## Handoff & Verification',
    '',
    '- Verify every upstream gate passed before producing the final artifact.',
    '- Never include raw credentials or unredacted secrets in final workflow outputs.',
    '',
  );

  const orchestratorSkillMd = lines.join('\n');

  return {
    slug,
    orderedSteps,
    hasCycle,
    estimatedTokens: estimateTokens(orchestratorSkillMd),
    orchestratorSkillMd,
  };
}
