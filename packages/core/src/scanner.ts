import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillMarkdown } from './frontmatter.js';
import { redactMcpArgs, redactMcpEnvironment } from './secrets.js';
import {
  estimateMcpStartupTokens,
  estimateSkillStartupTokens,
  estimateTokens,
} from './tokens.js';
import type {
  AgentPlatform,
  McpServerRecord,
  ScanSourceInfo,
  SkillRecord,
  SkillResourceFile,
} from './types.js';

export interface ScanRootSpec {
  rootPath: string;
  platform: AgentPlatform;
}

export interface RawScanOutput {
  scannedSources: ScanSourceInfo[];
  skills: SkillRecord[];
  mcpServers: McpServerRecord[];
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  '__pycache__',
  'coverage',
  '.pnpm-store',
]);

const TEXT_RESOURCE_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.sh',
  '.ps1',
  '.sql',
  '.toml',
  '.xml',
  '.html',
  '.css',
]);

const MCP_CONFIG_FILENAMES = new Set([
  'mcp.json',
  '.mcp.json',
  'mcp_config.json',
  'claude_desktop_config.json',
  'settings.json',
  'mcp-servers.json',
]);

/**
 * Discovers standard local AI agent configuration directories on the user's machine.
 * Strictly read-only inspection.
 */
export function getDefaultLocalScanRoots(includeBuiltin = false): ScanRootSpec[] {
  const home = os.homedir();
  const candidates: ScanRootSpec[] = [
    { rootPath: path.join(home, '.gemini', 'config', 'skills'), platform: 'antigravity' },
    { rootPath: path.join(home, '.gemini', 'config', 'plugins'), platform: 'antigravity' },
    { rootPath: path.join(home, '.gemini', 'skills'), platform: 'gemini-cli' },
    { rootPath: path.join(home, '.gemini', 'settings.json'), platform: 'gemini-cli' },
    { rootPath: path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), platform: 'antigravity' },
    { rootPath: path.join(home, '.claude', 'skills'), platform: 'claude-code' },
    { rootPath: path.join(home, '.claude', 'settings.json'), platform: 'claude-code' },
    { rootPath: path.join(home, '.claude.json'), platform: 'claude-code' },
    { rootPath: path.join(home, '.cursor', 'rules'), platform: 'cursor' },
    { rootPath: path.join(home, '.cursor', 'skills'), platform: 'cursor' },
    { rootPath: path.join(home, '.cursor', 'mcp.json'), platform: 'cursor' },
    { rootPath: path.join(home, '.codex', 'skills'), platform: 'codex' },
  ];

  if (includeBuiltin) {
    candidates.push({
      rootPath: path.join(home, '.gemini', 'antigravity', 'builtin', 'skills'),
      platform: 'antigravity',
    });
  }

  return candidates;
}

export function inferPlatformFromPath(targetPath: string, fallback: AgentPlatform = 'custom'): AgentPlatform {
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.gemini/antigravity') || normalized.includes('/.gemini/config/')) {
    return 'antigravity';
  }
  if (normalized.includes('/.gemini/')) {
    return 'gemini-cli';
  }
  if (normalized.includes('/.claude/') || normalized.endsWith('/.claude.json') || normalized.endsWith('/.mcp.json')) {
    return 'claude-code';
  }
  if (normalized.includes('/.cursor/')) {
    return 'cursor';
  }
  if (normalized.includes('/.codex/')) {
    return 'codex';
  }
  return fallback;
}

/**
 * Checks whether an executable command exists on the local system PATH without running it.
 */
