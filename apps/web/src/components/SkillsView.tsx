import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  FolderTree,
  Search,
  X,
} from 'lucide-react';
import type { AgentPlatform, LintIssue, SkillRecord } from '@skilldeck/core';

interface SkillsViewProps {
  skills: SkillRecord[];
  issues: LintIssue[];
  inspectedSkill: SkillRecord | null;
  onInspectSkill: (skill: SkillRecord | null) => void;
}

export function SkillsView({
  skills,
  issues,
  inspectedSkill,
  onInspectSkill,
}: SkillsViewProps) {
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | AgentPlatform>('all');
  const [sortBy, setSortBy] = useState<'startup' | 'body' | 'name'>('startup');
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (inspectedSkill && !dialog.open) {
      dialog.showModal();
    } else if (!inspectedSkill && dialog.open) {
      dialog.close();
    }
  }, [inspectedSkill]);

  const issueCountBySkill = useMemo(() => {
    const map = new Map<string, { errors: number; warnings: number; all: LintIssue[] }>();
    for (const issue of issues) {
      if (issue.targetType !== 'skill') continue;
      const entry = map.get(issue.targetId) ?? { errors: 0, warnings: 0, all: [] };
      if (issue.severity === 'error') entry.errors += 1;
      if (issue.severity === 'warning') entry.warnings += 1;
      entry.all.push(issue);
      map.set(issue.targetId, entry);
    }
    return map;
  }, [issues]);

  const platforms = useMemo(() => {
    return Array.from(new Set(skills.map((s) => s.platform))).sort();
  }, [skills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills
      .filter((s) => {
        if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.relativePath.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'startup') return b.tokens.startupTokens - a.tokens.startupTokens;
        if (sortBy === 'body') return b.tokens.bodyTokens - a.tokens.bodyTokens;
        return a.name.localeCompare(b.name);
      });
  }, [skills, query, platformFilter, sortBy]);

  const inspectedIssues = inspectedSkill
    ? (issueCountBySkill.get(inspectedSkill.id)?.all ?? [])
    : [];

  return (
    <section className="stack-md" aria-labelledby="skills-heading">
      <div className="card-header">
        <div>
          <h1 id="skills-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            Skills Inventory &amp; Inspector
          </h1>
          <p className="card-subtitle">
            Browse all discovered <code>SKILL.md</code> and <code>.mdc</code> rules, compare startup vs. on-demand tokens, and inspect bundled resources.
          </p>
        </div>
        <span className="badge badge-neutral">{filtered.length} of {skills.length} skills</span>
      </div>

      <article className="card">
        <search className="row-wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row-wrap" style={{ flex: '1 1 280px' }}>
            <label htmlFor="skill-search-input" className="sr-only">
              Filter skills by name or description
            </label>
            <div style={{ position: 'relative', flex: '1 1 240px', display: 'flex', alignItems: 'center' }}>
              <Search
                size={15}
                aria-hidden="true"
                style={{ position: 'absolute', insetInlineStart: '0.7rem', color: 'var(--text-muted)', pointerEvents: 'none' }}
              />
              <input
                id="skill-search-input"
                type="search"
                className="input"
                placeholder="Search skills, triggers, or descriptions..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ inlineSize: '100%', paddingInlineStart: '2.1rem' }}
              />
            </div>

            <div className="segmented" role="group" aria-label="Filter by platform">
              <button
                type="button"
                aria-pressed={platformFilter === 'all'}
                onClick={() => setPlatformFilter('all')}
              >
                All
              </button>
              {platforms.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={platformFilter === p}
                  onClick={() => setPlatformFilter(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="row-wrap">
            <label htmlFor="skill-sort" className="muted" style={{ fontSize: '0.8rem' }}>
              Sort:
            </label>
            <select
              id="skill-sort"
              className="select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'startup' | 'body' | 'name')}
            >
              <option value="startup">Highest Startup Tokens</option>
              <option value="body">Largest Body Tokens</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </search>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="skills-table-caption"
          className="table-wrapper"
        >
          <table className="data-table">
            <caption id="skills-table-caption">Discovered AI Agent Skills Inventory</caption>
            <thead>
              <tr>
                <th style={{ inlineSize: '23%' }}>Skill Name</th>
                <th style={{ inlineSize: '13%' }}>Platform</th>
                <th style={{ inlineSize: '30%' }}>Description</th>
                <th style={{ inlineSize: '11%' }}>Startup</th>
                <th style={{ inlineSize: '11%' }}>Body</th>
                <th style={{ inlineSize: '12%' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '2rem' }}>
                    No skills match the current filter.
                  </td>
                </tr>
              ) : (
                filtered.map((skill) => {
                  const counts = issueCountBySkill.get(skill.id);
                  const hasErrors = (counts?.errors ?? 0) > 0;
                  const hasWarnings = (counts?.warnings ?? 0) > 0;

                  return (
                    <tr key={skill.id}>
                      <th scope="row">
                        <button
                          type="button"
                          onClick={() => onInspectSkill(skill)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'start',
                            inlineSize: '100%',
                            color: 'var(--accent)',
                            fontWeight: 650,
                          }}
                        >
                          <span className="truncate-line">{skill.name}</span>
                        </button>
                      </th>
                      <td data-label="Platform">
                        <span className="badge badge-neutral">{skill.platform}</span>
                      </td>
                      <td data-label="Description">
                        <span className="truncate-line muted">
                          {skill.description || '(missing description)'}
                        </span>
                      </td>
                      <td data-label="Startup" className="mono">
                        <span className={skill.tokens.startupTokens >= 240 ? 'badge badge-danger' : ''}>
                          {skill.tokens.startupTokens}t
                        </span>
                      </td>
                      <td data-label="Body" className="mono">
                        {skill.tokens.bodyTokens}t
                      </td>
                      <td data-label="Status">
                        <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                          {hasErrors ? (
                            <span className="badge badge-danger">
                              <AlertCircle size={12} aria-hidden="true" /> {counts!.errors} err
                            </span>
                          ) : hasWarnings ? (
                            <span className="badge badge-warn">{counts!.warnings} warn</span>
                          ) : (
                            <span className="badge badge-ok">
                              <CheckCircle2 size={12} aria-hidden="true" /> clean
                            </span>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={`Inspect ${skill.name}`}
                            onClick={() => onInspectSkill(skill)}
                          >
                            <Eye size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </article>

      {/* Native <dialog> Inspector with light-dismiss closedby="any" */}
      <dialog
        ref={dialogRef}
        className="inspector-dialog"
        aria-labelledby="inspector-title"
        onClose={() => onInspectSkill(null)}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        {inspectedSkill && (
          <div className="dialog-shell">
            <header className="dialog-head">
              <div style={{ minInlineSize: 0 }}>
                <div className="row-wrap">
                  <h2 id="inspector-title" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                    {inspectedSkill.name}
                  </h2>
                  <span className="badge badge-accent">{inspectedSkill.platform}</span>
                  <span className="badge badge-neutral">{inspectedSkill.kind}</span>
                </div>
                <p className="muted mono truncate-line" style={{ fontSize: '0.75rem', marginBlockStart: '0.2rem' }}>
                  {inspectedSkill.filePath}
                </p>
              </div>
              <form method="dialog">
                <button type="submit" className="btn btn-sm" aria-label="Close skill inspector">
                  <X size={15} aria-hidden="true" />
                  Close
                </button>
              </form>
            </header>

            <div className="dialog-body">
              <div className="grid-kpi">
                <div className="kpi-card">
                  <span className="kpi-label">Startup Cost</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.tokens.startupTokens}t
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.descriptionChars} description chars</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">On-Demand Body</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.tokens.bodyTokens}t
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.bodyLineCount} markdown lines</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">Bundled Assets</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.resources.length}
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.resourceTokens}t text resources</span>
                </div>
              </div>

              {inspectedIssues.length > 0 && (
                <section className="stack-sm" aria-label="Skill diagnostics">
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 650 }}>Diagnostics ({inspectedIssues.length})</h3>
                  {inspectedIssues.map((issue) => (
                    <div
                      key={issue.id}
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border)',
                        background:
                          issue.severity === 'error'
                            ? 'var(--danger-soft)'
                            : issue.severity === 'warning'
                              ? 'var(--warn-soft)'
                              : 'var(--bg-elevated)',
                      }}
                    >
                      <div className="row-wrap">
                        <span className={`badge ${issue.severity === 'error' ? 'badge-danger' : issue.severity === 'warning' ? 'badge-warn' : 'badge-neutral'}`}>
                          {issue.ruleId} · {issue.severity.toUpperCase()}
                        </span>
                        <strong style={{ fontSize: '0.84rem' }}>{issue.message}</strong>
                      </div>
                      <p style={{ fontSize: '0.8rem', marginBlockStart: '0.25rem' }}>
                        Fix: {issue.suggestion}
                      </p>
                    </div>
                  ))}
                </section>
              )}

              <div className="grid-two">
                <div className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650 }}>Extracted Trigger Phrases</h3>
                  {inspectedSkill.triggerPhrases.length > 0 ? (
                    <div className="row-wrap">
                      {inspectedSkill.triggerPhrases.map((p) => (
                        <span key={p} className="badge badge-accent">{p}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>No explicit quoted/listed trigger phrases parsed.</p>
                  )}
                </div>

                <div className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650 }}>Negative Boundaries</h3>
                  {inspectedSkill.negativeTriggers.length > 0 ? (
                    <div className="row-wrap">
                      {inspectedSkill.negativeTriggers.map((neg) => (
                        <span key={neg} className="badge badge-warn">NOT: {neg}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>None defined. Adding &ldquo;Do NOT use for...&rdquo; prevents false triggers.</p>
                  )}
                </div>
              </div>

              {inspectedSkill.resources.length > 0 && (
                <section className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <FolderTree size={15} aria-hidden="true" />
                    Bundled Resource Files
                  </h3>
                  <div className="row-wrap">
                    {inspectedSkill.resources.map((res) => (
                      <span key={res.relativePath} className="badge badge-neutral">
                        {res.relativePath} ({res.estimatedTokens}t)
                      </span>
                    ))}
                  </div>
                </section>
              )}

              <section className="stack-sm">
                <h3 style={{ fontSize: '0.88rem', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FileText size={15} aria-hidden="true" />
                  Markdown Body Preview
                </h3>
                <pre
                  className="code-block"
                  role="region"
                  aria-label={`Markdown body for ${inspectedSkill.name}`}
                  tabIndex={0}
                >
                  <code>{inspectedSkill.body.trim() || '(Empty body)'}</code>
                </pre>
              </section>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}
