import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeWorkspace,
  compileWorkflowToSkill,
  exportBundle,
  simulatePromptRouting,
  type ExportTarget,
  type ScanOptions,
  type WorkflowGraph,
} from '@skilldeck/core';

export interface ServerOptions {
  port?: number;
  host?: string;
  demoWorkspacePath?: string;
  webDistPath?: string;
  defaultMode?: 'demo' | 'local';
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
  // packages/server/dist/index.js or packages/server/src/index.ts -> repo root is 3 levels up
  return path.resolve(path.dirname(currentFile), '..', '..', '..');
}

export function resolveDefaultDemoWorkspace(): string {
  return path.join(resolveRepoRoot(), 'examples', 'demo-workspace');
}

export function resolveDefaultWebDist(): string {
  return path.join(resolveRepoRoot(), 'apps', 'web', 'dist');
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
  if (
    origin &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  ) {
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
): ScanOptions {
  const mode = modeParam === 'demo' || modeParam === 'local' || modeParam === 'custom'
    ? modeParam
    : defaultMode;

  if (mode === 'demo') {
    return {
      mode: 'demo',
      paths: [demoWorkspacePath],
      includeBuiltin: false,
    };
  }

  if (mode === 'custom' && pathsParam && pathsParam.length > 0) {
    return {
      mode: 'custom',
      paths: pathsParam,
      includeBuiltin: false,
    };
  }

  return {
    mode: 'local',
    includeBuiltin,
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

  // Strict path traversal protection
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

  return http.createServer(async (req, res) => {
    setLocalCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'skilldeck-server',
          version: '0.1.0',
          defaultMode,
          demoWorkspaceExists: fs.existsSync(demoWorkspacePath),
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/report') {
        const modeParam = url.searchParams.get('mode');
        const pathsRaw = url.searchParams.get('paths');
        const pathsList = pathsRaw
          ? pathsRaw
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined;
        const includeBuiltin = url.searchParams.get('includeBuiltin') === 'true';

        const scanOpts = buildScanOptions(
          modeParam,
          pathsList,
          includeBuiltin,
          demoWorkspacePath,
          defaultMode,
        );
        const report = analyzeWorkspace(scanOpts);
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
        );
        const report = analyzeWorkspace(scanOpts);
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
        const compiled = compileWorkflowToSkill(body);
        sendJson(res, 200, compiled);
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
        );
        const report = analyzeWorkspace(scanOpts);

        const selectedSkills =
          Array.isArray(body.skillIds) && body.skillIds.length > 0
            ? report.skills.filter((s) => body.skillIds!.includes(s.id))
            : report.skills;
        const selectedMcps =
          Array.isArray(body.mcpIds) && body.mcpIds.length > 0
            ? report.mcpServers.filter((m) => body.mcpIds!.includes(m.id))
            : report.mcpServers;

        const bundle = exportBundle(target, selectedSkills, selectedMcps);
        sendJson(res, 200, bundle);
        return;
      }

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStaticFile(pathname, webDistPath, res)) {
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('SkillDeck API server is running. Build apps/web (`pnpm build`) to serve the Web Control Tower.');
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
