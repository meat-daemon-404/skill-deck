import { GitCompareArrows, ShieldCheck } from 'lucide-react';
import type { ConflictPair, SkillRecord } from '@skilldeck/core';

interface ConflictsViewProps {
  conflicts: ConflictPair[];
  skills: SkillRecord[];
  onInspectSkill: (skill: SkillRecord) => void;
}

export function ConflictsView({ conflicts, skills, onInspectSkill }: ConflictsViewProps) {
  const skillMap = new Map(skills.map((s) => [s.id, s]));

  return (
    <section className="stack-md" aria-labelledby="conflicts-heading">
      <div className="card-header">
        <div>
          <h1 id="conflicts-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            Trigger Conflict Radar
          </h1>
          <p className="card-subtitle">
            Bilingual TF-IDF + trigger-phrase overlap detector identifying skills that compete for the same user prompts.
          </p>
        </div>
        <span className="badge badge-neutral">{conflicts.length} colliding pairs</span>
      </div>

      {conflicts.length === 0 ? (
        <article className="card" style={{ alignItems: 'center', padding: '2.5rem', textAlign: 'center' }}>
          <ShieldCheck size={36} aria-hidden="true" style={{ color: 'var(--ok)' }} />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 650 }}>Clean Routing Boundaries</h2>
          <p className="muted" style={{ maxInlineSize: '460px' }}>
            No overlapping trigger phrases or high-similarity skill descriptions were detected across this workspace.
          </p>
        </article>
      ) : (
        <div className="stack-md">
          {conflicts.map((pair) => {
            const skillA = skillMap.get(pair.skillA.id);
            const skillB = skillMap.get(pair.skillB.id);
            const pct = Math.round(pair.similarity * 100);
            const sevClass =
              pair.severity === 'high'
                ? 'badge-danger'
                : pair.severity === 'medium'
                  ? 'badge-warn'
                  : 'badge-neutral';

            return (
              <article key={pair.id} className="card">
                <div className="card-header">
                  <div className="row-wrap">
                    <span className={`badge ${sevClass}`}>{pair.severity.toUpperCase()} · {pct}%</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => skillA && onInspectSkill(skillA)}
                    >
                      {pair.skillA.name}
                    </button>
                    <GitCompareArrows size={16} aria-hidden="true" className="muted" />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => skillB && onInspectSkill(skillB)}
                    >
                      {pair.skillB.name}
                    </button>
                  </div>
                  <span className="mono muted" style={{ fontSize: '0.76rem' }}>
                    {pair.skillA.platform} vs {pair.skillB.platform}
                  </span>
                </div>

                <div className="row-wrap">
                  {pair.sharedPhrases.map((phrase) => (
                    <span key={`p-${phrase}`} className="badge badge-danger">
                      exact trigger: &ldquo;{phrase}&rdquo;
                    </span>
                  ))}
                  {pair.sharedKeywords.map((kw) => (
                    <span key={`k-${kw}`} className="badge badge-warn">
                      {kw}
                    </span>
                  ))}
                </div>

                <div className="grid-two">
                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="mono" style={{ fontSize: '0.78rem', fontWeight: 700, marginBlockEnd: '0.25rem' }}>
                      {pair.skillA.name}
                    </div>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      {skillA?.description || '(no description)'}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="mono" style={{ fontSize: '0.78rem', fontWeight: 700, marginBlockEnd: '0.25rem' }}>
                      {pair.skillB.name}
                    </div>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      {skillB?.description || '(no description)'}
                    </p>
                  </div>
                </div>

                <p style={{ fontSize: '0.83rem' }}>
                  <strong>Recommendation:</strong> {pair.suggestion}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
