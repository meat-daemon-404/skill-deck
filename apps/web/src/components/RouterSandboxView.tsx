import { useState } from 'react';
import {
  AlertTriangle,
  Compass,
  Play,
  ShieldOff,
  Sparkles,
} from 'lucide-react';
import type { RouteResult } from '@skilldeck/core';
import { runPromptRoute, type WorkspaceQuery } from '../api.js';

interface RouterSandboxViewProps {
  query: WorkspaceQuery;
}

const SAMPLE_PROMPTS = [
  'Deploy a Cloudflare Worker with wrangler.toml and R2 bindings',
  '帮我把这集漫剧剧本拆分镜，生成分镜表和首帧提示词',
  'Audit our PostgreSQL RLS policies and slow EXPLAIN query plan',
  'Build an accessible dark mode modal dialog and responsive data table',
];

export function RouterSandboxView({ query }: RouterSandboxViewProps) {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]!);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSimulate(textToRun?: string) {
    const activePrompt = (textToRun ?? prompt).trim();
    if (!activePrompt) return;
    setLoading(true);
    setError(null);
    try {
      const data = await runPromptRoute(activePrompt, query);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack-md" aria-labelledby="router-heading">
      <div>
        <h1 id="router-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
          Prompt Routing Sandbox
        </h1>
        <p className="card-subtitle">
          Test any English or Chinese user prompt to preview which Skills activate, inspect matched trigger spans, and catch ambiguous collisions or negative-boundary suppressions.
        </p>
      </div>

      <article className="card">
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSimulate();
          }}
        >
          <label htmlFor="route-prompt-input" style={{ fontSize: '0.86rem', fontWeight: 650 }}>
            Simulated User Prompt
          </label>
          <textarea
            id="route-prompt-input"
            className="textarea"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a realistic prompt to test progressive-disclosure skill routing..."
          />
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="row-wrap">
              <span className="muted" style={{ fontSize: '0.78rem' }}>Quick presets:</span>
              {SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setPrompt(sample);
                    void handleSimulate(sample);
                  }}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span className="truncate-line" style={{ maxInlineSize: '210px' }}>
                    {sample}
                  </span>
                </button>
              ))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || !prompt.trim()}>
              <Play size={14} aria-hidden="true" />
              {loading ? 'Simulating...' : 'Simulate Routing'}
            </button>
          </div>
        </form>

        {error && (
          <p className="badge badge-danger" role="alert">
            {error}
          </p>
        )}
      </article>

      {result && (
        <div className="stack-md">
          <div className="grid-kpi">
            <article className="kpi-card">
              <span className="kpi-label">Always-On Baseline</span>
              <span className="kpi-value">{result.baselineStartupTokens.toLocaleString()}t</span>
              <span className="kpi-meta">Catalog + active MCP schemas</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">Activated Bodies</span>
              <span className="kpi-value">+{result.projectedActivatedTokens.toLocaleString()}t</span>
              <span className="kpi-meta">Progressive disclosure load</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">Total Projected Prompt</span>
              <span className="kpi-value">{result.totalProjectedTokens.toLocaleString()}t</span>
              <span className="kpi-meta">{result.matches.length} candidate skill(s) scored</span>
            </article>
          </div>

          {result.ambiguous && result.ambiguityReason && (
            <div
              role="status"
              style={{
                padding: '0.85rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--warn-soft)',
                border: '1px solid var(--warn)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
              }}
            >
              <AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <div>
                <strong>Ambiguous Routing Collision Detected:</strong> {result.ambiguityReason}
              </div>
            </div>
          )}

          <article className="card">
            <h2 className="card-title">
              <Compass size={17} aria-hidden="true" />
              Ranked Activation Candidates
            </h2>

            {result.matches.length === 0 ? (
              <p className="muted">No skills exceeded the activation threshold for this prompt.</p>
            ) : (
              <div className="stack-sm">
                {result.matches.map((match) => {
                  const pct = Math.round(match.score * 100);
                  const badgeClass = match.suppressedByNegative
                    ? 'badge-neutral'
                    : match.confidence === 'high'
                      ? 'badge-ok'
                      : match.confidence === 'medium'
                        ? 'badge-warn'
                        : 'badge-neutral';
                  const statusText = match.suppressedByNegative
                    ? 'SUPPRESSED'
                    : match.confidence === 'high'
                      ? 'WILL ACTIVATE'
                      : match.confidence === 'medium'
                        ? 'CANDIDATE'
                        : 'LOW SIGNAL';

                  return (
                    <div
                      key={match.skillId}
                      style={{
                        padding: '0.85rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                        <div className="row-wrap">
                          <span className={`badge ${badgeClass}`}>{statusText}</span>
                          <strong style={{ fontSize: '0.95rem' }}>{match.skillName}</strong>
                          <span className="badge badge-neutral">{match.platform}</span>
                        </div>
                        <div className="row-wrap mono" style={{ fontSize: '0.82rem' }}>
                          <strong>{pct}% match</strong>
                          <span className="muted">+{match.bodyTokens}t body</span>
                        </div>
                      </div>

                      <div
                        style={{
                          blockSize: '6px',
                          borderRadius: '999px',
                          background: 'var(--bg-subtle)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            inlineSize: `${pct}%`,
                            blockSize: '100%',
                            background: match.suppressedByNegative
                              ? 'var(--text-muted)'
                              : match.confidence === 'high'
                                ? 'var(--ok)'
                                : 'var(--warn)',
                          }}
                        />
                      </div>

                      <p className="muted" style={{ fontSize: '0.82rem' }}>
                        {match.description}
                      </p>

                      <div className="row-wrap">
                        {match.matchedPhrases.map((phrase) => (
                          <span key={`p-${phrase}`} className="badge badge-ok">
                            phrase: &ldquo;{phrase}&rdquo;
                          </span>
                        ))}
                        {match.matchedTerms.map((term) => (
                          <span key={`t-${term}`} className="badge badge-accent">
                            {term}
                          </span>
                        ))}
                        {match.negativeHits.length > 0 && (
                          <span className="badge badge-danger">
                            <ShieldOff size={12} aria-hidden="true" />
                            Negative rule hit: {match.negativeHits.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
