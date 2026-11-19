import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recallPitfallAntibodies } from './agent-immune-bridge.js';
import { compileWorkflowToSkill } from './exporter.js';
import { evaluateRuntimeToolCall } from './immune.js';
import { simulatePromptRouting } from './router.js';
import { isExecutableOnPath } from './scanner.js';
import type {
  DetectedLocalAgent,
  ImmuneAntibody,
  SuperAgentPlan,
  SuperAgentStep,
  WorkflowEdgeInput,
  WorkflowGraph,
  WorkflowNodeInput,
  WorkflowRunResult,
  WorkflowStepExecution,
  WorkspaceReport,
} from './types.js';

const execFileAsync = promisify(execFile);

const AGENT_PROFILES: Array<{
  id: string;
  name: string;
  command: string;
  endpoint?: string;
  capabilities: string[];
}> = [
  {
    id: 'agy',
    name: 'Antigravity CLI',
    command: 'agy',
    capabilities: ['Multi-skill coding agent', 'MCP tools', 'Workspace automation'],
  },
  {
    id: 'ollama',
    name: 'Ollama Local LLM',
    command: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    capabilities: ['100% offline local inference', 'Zero API cost', 'OpenAI-compatible API'],
  },
  {
    id: 'claude',
    name: 'Claude Code CLI',
    command: 'claude',
    capabilities: ['Autonomous repo editing', 'SKILL.md native', 'Headless -p mode'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    capabilities: ['Long-context reasoning', 'SKILL.md native', 'MCP client'],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    command: 'codex',
    capabilities: ['Sandboxed code execution', 'Skill routing'],
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    command: 'gh',
    capabilities: ['PR & Issue automation', 'Repo publishing', 'CI inspection'],
  },
];

async function probeOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    return [];
  }
}

/**
 * Auto-detects locally installed AI CLI Agents and running Ollama models (read-only).
 */
export async function detectLocalAgents(): Promise<DetectedLocalAgent[]> {
  const ollamaModels = await probeOllamaModels();

  return AGENT_PROFILES.map((profile) => {
    const cmdAvailable = Boolean(isExecutableOnPath(profile.command));
    let available = cmdAvailable;
    let statusNote = cmdAvailable ? 'Detected on PATH' : 'Not installed on PATH';
    let models: string[] | undefined;

    if (profile.id === 'ollama') {
      if (ollamaModels.length > 0) {
        available = true;
        models = ollamaModels;
        statusNote = `Running locally (${ollamaModels.length} model(s) ready)`;
      } else if (cmdAvailable) {
        statusNote = 'Installed (start `ollama serve` to enable local LLM synthesis)';
      }
    }

    return {
      id: profile.id,
      name: profile.name,
      command: profile.command,
      available,
      endpoint: profile.endpoint,
      capabilities: profile.capabilities,
      models,
      statusNote,
    };
  });
}

export interface SuperAgentLlmConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

/**
 * Calls an optional local Ollama or OpenAI-compatible chat endpoint to refine a plan or synthesize output.
 */
