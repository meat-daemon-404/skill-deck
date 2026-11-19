import { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Cpu,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Workflow,
  XCircle,
} from 'lucide-react';
import type {
  DetectedLocalAgent,
  SuperAgentPlan,
  WorkflowGraph,
  WorkflowRunResult,
} from '@skilldeck/core';
import {
  createSuperAgentPlanApi,
  fetchLocalAgents,
  runWorkflowGraphApi,
  type WorkspaceQuery,
} from '../api.js';
import { useI18n } from '../i18n.js';

interface SuperAgentViewProps {
  query: WorkspaceQuery;
  onSendToWorkflow: (graph: WorkflowGraph) => void;
}

const SAMPLE_GOALS_ZH = [
  '部署一个带 KV 和 R2 绑定的 Cloudflare Worker，并检查 PostgreSQL RLS 安全策略',
  '帮我把这集漫剧剧本拆成分镜表，生成首帧提示词并核对资产引用',
  '检查当前项目在 Windows PowerShell 5.1 和 pnpm v10 下的常见构建踩坑并输出修复方案',
];

const SAMPLE_GOALS_EN = [
  'Deploy a Cloudflare Worker with KV/R2 bindings and audit PostgreSQL RLS security policies',
  'Build an accessible dark mode modal dialog and responsive table following modern CSS guidelines',
  'Verify Windows PowerShell 5.1 and pnpm v10 build pitfalls and output a verified fix plan',
];

