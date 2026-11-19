import { tokenizeBilingual } from './conflicts.js';
import type { McpServerRecord, RouteMatch, RouteResult, SkillRecord } from './types.js';

/**
 * Simulates progressive-disclosure skill routing for any user prompt (English, Chinese, or mixed).
 *
 * Scoring factors:
 * 1. Direct skill name match
 * 2. Explicit quoted/listed trigger phrase match
 * 3. Bilingual IDF-weighted keyword overlap against skill description
 * 4. Negative-trigger boundary check ("Do NOT use for ...", "不负责 ...")
 */
export function simulatePromptRouting(
  prompt: string,
  skills: SkillRecord[],
  mcpServers: McpServerRecord[] = [],
  topK = 8,
): RouteResult {
  const baselineSkillTokens = skills.reduce((sum, s) => sum + s.tokens.startupTokens, 0);
  const baselineMcpTokens = mcpServers.reduce((sum, m) => sum + m.estimatedSchemaTokens, 0);
  const baselineStartupTokens = baselineSkillTokens + baselineMcpTokens;

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt || skills.length === 0) {
    return {
      prompt,
      matches: [],
      ambiguous: false,
      baselineStartupTokens,
      projectedActivatedTokens: 0,
      totalProjectedTokens: baselineStartupTokens,
    };
  }

  const promptLower = trimmedPrompt.toLowerCase();
  const promptTokens = tokenizeBilingual(trimmedPrompt);
  const promptTokenSet = new Set(promptTokens);

  // Build IDF table over the skill catalog so domain-specific terms rank higher than generic verbs
  const skillTokenSets = skills.map((skill) => {
    let positiveDesc = skill.description;
    for (const neg of skill.negativeTriggers) {
      positiveDesc = positiveDesc.replace(neg, ' ');
    }
    return new Set(tokenizeBilingual(`${skill.name.replace(/[-_]/g, ' ')} ${positiveDesc}`));
  });

  const df = new Map<string, number>();
  for (const tokenSet of skillTokenSets) {
    for (const token of tokenSet) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const totalDocs = skills.length;
  const matches: RouteMatch[] = [];

  for (let i = 0; i < skills.length; i += 1) {
    const skill = skills[i];
    const descTokenSet = skillTokenSets[i];
    if (!skill || !descTokenSet) continue;

    let rawScore = 0;
    const matchedTerms = new Set<string>();
    const matchedPhrases: string[] = [];

    // 1. Direct name mention (strong signal)
    const normalizedName = skill.name.toLowerCase();
    const spacedName = normalizedName.replace(/[-_]+/g, ' ');
    if (
      promptLower.includes(normalizedName) ||
      (spacedName.length >= 4 && promptLower.includes(spacedName))
    ) {
      rawScore += 0.55;
      matchedTerms.add(skill.name);
    }

    // 2. Explicit trigger phrase matches (capped so quoted phrases don't saturate unfairly over prose skills)
    let phraseScore = 0;
    for (const phrase of skill.triggerPhrases) {
      const pLower = phrase.toLowerCase();
      if (pLower.length >= 2 && promptLower.includes(pLower)) {
        phraseScore += 0.15;
        matchedPhrases.push(phrase);
      }
    }
    rawScore += Math.min(0.3, phraseScore);

    // 3. Bilingual IDF-weighted token overlap
    let overlapWeight = 0;
    let promptTotalWeight = 0;
    for (const token of promptTokenSet) {
      const idf = Math.log((totalDocs + 1) / ((df.get(token) ?? 0) + 1)) + 1;
      promptTotalWeight += idf;
      if (descTokenSet.has(token)) {
        overlapWeight += idf;
        matchedTerms.add(token);
      }
    }

    if (promptTotalWeight > 0 && overlapWeight > 0) {
      const coverage = overlapWeight / promptTotalWeight;
      // Blend prompt coverage with absolute weighted hits
      rawScore += coverage * 0.65 + Math.min(0.28, overlapWeight * 0.045);
    }

    if (rawScore <= 0.05) {
      continue;
    }

    // 4. Negative trigger check ("Do NOT use for...", "不负责...")
    const negativeHits: string[] = [];
    for (const negClause of skill.negativeTriggers) {
      const negTokens = tokenizeBilingual(negClause);
      const hitTokens = negTokens.filter((t) => promptTokenSet.has(t));
      if (hitTokens.length >= 1) {
        negativeHits.push(...hitTokens);
      }
    }

    const uniqueNegativeHits = Array.from(new Set(negativeHits));
    const suppressedByNegative =
      uniqueNegativeHits.length >= 2 ||
      (uniqueNegativeHits.length >= 1 && matchedPhrases.length === 0 && rawScore < 0.5);
    const adjustedScore = suppressedByNegative
      ? Math.max(0.05, rawScore * 0.28)
      : uniqueNegativeHits.length > 0
        ? Math.max(0.08, rawScore * 0.65)
        : rawScore;

    const finalScore = Number(Math.min(0.99, adjustedScore).toFixed(3));
    const confidence: RouteMatch['confidence'] =
      finalScore >= 0.55 ? 'high' : finalScore >= 0.28 ? 'medium' : 'low';

    matches.push({
      skillId: skill.id,
      skillName: skill.name,
      platform: skill.platform,
      score: finalScore,
      confidence,
      matchedTerms: Array.from(matchedTerms).slice(0, 10),
      matchedPhrases: matchedPhrases.slice(0, 6),
      negativeHits: uniqueNegativeHits.slice(0, 6),
      suppressedByNegative,
      startupTokens: skill.tokens.startupTokens,
      bodyTokens: skill.tokens.bodyTokens,
      description: skill.description,
    });
  }

  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, topK);

  // Ambiguity check: top 2 active matches compete closely OR both hit high activation confidence
  const activeMatches = topMatches.filter((m) => !m.suppressedByNegative);
  let ambiguous = false;
  let ambiguityReason: string | undefined;
  const first = activeMatches[0];
  const second = activeMatches[1];
  if (first && second && first.score >= 0.3 && second.score >= 0.26) {
    const gap = first.score - second.score;
    const bothHigh = first.score >= 0.55 && second.score >= 0.55 && gap <= 0.22;
    if (gap <= 0.14 || bothHigh) {
      ambiguous = true;
      ambiguityReason = `"${first.skillName}" (${Math.round(first.score * 100)}%) and "${second.skillName}" (${Math.round(second.score * 100)}%) are closely competing for this prompt.`;
    }
  }

  // Projected activated body tokens: assume the agent activates high-confidence matches (or top 1 medium)
  const likelyActivated = activeMatches.filter((m, idx) =>
    m.confidence === 'high' || (idx === 0 && m.confidence === 'medium'),
  );
  const projectedActivatedTokens = likelyActivated.reduce((sum, m) => sum + m.bodyTokens, 0);

  return {
    prompt: trimmedPrompt,
    matches: topMatches,
    ambiguous,
    ambiguityReason,
    baselineStartupTokens,
    projectedActivatedTokens,
    totalProjectedTokens: baselineStartupTokens + projectedActivatedTokens,
  };
}
