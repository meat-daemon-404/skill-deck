import readline from 'node:readline';
import type { ScanOptions } from '@skilldeck/core';
import { HUB_META_TOOLS, SkillDeckHub } from './hub.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Starts a real MCP (Model Context Protocol) JSON-RPC 2.0 Meta-Server over stdin/stdout.
 * Plug this directly into Antigravity, Claude Code, Cursor, Gemini CLI, Codex, ZCode, or DSH!
 */
export function startStdioMcpHubServer(options: {
  scanOptions: ScanOptions;
  hub?: SkillDeckHub;
}): void {
  const hub = options.hub ?? new SkillDeckHub();

  const writeMessage = (payload: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`);
  };

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      writeMessage({
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON-RPC payload' },
      });
      return;
    }

    const id = req.id ?? null;
    const method = req.method ?? '';

    try {
      if (method === 'initialize') {
        writeMessage({
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: 'skilldeck-hub',
              version: '0.2.0',
            },
          },
        });
        return;
      }

      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return;
      }

      if (method === 'ping') {
        writeMessage({ id, result: {} });
        return;
      }

      if (method === 'tools/list') {
        writeMessage({
          id,
          result: {
            tools: HUB_META_TOOLS,
          },
        });
        return;
      }

      if (method === 'tools/call') {
        const toolName = String(req.params?.name ?? '');
        const toolArgs =
          req.params?.arguments && typeof req.params.arguments === 'object'
            ? (req.params.arguments as Record<string, unknown>)
            : {};

        const result = await hub.executeMetaTool(
          toolName,
          toolArgs,
          options.scanOptions,
          'mcp-stdio',
        );

        writeMessage({
          id,
          result: {
            isError: !result.ok,
            content: [{ type: 'text', text: result.contentText }],
          },
        });
        return;
      }

      if (id !== null) {
        writeMessage({
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
    } catch (err) {
      if (id !== null) {
        writeMessage({
          id,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : 'Internal MCP hub error',
          },
        });
      }
    }
  });
}
