import type {
  CompiledWorkflowResult,
  ExportBundleResult,
  ExportTarget,
  RouteResult,
  WorkflowGraph,
  WorkspaceReport,
} from '@skilldeck/core';

export type WorkspaceMode = 'demo' | 'local' | 'custom';

export interface WorkspaceQuery {
  mode: WorkspaceMode;
  customPath?: string;
  includeBuiltin?: boolean;
}

export async function fetchWorkspaceReport(query: WorkspaceQuery): Promise<WorkspaceReport> {
  const params = new URLSearchParams();
  params.set('mode', query.mode);
  if (query.mode === 'custom' && query.customPath?.trim()) {
    params.set('paths', query.customPath.trim());
  }
  if (query.includeBuiltin) {
    params.set('includeBuiltin', 'true');
  }

  const res = await fetch(`/api/report?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to load report (${res.status})`);
  }
  return res.json() as Promise<WorkspaceReport>;
}

export async function fetchDemoWorkflows(): Promise<WorkflowGraph[]> {
  const res = await fetch('/api/workflows/demo');
  if (!res.ok) return [];
  const data = (await res.json()) as { workflows?: WorkflowGraph[] };
  return data.workflows ?? [];
}

export async function runPromptRoute(
  prompt: string,
  query: WorkspaceQuery,
): Promise<RouteResult> {
  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      mode: query.mode,
      paths: query.mode === 'custom' && query.customPath?.trim() ? [query.customPath.trim()] : undefined,
      includeBuiltin: query.includeBuiltin,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || 'Routing request failed');
  }
  return res.json() as Promise<RouteResult>;
}

export async function compileWorkflowGraph(graph: WorkflowGraph): Promise<CompiledWorkflowResult> {
  const res = await fetch('/api/workflow/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graph),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || 'Workflow compilation failed');
  }
  return res.json() as Promise<CompiledWorkflowResult>;
}

export async function generateExportBundle(
  target: ExportTarget,
  query: WorkspaceQuery,
  skillIds?: string[],
  mcpIds?: string[],
): Promise<ExportBundleResult> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target,
      mode: query.mode,
      paths: query.mode === 'custom' && query.customPath?.trim() ? [query.customPath.trim()] : undefined,
      includeBuiltin: query.includeBuiltin,
      skillIds,
      mcpIds,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || 'Bundle export failed');
  }
  return res.json() as Promise<ExportBundleResult>;
}
