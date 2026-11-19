import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { McpServerRecord } from '@skilldeck/core';

export interface DownstreamToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface DownstreamPingResult {
  serverName: string;
  ok: boolean;
  latencyMs: number;
  transport: McpServerRecord['transport'];
  tools: DownstreamToolInfo[];
  error?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * Probes a downstream MCP server (`initialize` + `tools/list`) over stdio or HTTP JSON-RPC 2.0.
 */
export async function pingDownstreamMcp(
  server: McpServerRecord,
  timeoutMs = 7000,
): Promise<DownstreamPingResult> {
  const start = Date.now();
  if (server.disabled) {
    return {
      serverName: server.name,
      ok: false,
      latencyMs: 0,
      transport: server.transport,
      tools: [],
      error: 'Server is disabled in configuration.',
    };
  }

  if (server.transport === 'http' || server.transport === 'sse') {
    if (!server.url) {
      return {
        serverName: server.name,
        ok: false,
        latencyMs: 0,
        transport: server.transport,
        tools: [],
        error: 'Missing remote endpoint URL.',
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });
      clearTimeout(timer);

      const latencyMs = Math.max(1, Date.now() - start);
      if (!res.ok) {
        return {
          serverName: server.name,
          ok: false,
          latencyMs,
          transport: server.transport,
          tools: [],
          error: `Endpoint responded HTTP ${res.status} (may require session handshake or OAuth).`,
        };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const json = (await res.json()) as JsonRpcResponse;
        const tools = extractToolsArray(json.result);
        return {
          serverName: server.name,
          ok: !json.error,
          latencyMs,
          transport: server.transport,
          tools,
          error: json.error?.message,
        };
      }

      return {
        serverName: server.name,
        ok: true,
        latencyMs,
        transport: server.transport,
        tools: [],
      };
    } catch (err) {
      return {
        serverName: server.name,
        ok: false,
        latencyMs: Math.max(1, Date.now() - start),
        transport: server.transport,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (server.transport === 'stdio' && server.command) {
    if (server.commandAvailable === false) {
      return {
        serverName: server.name,
        ok: false,
        latencyMs: 0,
        transport: 'stdio',
        tools: [],
        error: `Executable "${server.command}" not found on PATH.`,
      };
    }

    try {
      const result = await runStdioRpcSequence(
        server.command,
        server.args,
        [
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'skilldeck-hub', version: '0.2.0' },
            },
          },
          {
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          },
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          },
        ],
        2,
        timeoutMs,
      );

      return {
        serverName: server.name,
        ok: !result.error,
        latencyMs: Math.max(1, Date.now() - start),
        transport: 'stdio',
        tools: extractToolsArray(result.result),
        error: result.error?.message,
      };
    } catch (err) {
      return {
        serverName: server.name,
        ok: false,
        latencyMs: Math.max(1, Date.now() - start),
        transport: 'stdio',
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    serverName: server.name,
    ok: false,
    latencyMs: 0,
    transport: server.transport,
    tools: [],
    error: 'Unsupported MCP transport configuration.',
  };
}

/**
 * Invokes a specific tool on a downstream stdio or HTTP MCP server via JSON-RPC 2.0.
 */
export async function invokeDownstreamMcpTool(
  server: McpServerRecord,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; output: string; latencyMs: number }> {
  const start = Date.now();

  if (server.transport === 'stdio' && server.command) {
    if (server.commandAvailable === false) {
      return {
        ok: false,
        output: `Executable "${server.command}" not found on PATH.`,
        latencyMs: 0,
      };
    }

    const res = await runStdioRpcSequence(
      server.command,
      server.args,
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'skilldeck-hub', version: '0.2.0' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        },
      ],
      2,
      timeoutMs,
    );

    const latencyMs = Math.max(1, Date.now() - start);
    if (res.error) {
      return { ok: false, output: res.error.message ?? 'MCP tool error', latencyMs };
    }
    return {
      ok: true,
      output: typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2),
      latencyMs,
    };
  }

  if ((server.transport === 'http' || server.transport === 'sse') && server.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
      });
      clearTimeout(timer);
      const text = await res.text();
      return {
        ok: res.ok,
        output: text.slice(0, 4000),
        latencyMs: Math.max(1, Date.now() - start),
      };
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        output: err instanceof Error ? err.message : String(err),
        latencyMs: Math.max(1, Date.now() - start),
      };
    }
  }

  return {
    ok: false,
    output: 'Unsupported MCP transport.',
    latencyMs: Math.max(1, Date.now() - start),
  };
}

function extractToolsArray(result: unknown): DownstreamToolInfo[] {
  if (!result || typeof result !== 'object') return [];
  const tools = (result as { tools?: unknown[] }).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map((t) => ({
      name: String(t.name ?? 'unnamed'),
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema:
        t.inputSchema && typeof t.inputSchema === 'object'
          ? (t.inputSchema as Record<string, unknown>)
          : undefined,
    }));
}

async function runStdioRpcSequence(
  command: string,
  args: string[],
  messages: Array<Record<string, unknown>>,
  awaitResponseId: number,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command),
    });

    let settled = false;
    const finish = (err: Error | null, res?: JsonRpcResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Ignore already-exited process
      }
      if (err) reject(err);
      else resolve(res ?? {});
    };

    const timer = setTimeout(() => {
      finish(new Error(`MCP stdio timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => finish(err));

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcResponse;
        if (parsed.id === awaitResponseId) {
          finish(null, parsed);
        }
      } catch {
        // Ignore non-JSON stdout banner lines
      }
    });

    child.on('exit', (code) => {
      if (!settled) {
        finish(new Error(`MCP server exited before responding (code ${code ?? 'null'}).`));
      }
    });

    for (const msg of messages) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }
  });
}
