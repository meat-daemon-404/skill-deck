import { useCallback, useEffect, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  Package,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Workflow,
} from 'lucide-react';
import type {
  CompiledWorkflowResult,
  ExportBundleResult,
  ExportTarget,
  McpServerRecord,
  SkillRecord,
  WorkflowGraph,
  WorkflowNodeInput,
  WorkflowRunResult,
} from '@skilldeck/core';
import {
  compileWorkflowGraph,
  fetchDemoWorkflows,
  generateExportBundle,
  runWorkflowGraphApi,
  type WorkspaceQuery,
} from '../api.js';
import { useI18n } from '../i18n.js';

interface WorkflowExportViewProps {
  skills: SkillRecord[];
  mcpServers: McpServerRecord[];
  query: WorkspaceQuery;
  colorMode: 'light' | 'dark';
  externalGraph?: WorkflowGraph | null;
}

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  kind: WorkflowNodeInput['type'];
  description?: string;
  runStatus?: 'ok' | 'blocked' | 'quarantined' | 'error';
}

function DeckFlowNode({ data }: NodeProps<Node<CustomNodeData>>) {
  const statusBadge =
    data.runStatus === 'ok'
      ? 'badge-ok'
      : data.runStatus === 'quarantined' || data.runStatus === 'blocked' || data.runStatus === 'error'
        ? 'badge-danger'
        : null;

  return (
    <div
      className="workflow-node"
      data-kind={data.kind}
      style={{
        outline:
          data.runStatus === 'ok'
            ? '2px solid var(--ok)'
            : data.runStatus === 'quarantined' || data.runStatus === 'blocked'
              ? '2px solid var(--danger)'
              : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="row-wrap" style={{ justifyContent: 'space-between', marginBlockEnd: '0.2rem' }}>
        <span className="badge badge-neutral" style={{ fontSize: '0.64rem' }}>
          {data.kind.toUpperCase()}
        </span>
        {statusBadge && (
          <span className={`badge ${statusBadge}`} style={{ fontSize: '0.62rem' }}>
            {data.runStatus?.toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ fontWeight: 650 }} className="truncate-line">
        {data.label}
      </div>
      {data.description && (
        <div className="muted truncate-line" style={{ fontSize: '0.72rem', marginBlockStart: '0.15rem' }}>
          {data.description}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const NODE_TYPES = { deckNode: DeckFlowNode };

function toReactFlowNodes(graph: WorkflowGraph): Node<CustomNodeData>[] {
  return graph.nodes.map((n, index) => ({
    id: n.id,
    type: 'deckNode',
    position: n.position ?? { x: 60 + index * 240, y: 120 + (index % 2) * 110 },
    data: {
      label: n.label,
      kind: n.type,
      description: n.description,
    },
  }));
}

function toReactFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
  }));
}

const FALLBACK_GRAPH: WorkflowGraph = {
  id: 'custom-agent-flow',
  name: 'Multi-Skill Delivery Pipeline',
  description: 'Chains discovered skills and MCP servers with an Agent-Immune verification gate.',
  nodes: [
    { id: 'n1', type: 'trigger', label: 'User Request', position: { x: 40, y: 140 } },
    { id: 'n2', type: 'skill', label: 'Primary Skill', position: { x: 300, y: 80 } },
    { id: 'n3', type: 'gate', label: 'Agent-Immune Gate', position: { x: 580, y: 140 } },
    { id: 'n4', type: 'output', label: 'Verified Output', position: { x: 860, y: 140 } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4' },
  ],
};

export function WorkflowExportView({
  skills,
  mcpServers,
  query,
  colorMode,
  externalGraph,
}: WorkflowExportViewProps) {
  const { t } = useI18n();
  const [workflowName, setWorkflowName] = useState('Edge Feature Release Pipeline');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [compiled, setCompiled] = useState<CompiledWorkflowResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [copiedSkill, setCopiedSkill] = useState(false);

  const [selectedSkillToAdd, setSelectedSkillToAdd] = useState('');
  const [selectedMcpToAdd, setSelectedMcpToAdd] = useState('');

  const [exportTarget, setExportTarget] = useState<ExportTarget>('claude-code');
  const [bundle, setBundle] = useState<ExportBundleResult | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [exporting, setExporting] = useState(false);

  const loadStarterWorkflow = useCallback(async () => {
    const demos = await fetchDemoWorkflows();
    const graph = demos[0] ?? FALLBACK_GRAPH;
    setWorkflowName(graph.name);
    setNodes(toReactFlowNodes(graph));
    setEdges(toReactFlowEdges(graph));
    setRunResult(null);
  }, [setEdges, setNodes]);

  useEffect(() => {
    if (externalGraph) {
      setWorkflowName(externalGraph.name);
      setNodes(toReactFlowNodes(externalGraph));
      setEdges(toReactFlowEdges(externalGraph));
      setRunResult(null);
    } else {
      void loadStarterWorkflow();
    }
  }, [externalGraph, loadStarterWorkflow, setEdges, setNodes]);

  useEffect(() => {
    if (skills[0] && !selectedSkillToAdd) {
      setSelectedSkillToAdd(skills[0].name);
    }
    if (mcpServers[0] && !selectedMcpToAdd) {
      setSelectedMcpToAdd(mcpServers[0].name);
    }
  }, [skills, mcpServers, selectedSkillToAdd, selectedMcpToAdd]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    },
    [setEdges],
  );

  function addCanvasNode(kind: WorkflowNodeInput['type'], label: string, description?: string) {
    if (!label.trim()) return;
    const id = `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newNode: Node<CustomNodeData> = {
      id,
      type: 'deckNode',
      position: {
        x: 160 + (nodes.length % 4) * 210,
        y: 80 + Math.floor(nodes.length / 4) * 120,
      },
      data: { label, kind, description },
    };
    setNodes((prev) => [...prev, newNode]);
  }

  function snapshotGraph(): WorkflowGraph {
    return {
      id: 'composer-workflow',
      name: workflowName.trim() || 'SkillDeck Orchestrator',
      description: `Visual workflow orchestrated by SkillDeck across ${nodes.length} stages.`,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.kind,
        label: n.data.label,
        description: n.data.description,
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
  }

  async function handleCompile() {
    setCompiling(true);
    try {
      const result = await compileWorkflowGraph(snapshotGraph());
      setCompiled(result);
    } finally {
      setCompiling(false);
    }
  }

  async function handleRunWorkflow() {
    setRunning(true);
    try {
      const result = await runWorkflowGraphApi({
        graph: snapshotGraph(),
        query,
        runMode: 'dry-run',
      });
      setRunResult(result);
      const statusMap = new Map(result.steps.map((s) => [s.nodeId, s.status]));
      setNodes((prev) =>
        prev.map((n) => {
          const st = statusMap.get(n.id);
          return {
            ...n,
            data: {
              ...n.data,
              runStatus:
                st === 'ok' || st === 'blocked' || st === 'quarantined' || st === 'error'
                  ? st
                  : undefined,
            },
          };
        }),
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleGenerateExport(targetToUse: ExportTarget = exportTarget) {
    setExporting(true);
    try {
      const result = await generateExportBundle(targetToUse, query);
      setBundle(result);
      setSelectedFileIndex(0);
    } finally {
      setExporting(false);
    }
  }

  function handleDownloadBundleJson() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skilldeck-${bundle.target}-bundle.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopyCompiled() {
    if (!compiled) return;
    try {
      await navigator.clipboard.writeText(compiled.orchestratorSkillMd);
      setCopiedSkill(true);
      setTimeout(() => setCopiedSkill(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  }

  const activeFile = bundle?.files[selectedFileIndex];

  return (
    <section className="stack-md" aria-labelledby="workflow-heading">
      <div>
        <h1 id="workflow-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
          {t('可视化 DAG 工作流运行器 & 跨平台导出', 'Workflow DAG Live Runner & Cross-Platform Exporter')}
        </h1>
        <p className="card-subtitle">
          {t(
            '拖拽连线编排真实发现的 Skills、MCP 服务、SuperAgent 节点与免疫闸门；支持直接点击运行（逐节点高亮状态）或编译成标准总控 SKILL.md。',
            'Wire discovered Skills, MCP servers, Agent workers & immune gates; execute live with per-node status telemetry or compile into an Orchestrator SKILL.md.',
          )}
        </p>
      </div>

      {/* Interactive React Flow DAG Composer */}
      <article className="card">
        <div className="card-header">
          <div className="row-wrap" style={{ flex: '1 1 260px' }}>
            <Workflow size={18} aria-hidden="true" />
            <label htmlFor="workflow-name-input" className="sr-only">
              {t('工作流名称', 'Workflow name')}
            </label>
            <input
              id="workflow-name-input"
              type="text"
              className="input"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              style={{ inlineSize: 'min(320px, 100%)', fontWeight: 600 }}
            />
          </div>

          <div className="row-wrap">
            <button type="button" className="btn btn-sm" onClick={() => void loadStarterWorkflow()}>
              <RotateCcw size={13} aria-hidden="true" />
              {t('重置示例', 'Reset Template')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={compiling || nodes.length === 0}
              onClick={() => void handleCompile()}
            >
              <FileCode2 size={13} aria-hidden="true" />
              {compiling ? t('编译中...', 'Compiling...') : t('编译为 SKILL.md', 'Compile SKILL.md')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={running || nodes.length === 0}
              onClick={() => void handleRunWorkflow()}
            >
              <Play size={13} aria-hidden="true" />
              {running ? t('运行中...', 'Running...') : t('运行工作流', 'Run Workflow')}
            </button>
          </div>
        </div>

        {/* Palette Bar */}
        <div className="row-wrap">
          <div className="row-wrap">
            <label htmlFor="add-skill-select" className="sr-only">{t('选择技能节点', 'Choose skill')}</label>
            <select
              id="add-skill-select"
              className="select"
              value={selectedSkillToAdd}
              onChange={(e) => setSelectedSkillToAdd(e.target.value)}
            >
              {skills.map((s) => (
                <option key={s.id} value={s.name}>
                  Skill: {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!selectedSkillToAdd}
              onClick={() => addCanvasNode('skill', selectedSkillToAdd, t('执行技能规范', 'Run skill instructions'))}
            >
              <Plus size={13} aria-hidden="true" /> {t('添加技能', 'Add Skill')}
            </button>
          </div>

          {mcpServers.length > 0 && (
            <div className="row-wrap">
              <label htmlFor="add-mcp-select" className="sr-only">{t('选择 MCP 节点', 'Choose MCP')}</label>
              <select
                id="add-mcp-select"
                className="select"
                value={selectedMcpToAdd}
                onChange={(e) => setSelectedMcpToAdd(e.target.value)}
              >
                {mcpServers.map((m) => (
                  <option key={m.id} value={m.name}>
                    MCP: {m.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!selectedMcpToAdd}
                onClick={() => addCanvasNode('mcp', selectedMcpToAdd, t('经由 Hub 调用 MCP', 'Invoke MCP via Hub'))}
              >
                <Plus size={13} aria-hidden="true" /> {t('添加 MCP', 'Add MCP')}
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => addCanvasNode('gate', 'Agent-Immune Gate', t('免疫校验与人工审批', 'Immune check & approval'))}
          >
            <Plus size={13} aria-hidden="true" /> {t('添加免疫闸门', 'Add Immune Gate')}
          </button>
        </div>

        <div className="flow-canvas-shell" aria-label={t('交互式工作流画布', 'Interactive workflow canvas')}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            colorMode={colorMode}
            fitView
          >
            <Background gap={18} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Live Run Execution Trace */}
        {runResult && (
          <div className="stack-sm">
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <div className="row-wrap">
                {runResult.status === 'completed' ? (
                  <CheckCircle2 size={16} aria-hidden="true" style={{ color: 'var(--ok)' }} />
                ) : (
                  <ShieldAlert size={16} aria-hidden="true" style={{ color: 'var(--danger)' }} />
                )}
                <strong>
                  {t(`工作流执行完成 (${runResult.status.toUpperCase()})`, `Workflow Run (${runResult.status.toUpperCase()})`)}
                </strong>
                <span className="badge badge-neutral">{runResult.steps.length} steps · {runResult.totalDurationMs}ms</span>
              </div>
            </div>
            <div className="stack-sm">
              {runResult.steps.map((st) => (
                <div
                  key={`${st.nodeId}-${st.step}`}
                  style={{
                    padding: '0.55rem 0.8rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${st.status === 'ok' ? 'var(--border)' : 'var(--danger)'}`,
                    background: 'var(--bg-elevated)',
                    fontSize: '0.79rem',
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
                    <span className="mono muted">{st.durationMs}ms</span>
                  </div>
                  <p className="muted" style={{ marginBlockStart: '0.25rem', whiteSpace: 'pre-wrap' }}>
                    {st.output}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {compiled && (
          <div className="stack-sm">
            <div className="card-header">
              <div className="row-wrap">
                <strong style={{ fontSize: '0.9rem' }}>
                  {t('已编译总控技能：', 'Compiled Orchestrator: ')}<code>{compiled.slug}/SKILL.md</code>
                </strong>
                <span className="badge badge-accent">~{compiled.estimatedTokens}t</span>
                {compiled.hasCycle && <span className="badge badge-warn">{t('检测到环路', 'Cycle detected')}</span>}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => void handleCopyCompiled()}>
                {copiedSkill ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copiedSkill ? t('已复制', 'Copied') : t('复制 SKILL.md', 'Copy SKILL.md')}
              </button>
            </div>
            <pre
              className="code-block"
              role="region"
              aria-label="Compiled orchestrator SKILL.md output"
              tabIndex={0}
            >
              <code>{compiled.orchestratorSkillMd}</code>
            </pre>
          </div>
        )}
      </article>

      {/* Cross-Platform Exporter */}
      <article className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Package size={17} aria-hidden="true" />
              {t('跨平台脱敏配置导出器', 'Cross-Platform Bundle Exporter (Secret-Safe)')}
            </h2>
            <p className="card-subtitle">
              {t(
                '一键把当前工作区转换为 Claude Code、Cursor (.mdc)、Gemini CLI、Antigravity 插件或 Portable JSON，所有明文密钥自动替换为 ${ENV_VAR}。',
                'Convert workspace into Claude Code, Cursor (.mdc), Gemini CLI, Antigravity Plugin, or Portable JSON with all literal secrets replaced by ${ENV_VAR}.',
              )}
            </p>
          </div>
          <div className="row-wrap">
            <label htmlFor="export-target-select" className="sr-only">{t('导出目标平台', 'Target platform')}</label>
            <select
              id="export-target-select"
              className="select"
              value={exportTarget}
              onChange={(e) => {
                const next = e.target.value as ExportTarget;
                setExportTarget(next);
                void handleGenerateExport(next);
              }}
            >
              <option value="claude-code">Claude Code (.claude/skills + .mcp.json)</option>
              <option value="cursor">Cursor (.cursor/rules/*.mdc + mcp.json)</option>
              <option value="gemini-cli">Gemini CLI (.gemini/skills + settings.json)</option>
              <option value="antigravity">Antigravity Plugin (plugin.json + skills/)</option>
              <option value="portable-json">Portable JSON Snapshot</option>
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={exporting}
              onClick={() => void handleGenerateExport()}
            >
              {exporting ? t('生成中...', 'Generating...') : t('预览导出包', 'Preview Export')}
            </button>
            {bundle && (
              <button type="button" className="btn btn-sm" onClick={handleDownloadBundleJson}>
                <Download size={13} aria-hidden="true" />
                {t('下载 JSON', 'Download Bundle')}
              </button>
            )}
          </div>
        </div>

        {bundle && (
          <div className="stack-sm">
            <div className="row-wrap">
              <span className="badge badge-accent">{bundle.files.length} {t('个文件', 'files')}</span>
              <span className="badge badge-neutral">{bundle.skillCount} skills · {bundle.mcpCount} MCP</span>
              <span className="badge badge-ok">
                {t(`已自动脱敏 ${bundle.redactedSecretCount} 个密钥`, `${bundle.redactedSecretCount} secret(s) stripped`)}
              </span>
            </div>

            <div className="grid-two" style={{ gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)' }}>
              <div className="stack-sm" style={{ maxBlockSize: '340px', overflow: 'auto' }}>
                {bundle.files.map((file, idx) => (
                  <button
                    key={file.relativePath}
                    type="button"
                    className="nav-btn"
                    aria-current={idx === selectedFileIndex ? 'page' : undefined}
                    onClick={() => setSelectedFileIndex(idx)}
                  >
                    <span className="truncate-line mono" style={{ fontSize: '0.78rem' }}>
                      {file.relativePath}
                    </span>
                  </button>
                ))}
              </div>

              {activeFile && (
                <pre
                  className="code-block"
                  role="region"
                  aria-label={`Export preview of ${activeFile.relativePath}`}
                  tabIndex={0}
                >
                  <code>{activeFile.content}</code>
                </pre>
              )}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
