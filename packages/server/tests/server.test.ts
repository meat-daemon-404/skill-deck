import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { startSkillDeckServer } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_WORKSPACE = path.resolve(__dirname, '../../../examples/demo-workspace');

describe('@skilldeck/server — REST API integration', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startSkillDeckServer({
      port: 0,
      host: '127.0.0.1',
      demoWorkspacePath: DEMO_WORKSPACE,
      defaultMode: 'demo',
    });
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves GET /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; demoWorkspaceExists: boolean };
    expect(data.ok).toBe(true);
    expect(data.demoWorkspaceExists).toBe(true);
  });

  it('serves GET /api/report?mode=demo with redacted secrets', async () => {
    const res = await fetch(`${baseUrl}/api/report?mode=demo`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('sk-demo-9876543210abcdefghijklmnop');
    const report = JSON.parse(text) as { summary: { skillCount: number }; conflicts: unknown[] };
    expect(report.summary.skillCount).toBe(8);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(2);
  });

  it('serves POST /api/route for bilingual prompts', async () => {
    const res = await fetch(`${baseUrl}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Audit PostgreSQL RLS policies and slow indexes',
        mode: 'demo',
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: Array<{ skillName: string }> };
    expect(data.matches[0]?.skillName).toBe('postgres-schema-guardian');
  });

  it('serves POST /api/workflow/compile and POST /api/export', async () => {
    const wfRes = await fetch(`${baseUrl}/api/workflow/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'api-test-wf',
        name: 'API Test Workflow',
        description: 'End-to-end test',
        nodes: [
          { id: '1', type: 'trigger', label: 'Start' },
          { id: '2', type: 'skill', label: 'cloudflare-workers-deploy' },
        ],
        edges: [{ id: 'e1', source: '1', target: '2' }],
      }),
    });
    expect(wfRes.status).toBe(200);
    const wf = (await wfRes.json()) as { slug: string; orchestratorSkillMd: string };
    expect(wf.slug).toBe('api-test-workflow');
    expect(wf.orchestratorSkillMd).toContain('cloudflare-workers-deploy');

    const expRes = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'cursor', mode: 'demo' }),
    });
    expect(expRes.status).toBe(200);
    const expText = await expRes.text();
    expect(expText).not.toContain('sk-demo-9876543210abcdefghijklmnop');
    const expData = JSON.parse(expText) as { files: Array<{ relativePath: string }> };
    expect(expData.files.some((f) => f.relativePath.endsWith('.mdc'))).toBe(true);
  });
});