export function isExecutableOnPath(command: string | undefined): boolean | null {
  if (!command || command.trim().length === 0) {
    return null;
  }

  const trimmed = command.trim();
  // Direct file path
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    try {
      return fs.existsSync(trimmed);
    } catch {
      return false;
    }
  }

  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  if (!pathEnv) {
    return null;
  }

  const isWin = process.platform === 'win32';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.PS1').split(';').filter(Boolean)
    : [''];

  for (const dir of pathDirs) {
    // Check exact name first
    const exact = path.join(dir, trimmed);
    if (safeIsFile(exact)) {
      return true;
    }
    if (isWin && !path.extname(trimmed)) {
      for (const ext of extensions) {
        if (safeIsFile(path.join(dir, `${trimmed}${ext.toLowerCase()}`))) {
          return true;
        }
        if (safeIsFile(path.join(dir, `${trimmed}${ext.toUpperCase()}`))) {
          return true;
        }
      }
    }
  }

  return false;
}

function safeIsFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function makeStableId(prefix: string, uniqueKey: string): string {
  const hash = createHash('sha256').update(uniqueKey).digest('hex').slice(0, 10);
  return `${prefix}_${hash}`;
}

function collectSkillResources(skillDir: string, skillFilePath: string): SkillResourceFile[] {
  const resources: SkillResourceFile[] = [];
  const subdirs: Array<{ name: 'scripts' | 'references' | 'assets'; dir: string }> = [
    { name: 'scripts', dir: path.join(skillDir, 'scripts') },
    { name: 'references', dir: path.join(skillDir, 'references') },
    { name: 'assets', dir: path.join(skillDir, 'assets') },
  ];

  // Collect direct sibling files (besides SKILL.md)
  try {
    const entries = fs.readdirSync(skillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(skillDir, entry.name);
      if (path.resolve(fullPath) === path.resolve(skillFilePath)) continue;
      const st = safeStat(fullPath);
      if (!st) continue;
      resources.push({
        relativePath: entry.name,
        category: 'other',
        bytes: st.size,
        estimatedTokens: estimateFileTokensIfText(fullPath, st.size),
      });
    }
  } catch {
    // Ignore unreadable directories
  }

  for (const sub of subdirs) {
    if (!safeStat(sub.dir)?.isDirectory()) continue;
    walkFiles(sub.dir, 3, (filePath) => {
      const st = safeStat(filePath);
      if (!st) return;
      resources.push({
        relativePath: path.relative(skillDir, filePath).replace(/\\/g, '/'),
        category: sub.name,
        bytes: st.size,
        estimatedTokens: estimateFileTokensIfText(filePath, st.size),
      });
    });
  }

  return resources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function estimateFileTokensIfText(filePath: string, bytes: number): number {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_RESOURCE_EXTS.has(ext) || bytes > 512 * 1024) {
    return 0;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return estimateTokens(content);
  } catch {
    return 0;
  }
}

function walkFiles(
  rootDir: string,
  maxDepth: number,
  onFile: (filePath: string) => void,
  currentDepth = 0,
): void {
  if (currentDepth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(path.join(rootDir, entry.name), maxDepth, onFile, currentDepth + 1);
    } else if (entry.isFile()) {
      onFile(path.join(rootDir, entry.name));
    }
  }
}

function parseSkillFile(
  filePath: string,
  sourceRoot: string,
  fallbackPlatform: AgentPlatform,
  kind: 'skill' | 'rule',
): SkillRecord | null {
  let rawContent: string;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const parsed = parseSkillMarkdown(rawContent);
  const skillDir = path.dirname(filePath);
  const directoryName = path.basename(skillDir);
  const stemName = path.basename(filePath, path.extname(filePath));
  const declaredName =
    typeof parsed.frontmatter.name === 'string' && parsed.frontmatter.name.trim().length > 0
      ? parsed.frontmatter.name.trim()
      : kind === 'skill'
        ? directoryName
        : stemName;

  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : '';

  const platform = inferPlatformFromPath(filePath, fallbackPlatform);
  const resources = kind === 'skill' ? collectSkillResources(skillDir, filePath) : [];
  const startupTokens = estimateSkillStartupTokens(declaredName, description, path.basename(filePath));
  const bodyTokens = estimateTokens(parsed.body);
  const resourceTokens = resources.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const bodyLineCount = parsed.body.trim().length === 0 ? 0 : parsed.body.split(/\r?\n/).length;
  const contentHash = createHash('sha256').update(rawContent).digest('hex').slice(0, 16);

  return {
    id: makeStableId('skill', path.resolve(filePath)),
    name: declaredName,
    directoryName,
    platform,
    sourceRoot,
    filePath: path.resolve(filePath),
    relativePath: path.relative(sourceRoot, filePath).replace(/\\/g, '/') || path.basename(filePath),
    kind,
    frontmatter: parsed.frontmatter,
    frontmatterRaw: parsed.frontmatterRaw,
    frontmatterValid: parsed.frontmatterValid,
    frontmatterError: parsed.frontmatterError,
    description,
    body: parsed.body,
    triggerPhrases: parsed.triggerPhrases,
    negativeTriggers: parsed.negativeTriggers,
    localLinks: parsed.localLinks,
    resources,
    tokens: {
      startupTokens,
      bodyTokens,
      resourceTokens,
      totalTokens: startupTokens + bodyTokens + resourceTokens,
      bodyLineCount,
      descriptionChars: description.length,
    },
    contentHash,
  };
}

