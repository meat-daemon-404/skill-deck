import { recallPitfallAntibodies } from './agent-immune-bridge.js';
import { simulatePromptRouting } from './router.js';
import type {
  ImmuneFirewallDecision,
  LlmProbeResult,
  SuperAgentChatResult,
  SuperAgentToolTrace,
  WorkspaceReport,
} from './types.js';

export interface LlmEndpointConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface OpenAiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecutionResult {
  ok: boolean;
  contentText: string;
  durationMs: number;
  immuneAction: ImmuneFirewallDecision['action'];
}

export type SuperAgentToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolExecutionResult>;

function normalizeBaseUrl(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

/**
 * Probes any OpenAI-compatible endpoint (Ollama, DeepSeek, Gemini, OpenAI, OpenRouter, custom)
 * via GET /models and returns available model IDs + latency.
 */
export async function probeLlmEndpoint(
  endpoint: string,
  apiKey?: string,
  timeoutMs = 5000,
): Promise<LlmProbeResult> {
  const base = normalizeBaseUrl(endpoint);
  const start = Date.now();
  if (!base) {
    return { ok: false, endpoint: base, latencyMs: 0, models: [], error: 'Endpoint URL is required.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(`${base}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Math.max(1, Date.now() - start);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        ok: false,
        endpoint: base,
        latencyMs,
        models: [],
        error: `HTTP ${res.status}: ${errBody.slice(0, 220) || res.statusText}`,
      };
    }

    const json = (await res.json()) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    };
    const rawIds = [
      ...(json.data ?? []).map((m) => m.id),
      ...(json.models ?? []).map((m) => m.id ?? m.name),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);

    // Keep routing aliases (`group/*`, `auto/*`) near the top when present
    const unique = Array.from(new Set(rawIds)).sort((a, b) => {
      const rank = (s: string) => (s.startsWith('group/') ? 0 : s.startsWith('auto/') ? 1 : 2);
      const diff = rank(a) - rank(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    return {
      ok: true,
      endpoint: base,
      latencyMs,
      models: unique,
    };
  } catch (err) {
    return {
      ok: false,
      endpoint: base,
      latencyMs: Math.max(1, Date.now() - start),
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

async function postChatCompletion(
  base: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data?: ChatCompletionResponse; errorText?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    const text = await res.text();
    let parsed: ChatCompletionResponse | undefined;
    try {
      parsed = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      // Non-JSON error body
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: parsed,
        errorText: parsed?.error?.message || text.slice(0, 320) || `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data: parsed };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      errorText: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Runs a real multi-turn OpenAI-compatible Function Calling (ReAct) SuperAgent loop
 * wired directly into SkillDeck Hub's 7 Meta-Tools + Agent-Immune Firewall!
 *
 * Works seamlessly with Ollama (`http://127.0.0.1:11434/v1`), DeepSeek,
 * Gemini OpenAI endpoint, OpenAI, OpenRouter, and any OpenAI-compatible API.
 */
export async function runSuperAgentToolLoop(params: {
  goal: string;
  llm: LlmEndpointConfig;
  tools: OpenAiToolDef[];
  executeTool: SuperAgentToolExecutor;
  report: WorkspaceReport;
}): Promise<SuperAgentChatResult> {
  const start = Date.now();
  const base = normalizeBaseUrl(params.llm.endpoint);
  const model = params.llm.model.trim();
  const maxTurns = Math.max(1, Math.min(10, params.llm.maxTurns ?? 6));
  const timeoutMs = params.llm.timeoutMs ?? 60_000;

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const toolTraces: SuperAgentToolTrace[] = [];

  // Always inject relevant agent-immune pitfall memory upfront so the model avoids known pitfalls on turn 1
  const initialRecall = recallPitfallAntibodies(
    params.goal,
    params.report.immune.agentImmuneBridge.pitfallAntibodies,
    4,
  );

  const systemLines = [
    'You are SkillDeck SuperAgent — a local-first AI orchestrator connected to all Agent Skills (Antigravity, Claude Code, Cursor, Codex, DSH, ZCode), MCP Servers, and agent-immune pitfall memory on this machine.',
    `Workspace telemetry: ${params.report.summary.skillCount} skills, ${params.report.summary.mcpServerCount} MCP servers, ${params.report.immune.agentImmuneBridge.activePitfallCount} active pitfall antibodies, Health ${params.report.summary.healthScore}/100, Immunity ${params.report.summary.immunityScore}/100.`,
    'Workflow: Call `skilldeck_search_tools` or `skilldeck_recall_immune` when domain skills or pitfall rules can help, call `skilldeck_load_skill` for top relevant skills before giving domain advice, and respect any Agent-Immune quarantine blocks.',
    'Answer concisely, accurately, and in the same language as the user goal.',
  ];

  if (initialRecall.immuneMemoryBlock) {
    systemLines.push('', 'Pre-recalled local pitfall memory:', initialRecall.immuneMemoryBlock);
  }

  const messages: ChatCompletionMessage[] = [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: params.goal },
  ];

  let mode: SuperAgentChatResult['mode'] = 'tool-calling';
  let turns = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    turns = turn;
    const isFinalTurn = turn === maxTurns;
    const reqBody: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.2,
    };
    if (mode === 'tool-calling' && params.tools.length > 0 && !isFinalTurn) {
      reqBody.tools = params.tools;
      reqBody.tool_choice = 'auto';
    }

    let resp = await postChatCompletion(base, params.llm.apiKey, reqBody, timeoutMs);

    // Graceful fallback if the selected model does not support OpenAI `tools` parameter
    if (
      !resp.ok &&
      turn === 1 &&
      mode === 'tool-calling' &&
      resp.status >= 400 &&
      resp.status < 500 &&
      /(tool|function)/i.test(resp.errorText ?? '')
    ) {
      mode = 'context-injected';
      const route = simulatePromptRouting(params.goal, params.report.skills, params.report.mcpServers, 2);
      const topSkills = route.matches
        .filter((m) => !m.suppressedByNegative && m.score >= 0.25)
        .slice(0, 2)
        .map((m) => params.report.skills.find((s) => s.id === m.skillId))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      const injectedContext = topSkills
        .map((s) => `### Skill: ${s.name} (${s.platform})\n${s.body.slice(0, 2400)}`)
        .join('\n\n');

      messages[0] = {
        role: 'system',
        content: `${systemLines.join('\n')}${injectedContext ? `\n\nMatched local skills:\n${injectedContext}` : ''}`,
      };
      resp = await postChatCompletion(
        base,
        params.llm.apiKey,
        { model, messages, temperature: 0.2 },
        timeoutMs,
      );
    }

    if (!resp.ok || !resp.data) {
      return {
        ok: false,
        goal: params.goal,
        endpoint: base,
        model,
        mode,
        turns,
        totalDurationMs: Math.max(1, Date.now() - start),
        usage,
        toolTraces,
        finalAnswer: '',
        error: resp.errorText || 'LLM request failed.',
      };
    }

    if (resp.data.usage) {
      usage.promptTokens += resp.data.usage.prompt_tokens ?? 0;
      usage.completionTokens += resp.data.usage.completion_tokens ?? 0;
      usage.totalTokens +=
        resp.data.usage.total_tokens ??
        (resp.data.usage.prompt_tokens ?? 0) + (resp.data.usage.completion_tokens ?? 0);
    }

    const assistantMsg = resp.data.choices?.[0]?.message;
    if (!assistantMsg) {
      return {
        ok: false,
        goal: params.goal,
        endpoint: base,
        model,
        mode,
        turns,
        totalDurationMs: Math.max(1, Date.now() - start),
        usage,
        toolTraces,
        finalAnswer: '',
        error: 'Model returned an empty response choice.',
      };
    }

    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return {
        ok: true,
        goal: params.goal,
        endpoint: base,
        model,
        mode,
        turns,
        totalDurationMs: Math.max(1, Date.now() - start),
        usage,
        toolTraces,
        finalAnswer: assistantMsg.content?.trim() || '(Model returned empty text)',
      };
    }

    // Record assistant tool_calls message, then execute each requested Hub tool under Agent-Immune guardrails
    messages.push({
      role: 'assistant',
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
      } catch {
        parsedArgs = {};
      }

      const execRes = await params.executeTool(tc.function.name, parsedArgs);
      toolTraces.push({
        turn,
        toolName: tc.function.name,
        arguments: parsedArgs,
        ok: execRes.ok,
        durationMs: execRes.durationMs,
        immuneAction: execRes.immuneAction,
        resultPreview: execRes.contentText.slice(0, 320),
      });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: execRes.contentText.slice(0, 6000),
      });
    }
  }

  return {
    ok: true,
    goal: params.goal,
    endpoint: base,
    model,
    mode,
    turns,
    totalDurationMs: Math.max(1, Date.now() - start),
    usage,
    toolTraces,
    finalAnswer:
      'Reached maximum tool-calling turns. Inspect the tool call timeline above for gathered results.',
  };
}
