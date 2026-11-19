import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeWorkspaceAsync,
  detectLocalAgents,
  distillAndPersistPitfallAntibody,
  evaluateRuntimeToolCall,
  getBuiltinAntibodies,
  recallPitfallAntibodies,
  scanContentForThreats,
  simulatePromptRouting,
  synthesizeAntibody,
  type HubTraceEvent,
  type ImmuneAntibody,
  type QuarantineItem,
  type RuntimeCallWindowItem,
  type ScanOptions,
  type WorkspaceReport,
} from '@skilldeck/core';
import {
  invokeDownstreamMcpTool,
  pingDownstreamMcp,
  type DownstreamPingResult,
} from './mcp-client.js';

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

export interface HubMetaToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const HUB_META_TOOLS: HubMetaToolDefinition[] = [
  {
    name: 'skilldeck_search_tools',
    description:
      'Bilingual semantic search across all local Agent Skills (Antigravity, Claude Code, Cursor, Codex, DSH, ZCode) and connected MCP servers. Call this first to find the exact skill or tool needed without loading bloated schemas.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Task description or keywords in English or Chinese.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'skilldeck_load_skill',
    description:
      'Load a discovered SKILL.md playbook on demand (progressive disclosure). Automatically guarded by Agent-Immune ToxicSkills shield.',
    inputSchema: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'Exact name of the skill to load.' },
      },
      required: ['skillName'],
    },
  },
  {
    name: 'skilldeck_recall_immune',
    description:
      'Recall verified pitfall antibodies (trigger -> avoid -> do) from local agent-immune SQLite/JSONL memory and return a delimiter-sanitized <immune_memory> block before executing risky actions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Current command, library, or task context.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'skilldeck_record_pitfall',
    description:
      'Distill a failed-then-fixed tool call into a reusable agent-immune pitfall antibody (trigger -> avoid -> do) persisted to .immune/rules.jsonl.',
    inputSchema: {
      type: 'object',
      properties: {
        trigger_pattern: { type: 'string', description: 'Comma-separated keywords/commands where the pitfall occurs.' },
        symptom: { type: 'string', description: 'The mistake or error to avoid.' },
        prescription: { type: 'string', description: 'The verified fix to apply instead.' },
        tool_name: { type: 'string', description: 'Originating tool name (e.g. Bash, Edit, SQL).' },
      },
      required: ['trigger_pattern', 'symptom', 'prescription'],
    },
  },
  {
    name: 'skilldeck_call_tool',
    description:
      'Invoke a tool on any downstream MCP server discovered on this machine, routed through the Agent-Immune runtime firewall (loop circuit breaker, injection scan, and secret shield).',
    inputSchema: {
      type: 'object',
      properties: {
        serverName: { type: 'string', description: 'Name of the downstream MCP server.' },
        toolName: { type: 'string', description: 'Tool name exposed by that MCP server.' },
        arguments: { type: 'object', description: 'Tool arguments object.' },
        dryRun: { type: 'boolean', description: 'When true, evaluates firewall & config without executing.' },
      },
      required: ['serverName', 'toolName'],
    },
  },
  {
    name: 'skilldeck_workspace_health',
    description:
      'Return live SkillDeck telemetry: startup token budget, trigger conflicts, spec lint errors, and Agent-Immune posture.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'skilldeck_list_agents',
    description:
      'Detect locally installed AI CLI agents (Antigravity agy, Ollama local models, Claude Code, Gemini CLI, Codex, gh) available for SuperAgent orchestration.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

type TraceListener = (event: { kind: 'trace' | 'quarantine'; data: unknown }) => void;

export class SkillDeckHub {
  private traces: HubTraceEvent[] = [];
  private quarantineQueue: QuarantineItem[] = [];
  private recentCallWindow: RuntimeCallWindowItem[] = [];
  private customAntibodies: ImmuneAntibody[] = [];
  private listeners = new Set<TraceListener>();
  private requireApprovalForHighRisk = true;
  private antibodiesFilePath: string;
  private cliEntryPath: string;

  constructor(options?: { antibodiesFilePath?: string; cliEntryPath?: string }) {
    this.antibodiesFilePath =
      options?.antibodiesFilePath ??
      path.join(os.homedir(), '.skilldeck', 'immune', 'custom-antibodies.json');
    this.cliEntryPath = options?.cliEntryPath ?? 'skilldeck';
    this.customAntibodies = this.loadCustomAntibodies();
  }

  private loadCustomAntibodies(): ImmuneAntibody[] {
    if (!fs.existsSync(this.antibodiesFilePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.antibodiesFilePath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as ImmuneAntibody[]) : [];
    } catch {
      return [];
    }
  }

  private saveCustomAntibodies(): void {
    try {
      fs.mkdirSync(path.dirname(this.antibodiesFilePath), { recursive: true });
      fs.writeFileSync(
        this.antibodiesFilePath,
        `${JSON.stringify(this.customAntibodies, null, 2)}\n`,
        'utf8',
      );
    } catch {
      // Ignore write failures in read-only test sandboxes
    }
  }

  public getCustomAntibodies(): ImmuneAntibody[] {
    return this.customAntibodies;
  }

  public getAllSecurityAntibodies(): ImmuneAntibody[] {
    return [...getBuiltinAntibodies(), ...this.customAntibodies];
  }

  public addCustomAntibody(input: {
    name: string;
    sampleText: string;
    vector?: ImmuneAntibody['vector'];
    severity?: ImmuneAntibody['severity'];
  }): ImmuneAntibody {
    const ab = synthesizeAntibody(input);
    this.customAntibodies = [ab, ...this.customAntibodies.filter((x) => x.id !== ab.id)];
    this.saveCustomAntibodies();
    return ab;
  }

  public setRequireApprovalForHighRisk(enabled: boolean): void {
    this.requireApprovalForHighRisk = enabled;
  }

  public subscribe(listener: TraceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(kind: 'trace' | 'quarantine', data: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener({ kind, data });
      } catch {
        // Ignore broken SSE subscribers
      }
    }
  }

  public recordTrace(trace: Omit<HubTraceEvent, 'id' | 'timestamp'>): HubTraceEvent {
    const entry: HubTraceEvent = {
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...trace,
    };
    this.traces = [entry, ...this.traces].slice(0, 150);
    this.emit('trace', entry);
    return entry;
  }

  public buildConnectSnippets(): HubConnectSnippet[] {
    const hubEntry = {
      mcpServers: {
        'skilldeck-hub': {
          command: 'node',
          args: [this.cliEntryPath, 'hub', '--local'],
        },
      },
    };
    const jsonText = JSON.stringify(hubEntry, null, 2);

    return [
      {
        platform: 'Antigravity / Gemini CLI',
        configPathHint: '~/.gemini/antigravity/mcp_config.json 或 ~/.gemini/settings.json',
        snippet: jsonText,
      },
      {
        platform: 'Claude Code',
        configPathHint: '.mcp.json 或 ~/.claude.json',
        snippet: jsonText,
      },
      {
        platform: 'Cursor',
        configPathHint: '.cursor/mcp.json 或 ~/.cursor/mcp.json',
        snippet: jsonText,
      },
      {
        platform: 'Codex CLI / ZCode / DSH',
        configPathHint: 'MCP Server 配置（stdio 协议）',
        snippet: jsonText,
      },
    ];
  }

  public getStatusSnapshot(report: WorkspaceReport): HubStatusSnapshot {
    const estimatedHubStartupTokens = 580;
    const directStartupTokens = report.budget.totalAlwaysOnTokens;
    const savingsPct =
      directStartupTokens > estimatedHubStartupTokens
        ? Number(
            (((directStartupTokens - estimatedHubStartupTokens) / directStartupTokens) * 100).toFixed(1),
          )
        : 0;

    return {
      metaToolCount: HUB_META_TOOLS.length,
      estimatedHubStartupTokens,
      directStartupTokens,
      estimatedTokenSavingsPct: savingsPct,
      requireApprovalForHighRisk: this.requireApprovalForHighRisk,
      traces: this.traces,
      quarantineQueue: this.quarantineQueue,
      customAntibodies: this.customAntibodies,
      connectSnippets: this.buildConnectSnippets(),
    };
  }

  public async pingServer(
    serverName: string,
    report: WorkspaceReport,
  ): Promise<DownstreamPingResult> {
    const server = report.mcpServers.find((m) => m.name === serverName);
    if (!server) {
      return {
        serverName,
        ok: false,
        latencyMs: 0,
        transport: 'unknown',
        tools: [],
        error: `MCP server "${serverName}" not found in active workspace.`,
      };
    }

    const res = await pingDownstreamMcp(server);
    this.recordTrace({
      source: 'hub-api',
      serverName: server.name,
      toolName: 'tools/list',
      durationMs: res.latencyMs,
      status: res.ok ? 'ok' : 'error',
      immuneAction: 'allow',
      summary: res.ok
        ? `Discovered ${res.tools.length} tool(s) from ${server.name} (${server.transport})`
        : `Ping failed: ${res.error ?? 'unknown error'}`,
    });
    return res;
  }

  public resolveQuarantine(
    id: string,
    decision: 'approve' | 'reject' | 'immunize',
  ): { item: QuarantineItem; createdAntibody?: ImmuneAntibody } {
    const item = this.quarantineQueue.find((q) => q.id === id);
    if (!item) {
      throw new Error(`Quarantine item not found: ${id}`);
    }

    item.status =
      decision === 'approve' ? 'approved' : decision === 'immunize' ? 'immunized' : 'rejected';
    item.resolvedAt = new Date().toISOString();

    let createdAntibody: ImmuneAntibody | undefined;
    if (decision === 'immunize') {
      const sampleText =
        typeof item.redactedArgs === 'string'
          ? item.redactedArgs
          : JSON.stringify(item.redactedArgs ?? item.toolName);
      createdAntibody = this.addCustomAntibody({
        name: `Block ${item.serverName}:${item.toolName}`,
        sampleText,
        vector: 'custom-antibody',
        severity: 'high',
      });
    }

    this.emit('quarantine', item);
    return { item, createdAntibody };
  }

  /**
   * Executes one of the 7 SkillDeck Hub Meta-Tools (used by both stdio MCP server and Web API).
   */
  public async executeMetaTool(
    toolName: string,
    rawArgs: Record<string, unknown>,
    scanOptions: ScanOptions,
    source: HubTraceEvent['source'] = 'hub-api',
  ): Promise<{ ok: boolean; contentText: string; data?: unknown; trace: HubTraceEvent }> {
    const start = Date.now();
    const report = await analyzeWorkspaceAsync({
      ...scanOptions,
      customAntibodies: this.customAntibodies,
    });

    if (toolName === 'skilldeck_search_tools') {
      const query = String(rawArgs.query ?? '').trim();
      const route = simulatePromptRouting(query, report.skills, report.mcpServers, 6);
      const immune = recallPitfallAntibodies(
        query,
        report.immune.agentImmuneBridge.pitfallAntibodies,
        3,
      );
      const matchingMcps = report.mcpServers
        .filter((m) => !m.disabled)
        .filter((m) => !query || m.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6)
        .map((m) => ({ name: m.name, transport: m.transport, platform: m.platform }));

      const payload = {
        query,
        recommendedSkills: route.matches.map((m) => ({
          name: m.skillName,
          platform: m.platform,
          score: m.score,
          bodyTokens: m.bodyTokens,
          matchedTerms: m.matchedTerms,
        })),
        activeMcpServers: matchingMcps,
        pitfallMemory: immune.immuneMemoryBlock || null,
      };
      const trace = this.recordTrace({
        source,
        serverName: 'skilldeck-hub',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Matched ${route.matches.length} skills & ${immune.matches.length} pitfall antibodies for "${query.slice(0, 48)}"`,
        redactedArgsPreview: JSON.stringify({ query }),
      });
      return { ok: true, contentText: JSON.stringify(payload, null, 2), data: payload, trace };
    }

    if (toolName === 'skilldeck_load_skill') {
      const skillName = String(rawArgs.skillName ?? '').trim();
      const skill = report.skills.find((s) => s.name === skillName);
      if (!skill) {
        const trace = this.recordTrace({
          source,
          serverName: 'skilldeck-hub',
          toolName,
          durationMs: Math.max(1, Date.now() - start),
          status: 'error',
          immuneAction: 'allow',
          summary: `Skill "${skillName}" not found.`,
        });
        return { ok: false, contentText: `Skill "${skillName}" not found.`, trace };
      }

      const imm = report.immune.skillReports.find((r) => r.skillId === skill.id);
      if (imm?.verdict === 'quarantine') {
        const trace = this.recordTrace({
          source,
          serverName: 'skilldeck-hub',
          toolName,
          durationMs: Math.max(1, Date.now() - start),
          status: 'quarantined',
          immuneAction: 'quarantine',
          summary: `Agent-Immune blocked loading toxic skill "${skill.name}" (threat ${imm.threatScore}/100).`,
        });
        return {
          ok: false,
          contentText: `[Agent-Immune QUARANTINE] Refused to load "${skill.name}": ${imm.findings.map((f) => `${f.ruleId} ${f.title}`).join('; ')}`,
          trace,
        };
      }

      const trace = this.recordTrace({
        source,
        serverName: 'skilldeck-hub',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Loaded "${skill.name}" (${skill.tokens.bodyTokens}t, verdict=${imm?.verdict ?? 'safe'})`,
      });
      return {
        ok: true,
        contentText: `# Skill: ${skill.name} (${skill.platform})\n\n${skill.body}`,
        data: { skillName: skill.name, tokens: skill.tokens, verdict: imm?.verdict ?? 'safe' },
        trace,
      };
    }

    if (toolName === 'skilldeck_recall_immune') {
      const query = String(rawArgs.query ?? '').trim();
      const recalled = recallPitfallAntibodies(
        query,
        report.immune.agentImmuneBridge.pitfallAntibodies,
        5,
      );
      const trace = this.recordTrace({
        source,
        serverName: 'agent-immune',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Recalled ${recalled.matches.length} pitfall antibody(ies) for "${query.slice(0, 48)}"`,
      });
      return {
        ok: true,
        contentText:
          recalled.immuneMemoryBlock || 'No matching pitfall antibodies found for this context.',
        data: recalled,
        trace,
      };
    }

    if (toolName === 'skilldeck_record_pitfall') {
      const created = distillAndPersistPitfallAntibody({
        trigger_pattern: String(rawArgs.trigger_pattern ?? ''),
        symptom: String(rawArgs.symptom ?? ''),
        prescription: String(rawArgs.prescription ?? ''),
        tool_name: rawArgs.tool_name ? String(rawArgs.tool_name) : 'Bash',
      });
      const trace = this.recordTrace({
        source,
        serverName: 'agent-immune',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Distilled new pitfall antibody [${created.trigger_pattern}]`,
      });
      return {
        ok: true,
        contentText: JSON.stringify(created, null, 2),
        data: created,
        trace,
      };
    }

    if (toolName === 'skilldeck_workspace_health') {
      const payload = {
        summary: report.summary,
        budget: report.budget,
        topConflicts: report.conflicts.slice(0, 5),
        immune: {
          immunityScore: report.immune.immunityScore,
          quarantineCount: report.immune.quarantineCount,
          pitfallAntibodyCount: report.immune.agentImmuneBridge.activePitfallCount,
        },
      };
      const trace = this.recordTrace({
        source,
        serverName: 'skilldeck-hub',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Health ${report.summary.healthScore}/100 · Immunity ${report.summary.immunityScore}/100`,
      });
      return { ok: true, contentText: JSON.stringify(payload, null, 2), data: payload, trace };
    }

    if (toolName === 'skilldeck_list_agents') {
      const agents = await detectLocalAgents();
      const trace = this.recordTrace({
        source,
        serverName: 'skilldeck-hub',
        toolName,
        durationMs: Math.max(1, Date.now() - start),
        status: 'ok',
        immuneAction: 'allow',
        summary: `Detected ${agents.filter((a) => a.available).length}/${agents.length} local CLI agents`,
      });
      return { ok: true, contentText: JSON.stringify(agents, null, 2), data: agents, trace };
    }

    if (toolName === 'skilldeck_call_tool') {
      const serverName = String(rawArgs.serverName ?? '').trim();
      const targetTool = String(rawArgs.toolName ?? '').trim();
      const toolArgs =
        rawArgs.arguments && typeof rawArgs.arguments === 'object'
          ? (rawArgs.arguments as Record<string, unknown>)
          : {};
      const dryRun = Boolean(rawArgs.dryRun);

      // Runtime Agent-Immune Firewall Gate!
      const fw = evaluateRuntimeToolCall({
        serverName,
        toolName: targetTool,
        args: toolArgs,
        recentCalls: this.recentCallWindow,
        customAntibodies: this.customAntibodies,
        requireApprovalForHighRisk: this.requireApprovalForHighRisk,
      });

      const payloadSig = `${serverName}.${targetTool} ${JSON.stringify(toolArgs)}`;
      const fp = createHash('sha256').update(payloadSig).digest('hex').slice(0, 16);
      this.recentCallWindow = [
        ...this.recentCallWindow.filter((c) => Date.now() - c.timestamp <= 30_000),
        { fingerprint: fp, timestamp: Date.now() },
      ];

      if (!fw.allowed) {
        if (fw.action === 'quarantine') {
          const qItem: QuarantineItem = {
            id: `quar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: new Date().toISOString(),
            source: source === 'mcp-stdio' || source === 'hub-api' ? 'hub' : source,
            serverName,
            toolName: targetTool,
            redactedArgs: toolArgs,
            reason: fw.reason,
            matchedRules: fw.matchedRules,
            threatScore: fw.threatScore,
            status: 'pending',
          };
          this.quarantineQueue = [qItem, ...this.quarantineQueue].slice(0, 50);
          this.emit('quarantine', qItem);
        }

        const trace = this.recordTrace({
          source,
          serverName,
          toolName: targetTool,
          durationMs: Math.max(1, Date.now() - start),
          status: fw.action === 'quarantine' ? 'quarantined' : 'blocked',
          immuneAction: fw.action,
          summary: `${fw.reason} [${fw.matchedRules.join(', ')}]`,
          redactedArgsPreview: JSON.stringify(toolArgs).slice(0, 160),
        });
        return {
          ok: false,
          contentText: `[Agent-Immune ${fw.action.toUpperCase()}] ${fw.reason}`,
          data: { firewall: fw },
          trace,
        };
      }

      const server = report.mcpServers.find((m) => m.name === serverName);
      if (!server) {
        const trace = this.recordTrace({
          source,
          serverName,
          toolName: targetTool,
          durationMs: Math.max(1, Date.now() - start),
          status: 'error',
          immuneAction: 'allow',
          summary: `Downstream MCP server "${serverName}" not found.`,
        });
        return { ok: false, contentText: `Downstream MCP server "${serverName}" not found.`, trace };
      }

      if (dryRun) {
        const trace = this.recordTrace({
          source,
          serverName,
          toolName: targetTool,
          durationMs: Math.max(1, Date.now() - start),
          status: 'dry-run',
          immuneAction: 'allow',
          summary: `[Dry-Run] Firewall ALLOW for ${serverName}.${targetTool}`,
          redactedArgsPreview: JSON.stringify(toolArgs).slice(0, 160),
        });
        return {
          ok: true,
          contentText: `[Dry-Run] Agent-Immune firewall ALLOWED ${serverName}.${targetTool}.`,
          data: { firewall: fw, dryRun: true },
          trace,
        };
      }

      const invoked = await invokeDownstreamMcpTool(server, targetTool, toolArgs);
      // Indirect prompt-injection scan on downstream tool output!
      const respFindings = scanContentForThreats(
        invoked.output,
        {
          targetId: `${serverName}:${targetTool}:response`,
          targetName: `${serverName}/${targetTool}`,
          filePath: 'mcp-response',
        },
        this.customAntibodies,
      );
      const outputText =
        respFindings.length > 0
          ? `[Agent-Immune WARNING: Indirect injection pattern detected in tool output (${respFindings.map((f) => f.ruleId).join(', ')})]\n\n${invoked.output}`
          : invoked.output;

      const trace = this.recordTrace({
        source,
        serverName,
        toolName: targetTool,
        durationMs: invoked.latencyMs,
        status: invoked.ok ? 'ok' : 'error',
        immuneAction: 'allow',
        summary: invoked.ok
          ? `Executed ${serverName}.${targetTool} in ${invoked.latencyMs}ms`
          : `Failed: ${invoked.output.slice(0, 120)}`,
        redactedArgsPreview: JSON.stringify(toolArgs).slice(0, 160),
        resultPreview: outputText.slice(0, 240),
      });
      return { ok: invoked.ok, contentText: outputText, trace };
    }

    const trace = this.recordTrace({
      source,
      serverName: 'skilldeck-hub',
      toolName,
      durationMs: Math.max(1, Date.now() - start),
      status: 'error',
      immuneAction: 'allow',
      summary: `Unknown meta-tool "${toolName}"`,
    });
    return { ok: false, contentText: `Unknown SkillDeck Hub meta-tool: ${toolName}`, trace };
  }
}
