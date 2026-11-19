import type { ConflictPair, ConflictSeverity, SkillRecord } from './types.js';

const EN_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from',
  'has', 'have', 'help', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'more',
  'need', 'not', 'of', 'on', 'only', 'or', 'out', 'over', 'should', 'so', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'tool',
  'tools', 'use', 'used', 'user', 'users', 'using', 'via', 'want', 'wants', 'when',
  'where', 'which', 'who', 'will', 'with', 'without', 'work', 'working', 'you', 'your',
  'skill', 'skills', 'agent', 'agents', 'file', 'files', 'code', 'project', 'task', 'tasks',
]);

const ZH_STOPWORDS = new Set([
  '使用', '用于', '时候', '进行', '需要', '用户', '提出', '要求', '或者', '以及',
  '可以', '通过', '一个', '这个', '那个', '我们', '你们', '他们', '处理', '相关',
  '支持', '提供', '帮助', '工具', '技能', '文件', '内容', '项目', '系统', '功能',
]);

const CJK_SEGMENT_RE = /[\u4e00-\u9fff]{2,}/g;
const LATIN_TOKEN_RE = /[a-z][a-z0-9_-]{1,}/g;

/**
 * Bilingual tokenizer producing normalized English stems + Chinese 2-char/3-char terms.
 */
export function tokenizeBilingual(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // English tokens (split hyphen/underscore compounds too so "cloudflare-workers" matches "cloudflare" + "workers")
  for (const match of lower.matchAll(LATIN_TOKEN_RE)) {
    const raw = match[0];
    const parts = raw.split(/[-_]+/).filter((p) => p.length >= 2);
    for (const part of parts) {
      const stemmed = lightStemEnglish(part);
      if (stemmed.length >= 2 && !EN_STOPWORDS.has(stemmed) && !EN_STOPWORDS.has(part)) {
        tokens.push(stemmed);
      }
    }
    if (parts.length > 1 && !EN_STOPWORDS.has(raw)) {
      tokens.push(raw);
    }
  }

  // Chinese n-grams (bigrams + trigrams inside contiguous Han runs)
  for (const match of text.matchAll(CJK_SEGMENT_RE)) {
    const seg = match[0];
    if (seg.length === 2) {
      if (!ZH_STOPWORDS.has(seg)) tokens.push(seg);
      continue;
    }
    for (let i = 0; i <= seg.length - 2; i += 1) {
      const bi = seg.slice(i, i + 2);
      if (!ZH_STOPWORDS.has(bi)) {
        tokens.push(bi);
      }
    }
    for (let i = 0; i <= seg.length - 3; i += 1) {
      const tri = seg.slice(i, i + 3);
      tokens.push(tri);
    }
  }

  return tokens;
}

function lightStemEnglish(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);
  return word;
}

function buildPositiveDescription(skill: SkillRecord): string {
  let desc = skill.description;
  for (const neg of skill.negativeTriggers) {
    desc = desc.replace(neg, ' ');
  }
  return `${skill.name.replace(/[-_]/g, ' ')} ${desc}`;
}

/**
 * Computes pairwise trigger collisions across all scanned skills using bilingual TF-IDF cosine
 * similarity + explicit trigger phrase overlap.
 */
export function detectTriggerConflicts(
  skills: SkillRecord[],
  threshold = 0.24,
): ConflictPair[] {
  if (skills.length < 2) {
    return [];
  }

  const docTokens = skills.map((s) => tokenizeBilingual(buildPositiveDescription(s)));
  const docCount = skills.length;

  // Document frequency per token
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const unique = new Set(tokens);
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  // Build normalized TF-IDF vectors
  const vectors = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const vec = new Map<string, number>();
    let normSq = 0;
    for (const [token, count] of tf.entries()) {
      const idf = Math.log((docCount + 1) / ((df.get(token) ?? 1) + 1)) + 1;
      const weight = (1 + Math.log(count)) * idf;
      vec.set(token, weight);
      normSq += weight * weight;
    }

    const norm = Math.sqrt(normSq) || 1;
    for (const [token, weight] of vec.entries()) {
      vec.set(token, weight / norm);
    }
    return vec;
  });

  const positiveDescsLower = skills.map((s) => buildPositiveDescription(s).toLowerCase());
  const normalizedPhraseSets = skills.map(
    (s) => new Set(s.triggerPhrases.map((p) => p.toLowerCase().trim()).filter(Boolean)),
  );

  const pairs: ConflictPair[] = [];

  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      const skillA = skills[i];
      const skillB = skills[j];
      const vecA = vectors[i];
      const vecB = vectors[j];
      if (!skillA || !skillB || !vecA || !vecB) continue;

      let cosine = 0;
      const sharedWeighted: Array<{ token: string; score: number }> = [];

      for (const [token, wA] of vecA.entries()) {
        const wB = vecB.get(token);
        if (wB !== undefined) {
          const contribution = wA * wB;
          cosine += contribution;
          sharedWeighted.push({ token, score: contribution });
        }
      }

      // Check explicit trigger phrase overlap: both direct intersection AND cross-containment in prose
      const phrasesA = normalizedPhraseSets[i] ?? new Set<string>();
      const phrasesB = normalizedPhraseSets[j] ?? new Set<string>();
      const descALower = positiveDescsLower[i] ?? '';
      const descBLower = positiveDescsLower[j] ?? '';
      const sharedPhraseSet = new Set<string>();

      for (const p of phrasesA) {
        if (phrasesB.has(p) || (p.length >= 3 && descBLower.includes(p))) {
          sharedPhraseSet.add(p);
        }
      }
      for (const p of phrasesB) {
        if (phrasesA.has(p) || (p.length >= 3 && descALower.includes(p))) {
          sharedPhraseSet.add(p);
        }
      }
      const sharedPhrases = Array.from(sharedPhraseSet);

      // Boost similarity when exact trigger phrases collide across skills
      const phraseBoost = Math.min(0.35, sharedPhrases.length * 0.14);
      const similarity = Math.min(1, Number((cosine + phraseBoost).toFixed(3)));

      if (similarity < threshold && sharedPhrases.length === 0) {
        continue;
      }

      sharedWeighted.sort((a, b) => b.score - a.score);
      const sharedKeywords = sharedWeighted.slice(0, 8).map((item) => item.token);

      let severity: ConflictSeverity = 'low';
      if (similarity >= 0.52 || sharedPhrases.length >= 2) {
        severity = 'high';
      } else if (similarity >= 0.34 || sharedPhrases.length === 1) {
        severity = 'medium';
      }

      const topTerms = sharedPhrases.length > 0 ? sharedPhrases : sharedKeywords.slice(0, 4);
      const suggestion =
        skillA.name === skillB.name
          ? `Duplicate skill name "${skillA.name}" across ${skillA.platform} and ${skillB.platform}. Keep one canonical copy or rename one skill.`
          : `Both skills compete on [${topTerms.join(', ')}]. Add explicit negative boundaries (e.g. "Do NOT use for ...") in each description to disambiguate routing.`;

      pairs.push({
        id: `conflict_${skillA.id}_${skillB.id}`,
        skillA: { id: skillA.id, name: skillA.name, platform: skillA.platform },
        skillB: { id: skillB.id, name: skillB.name, platform: skillB.platform },
        similarity,
        severity,
        sharedKeywords,
        sharedPhrases,
        suggestion,
      });
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}
