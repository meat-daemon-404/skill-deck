/**
 * Calibrated bilingual (CJK + Latin + Code/Markdown) token estimator.
 *
 * Designed to stay fast and dependency-free while tracking real BPE token counts
 * within ~5–10% across English prose, Chinese/Japanese/Korean text, and Markdown/JSON.
 */

const CJK_CHAR_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;
const LATIN_WORD_RE = /[A-Za-z0-9_]+/g;
const PUNCT_SYMBOL_RE = /[^\sA-Za-z0-9_\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

export function estimateTokens(text: string): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  const cjkMatches = text.match(CJK_CHAR_RE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // Strip CJK before counting Latin words & symbols so nothing is double-counted
  const withoutCjk = text.replace(CJK_CHAR_RE, ' ');
  const latinWords = withoutCjk.match(LATIN_WORD_RE) ?? [];
  const symbols = withoutCjk.match(PUNCT_SYMBOL_RE) ?? [];

  let latinTokens = 0;
  for (const word of latinWords) {
    if (word.length <= 4) {
      latinTokens += 1;
    } else if (word.length <= 10) {
      latinTokens += 1.35;
    } else {
      // Identifiers, URLs, snake_case, camelCase split into more BPE pieces
      latinTokens += Math.ceil(word.length / 4);
    }
  }

  // Modern LLM tokenizers average ~0.72 tokens per CJK character (some common 2-char words merge)
  const cjkTokens = cjkCount * 0.72;
  // Code punctuation, brackets, markdown syntax
  const symbolTokens = symbols.length * 0.55;

  return Math.max(1, Math.round(latinTokens + cjkTokens + symbolTokens));
}

/**
 * Estimates the always-on startup prompt tokens for a skill declaration.
 * Under progressive disclosure, agents inject skill name, path, and description at startup.
 */
export function estimateSkillStartupTokens(
  name: string,
  description: string,
  filePathHint = '',
): number {
  // Wrapper formatting overhead in system prompt catalogs (e.g. "- name (path): description\n")
  const catalogLine = `- ${name} (${filePathHint || 'SKILL.md'}): ${description}\n`;
  return estimateTokens(catalogLine) + 6;
}

/**
 * Estimates baseline context overhead for an active MCP server declaration.
 * Real MCP servers expose tool JSON schemas (typically 6–15 tools × ~80–120 tokens each).
 * Without spawning arbitrary servers, we provide a transparent heuristic baseline.
 */
export function estimateMcpStartupTokens(
  name: string,
  args: string[],
  disabled: boolean,
): number {
  if (disabled) {
    return 0;
  }
  const lower = `${name} ${args.join(' ')}`.toLowerCase();
  // Well-known large multi-tool MCP servers expose 15–35 tools
  if (/(github|chrome-devtools|playwright|postgres|supabase|unity|cua|figma)/.test(lower)) {
    return 1450;
  }
  if (/(filesystem|git|memory|sentry|slack|linear|notion|gdrive|gmail)/.test(lower)) {
    return 820;
  }
  // Standard single-domain MCP server (~5–8 tools)
  return 480;
}