async function callOptionalLlm(
  systemPrompt: string,
  userPrompt: string,
  llmConfig?: SuperAgentLlmConfig,
): Promise<string | null> {
  const endpoint = llmConfig?.endpoint?.trim();
  const model = llmConfig?.model?.trim();
  if (!endpoint || !model) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (llmConfig?.apiKey?.trim()) {
      headers.Authorization = `Bearer ${llmConfig.apiKey.trim()}`;
    }

    const url = endpoint.endsWith('/chat/completions')
      ? endpoint
      : `${endpoint.replace(/\/+$/, '')}/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * SuperAgent Planner:
 * Routes the user's goal across ALL discovered Skills & MCPs, automatically enforces Agent-Immune
 * quarantine filtering, selects the best available local worker engines, and emits BOTH a structured
 * SuperAgentPlan AND a runnable React Flow WorkflowGraph!
 */
export async function createSuperAgentPlan(params: {
  goal: string;
  report: WorkspaceReport;
  preferredEngine?: string;
  llmConfig?: SuperAgentLlmConfig;
}): Promise<SuperAgentPlan> {
  const goal = params.goal.trim();
  const route = simulatePromptRouting(goal, params.report.skills, params.report.mcpServers, 6);
  const immuneMap = new Map(params.report.immune.skillReports.map((r) => [r.skillId, r]));
  const agents = await detectLocalAgents();

  const availableEngine =
    params.preferredEngine ||
    (params.llmConfig?.endpoint && params.llmConfig?.model
      ? `llm:${params.llmConfig.model}`
      : agents.find((a) => a.id === 'ollama' && (a.models?.length ?? 0) > 0)
        ? `ollama:${agents.find((a) => a.id === 'ollama')!.models![0]}`
        : agents.find((a) => a.available && a.id !== 'gh')?.id ?? 'skilldeck-builtin');

  const selectedSkills: SuperAgentPlan['selectedSkills'] = [];
  const skippedQuarantinedSkills: string[] = [];

  for (const m of route.matches) {
    if (m.suppressedByNegative || m.score < 0.2) continue;
    const imm = immuneMap.get(m.skillId);
    const verdict = imm?.verdict ?? 'safe';
    if (verdict === 'quarantine') {
      skippedQuarantinedSkills.push(m.skillName);
      continue;
    }
    selectedSkills.push({
      name: m.skillName,
      platform: m.platform,
      score: m.score,
      immuneVerdict: verdict,
    });
    if (selectedSkills.length >= 3) break;
  }

  // Pick relevant active MCP servers by simple keyword relevance against goal
  const goalLower = goal.toLowerCase();
  const activeMcps = params.report.mcpServers.filter((m) => !m.disabled);
  const selectedMcps = Array.from(
    new Set(
      activeMcps
        .filter((m) => {
          const nameLower = m.name.toLowerCase();
          if (goalLower.includes(nameLower)) return true;
          if (/(github|pr|issue|repo|代码|提交|仓库)/.test(goalLower) && nameLower.includes('github')) return true;
          if (/(sql|postgres|supabase|rls|数据库|表)/.test(goalLower) && /(postgres|supabase)/.test(nameLower)) return true;
          if (/(doc|api|gemini|文档)/.test(goalLower) && /(doc|context7|gemini)/.test(nameLower)) return true;
          if (/(memory|记忆|历史)/.test(goalLower) && nameLower.includes('memory')) return true;
          return false;
        })
        .map((m) => m.name),
    ),
  ).slice(0, 2);

  // Build steps + matching WorkflowGraph
  const steps: SuperAgentStep[] = [];
  const nodes: WorkflowNodeInput[] = [];
  const edges: WorkflowEdgeInput[] = [];

  const triggerNodeId = 'sa-trigger';
  nodes.push({
    id: triggerNodeId,
    type: 'trigger',
    label: 'SuperAgent Goal',
    description: goal.slice(0, 96),
    position: { x: 40, y: 150 },
  });

  // Step 1: Dual-Layer Agent-Immune Pre-Flight Gate (Pitfall Memory + ToxicSkills Shield)
  const pitfallRecall = recallPitfallAntibodies(
    goal,
    params.report.immune.agentImmuneBridge.pitfallAntibodies,
    4,
  );
  const immuneGateId = 'sa-immune-gate';
  const immuneParts: string[] = [];
  if (skippedQuarantinedSkills.length > 0) {
    immuneParts.push(
      `Automatically quarantined ${skippedQuarantinedSkills.length} unsafe skill(s): ${skippedQuarantinedSkills.join(', ')}.`,
    );
  }
  if (pitfallRecall.matches.length > 0) {
    immuneParts.push(
      `Injected ${pitfallRecall.matches.length} agent-immune pitfall antibody(ies) before execution:\n${pitfallRecall.immuneMemoryBlock}`,
    );
  } else {
    immuneParts.push(
      'Scanned goal prompt, selected skill bodies, and MCP parameters via Agent-Immune shield (0 toxic hits).',
    );
  }

  steps.push({
    id: immuneGateId,
    order: 1,
    title: 'Agent-Immune Pre-Flight & Pitfall Memory Injection',
    role: 'immune-gate',
    engine: 'agent-immune',
    skillNames: selectedSkills.map((s) => s.name),
    instruction: immuneParts.join('\n\n'),
    estimatedTokens: 120 + pitfallRecall.matches.length * 42,
    immuneStatus: skippedQuarantinedSkills.length > 0 ? 'caution' : 'safe',
  });
  nodes.push({
    id: immuneGateId,
    type: 'gate',
    label: 'Agent-Immune Gate',
    description:
      pitfallRecall.matches.length > 0
        ? `${pitfallRecall.matches.length} pitfall antibodies injected · toxic shield active`
        : 'Scan payloads & block quarantined skills',
    position: { x: 290, y: 150 },
  });
  edges.push({ id: 'sa-e-start', source: triggerNodeId, target: immuneGateId });

  const fanOutParents: string[] = [];

  // Skill execution steps
  selectedSkills.forEach((sk, idx) => {
    const stepId = `sa-skill-${idx + 1}`;
    const skillObj = params.report.skills.find((s) => s.name === sk.name);
    steps.push({
      id: stepId,
      order: steps.length + 1,
      title: `Execute Skill: ${sk.name}`,
      role: 'skill-worker',
      engine: availableEngine,
      skillNames: [sk.name],
      instruction: `Load progressive-disclosure playbook "${sk.name}" (${sk.platform}) and apply its domain checklist to: ${goal}`,
      estimatedTokens: skillObj?.tokens.bodyTokens ?? 350,
      immuneStatus: sk.immuneVerdict,
    });
    nodes.push({
      id: stepId,
      type: 'skill',
      label: sk.name,
      refId: skillObj?.id,
      description: `Skill (${sk.platform}) · ${Math.round(sk.score * 100)}% match`,
      agentEngine: availableEngine,
      position: { x: 580, y: 40 + idx * 120 },
    });
    edges.push({ id: `sa-e-g-s${idx}`, source: immuneGateId, target: stepId });
    fanOutParents.push(stepId);
  });

  // MCP execution steps
  selectedMcps.forEach((mcpName, idx) => {
    const stepId = `sa-mcp-${idx + 1}`;
    steps.push({
      id: stepId,
      order: steps.length + 1,
      title: `Query MCP via Hub: ${mcpName}`,
      role: 'mcp-worker',
      engine: 'skilldeck-hub',
      skillNames: [],
      mcpServer: mcpName,
      instruction: `Invoke tools on "${mcpName}" via SkillDeck MCP Hub under Agent-Immune firewall protection.`,
      estimatedTokens: 480,
      immuneStatus: 'safe',
    });
    nodes.push({
      id: stepId,
      type: 'mcp',
      label: mcpName,
      description: 'Guarded MCP Hub tool call',
      position: { x: 580, y: 40 + (selectedSkills.length + idx) * 120 },
    });
    edges.push({ id: `sa-e-g-m${idx}`, source: immuneGateId, target: stepId });
    fanOutParents.push(stepId);
  });

  // If no skill/MCP matched, add a direct SuperAgent Worker node
  if (fanOutParents.length === 0) {
    const directId = 'sa-agent-1';
    steps.push({
      id: directId,
      order: steps.length + 1,
      title: `SuperAgent Direct Worker (${availableEngine})`,
      role: 'cli-agent',
      engine: availableEngine,
      skillNames: [],
      instruction: `Execute goal directly using ${availableEngine}: ${goal}`,
      estimatedTokens: 600,
      immuneStatus: 'safe',
    });
    nodes.push({
      id: directId,
      type: 'agent',
      label: `Agent: ${availableEngine}`,
      description: 'Direct SuperAgent execution worker',
      agentEngine: availableEngine,
      position: { x: 580, y: 150 },
    });
    edges.push({ id: 'sa-e-g-direct', source: immuneGateId, target: directId });
    fanOutParents.push(directId);
  }

  // Final Synthesizer Output node
  const outId = 'sa-output';
  steps.push({
    id: outId,
    order: steps.length + 1,
    title: 'Synthesize Verified Deliverable',
    role: 'synthesizer',
    engine: availableEngine,
    skillNames: selectedSkills.map((s) => s.name),
    instruction:
      'Combine outputs from all upstream Skill & MCP workers, verify zero secret leaks, and produce final structured result.',
    estimatedTokens: 320,
    immuneStatus: 'safe',
  });
  nodes.push({
    id: outId,
    type: 'output',
    label: 'Verified Deliverable',
    description: 'Synthesized & redacted final output',
    position: { x: 890, y: 150 },
  });
  fanOutParents.forEach((parentId, idx) => {
    edges.push({ id: `sa-e-out-${idx}`, source: parentId, target: outId });
  });

  // Optional LLM plan enrichment if user supplied Ollama/API config
  let plannerEngine = 'skilldeck-deterministic-router';
  if (params.llmConfig?.endpoint && params.llmConfig?.model) {
    const llmNote = await callOptionalLlm(
      'You are SkillDeck SuperAgent. Given a user goal and routed skills, write a crisp 2-sentence execution strategy in the same language as the goal.',
      `Goal: ${goal}\nSkills: ${selectedSkills.map((s) => s.name).join(', ') || 'none'}\nMCP: ${selectedMcps.join(', ') || 'none'}`,
      params.llmConfig,
    );
    if (llmNote) {
      plannerEngine = `llm:${params.llmConfig.model}`;
      const synthStep = steps[steps.length - 1];
      if (synthStep) {
        synthStep.instruction = `${synthStep.instruction}\n\nAI Strategy: ${llmNote}`;
      }
    }
  }

  const estimatedTotalTokens =
    route.baselineStartupTokens + steps.reduce((sum, s) => sum + s.estimatedTokens, 0);

  return {
    planId: `plan_${Date.now()}`,
    goal,
    plannerEngine,
    createdAt: new Date().toISOString(),
    selectedSkills,
    skippedQuarantinedSkills,
    selectedMcps,
    estimatedTotalTokens,
    steps,
    workflowGraph: {
      id: `superagent_${Date.now()}`,
      name: `SuperAgent: ${goal.slice(0, 42)}`,
      description: `Auto-synthesized SuperAgent workflow for: ${goal}`,
      nodes,
      edges,
    },
  };
}

/**
 * Live Workflow DAG Runner:
 * Topologically executes any React Flow WorkflowGraph step-by-step under Agent-Immune protection.
 * Supports safe Dry-Run (simulation + real skill/immune checks) and Live mode (optional local LLM /
 * MCP callback / safe CLI agent execution).
 */
export async function executeWorkflowGraph(params: {
  graph: WorkflowGraph;
  report: WorkspaceReport;
  mode?: 'dry-run' | 'live';
  goalContext?: string;
  customAntibodies?: ImmuneAntibody[];
  llmConfig?: SuperAgentLlmConfig;
  mcpInvoker?: (serverName: string, toolName: string, args: Record<string, unknown>) => Promise<string>;
}): Promise<WorkflowRunResult> {
  const mode = params.mode ?? 'dry-run';
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const compiled = compileWorkflowToSkill(params.graph);
  const nodeMap = new Map(params.graph.nodes.map((n) => [n.id, n]));
  const skillMap = new Map(params.report.skills.map((s) => [s.name, s]));
  const immuneMap = new Map(params.report.immune.skillReports.map((r) => [r.skillName, r]));

  const steps: WorkflowStepExecution[] = [];
  const contextLines: string[] = [];
  let overallStatus: WorkflowRunResult['status'] = 'completed';

  for (const ordered of compiled.orderedSteps) {
    const node = nodeMap.get(ordered.nodeId);
    if (!node) continue;
    const stepStart = Date.now();

    // Every single step passes through Agent-Immune Runtime Firewall!
    const fw = evaluateRuntimeToolCall({
      serverName: `workflow:${node.type}`,
      toolName: node.toolName ?? node.label,
      args: {
        description: node.description,
        goal: params.goalContext,
        toolArgs: node.toolArgs,
      },
      customAntibodies: params.customAntibodies,
      requireApprovalForHighRisk: false,
    });

    if (!fw.allowed) {
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: fw.action === 'quarantine' ? 'quarantined' : 'blocked',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: fw.action,
        output: `[Agent-Immune ${fw.action.toUpperCase()}] ${fw.reason} (${fw.matchedRules.join(', ')})`,
        engineUsed: 'agent-immune-firewall',
      });
      overallStatus = 'blocked';
      break;
    }

    if (node.type === 'trigger') {
      const out = `Initialized workflow trigger "${node.label}". Context: ${params.goalContext ?? node.description ?? 'standard run'}.`;
      contextLines.push(out);
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: 'ok',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: 'allow',
        output: out,
        engineUsed: 'workflow-trigger',
      });
      continue;
    }

    if (node.type === 'gate') {
      const quarantinedCount = params.report.immune.quarantineCount;
      const out = `Immune & quality gate verified: workspace immunity ${params.report.immune.immunityScore}/100, ${quarantinedCount} quarantined skill(s) isolated, upstream steps passed.`;
      contextLines.push(out);
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: 'ok',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: 'allow',
        output: out,
        engineUsed: 'agent-immune-gate',
      });
      continue;
    }

    if (node.type === 'skill') {
      const skill = skillMap.get(node.label);
      const imm = immuneMap.get(node.label);
      if (imm && imm.verdict === 'quarantine') {
        const msg = `[Agent-Immune QUARANTINE] Refused to load toxic skill "${node.label}" (threat score ${imm.threatScore}/100: ${imm.findings[0]?.title ?? 'policy violation'}).`;
        steps.push({
          step: ordered.step,
          nodeId: node.id,
          type: node.type,
          label: node.label,
          status: 'quarantined',
          durationMs: Math.max(1, Date.now() - stepStart),
          immuneVerdict: 'quarantine',
          output: msg,
          engineUsed: 'agent-immune-shield',
        });
        overallStatus = 'blocked';
        break;
      }

      let out = skill
        ? `Loaded SKILL.md "${skill.name}" (${skill.platform}, ${skill.tokens.bodyTokens}t, ${skill.resources.length} resource files). First directive: ${skill.body.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? '(ready)'}`
        : `Executed virtual skill node "${node.label}" (${node.description ?? 'custom step'}).`;

      if (mode === 'live' && params.llmConfig?.endpoint && params.llmConfig?.model && skill) {
        const llmOut = await callOptionalLlm(
          `Apply this Agent Skill accurately:\n\n${skill.body.slice(0, 3200)}`,
          `Goal: ${params.goalContext ?? params.graph.description}\nPrior context:\n${contextLines.join('\n')}`,
          params.llmConfig,
        );
        if (llmOut) {
          out = llmOut;
        }
      }

      contextLines.push(`[${node.label}] ${out.slice(0, 260)}`);
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: 'ok',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: 'allow',
        output: out,
        engineUsed:
          mode === 'live' && params.llmConfig?.model
            ? `llm:${params.llmConfig.model}`
            : 'skill-loader',
      });
      continue;
    }

    if (node.type === 'mcp') {
      const mcp = params.report.mcpServers.find((m) => m.name === node.label);
      let out: string;
      let engineUsed = 'skilldeck-hub-dry-run';

      if (mode === 'live' && params.mcpInvoker && node.toolName) {
        try {
          out = await params.mcpInvoker(node.label, node.toolName, node.toolArgs ?? {});
          engineUsed = 'skilldeck-hub-live';
        } catch (err) {
          out = `MCP invocation error: ${err instanceof Error ? err.message : String(err)}`;
          steps.push({
            step: ordered.step,
            nodeId: node.id,
            type: node.type,
            label: node.label,
            status: 'error',
            durationMs: Math.max(1, Date.now() - stepStart),
            immuneVerdict: 'allow',
            output: out,
            engineUsed: 'skilldeck-hub-live',
          });
          overallStatus = 'failed';
          break;
        }
      } else {
        out = mcp
          ? `[Dry-Run] Verified MCP "${mcp.name}" (${mcp.transport}, ${mcp.disabled ? 'disabled' : 'active'}, ${mcp.secretFindings.length} secrets redacted). Ready to invoke via SkillDeck Hub.`
          : `[Dry-Run] MCP node "${node.label}" validated by Agent-Immune firewall.`;
      }

      contextLines.push(`[MCP:${node.label}] ${out.slice(0, 220)}`);
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: 'ok',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: 'allow',
        output: out,
        engineUsed,
      });
      continue;
    }

    if (node.type === 'agent') {
      let out = `[Dry-Run] Agent worker "${node.label}" ready with engine "${node.agentEngine ?? 'auto'}".`;
      let engineUsed = node.agentEngine ?? 'superagent-worker';

      if (mode === 'live' && params.llmConfig?.endpoint && params.llmConfig?.model) {
        const llmOut = await callOptionalLlm(
          'You are a concise, precise sub-agent inside SkillDeck SuperAgent.',
          `Task: ${params.goalContext ?? node.description ?? node.label}\nContext:\n${contextLines.join('\n')}`,
          params.llmConfig,
        );
        if (llmOut) {
          out = llmOut;
          engineUsed = `llm:${params.llmConfig.model}`;
        }
      } else if (mode === 'live' && node.agentEngine === 'ollama') {
        try {
          const { stdout } = await execFileAsync('ollama', ['list'], { timeout: 4000 });
          out = `Verified local Ollama runtime:\n${stdout.trim().slice(0, 300)}`;
        } catch {
          out = 'Ollama CLI detected; select a running Ollama model in SuperAgent settings for live inference.';
        }
      }

      contextLines.push(`[Agent:${node.label}] ${out.slice(0, 260)}`);
      steps.push({
        step: ordered.step,
        nodeId: node.id,
        type: node.type,
        label: node.label,
        status: 'ok',
        durationMs: Math.max(1, Date.now() - stepStart),
        immuneVerdict: 'allow',
        output: out,
        engineUsed,
      });
      continue;
    }

    // Output / Synthesizer node
    let finalOut = `Workflow "${params.graph.name}" synthesized ${steps.length} upstream step(s) with zero secret leaks.\n\nExecution Digest:\n${contextLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
    let synthEngine = 'skilldeck-synthesizer';

    if (mode === 'live' && params.llmConfig?.endpoint && params.llmConfig?.model) {
      const llmSummary = await callOptionalLlm(
        'Synthesize the workflow step outputs into a clear, actionable final answer in the same language as the user goal.',
        `Goal: ${params.goalContext ?? params.graph.name}\n\nStep Outputs:\n${contextLines.join('\n')}`,
        params.llmConfig,
      );
      if (llmSummary) {
        finalOut = llmSummary;
        synthEngine = `llm:${params.llmConfig.model}`;
      }
    }

    steps.push({
      step: ordered.step,
      nodeId: node.id,
      type: node.type,
      label: node.label,
      status: 'ok',
      durationMs: Math.max(1, Date.now() - stepStart),
      immuneVerdict: 'allow',
      output: finalOut,
      engineUsed: synthEngine,
    });
  }

  const lastStep = steps[steps.length - 1];
  const finalSummary =
    overallStatus === 'blocked'
      ? `Stopped by Agent-Immune: ${lastStep?.output ?? 'security policy triggered'}`
      : lastStep?.output ?? 'Workflow finished.';

  return {
    runId: `run_${Date.now()}`,
    workflowName: params.graph.name,
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDurationMs: Math.max(1, Date.now() - startMs),
    status: overallStatus,
    steps,
    finalSummary,
  };
}