function parseMcpConfigFile(
  configPath: string,
  fallbackPlatform: AgentPlatform,
): McpServerRecord[] {
  let rawJson: unknown;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    rawJson = JSON.parse(content);
  } catch {
    return [];
  }

  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    return [];
  }

  const rootObj = rawJson as Record<string, unknown>;
  // Support standard `mcpServers`, VS Code/Cursor `servers`, or nested `mcp.servers`
  let serversMap: Record<string, unknown> | null = null;
  if (rootObj.mcpServers && typeof rootObj.mcpServers === 'object' && !Array.isArray(rootObj.mcpServers)) {
    serversMap = rootObj.mcpServers as Record<string, unknown>;
  } else if (rootObj.servers && typeof rootObj.servers === 'object' && !Array.isArray(rootObj.servers)) {
    serversMap = rootObj.servers as Record<string, unknown>;
  } else if (
    rootObj.mcp &&
    typeof rootObj.mcp === 'object' &&
    !Array.isArray(rootObj.mcp) &&
    (rootObj.mcp as Record<string, unknown>).servers &&
    typeof (rootObj.mcp as Record<string, unknown>).servers === 'object'
  ) {
    serversMap = (rootObj.mcp as Record<string, unknown>).servers as Record<string, unknown>;
  }

  if (!serversMap) {
    return [];
  }

  const platform = inferPlatformFromPath(configPath, fallbackPlatform);
  const records: McpServerRecord[] = [];

  for (const [serverName, rawEntry] of Object.entries(serversMap)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const command = typeof entry.command === 'string' ? entry.command : undefined;
    const args = Array.isArray(entry.args)
      ? entry.args.map((a) => (typeof a === 'string' ? a : String(a)))
      : [];
    const url =
      typeof entry.url === 'string'
        ? entry.url
        : typeof entry.serverUrl === 'string'
          ? entry.serverUrl
          : undefined;
    const disabled = Boolean(entry.disabled === true || entry.enabled === false);

    let transport: McpServerRecord['transport'] = 'unknown';
    if (command) {
      transport = 'stdio';
    } else if (url) {
      transport = entry.type === 'sse' || url.includes('/sse') ? 'sse' : 'http';
    }

    const envObj =
      entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
        ? (entry.env as Record<string, unknown>)
        : undefined;
    const headersObj =
      entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
        ? (entry.headers as Record<string, unknown>)
        : undefined;

    const envRedaction = redactMcpEnvironment(envObj);
    const headerRedaction = redactMcpEnvironment(headersObj);
    const argsRedaction = redactMcpArgs(args);

    const combinedSecrets = [
      ...envRedaction.findings,
      ...headerRedaction.findings.map((f) => ({
        ...f,
        fieldPath: f.fieldPath.replace(/^env\./, 'headers.'),
      })),
      ...argsRedaction.findings,
    ];

    records.push({
      id: makeStableId('mcp', `${path.resolve(configPath)}::${serverName}`),
      name: serverName,
      platform,
      configPath: path.resolve(configPath),
      transport,
      command,
      args,
      url,
      disabled,
      envKeys: Object.keys(envRedaction.redactedEnv),
      redactedEnv: envRedaction.redactedEnv,
      redactedArgs: argsRedaction.redactedArgs,
      secretFindings: combinedSecrets,
      commandAvailable: transport === 'stdio' ? isExecutableOnPath(command) : null,
      estimatedSchemaTokens: estimateMcpStartupTokens(serverName, args, disabled),
    });
  }

  return records;
}

