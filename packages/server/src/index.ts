import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeWorkspaceAsync,
  applyVaultSync,
  compileWorkflowToSkill,
  createSuperAgentPlan,
  detectLocalAgents,
  distillAndPersistPitfallAntibody,
  executeWorkflowGraph,
  exportBundle,
  exportRulesJsonl,
  getVaultStatus,
  importSkillsToVault,
  previewVaultSync,
  probeLlmEndpoint,
  recallPitfallAntibodies,
  rollbackVaultTransaction,
  runSuperAgentToolLoop,
  scanContentForThreats,
  simulatePromptRouting,
  toggleSkillFileState,
  type ExportTarget,
  type ImmuneAntibody,
  type OpenAiToolDef,
  type ScanOptions,
  type SuperAgentLlmConfig,
  type WorkflowGraph,
} from '@skilldeck/core';
import { HUB_META_TOOLS, SkillDeckHub } from '@skilldeck/hub';

export interface ServerOptions {
  port?: number;
  host?: string;
  demoWorkspacePath?: string;
  webDistPath?: string;
  vaultRoot?: string;
  defaultMode?: 'demo' | 'local';
  hub?: SkillDeckHub;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const VALID_EXPORT_TARGETS = new Set<ExportTarget>([
  'claude-code',
  'cursor',
  'gemini-cli',
  'antigravity',
  'portable-json',
]);

export function resolveRepoRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..', '..', '..');
}

export function resolveDefaultDemoWorkspace(): string {
  return path.join(resolveRepoRoot(), 'examples', 'demo-workspace');
}

export function resolveDefaultWebDist(): string {
  return path.join(resolveRepoRoot(), 'apps', 'web', 'dist');
}

export function resolveDefaultCliEntry(): string {
  return path.join(resolveRepoRoot(), 'packages', 'cli', 'dist', 'cli.js');
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function setLocalCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request payload exceeds maximum allowed size (1 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve((raw.trim() ? JSON.parse(raw) : {}) as T);
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function buildScanOptions(
  modeParam: string | null | undefined,
  pathsParam: string[] | undefined,
  includeBuiltin: boolean,
  demoWorkspacePath: string,
  defaultMode: 'demo' | 'local',
  customAntibodies?: ImmuneAntibody[],
): ScanOptions {
  const mode =
    modeParam === 'demo' || modeParam === 'local' || modeParam === 'custom'
      ? modeParam
      : defaultMode;

  if (mode === 'demo') {
    return {
      mode: 'demo',
      paths: [demoWorkspacePath],
      includeBuiltin: false,
      customAntibodies,
    };
  }

  if (mode === 'custom' && pathsParam && pathsParam.length > 0) {
    return {
      mode: 'custom',
      paths: pathsParam,
      includeBuiltin: false,
      customAntibodies,
    };
  }

  return {
    mode: 'local',
    includeBuiltin,
    customAntibodies,
  };
}

function loadDemoWorkflows(demoWorkspacePath: string): WorkflowGraph[] {
  const workflowsDir = path.join(demoWorkspacePath, 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    return [];
  }
  const results: WorkflowGraph[] = [];
  for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(workflowsDir, entry.name), 'utf8'),
      ) as WorkflowGraph;
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        results.push(parsed);
      }
    } catch {
      // Ignore malformed demo workflow files
    }
  }
  return results;
}

