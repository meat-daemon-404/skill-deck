import { parse as parseYaml } from 'yaml';
import type { SkillFrontmatter } from './types.js';

export interface ParsedSkillDocument {
  frontmatter: SkillFrontmatter;
  frontmatterRaw: string;
  frontmatterValid: boolean;
  frontmatterError?: string;
  body: string;
  localLinks: string[];
  triggerPhrases: string[];
  negativeTriggers: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const MARKDOWN_LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Extracts YAML frontmatter and Markdown body from a SKILL.md or .mdc file.
 */
export function parseSkillMarkdown(rawContent: string): ParsedSkillDocument {
  const normalized = rawContent.replace(/^\uFEFF/, '');
  const match = normalized.match(FRONTMATTER_RE);

  let frontmatter: SkillFrontmatter = {};
  let frontmatterRaw = '';
  let frontmatterValid = false;
  let frontmatterError: string | undefined;
  let body = normalized;

  if (match) {
    frontmatterRaw = match[1] ?? '';
    body = match[2] ?? '';
    try {
      const parsed = parseYaml(frontmatterRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed as SkillFrontmatter;
        frontmatterValid = true;
      } else {
        frontmatterError = 'YAML frontmatter must evaluate to a key-value mapping.';
      }
    } catch (error) {
      frontmatterError =
        error instanceof Error ? error.message : 'Failed to parse YAML frontmatter.';
    }
  } else {
    frontmatterError = 'Missing YAML frontmatter block delimited by --- lines.';
  }

  const description = typeof frontmatter.description === 'string'
    ? frontmatter.description.trim()
    : '';

  const localLinks = extractLocalLinks(body);
  const triggerPhrases = extractTriggerPhrases(description);
  const negativeTriggers = extractNegativeTriggers(description);

  return {
    frontmatter,
    frontmatterRaw,
    frontmatterValid,
    frontmatterError,
    body,
    localLinks,
    triggerPhrases,
    negativeTriggers,
  };
}

/**
 * Finds relative local links in Markdown body (excluding http/https/mailto/#anchors/data).
 */
export function extractLocalLinks(markdown: string): string[] {
  // Strip fenced code blocks before scanning links to prevent false positives
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, '');
  const links = new Set<string>();

  for (const match of withoutCodeBlocks.matchAll(MARKDOWN_LINK_RE)) {
    const rawTarget = (match[1] ?? '').trim();
    if (!rawTarget) continue;
    if (
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:') ||
      rawTarget.startsWith('file://') ||
      rawTarget.startsWith('data:') ||
      rawTarget.startsWith('#') ||
      rawTarget.startsWith('<')
    ) {
      continue;
    }
    const cleanPath = rawTarget.split('#')[0]?.split('?')[0] ?? '';
    if (cleanPath && !cleanPath.includes('{{') && !cleanPath.includes('<')) {
      links.add(cleanPath);
    }
  }

  return Array.from(links);
}

/**
 * Extracts explicit trigger cues and quoted trigger phrases from a skill description
 * (supporting both English and Chinese conventions).
 */
export function extractTriggerPhrases(description: string): string[] {
  if (!description) return [];
  const phrases = new Set<string>();

  // 1. Quoted trigger strings: 'foo', "foo", “foo”, 「foo」
  const quotedRe = /['"“「]([^'"”」]{2,48})['"”」]/g;
  for (const m of description.matchAll(quotedRe)) {
    const candidate = (m[1] ?? '').trim();
    if (candidate.length >= 2 && !candidate.startsWith('--')) {
      phrases.add(candidate);
    }
  }

  // 2. Explicit Chinese "触发词：a、b、c" or "触发：a / b / c"
  const zhTriggerMatch = description.match(/触发词?[：:]\s*([^。\n]+)/);
  if (zhTriggerMatch?.[1]) {
    for (const part of zhTriggerMatch[1].split(/[、,，/｜|]+/)) {
      const cleaned = part.trim();
      if (cleaned.length >= 2 && cleaned.length <= 36) {
        phrases.add(cleaned);
      }
    }
  }

  // 3. Explicit English "Trigger on ...:" or "Triggers:"
  const enTriggerMatch = description.match(/triggers?(?:\s+on(?:\s+mentions\s+of)?)?:\s*([^.\n]+)/i);
  if (enTriggerMatch?.[1]) {
    for (const part of enTriggerMatch[1].split(/[,;/]+/)) {
      const cleaned = part.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
      if (cleaned.length >= 2 && cleaned.length <= 42) {
        phrases.add(cleaned);
      }
    }
  }

  return Array.from(phrases).slice(0, 24);
}

/**
 * Extracts negative trigger clauses ("Do NOT use for...", "Not for...", "不负责...", "不要用于...")
 * so the Prompt Router can realistically avoid false positives.
 */
export function extractNegativeTriggers(description: string): string[] {
  if (!description) return [];
  const negatives: string[] = [];

  const patterns = [
    /(?:do\s+not|don't|never)\s+(?:use|trigger)\s+(?:this\s+skill\s+)?(?:for|when|on)\s+([^.;\n]+)/gi,
    /\bnot\s+(?:intended\s+)?for\s+([^.;\n]+)/gi,
    /(?:不负责|不要用于|不适用于|勿用于)\s*([^。；;\n]+)/g,
  ];

  for (const pattern of patterns) {
    for (const m of description.matchAll(pattern)) {
      const clause = (m[1] ?? '').trim();
      if (clause.length >= 3) {
        negatives.push(clause);
      }
    }
  }

  return negatives;
}
