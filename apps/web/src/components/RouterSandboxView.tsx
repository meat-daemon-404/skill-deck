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
import { useI18n } from '../i18n.js';

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
  const { t } = useI18n();
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
          {t('Prompt 路由仿真沙盒', 'Prompt Routing Sandbox')}
        </h1>
        <p className="card-subtitle">
          {t(
            '输入任意中英文指令，实时仿真哪些技能会被渐进式激活、命中的关键词、反向排除抑制效果与路由歧义警告。',
            'Test any English or Chinese prompt to preview activated Skills, matched triggers, negative-boundary suppression, and routing collisions.',
          )}
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
            {t('模拟用户输入指令', 'Simulated User Prompt')}
          </label>
          <textarea
            id="route-prompt-input"
            className="textarea"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('输入真实提示词测试技能路由命中...', 'Enter a realistic prompt to test progressive-disclosure routing...')}
          />
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="row-wrap">
              <span className="muted" style={{ fontSize: '0.78rem' }}>{t('快速测试：', 'Presets:')}</span>
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
              {loading ? t('仿真中...', 'Simulating...') : t('开始路由仿真', 'Simulate Routing')}
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
              <span className="kpi-label">{t('常驻基线开销', 'Always-On Baseline')}</span>
              <span className="kpi-value">{result.baselineStartupTokens.toLocaleString()}t</span>
              <span className="kpi-meta">{t('技能目录 + 活跃 MCP', 'Catalog + active MCP schemas')}</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">{t('预计激活正文', 'Activated Bodies')}</span>
              <span className="kpi-value">+{result.projectedActivatedTokens.toLocaleString()}t</span>
              <span className="kpi-meta">{t('按需渐进加载', 'Progressive disclosure load')}</span>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">{t('预计本轮总上下文', 'Total Projected Prompt')}</span>
              <span className="kpi-value">{result.totalProjectedTokens.toLocaleString()}t</span>
              <span className="kpi-meta">{t(`共命中 ${result.matches.length} 个候选`, `${result.matches.length} candidate(s) scored`)}</span>
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
                <strong>{t('检测到路由歧义冲突：', 'Ambiguous Routing Collision Detected: ')}</strong>
                {result.ambiguityReason}
              </div>
            </div>
          )}

          <article className="card">
            <h2 className="card-title">
              <Compass size={17} aria-hidden="true" />
              {t('候选技能激活排序', 'Ranked Activation Candidates')}
            </h2>

            {result.matches.length === 0 ? (
              <p className="muted">{t('没有技能超过触发阈值。', 'No skills exceeded the activation threshold.')}</p>
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
                    ? t('已被排除规则抑制', 'SUPPRESSED')
                    : match.confidence === 'high'
                      ? t('将会激活', 'WILL ACTIVATE')
                      : match.confidence === 'medium'
                        ? t('候选触发', 'CANDIDATE')
                        : t('弱相关', 'LOW SIGNAL');

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
                          <strong>{pct}%</strong>
                          <span className="muted">+{match.bodyTokens}t</span>
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
                            {t('触发词', 'phrase')}: &ldquo;{phrase}&rdquo;
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
                            {t('命中反向边界：', 'Negative rule hit: ')}{match.negativeHits.join(', ')}
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