function serveStaticFile(
  reqPath: string,
  webDistPath: string,
  res: ServerResponse,
): boolean {
  if (!fs.existsSync(webDistPath)) {
    return false;
  }

  const decoded = decodeURIComponent(reqPath.split('?')[0] ?? '/');
  const safeRelative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = path.resolve(webDistPath, safeRelative);
  const resolvedBase = path.resolve(webDistPath);

  if (!candidate.startsWith(resolvedBase)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  const targetFile =
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(resolvedBase, 'index.html');

  if (!fs.existsSync(targetFile)) {
    return false;
  }

  const ext = path.extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(targetFile).pipe(res);
  return true;
}

export function createSkillDeckServer(options: ServerOptions = {}): http.Server {
  const demoWorkspacePath = options.demoWorkspacePath ?? resolveDefaultDemoWorkspace();
  const webDistPath = options.webDistPath ?? resolveDefaultWebDist();
  const defaultMode = options.defaultMode ?? 'demo';
  const vaultRoot = options.vaultRoot;
  const hub = options.hub ?? new SkillDeckHub({ cliEntryPath: resolveDefaultCliEntry() });

  return http.createServer(async (req, res) => {
    setLocalCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    const getScanOptsFromQuery = (): ScanOptions => {
      const modeParam = url.searchParams.get('mode');
      const pathsRaw = url.searchParams.get('paths');
      const pathsList = pathsRaw
        ? pathsRaw
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        : undefined;
      const includeBuiltin = url.searchParams.get('includeBuiltin') === 'true';
      return buildScanOptions(
        modeParam,
        pathsList,
        includeBuiltin,
        demoWorkspacePath,
        defaultMode,
        hub.getCustomAntibodies(),
      );
    };

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'skilldeck-server',
          version: '0.2.0',
          defaultMode,
          demoWorkspaceExists: fs.existsSync(demoWorkspacePath),
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/report') {
        const report = await analyzeWorkspaceAsync(getScanOptsFromQuery());
        sendJson(res, 200, report);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/workflows/demo') {
        sendJson(res, 200, { workflows: loadDemoWorkflows(demoWorkspacePath) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/route') {
        const body = await readJsonBody<{
          prompt?: string;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);

        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const result = simulatePromptRouting(prompt, report.skills, report.mcpServers);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/workflow/compile') {
        const body = await readJsonBody<WorkflowGraph>(req);
        if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
          sendJson(res, 400, { error: 'Workflow payload must include `nodes` and `edges` arrays.' });
          return;
        }
        sendJson(res, 200, compileWorkflowToSkill(body));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/workflow/run') {
        const body = await readJsonBody<{
          graph?: WorkflowGraph;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
          runMode?: 'dry-run' | 'live';
          goalContext?: string;
          llmConfig?: SuperAgentLlmConfig;
        }>(req);

        if (!body.graph || !Array.isArray(body.graph.nodes)) {
          sendJson(res, 400, { error: 'Missing `graph` payload.' });
          return;
        }
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const result = await executeWorkflowGraph({
          graph: body.graph,
          report,
          mode: body.runMode === 'live' ? 'live' : 'dry-run',
          goalContext: body.goalContext,
          customAntibodies: hub.getCustomAntibodies(),
          llmConfig: body.llmConfig,
          mcpInvoker: async (serverName, toolName, args) => {
            const res = await hub.executeMetaTool(
              'skilldeck_call_tool',
              { serverName, toolName, arguments: args, dryRun: body.runMode !== 'live' },
              scanOpts,
              'workflow',
            );
            return res.contentText;
          },
        });
        hub.recordTrace({
          source: 'workflow',
          serverName: 'workflow-runner',
          toolName: body.graph.name,
          durationMs: result.totalDurationMs,
          status:
            result.status === 'completed'
              ? 'ok'
              : result.status === 'blocked'
                ? 'quarantined'
                : 'error',
          immuneAction: result.status === 'blocked' ? 'quarantine' : 'allow',
          summary: `Workflow "${body.graph.name}" ${result.status} (${result.steps.length} steps, ${result.totalDurationMs}ms)`,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/export') {
        const body = await readJsonBody<{
          target?: ExportTarget;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
          skillIds?: string[];
          mcpIds?: string[];
        }>(req);

        const target: ExportTarget =
          body.target && VALID_EXPORT_TARGETS.has(body.target) ? body.target : 'claude-code';
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);

        const selectedSkills =
          Array.isArray(body.skillIds) && body.skillIds.length > 0
            ? report.skills.filter((s) => body.skillIds!.includes(s.id))
            : report.skills;
        const selectedMcps =
          Array.isArray(body.mcpIds) && body.mcpIds.length > 0
            ? report.mcpServers.filter((m) => body.mcpIds!.includes(m.id))
            : report.mcpServers;

        sendJson(res, 200, exportBundle(target, selectedSkills, selectedMcps));
        return;
      }

      // === Agent-Immune Endpoints ===
      if (req.method === 'POST' && pathname === '/api/immune/scan-text') {
        const body = await readJsonBody<{
          text?: string;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);
        const text = typeof body.text === 'string' ? body.text : '';
        const findings = scanContentForThreats(
          text,
          { targetId: 'manual-scan', targetName: 'Manual Payload Check', filePath: 'inline' },
          hub.getCustomAntibodies(),
        );
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const pitfallRecall = recallPitfallAntibodies(
          text,
          report.immune.agentImmuneBridge.pitfallAntibodies,
          5,
        );
        sendJson(res, 200, {
          findings,
          verdict:
            findings.some((f) => f.severity === 'critical') || findings.length >= 2
              ? 'quarantine'
              : findings.length === 1
                ? 'caution'
                : 'safe',
          pitfallRecall,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/immune/pitfall') {
        const body = await readJsonBody<{
          trigger_pattern?: string;
          symptom?: string;
          prescription?: string;
          tool_name?: string;
          root_cause?: string;
        }>(req);
        if (!body.trigger_pattern?.trim() || !body.prescription?.trim()) {
          sendJson(res, 400, { error: 'Both `trigger_pattern` and `prescription` are required.' });
          return;
        }
        const created = distillAndPersistPitfallAntibody({
          trigger_pattern: body.trigger_pattern,
          symptom: body.symptom ?? 'Repeated workflow pitfall',
          prescription: body.prescription,
          tool_name: body.tool_name,
          root_cause: body.root_cause,
        });
        sendJson(res, 200, { antibody: created });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/immune/antibody') {
        const body = await readJsonBody<{
          name?: string;
          sampleText?: string;
          severity?: ImmuneAntibody['severity'];
        }>(req);
        if (!body.sampleText?.trim()) {
          sendJson(res, 400, { error: '`sampleText` is required to synthesize an antibody.' });
          return;
        }
        const ab = hub.addCustomAntibody({
          name: body.name ?? 'Custom Runtime Antibody',
          sampleText: body.sampleText,
          severity: body.severity ?? 'high',
        });
        sendJson(res, 200, { antibody: ab });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/immune/export-jsonl') {
        const report = await analyzeWorkspaceAsync(getScanOptsFromQuery());
        const jsonl = exportRulesJsonl(report.immune.agentImmuneBridge.pitfallAntibodies);
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': 'attachment; filename="rules.jsonl"',
        });
        res.end(jsonl);
        return;
      }

      // === MCP Hub & Live Telemetry Endpoints ===
      if (req.method === 'GET' && pathname === '/api/hub/status') {
        const report = await analyzeWorkspaceAsync(getScanOptsFromQuery());
        sendJson(res, 200, hub.getStatusSnapshot(report));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/hub/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        const unsubscribe = hub.subscribe((ev) => {
          res.write(`event: ${ev.kind}\ndata: ${JSON.stringify(ev.data)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          res.write(': keepalive\n\n');
        }, 20_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/hub/ping') {
        const body = await readJsonBody<{
          serverName?: string;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);
        if (!body.serverName) {
          sendJson(res, 400, { error: '`serverName` is required.' });
          return;
        }
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const ping = await hub.pingServer(body.serverName, report);
        sendJson(res, 200, ping);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/hub/call') {
        const body = await readJsonBody<{
          toolName?: string;
          arguments?: Record<string, unknown>;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);
        if (!body.toolName) {
          sendJson(res, 400, { error: '`toolName` is required.' });
          return;
        }
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const result = await hub.executeMetaTool(
          body.toolName,
          body.arguments ?? {},
          scanOpts,
          'hub-api',
        );
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/hub/policy') {
        const body = await readJsonBody<{ requireApprovalForHighRisk?: boolean }>(req);
        if (typeof body.requireApprovalForHighRisk === 'boolean') {
          hub.setRequireApprovalForHighRisk(body.requireApprovalForHighRisk);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/hub/quarantine/resolve') {
        const body = await readJsonBody<{
          id?: string;
          decision?: 'approve' | 'reject' | 'immunize';
        }>(req);
        if (!body.id || !body.decision) {
          sendJson(res, 400, { error: '`id` and `decision` are required.' });
          return;
        }
        sendJson(res, 200, hub.resolveQuarantine(body.id, body.decision));
        return;
      }

      // === Skill Vault & Sync Endpoints ===
      if (req.method === 'GET' && pathname === '/api/vault/status') {
        sendJson(res, 200, getVaultStatus(vaultRoot));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/import') {
        const body = await readJsonBody<{
          skillIds?: string[];
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const selected =
          Array.isArray(body.skillIds) && body.skillIds.length > 0
            ? report.skills.filter((s) => body.skillIds!.includes(s.id))
            : report.skills.filter((s) => {
                const imm = report.immune.skillReports.find((r) => r.skillId === s.id);
                return imm?.verdict !== 'quarantine';
              });
        const tx = importSkillsToVault(selected, vaultRoot);
        sendJson(res, 200, { transaction: tx, vault: getVaultStatus(vaultRoot) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/sync-preview') {
        const body = await readJsonBody<{ targetRoot?: string; slugs?: string[] }>(req);
        if (!body.targetRoot?.trim()) {
          sendJson(res, 400, { error: '`targetRoot` directory path is required.' });
          return;
        }
        const items = previewVaultSync(body.targetRoot.trim(), vaultRoot, body.slugs);
        sendJson(res, 200, { targetRoot: path.resolve(body.targetRoot.trim()), items });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/sync-apply') {
        const body = await readJsonBody<{ targetRoot?: string; slugs?: string[] }>(req);
        if (!body.targetRoot?.trim()) {
          sendJson(res, 400, { error: '`targetRoot` directory path is required.' });
          return;
        }
        const tx = applyVaultSync(body.targetRoot.trim(), vaultRoot, body.slugs);
        sendJson(res, 200, { transaction: tx, vault: getVaultStatus(vaultRoot) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/toggle-skill') {
        const body = await readJsonBody<{
          filePath?: string;
          action?: 'disable' | 'enable' | 'quarantine';
        }>(req);
        if (!body.filePath || !body.action) {
          sendJson(res, 400, { error: '`filePath` and `action` are required.' });
          return;
        }
        const tx = toggleSkillFileState(body.filePath, body.action, vaultRoot);
        sendJson(res, 200, { transaction: tx, vault: getVaultStatus(vaultRoot) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/vault/rollback') {
        const body = await readJsonBody<{ transactionId?: string }>(req);
        if (!body.transactionId) {
          sendJson(res, 400, { error: '`transactionId` is required.' });
          return;
        }
        const tx = rollbackVaultTransaction(body.transactionId, vaultRoot);
        sendJson(res, 200, { transaction: tx, vault: getVaultStatus(vaultRoot) });
        return;
      }

      // === SuperAgent Endpoints ===
      if (req.method === 'GET' && pathname === '/api/superagent/agents') {
        const agents = await detectLocalAgents();
        sendJson(res, 200, { agents });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/superagent/probe-llm') {
        const body = await readJsonBody<{ endpoint?: string; apiKey?: string }>(req);
        const endpoint = body.endpoint?.trim() || 'http://127.0.0.1:11434/v1';
        const result = await probeLlmEndpoint(endpoint, body.apiKey);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/superagent/chat') {
        const body = await readJsonBody<{
          goal?: string;
          endpoint?: string;
          model?: string;
          apiKey?: string;
          maxTurns?: number;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
        }>(req);

        if (!body.goal?.trim()) {
          sendJson(res, 400, { error: '`goal` is required.' });
          return;
        }
        if (!body.endpoint?.trim() || !body.model?.trim()) {
          sendJson(res, 400, { error: 'Both `endpoint` and `model` are required for Live SuperAgent Chat.' });
          return;
        }

        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const tools: OpenAiToolDef[] = HUB_META_TOOLS.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));

        const result = await runSuperAgentToolLoop({
          goal: body.goal.trim(),
          llm: {
            endpoint: body.endpoint.trim(),
            model: body.model.trim(),
            apiKey: body.apiKey?.trim() || undefined,
            maxTurns: body.maxTurns ?? 6,
          },
          tools,
          report,
          executeTool: async (toolName, args) => {
            const exec = await hub.executeMetaTool(toolName, args, scanOpts, 'superagent');
            return {
              ok: exec.ok,
              contentText: exec.contentText,
              durationMs: exec.trace.durationMs,
              immuneAction: exec.trace.immuneAction,
            };
          },
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/superagent/plan') {
        const body = await readJsonBody<{
          goal?: string;
          mode?: string;
          paths?: string[];
          includeBuiltin?: boolean;
          preferredEngine?: string;
          llmConfig?: SuperAgentLlmConfig;
        }>(req);
        if (!body.goal?.trim()) {
          sendJson(res, 400, { error: '`goal` prompt is required.' });
          return;
        }
        const scanOpts = buildScanOptions(
          body.mode,
          body.paths,
          Boolean(body.includeBuiltin),
          demoWorkspacePath,
          defaultMode,
          hub.getCustomAntibodies(),
        );
        const report = await analyzeWorkspaceAsync(scanOpts);
        const plan = await createSuperAgentPlan({
          goal: body.goal,
          report,
          preferredEngine: body.preferredEngine,
          llmConfig: body.llmConfig,
        });
        hub.recordTrace({
          source: 'superagent',
          serverName: 'superagent-planner',
          toolName: 'plan',
          durationMs: 12,
          status: 'ok',
          immuneAction: 'allow',
          summary: `Planned ${plan.steps.length} steps (${plan.selectedSkills.length} skills, ${plan.skippedQuarantinedSkills.length} quarantined skipped)`,
        });
        sendJson(res, 200, plan);
        return;
      }

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStaticFile(pathname, webDistPath, res)) {
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(
          'SkillDeck API server is running. Build apps/web (`pnpm build`) to serve the Web Control Tower.',
        );
        return;
      }

      sendJson(res, 404, { error: `Route not found: ${req.method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { error: message });
    }
  });
}

export async function startSkillDeckServer(
  options: ServerOptions = {},
): Promise<{ server: http.Server; url: string; port: number; host: string }> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4173;
  const server = createSkillDeckServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
  };
}
