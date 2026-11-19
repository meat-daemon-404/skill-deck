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
  Copy,
  Download,
  Package,
  Play,
  Plus,
  RotateCcw,
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
} from '@skilldeck/core';
import {
  compileWorkflowGraph,
  fetchDemoWorkflows,
  generateExportBundle,
  type WorkspaceQuery,
} from '../api.js';

interface WorkflowExportViewProps {
  skills: SkillRecord[];
  mcpServers: McpServerRecord[];
  query: WorkspaceQuery;
  colorMode: 'light' | 'dark';
}

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  kind: WorkflowNodeInput['type'];
  description?: string;
}

function DeckFlowNode({ data }: NodeProps<Node<CustomNodeData>>) {
  return (
    <div className="workflow-node" data-kind={data.kind}>
      <Handle type="target" position={Position.Left} />
      <div className="row-wrap" style={{ justifyContent: 'space-between', marginBlockEnd: '0.2rem' }}>
        <span className="badge badge-neutral" style={{ fontSize: '0.64rem' }}>
          {data.kind.toUpperCase()}
        </span>
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
  description: 'Chains discovered skills and MCP servers with a verification gate.',
  nodes: [
    { id: 'n1', type: 'trigger', label: 'User Request', position: { x: 40, y: 140 } },
    { id: 'n2', type: 'skill', label: 'Primary Skill', position: { x: 300, y: 80 } },
    { id: 'n3', type: 'gate', label: 'Human Review Gate', position: { x: 580, y: 140 } },
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
}: WorkflowExportViewProps) {
  const [workflowName, setWorkflowName] = useState('Edge Feature Release Pipeline');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [compiled, setCompiled] = useState<CompiledWorkflowResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);

  const [selectedSkillToAdd, setSelectedSkillToAdd] = useState('');
  const [selectedMcpToAdd, setSelectedMcpToAdd] = useState('');

  // Cross-Platform Exporter state
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
  }, [setEdges, setNodes]);

  useEffect(() => {
    void loadStarterWorkflow();
  }, [loadStarterWorkflow]);

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

  async function handleCompile() {
    setCompiling(true);
    try {
      const graph: WorkflowGraph = {
        id: 'composer-workflow',
        name: workflowName.trim() || 'SkillDeck Orchestrator',
        description: `Visual workflow compiled by SkillDeck across ${nodes.length} stages.`,
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
      const result = await compileWorkflowGraph(graph);
      setCompiled(result);
    } finally {
      setCompiling(false);
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
      // Ignore clipboard rejection in restricted environments
    }
  }

  const activeFile = bundle?.files[selectedFileIndex];

  return (
    <section className="stack-md" aria-labelledby="workflow-heading">
      <div>
        <h1 id="workflow-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
          Workflow DAG Composer &amp; Cross-Platform Exporter
        </h1>
        <p className="card-subtitle">
          Wire discovered Skills, MCP servers, and review gates into an executable Orchestrator <code>SKILL.md</code>, or export secret-safe configuration bundles across agent runtimes.
        </p>
      </div>

      {/* Interactive React Flow DAG Composer */}
      <article className="card">
        <div className="card-header">
          <div className="row-wrap" style={{ flex: '1 1 280px' }}>
            <Workflow size={18} aria-hidden="true" />
            <label htmlFor="workflow-name-input" className="sr-only">
              Workflow name
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
              Reset Template
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={compiling || nodes.length === 0}
              onClick={() => void handleCompile()}
            >
              <Play size={13} aria-hidden="true" />
              {compiling ? 'Compiling...' : 'Compile to SKILL.md'}
            </button>
          </div>
        </div>

        {/* Palette Bar */}
        <div className="row-wrap">
          <div className="row-wrap">
            <label htmlFor="add-skill-select" className="sr-only">Choose a skill to add</label>
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
              onClick={() => addCanvasNode('skill', selectedSkillToAdd, 'Run skill instructions')}
            >
              <Plus size={13} aria-hidden="true" /> Add Skill
            </button>
          </div>

          {mcpServers.length > 0 && (
            <div className="row-wrap">
              <label htmlFor="add-mcp-select" className="sr-only">Choose an MCP server to add</label>
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
                onClick={() => addCanvasNode('mcp', selectedMcpToAdd, 'Invoke MCP tool')}
              >
                <Plus size={13} aria-hidden="true" /> Add MCP
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => addCanvasNode('gate', 'Approval Gate', 'Confirm before proceeding')}
          >
            <Plus size={13} aria-hidden="true" /> Add Gate
          </button>
        </div>

        <div className="flow-canvas-shell" aria-label="Interactive workflow canvas">
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

        {compiled && (
          <div className="stack-sm">
            <div className="card-header">
              <div className="row-wrap">
                <strong style={{ fontSize: '0.9rem' }}>
                  Compiled Orchestrator: <code>{compiled.slug}/SKILL.md</code>
                </strong>
                <span className="badge badge-accent">~{compiled.estimatedTokens}t</span>
                {compiled.hasCycle && <span className="badge badge-warn">Cycle detected</span>}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => void handleCopyCompiled()}>
                {copiedSkill ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copiedSkill ? 'Copied' : 'Copy SKILL.md'}
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
              Cross-Platform Bundle Exporter (Secret-Safe)
            </h2>
            <p className="card-subtitle">
              Convert your workspace into target layouts for Claude Code, Cursor, Gemini CLI, Antigravity, or Portable JSON. Hardcoded secrets are automatically replaced with <code>${'{ENV_VAR}'}</code> placeholders.
            </p>
          </div>
          <div className="row-wrap">
            <label htmlFor="export-target-select" className="sr-only">Target agent platform</label>
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
              {exporting ? 'Generating...' : 'Preview Export'}
            </button>
            {bundle && (
              <button type="button" className="btn btn-sm" onClick={handleDownloadBundleJson}>
                <Download size={13} aria-hidden="true" />
                Download Bundle JSON
              </button>
            )}
          </div>
        </div>

        {bundle && (
          <div className="stack-sm">
            <div className="row-wrap">
              <span className="badge badge-accent">{bundle.files.length} files generated</span>
              <span className="badge badge-neutral">{bundle.skillCount} skills · {bundle.mcpCount} MCP</span>
              <span className="badge badge-ok">
                {bundle.redactedSecretCount} secret(s) stripped to safe env refs
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