export function SuperAgentView({ query, onSendToWorkflow }: SuperAgentViewProps) {
  const { lang, t } = useI18n();
  const [agents, setAgents] = useState<DetectedLocalAgent[]>([]);
  const [goal, setGoal] = useState(SAMPLE_GOALS_ZH[0]!);
  const [preferredEngine, setPreferredEngine] = useState('');
  const [llmEndpoint, setLlmEndpoint] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [runMode, setRunMode] = useState<'dry-run' | 'live'>('dry-run');

  const [plan, setPlan] = useState<SuperAgentPlan | null>(null);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchLocalAgents().then((list) => {
      setAgents(list);
      const ollama = list.find((a) => a.id === 'ollama' && (a.models?.length ?? 0) > 0);
      if (ollama && ollama.models?.[0]) {
        setLlmEndpoint('http://127.0.0.1:11434/v1');
        setLlmModel(ollama.models[0]);
      }
    });
  }, []);

  const llmConfig =
    llmEndpoint.trim() && llmModel.trim()
      ? {
          endpoint: llmEndpoint.trim(),
          model: llmModel.trim(),
          apiKey: llmApiKey.trim() || undefined,
        }
      : undefined;

  async function handlePlan(goalOverride?: string) {
    const activeGoal = (goalOverride ?? goal).trim();
    if (!activeGoal) return;
    setPlanning(true);
    setError(null);
    setRunResult(null);
    try {
      const nextPlan = await createSuperAgentPlanApi({
        goal: activeGoal,
        query,
        preferredEngine: preferredEngine || undefined,
        llmConfig,
      });
      setPlan(nextPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planning failed');
    } finally {
      setPlanning(false);
    }
  }

  async function handleRunPlan() {
    if (!plan) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runWorkflowGraphApi({
        graph: plan.workflowGraph,
        query,
        runMode,
        goalContext: plan.goal,
        llmConfig,
      });
      setRunResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunning(false);
    }
  }

  const samples = lang === 'zh' ? SAMPLE_GOALS_ZH : SAMPLE_GOALS_EN;
  const availableCount = agents.filter((a) => a.available).length;

  return (
    <section className="stack-md" aria-labelledby="superagent-heading">
      <div className="card-header">
        <div>
          <h1 id="superagent-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            {t('SuperAgent 超级指挥台', 'SuperAgent Command Center')}
          </h1>
          <p className="card-subtitle">
            {t(
              '统一调度本机 CLI Agent、本地 Ollama / OpenAI 兼容模型、全平台 Skills 与 MCP 网关；每一步自动注入 agent-immune 踩坑抗体并受安全防火墙保护。',
              'Orchestrate local CLI agents, Ollama / OpenAI-compatible models, multi-platform Skills, and MCP Hub under Agent-Immune pitfall memory & firewall guardrails.',
            )}
          </p>
        </div>
        <span className="badge badge-accent">
          {t(`本机已就绪 ${availableCount}/${agents.length} 个引擎`, `${availableCount}/${agents.length} local runtimes ready`)}
        </span>
      </div>

      {/* Detected Local Agents Grid */}
      <article className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Cpu size={17} aria-hidden="true" />
            {t('本机已探测到的 Agent 运行时与模型引擎', 'Detected Local Agent Runtimes')}
          </h2>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {t('纯本地 PATH & 127.0.0.1:11434 只读探测', 'Read-only local PATH & Ollama probe')}
          </span>
        </div>

        <div className="grid-kpi">
          {agents.map((ag) => (
            <div
              key={ag.id}
              style={{
                padding: '0.75rem 0.9rem',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${ag.available ? 'color-mix(in srgb, var(--ok) 45%, var(--border))' : 'var(--border)'}`,
                background: 'var(--bg-elevated)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
              }}
            >
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontSize: '0.88rem' }}>{ag.name}</strong>
                <span className={`badge ${ag.available ? 'badge-ok' : 'badge-neutral'}`}>
                  {ag.available ? t('就绪', 'READY') : t('未安装', 'N/A')}
                </span>
              </div>
              <span className="mono muted" style={{ fontSize: '0.74rem' }}>
                {ag.command} · {ag.statusNote}
              </span>
              {ag.models && ag.models.length > 0 && (
                <div className="row-wrap">
                  {ag.models.slice(0, 3).map((m) => (
                    <span key={m} className="badge badge-purple">{m}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </article>

      {/* Goal Composer + Optional LLM Backend */}
      <article className="card">
        <form
          className="stack-md"
          onSubmit={(e) => {
            e.preventDefault();
            void handlePlan();
          }}
        >
          <div className="stack-sm">
            <label htmlFor="superagent-goal-input" style={{ fontSize: '0.9rem', fontWeight: 650 }}>
              {t('输入高层任务目标（SuperAgent 将自动匹配技能、检索踩坑抗体并编排执行链）', 'High-Level Goal (SuperAgent routes skills, injects pitfall memory & composes a DAG)')}
            </label>
            <textarea
              id="superagent-goal-input"
              className="textarea"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t('例如：帮我部署 Cloudflare Worker 并审查 Supabase RLS 权限...', 'e.g. Deploy Cloudflare Worker and audit Supabase RLS policies...')}
            />
            <div className="row-wrap">
              <span className="muted" style={{ fontSize: '0.78rem' }}>{t('快速示例：', 'Presets:')}</span>
              {samples.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setGoal(s);
                    void handlePlan(s);
                  }}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span className="truncate-line" style={{ maxInlineSize: '230px' }}>{s}</span>
                </button>
              ))}
            </div>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600 }}>
              {t('可选：接入本地 Ollama 或 OpenAI 兼容模型（默认 100% 离线确定性规划即可运行）', 'Optional: Connect Local Ollama or OpenAI-Compatible LLM (works 100% offline by default)')}
            </summary>
            <div className="grid-kpi" style={{ marginBlockStart: '0.75rem' }}>
              <div className="stack-sm">
                <label htmlFor="sa-engine" className="muted" style={{ fontSize: '0.76rem' }}>
                  {t('优先工作引擎', 'Preferred Worker Engine')}
                </label>
                <select
                  id="sa-engine"
                  className="select"
                  value={preferredEngine}
                  onChange={(e) => setPreferredEngine(e.target.value)}
                >
                  <option value="">{t('自动选择最优可用引擎', 'Auto-select best available')}</option>
                  {agents.filter((a) => a.available).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.command})</option>
                  ))}
                  <option value="skilldeck-builtin">SkillDeck Built-in Deterministic Engine</option>
                </select>
              </div>
              <div className="stack-sm">
                <label htmlFor="sa-endpoint" className="muted" style={{ fontSize: '0.76rem' }}>
                  {t('模型 API 地址（如 Ollama）', 'OpenAI-Compatible Base URL')}
                </label>
                <input
                  id="sa-endpoint"
                  className="input"
                  placeholder="http://127.0.0.1:11434/v1"
                  value={llmEndpoint}
                  onChange={(e) => setLlmEndpoint(e.target.value)}
                />
              </div>
              <div className="stack-sm">
                <label htmlFor="sa-model" className="muted" style={{ fontSize: '0.76rem' }}>
                  {t('模型名称', 'Model ID')}
                </label>
                <input
                  id="sa-model"
                  className="input"
                  placeholder="qwen2.5-coder:7b / deepseek-chat"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                />
              </div>
              <div className="stack-sm">
                <label htmlFor="sa-key" className="muted" style={{ fontSize: '0.76rem' }}>
                  {t('API Key（仅存内存，绝不落盘）', 'API Key (memory-only, never persisted)')}
                </label>
                <input
                  id="sa-key"
                  type="password"
                  className="input"
                  placeholder={t('本地 Ollama 可留空', 'Optional for local Ollama')}
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                />
              </div>
            </div>
          </details>

          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="segmented" role="group" aria-label={t('执行模式', 'Execution mode')}>
              <button
                type="button"
                aria-pressed={runMode === 'dry-run'}
                onClick={() => setRunMode('dry-run')}
              >
                {t('安全预演 (Dry-Run)', 'Safe Dry-Run')}
              </button>
              <button
                type="button"
                aria-pressed={runMode === 'live'}
                onClick={() => setRunMode('live')}
              >
                {t('实机执行 (Live)', 'Live Execution')}
              </button>
            </div>

            <button type="submit" className="btn btn-primary" disabled={planning || !goal.trim()}>
              <Bot size={15} aria-hidden="true" />
              {planning ? t('正在规划...', 'Synthesizing Plan...') : t('生成 SuperAgent 作战计划', 'Generate SuperAgent Plan')}
            </button>
          </div>
        </form>

        {error && (
          <p className="badge badge-danger" role="alert">
            {error}
          </p>
        )}
      </article>

      {/* Generated Plan */}
      {plan && (
        <article className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                <ShieldCheck size={17} aria-hidden="true" />
                {t('作战计划与免疫注入摘要', 'Synthesized Execution Plan & Immune Injection')}
              </h2>
              <p className="card-subtitle">
                {t(
                  `规划引擎：${plan.plannerEngine} · 预计上下文：${plan.estimatedTotalTokens.toLocaleString()}t · 共 ${plan.steps.length} 个阶段`,
                  `Planner: ${plan.plannerEngine} · Est. Context: ${plan.estimatedTotalTokens.toLocaleString()}t · ${plan.steps.length} stages`,
                )}
              </p>
            </div>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onSendToWorkflow(plan.workflowGraph)}
              >
                <Workflow size={14} aria-hidden="true" />
                {t('发送到画布编排', 'Send to Workflow Canvas')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={running}
                onClick={() => void handleRunPlan()}
              >
                <Play size={14} aria-hidden="true" />
                {running
                  ? t('执行中...', 'Running...')
                  : runMode === 'live'
                    ? t('实机运行此计划', 'Run Plan Live')
                    : t('预演运行此计划', 'Dry-Run Plan')}
              </button>
            </div>
          </div>

          {plan.skippedQuarantinedSkills.length > 0 && (
            <div
              role="status"
              style={{
                padding: '0.7rem 0.9rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                fontSize: '0.84rem',
              }}
            >
              <ShieldAlert size={16} aria-hidden="true" style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <span>
                {t(
                  `Agent-Immune 自动跳过已隔离的危险技能：${plan.skippedQuarantinedSkills.join(', ')}`,
                  `Agent-Immune automatically skipped quarantined skill(s): ${plan.skippedQuarantinedSkills.join(', ')}`,
                )}
              </span>
            </div>
          )}

          <div className="stack-sm">
            {plan.steps.map((st) => (
              <div
                key={st.id}
                style={{
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                  <div className="row-wrap">
                    <span className="badge badge-accent">#{st.order}</span>
                    <span className="badge badge-purple">{st.role}</span>
                    <strong>{st.title}</strong>
                  </div>
                  <div className="row-wrap mono" style={{ fontSize: '0.76rem' }}>
                    <span className="badge badge-neutral">{st.engine}</span>
                    <span className="muted">~{st.estimatedTokens}t</span>
                  </div>
                </div>
                <pre className="code-block" style={{ maxBlockSize: '180px', fontSize: '0.76rem' }}>
                  <code>{st.instruction}</code>
                </pre>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Live Execution Trace */}
      {runResult && (
        <article className="card">
          <div className="card-header">
            <h2 className="card-title">
              {runResult.status === 'completed' ? (
                <CheckCircle2 size={17} aria-hidden="true" style={{ color: 'var(--ok)' }} />
              ) : (
                <XCircle size={17} aria-hidden="true" style={{ color: 'var(--danger)' }} />
              )}
              {t('SuperAgent 运行报告', 'SuperAgent Execution Report')}
            </h2>
            <div className="row-wrap">
              <span className={`badge ${runResult.status === 'completed' ? 'badge-ok' : 'badge-danger'}`}>
                {runResult.status.toUpperCase()}
              </span>
              <span className="badge badge-neutral">{runResult.mode}</span>
              <span className="mono muted" style={{ fontSize: '0.78rem' }}>{runResult.totalDurationMs}ms</span>
            </div>
          </div>

          <div className="stack-sm">
            {runResult.steps.map((st) => (
              <div
                key={`${st.nodeId}-${st.step}`}
                style={{
                  padding: '0.75rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${st.status === 'ok' ? 'var(--border)' : 'var(--danger)'}`,
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                }}
              >
                <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                  <div className="row-wrap">
                    <span className={`badge ${st.status === 'ok' ? 'badge-ok' : 'badge-danger'}`}>
                      {st.status.toUpperCase()}
                    </span>
                    <strong>{st.step}. {st.label}</strong>
                    <span className="badge badge-neutral">{st.engineUsed}</span>
                  </div>
                  <span className="mono muted" style={{ fontSize: '0.74rem' }}>
                    {st.durationMs}ms · immune:{st.immuneVerdict}
                  </span>
                </div>
                <pre className="code-block" style={{ maxBlockSize: '180px', fontSize: '0.76rem' }}>
                  <code>{st.output}</code>
                </pre>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
