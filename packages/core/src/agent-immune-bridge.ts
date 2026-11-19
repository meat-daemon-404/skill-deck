import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenizeBilingual } from './conflicts.js';
import type { AgentImmuneBridgeReport, PitfallAntibody } from './types.js';

interface SqliteLikeStatement {
  all: (...params: unknown[]) => unknown[];
}

interface SqliteLikeDatabase {
  prepare: (sql: string) => SqliteLikeStatement;
  close: () => void;
}

/**
 * Dynamically opens a local SQLite database via Node 22.19+/24 built-in `node:sqlite`
 * in strict read-only mode (zero runtime dependencies).
 */
async function readAntibodiesFromSqlite(dbPath: string): Promise<{
  rows: PitfallAntibody[];
  error?: string;
}> {
  if (!fs.existsSync(dbPath)) {
    return { rows: [] };
  }

  try {
    // Use dynamic import so older Node environments degrade gracefully
    const mod = (await import('node:sqlite' as string)) as {
      DatabaseSync?: new (location: string, options?: { readOnly?: boolean }) => SqliteLikeDatabase;
    };
    if (!mod.DatabaseSync) {
      return { rows: [], error: 'node:sqlite DatabaseSync unavailable in this Node version' };
    }

    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'antibodies'")
        .all();
      if (tableCheck.length === 0) {
        return { rows: [] };
      }

      const rawRows = db
        .prepare(
          `SELECT id, trigger_pattern, symptom, prescription, hit_count, fail_count, status,
                  tool_name, project_scope, quality_grade, rubric_score, root_cause, created_at
           FROM antibodies
           ORDER BY hit_count DESC, rubric_score DESC, id DESC
           LIMIT 250`,
        )
        .all() as Array<Record<string, unknown>>;

      const rows: PitfallAntibody[] = rawRows.map((r) => {
        const numericId = Number(r.id ?? 0);
        return {
          id: `sqlite:${path.basename(path.dirname(dbPath))}:${numericId}`,
          numericId,
          trigger_pattern: String(r.trigger_pattern ?? ''),
          symptom: String(r.symptom ?? ''),
          prescription: String(r.prescription ?? ''),
          status:
            r.status === 'retired' || r.status === 'quarantined' ? r.status : 'active',
          quality_grade:
            r.quality_grade === 'tactic' || r.quality_grade === 'quarantined'
              ? r.quality_grade
              : 'advice',
          rubric_score: Number(r.rubric_score ?? 70),
          root_cause: String(r.root_cause ?? ''),
          hit_count: Number(r.hit_count ?? 0),
          fail_count: Number(r.fail_count ?? 0),
          tool_name: r.tool_name ? String(r.tool_name) : null,
          project_scope: String(r.project_scope ?? '*'),
          sourceDb: dbPath,
          created_at: Number(r.created_at ?? Date.now()),
        };
      });

      return { rows };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reads Git-native `.immune/rules.jsonl` team-sync files compatible with `meat-daemon-404/agent-immune`.
 */
export function readAntibodiesFromJsonl(jsonlPath: string): {
  rows: PitfallAntibody[];
  error?: string;
} {
  if (!fs.existsSync(jsonlPath)) {
    return { rows: [] };
  }

  try {
    const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows: PitfallAntibody[] = [];

    lines.forEach((line, idx) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const trigger = String(obj.trigger_pattern ?? '').trim();
        const symptom = String(obj.symptom ?? '').trim();
        const prescription = String(obj.prescription ?? '').trim();
        if (!trigger || !prescription) return;

        const hash = createHash('sha256')
          .update(`${trigger}|${symptom}|${prescription}`)
          .digest('hex')
          .slice(0, 8);

        rows.push({
          id: String(obj.id ?? `jsonl:${hash}:${idx + 1}`),
          trigger_pattern: trigger,
          symptom: symptom || 'Repeated tool or configuration pitfall',
          prescription,
          status:
            obj.status === 'retired' || obj.status === 'quarantined' ? obj.status : 'active',
          quality_grade:
            obj.quality_grade === 'tactic' || obj.quality_grade === 'quarantined'
              ? obj.quality_grade
              : 'advice',
          rubric_score: Number(obj.rubric_score ?? 82),
          root_cause: String(obj.root_cause ?? 'config_mismatch'),
          hit_count: Number(obj.hit_count ?? 0),
          fail_count: Number(obj.fail_count ?? 0),
          tool_name: obj.tool_name ? String(obj.tool_name) : null,
          project_scope: String(obj.project_scope ?? '*'),
          sourceDb: jsonlPath,
          created_at: Number(obj.created_at ?? Date.now()),
        });
      } catch {
        // Ignore malformed JSONL line
      }
    });

    return { rows };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getDefaultAgentImmuneStores(extraRoots: string[] = []): Array<{
  path: string;
  kind: 'sqlite' | 'jsonl';
}> {
  const home = os.homedir();
  const stores: Array<{ path: string; kind: 'sqlite' | 'jsonl' }> = [];
  const seen = new Set<string>();

  const add = (p: string, kind: 'sqlite' | 'jsonl') => {
    const resolved = path.resolve(p);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      stores.push({ path: resolved, kind });
    }
  };

  for (const root of extraRoots) {
    add(path.join(root, '.immune', 'rules.jsonl'), 'jsonl');
    add(path.join(root, 'immune.sqlite'), 'sqlite');
  }

  // Standard `meat-daemon-404/agent-immune` local database & rules locations
  add(path.join(home, '.dsh', 'immune.sqlite'), 'sqlite');
  add(path.join(home, '.zcode', 'immune.sqlite'), 'sqlite');
  add(path.join(home, '.agent-immune', 'immune.sqlite'), 'sqlite');
  add(path.join(home, '.immune', 'rules.jsonl'), 'jsonl');
  add(path.join(home, '.skilldeck', 'immune', 'rules.jsonl'), 'jsonl');

  return stores;
}

/**
 * Loads pitfall antibodies across all detected `agent-immune` SQLite DBs and `.immune/rules.jsonl` files.
 */
export async function loadAgentImmuneBridge(
  extraRoots: string[] = [],
  onlyExtraRoots = false,
): Promise<AgentImmuneBridgeReport> {
  const candidates = onlyExtraRoots
    ? extraRoots.flatMap((root) => [
        { path: path.resolve(root, '.immune', 'rules.jsonl'), kind: 'jsonl' as const },
        { path: path.resolve(root, 'immune.sqlite'), kind: 'sqlite' as const },
      ])
    : getDefaultAgentImmuneStores(extraRoots);

  const detectedStores: AgentImmuneBridgeReport['detectedStores'] = [];
  const pitfallAntibodies: PitfallAntibody[] = [];
  const dedupKeys = new Set<string>();

  for (const store of candidates) {
    const exists = fs.existsSync(store.path);
    if (!exists) {
      detectedStores.push({
        path: store.path,
        kind: store.kind,
        exists: false,
        antibodyCount: 0,
      });
      continue;
    }

    const loaded =
      store.kind === 'sqlite'
        ? await readAntibodiesFromSqlite(store.path)
        : readAntibodiesFromJsonl(store.path);

    let added = 0;
    for (const ab of loaded.rows) {
      const key = `${ab.trigger_pattern.toLowerCase()}::${ab.prescription.toLowerCase()}`;
      if (!dedupKeys.has(key)) {
        dedupKeys.add(key);
        pitfallAntibodies.push(ab);
        added += 1;
      }
    }

    detectedStores.push({
      path: store.path,
      kind: store.kind,
      exists: true,
      antibodyCount: added,
      error: loaded.error,
    });
  }

  pitfallAntibodies.sort((a, b) => b.rubric_score - a.rubric_score || b.hit_count - a.hit_count);

  return {
    detectedStores,
    pitfallAntibodies,
    activePitfallCount: pitfallAntibodies.filter((a) => a.status === 'active').length,
    totalHits: pitfallAntibodies.reduce((sum, a) => sum + a.hit_count, 0),
  };
}

/**
 * Strips `<` and `>` from antibody strings before rendering `<immune_memory>` blocks,
 * honoring `meat-daemon-404/agent-immune`'s delimiter isolation invariant so untrusted error
 * traces can never forge `</immune_memory>`.
 */
export function sanitizeImmuneDelimiter(text: string): string {
  return text.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

export interface PitfallRecallResult {
  query: string;
  matches: Array<{
    antibody: PitfallAntibody;
    score: number;
    matchedTerms: string[];
  }>;
  immuneMemoryBlock: string;
}

/**
 * Bilingual pitfall antibody recall & `<immune_memory>` renderer compatible with `agent-immune`.
 */
export function recallPitfallAntibodies(
  query: string,
  antibodies: PitfallAntibody[],
  topK = 5,
): PitfallRecallResult {
  const active = antibodies.filter((a) => a.status === 'active');
  const queryLower = query.toLowerCase();
  const queryTokens = new Set(tokenizeBilingual(query));

  const scored: PitfallRecallResult['matches'] = [];

  for (const ab of active) {
    const abText = `${ab.trigger_pattern} ${ab.symptom} ${ab.prescription} ${ab.tool_name ?? ''} ${ab.root_cause}`;
    const abTokens = new Set(tokenizeBilingual(abText));
    const matchedTerms: string[] = [];

    for (const token of queryTokens) {
      if (abTokens.has(token)) {
        matchedTerms.push(token);
      }
    }

    // Check explicit comma/pipe trigger keywords inside trigger_pattern
    const triggerParts = ab.trigger_pattern
      .split(/[,，;|/\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length >= 2);
    let exactBonus = 0;
    for (const part of triggerParts) {
      if (queryLower.includes(part)) {
        exactBonus += 0.22;
        if (!matchedTerms.includes(part)) matchedTerms.push(part);
      }
    }

    const tokenRatio = queryTokens.size > 0 ? matchedTerms.length / Math.max(1, queryTokens.size) : 0;
    const rubricFactor = 0.85 + (Math.min(100, ab.rubric_score) / 100) * 0.25;
    const score = Number(Math.min(0.99, (tokenRatio * 0.65 + Math.min(0.5, exactBonus)) * rubricFactor).toFixed(3));

    if (score >= 0.16 && matchedTerms.length > 0) {
      scored.push({
        antibody: ab,
        score,
        matchedTerms: matchedTerms.slice(0, 8),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const immuneMemoryBlock =
    top.length === 0
      ? ''
      : [
          '<immune_memory>',
          ...top.map(
            (m, i) =>
              `${i + 1}. [trigger: ${sanitizeImmuneDelimiter(m.antibody.trigger_pattern)}] ` +
              `AVOID: ${sanitizeImmuneDelimiter(m.antibody.symptom)} -> ` +
              `DO: ${sanitizeImmuneDelimiter(m.antibody.prescription)}`,
          ),
          '</immune_memory>',
        ].join('\n');

  return {
    query,
    matches: top,
    immuneMemoryBlock,
  };
}

/**
 * Distills a failed-then-fixed tool episode into a `meat-daemon-404/agent-immune` compatible
 * `trigger → avoid → do` PitfallAntibody and optionally appends it to `.immune/rules.jsonl`.
 */
export function distillAndPersistPitfallAntibody(
  input: {
    trigger_pattern: string;
    symptom: string;
    prescription: string;
    tool_name?: string;
    root_cause?: string;
    project_scope?: string;
    rubric_score?: number;
  },
  jsonlPath = path.join(os.homedir(), '.skilldeck', 'immune', 'rules.jsonl'),
  persist = true,
): PitfallAntibody {
  const trigger = sanitizeImmuneDelimiter(input.trigger_pattern);
  const symptom = sanitizeImmuneDelimiter(input.symptom);
  const prescription = sanitizeImmuneDelimiter(input.prescription);

  const hash = createHash('sha256')
    .update(`${trigger}|${symptom}|${prescription}`)
    .digest('hex')
    .slice(0, 8);

  const antibody: PitfallAntibody = {
    id: `immune_${hash}`,
    trigger_pattern: trigger,
    symptom,
    prescription,
    status: 'active',
    quality_grade: 'advice',
    rubric_score: Math.max(40, Math.min(100, input.rubric_score ?? 86)),
    root_cause: input.root_cause?.trim() || 'command_syntax',
    hit_count: 0,
    fail_count: 0,
    tool_name: input.tool_name?.trim() || 'Bash',
    project_scope: input.project_scope?.trim() || '*',
    sourceDb: jsonlPath,
    created_at: Date.now(),
  };

  if (persist) {
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.appendFileSync(jsonlPath, `${JSON.stringify(antibody)}\n`, 'utf8');
  }

  return antibody;
}

/**
 * Exports Pitfall Antibodies into deterministic hash-sorted `.immune/rules.jsonl` format
 * directly compatible with `agent-immune team-sync`.
 */
export function exportRulesJsonl(antibodies: PitfallAntibody[]): string {
  const sorted = [...antibodies].sort((a, b) =>
    `${a.trigger_pattern}|${a.prescription}`.localeCompare(`${b.trigger_pattern}|${b.prescription}`),
  );
  return `${sorted
    .map((a) =>
      JSON.stringify({
        trigger_pattern: sanitizeImmuneDelimiter(a.trigger_pattern),
        symptom: sanitizeImmuneDelimiter(a.symptom),
        prescription: sanitizeImmuneDelimiter(a.prescription),
        status: a.status,
        quality_grade: a.quality_grade,
        rubric_score: a.rubric_score,
        root_cause: a.root_cause,
        tool_name: a.tool_name,
        project_scope: a.project_scope,
      }),
    )
    .join('\n')}\n`;
}