/**
 * Scans a list of roots (directories or individual config files) for Agent Skills and MCP Servers.
 */
export function scanRoots(roots: ScanRootSpec[]): RawScanOutput {
  const scannedSources: ScanSourceInfo[] = [];
  const skills: SkillRecord[] = [];
  const mcpServers: McpServerRecord[] = [];
  const seenSkillFiles = new Set<string>();
  const seenMcpFiles = new Set<string>();

  for (const spec of roots) {
    const resolvedRoot = path.resolve(spec.rootPath);
    const stat = safeStat(resolvedRoot);
    if (!stat) {
      scannedSources.push({
        rootPath: resolvedRoot,
        platform: spec.platform,
        exists: false,
        skillCount: 0,
        mcpCount: 0,
      });
      continue;
    }

    let sourceSkillCount = 0;
    let sourceMcpCount = 0;

    if (stat.isFile()) {
      const base = path.basename(resolvedRoot);
      if (base.toLowerCase() === 'skill.md' || base.toLowerCase().endsWith('.mdc')) {
        if (!seenSkillFiles.has(resolvedRoot)) {
          seenSkillFiles.add(resolvedRoot);
          const rec = parseSkillFile(
            resolvedRoot,
            path.dirname(resolvedRoot),
            spec.platform,
            base.toLowerCase() === 'skill.md' ? 'skill' : 'rule',
          );
          if (rec) {
            skills.push(rec);
            sourceSkillCount += 1;
          }
        }
      } else if (base.toLowerCase().endsWith('.json')) {
        if (!seenMcpFiles.has(resolvedRoot)) {
          seenMcpFiles.add(resolvedRoot);
          const parsed = parseMcpConfigFile(resolvedRoot, spec.platform);
          mcpServers.push(...parsed);
          sourceMcpCount += parsed.length;
        }
      }
    } else if (stat.isDirectory()) {
      walkFiles(resolvedRoot, 6, (filePath) => {
        const resolved = path.resolve(filePath);
        const base = path.basename(resolved);
        const lowerBase = base.toLowerCase();

        if (lowerBase === 'skill.md') {
          if (!seenSkillFiles.has(resolved)) {
            seenSkillFiles.add(resolved);
            const rec = parseSkillFile(resolved, resolvedRoot, spec.platform, 'skill');
            if (rec) {
              skills.push(rec);
              sourceSkillCount += 1;
            }
          }
          return;
        }

        if (lowerBase.endsWith('.mdc')) {
          if (!seenSkillFiles.has(resolved)) {
            seenSkillFiles.add(resolved);
            const rec = parseSkillFile(resolved, resolvedRoot, spec.platform, 'rule');
            if (rec) {
              skills.push(rec);
              sourceSkillCount += 1;
            }
          }
          return;
        }

        if (MCP_CONFIG_FILENAMES.has(lowerBase)) {
          if (!seenMcpFiles.has(resolved)) {
            seenMcpFiles.add(resolved);
            const parsed = parseMcpConfigFile(resolved, spec.platform);
            mcpServers.push(...parsed);
            sourceMcpCount += parsed.length;
          }
        }
      });
    }

    scannedSources.push({
      rootPath: resolvedRoot,
      platform: spec.platform,
      exists: true,
      skillCount: sourceSkillCount,
      mcpCount: sourceMcpCount,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  mcpServers.sort((a, b) => a.name.localeCompare(b.name));

  return { scannedSources, skills, mcpServers };
}
