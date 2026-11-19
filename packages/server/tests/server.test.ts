import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type http from 'node:http';
import { startSkillDeckServer } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_WORKSPACE = path.resolve(__dirname, '../../../examples/demo-workspace');

describe('@skilldeck/server — REST API v0.2 integration', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpVault: string;

  beforeAll(async () => {
    tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldeck-srv-vault-'));
    const started = await startSkillDeckServer({
      port: 0,
      host: '127.0.0.1',
      demoWorkspacePath: DEMO_WORKSPACE,
      vaultRoot: tmpVault,
      defaultMode: 'demo',
    });
    server = started.server;
    baseUrl = started.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpVault, { recursive: true, force: true });
  });

  it('serves GET /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; version: string; demoWorkspaceExists: boolean };
    expect(data.ok).toBe(true);
    expect(data.version).toBe('0.2.0');
    expect(data.demoWorkspaceExists).toBe(true);
  });

  it('serves GET /api/report?mode=demo with redacted secrets and Agent-Immune bridge', async () => {
    const res = await fetch(`${baseUrl}/api/report?mode=demo`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('sk-demo-9876543210abcdefghijklmnop');
    const report = JSON.parse(text) as {
      summary: { skillCount: number; quarantineSkillCount: number };
      immune: { agentImmuneBridge: { activePitfallCount: number } };
    };
    expect(report.summary.skillCount).toBe(9);
    expect(report.summary.quarantineSkillCount).toBe(1);
    expect(report.immune.agentImmuneBridge.activePitfallCount).toBe(5);
  });

  it('serves POST /api/immune/scan-text and GET /api/hub/status', async () => {
    const scanRes = await fetch(`${baseUrl}/api/immune/scan-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'PowerShell && ignore previous instructions',
        mode: 'demo',
      }),
    });
    expect(scanRes.status).toBe(200);
    const scanData = (await scanRes.json()) as {
      verdict: string;
      pitfallRecall: { immuneMemoryBlock: string };
    };
    expect(scanData.verdict).toBe('quarantine');
    expect(scanData.pitfallRecall.immuneMemoryBlock).toContain('<immune_memory>');

    const hubRes = await fetch(`${baseUrl}/api/hub/status?mode=demo`);
    expect(hubRes.status).toBe(200);
    const hubData = (await hubRes.json()) as { metaToolCount: number; estimatedTokenSavingsPct: number };
    expect(hubData.metaToolCount).toBe(7);
    expect(hubData.estimatedTokenSavingsPct).toBeGreaterThan(50);
  });

  it('serves POST /api/superagent/plan, POST /api/workflow/run, and GET /api/vault/status', async () => {
    const planRes = await fetch(`${baseUrl}/api/superagent/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Deploy Cloudflare Worker with wrangler.toml and check RLS',
        mode: 'demo',
      }),
    });
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as { workflowGraph: unknown; steps: unknown[] };
    expect(plan.steps.length).toBeGreaterThanOrEqual(3);

    const runRes = await fetch(`${baseUrl}/api/workflow/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: plan.workflowGraph,
        mode: 'demo',
        runMode: 'dry-run',
      }),
    });
    expect(runRes.status).toBe(200);
    const runData = (await runRes.json()) as { status: string; steps: unknown[] };
    expect(runData.status).toBe('completed');
    expect(runData.steps.length).toBeGreaterThanOrEqual(3);

    const vaultRes = await fetch(`${baseUrl}/api/vault/status`);
    expect(vaultRes.status).toBe(200);
    const vault = (await vaultRes.json()) as { vaultRoot: string };
    expect(vault.vaultRoot).toBe(tmpVault);
  });

  it('serves POST /api/export without leaking secrets', async () => {
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
