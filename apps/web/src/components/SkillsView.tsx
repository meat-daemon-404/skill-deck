import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  FolderTree,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { AgentPlatform, ImmuneSkillReport, LintIssue, SkillRecord } from '@skilldeck/core';
import { maskLocalHomePath, type WorkspaceQuery } from '../api.js';
import { useI18n } from '../i18n.js';
import { VaultPanel } from './VaultPanel.js';

interface SkillsViewProps {
  skills: SkillRecord[];
  issues: LintIssue[];
  immuneReports: ImmuneSkillReport[];
  inspectedSkill: SkillRecord | null;
  onInspectSkill: (skill: SkillRecord | null) => void;
  query: WorkspaceQuery;
  onRefreshWorkspace: () => void;
}

export function SkillsView({
  skills,
  issues,
  immuneReports,
  inspectedSkill,
  onInspectSkill,
  query,
  onRefreshWorkspace,
}: SkillsViewProps) {
  const { t } = useI18n();
  const [searchText, setSearchText] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | AgentPlatform>('all');
  const [sortBy, setSortBy] = useState<'startup' | 'body' | 'name'>('startup');
  const [showAllRows, setShowAllRows] = useState(false);
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

  const immuneMap = useMemo(
    () => new Map(immuneReports.map((r) => [r.skillId, r])),
    [immuneReports],
  );

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
    const q = searchText.trim().toLowerCase();
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
  }, [skills, searchText, platformFilter, sortBy]);

  const inspectedIssues = inspectedSkill
    ? (issueCountBySkill.get(inspectedSkill.id)?.all ?? [])
    : [];

  return (
    <section className="stack-md" aria-labelledby="skills-heading">
      <div className="card-header">
        <div>
          <h1 id="skills-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            {t('技能资产清册与统一金库', 'Skills Inventory & Canonical Vault')}
          </h1>
          <p className="card-subtitle">
            {t(
              '浏览所有平台的 SKILL.md 与 .mdc 规则，查看 Token 成本与免疫判定，或一键纳管进统一金库做跨平台事务同步。',
              'Browse SKILL.md & .mdc rules across platforms, inspect token & immune status, and sync cleanly via the transactional Vault.',
            )}
          </p>
        </div>
        <span className="badge badge-neutral">
          {t(`显示 ${filtered.length} / ${skills.length} 个技能`, `${filtered.length} of ${skills.length} skills`)}
        </span>
      </div>

      {/* Vault & Sync Control Card */}
      <VaultPanel query={query} onRefreshWorkspace={onRefreshWorkspace} />

      <article className="card">
        <search className="row-wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row-wrap" style={{ flex: '1 1 280px' }}>
            <label htmlFor="skill-search-input" className="sr-only">
              {t('按名称或描述筛选技能', 'Filter skills by name or description')}
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
                placeholder={t('搜索技能名、触发词或描述...', 'Search skills, triggers, or descriptions...')}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ inlineSize: '100%', paddingInlineStart: '2.1rem' }}
              />
            </div>

            <div className="segmented" role="group" aria-label={t('按平台筛选', 'Filter by platform')}>
              <button
                type="button"
                aria-pressed={platformFilter === 'all'}
                onClick={() => setPlatformFilter('all')}
              >
                {t('全部', 'All')}
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
              {t('排序：', 'Sort:')}
            </label>
            <select
              id="skill-sort"
              className="select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'startup' | 'body' | 'name')}
            >
              <option value="startup">{t('按常驻 Token 从高到低', 'Highest Startup Tokens')}</option>
              <option value="body">{t('按正文 Token 从高到低', 'Largest Body Tokens')}</option>
              <option value="name">{t('按名称 (A–Z)', 'Name (A–Z)')}</option>
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
            <caption id="skills-table-caption">{t('已发现的 AI Agent 技能清册', 'Discovered AI Agent Skills Inventory')}</caption>
            <thead>
              <tr>
                <th style={{ inlineSize: '22%' }}>{t('技能名称', 'Skill Name')}</th>
                <th style={{ inlineSize: '12%' }}>{t('所属平台', 'Platform')}</th>
                <th style={{ inlineSize: '29%' }}>{t('描述摘要', 'Description')}</th>
                <th style={{ inlineSize: '10%' }}>{t('常驻', 'Startup')}</th>
                <th style={{ inlineSize: '10%' }}>{t('正文', 'Body')}</th>
                <th style={{ inlineSize: '17%' }}>{t('体检 / 免疫', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '2rem' }}>
                    {t('没有符合当前筛选条件的技能。', 'No skills match the current filter.')}
                  </td>
                </tr>
              ) : (
                (showAllRows ? filtered : filtered.slice(0, 100)).map((skill) => {
                  const counts = issueCountBySkill.get(skill.id);
                  const imm = immuneMap.get(skill.id);
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
                      <td data-label={t('所属平台', 'Platform')}>
                        <span className="badge badge-neutral">{skill.platform}</span>
                      </td>
                      <td data-label={t('描述摘要', 'Description')}>
                        <span className="truncate-line muted">
                          {skill.description || t('(缺少描述)', '(missing description)')}
                        </span>
                      </td>
                      <td data-label={t('常驻', 'Startup')} className="mono">
                        <span className={skill.tokens.startupTokens >= 240 ? 'badge badge-danger' : ''}>
                          {skill.tokens.startupTokens}t
                        </span>
                      </td>
                      <td data-label={t('正文', 'Body')} className="mono">
                        {skill.tokens.bodyTokens}t
                      </td>
                      <td data-label={t('体检 / 免疫', 'Status')}>
                        <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                          <div className="row-wrap">
                            {imm?.verdict === 'quarantine' ? (
                              <span className="badge badge-danger">
                                <ShieldAlert size={12} aria-hidden="true" /> {t('隔离', 'QUARANTINE')}
                              </span>
                            ) : hasErrors ? (
                              <span className="badge badge-danger">
                                <AlertCircle size={12} aria-hidden="true" /> {counts!.errors} {t('错', 'err')}
                              </span>
                            ) : hasWarnings ? (
                              <span className="badge badge-warn">{counts!.warnings} {t('警', 'warn')}</span>
                            ) : (
                              <span className="badge badge-ok">
                                <CheckCircle2 size={12} aria-hidden="true" /> {t('健康', 'clean')}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={`${t('检查', 'Inspect')} ${skill.name}`}
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

        {filtered.length > 100 && !showAllRows && (
          <div className="row-wrap" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-sm" onClick={() => setShowAllRows(true)}>
              {t(`展开全部 ${filtered.length} 个技能（当前显示前 100 个）`, `Show all ${filtered.length} skills (showing first 100)`)}
            </button>
          </div>
        )}
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
                  {maskLocalHomePath(inspectedSkill.filePath)}
                </p>
              </div>
              <form method="dialog">
                <button type="submit" className="btn btn-sm" aria-label={t('关闭技能详情', 'Close skill inspector')}>
                  <X size={15} aria-hidden="true" />
                  {t('关闭', 'Close')}
                </button>
              </form>
            </header>

            <div className="dialog-body">
              <div className="grid-kpi">
                <div className="kpi-card">
                  <span className="kpi-label">{t('常驻启动开销', 'Startup Cost')}</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.tokens.startupTokens}t
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.descriptionChars} {t('字符描述', 'chars')}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">{t('按需正文开销', 'On-Demand Body')}</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.tokens.bodyTokens}t
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.bodyLineCount} {t('行 Markdown', 'lines')}</span>
                </div>
                <div className="kpi-card">
                  <span className="kpi-label">{t('附带资源文件', 'Bundled Assets')}</span>
                  <span className="kpi-value" style={{ fontSize: '1.25rem' }}>
                    {inspectedSkill.resources.length}
                  </span>
                  <span className="kpi-meta">{inspectedSkill.tokens.resourceTokens}t</span>
                </div>
              </div>

              {inspectedIssues.length > 0 && (
                <section className="stack-sm" aria-label={t('诊断问题', 'Skill diagnostics')}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 650 }}>
                    {t(`规范与安全诊断 (${inspectedIssues.length})`, `Diagnostics (${inspectedIssues.length})`)}
                  </h3>
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
                        {t('修复建议：', 'Fix: ')}{issue.suggestion}
                      </p>
                    </div>
                  ))}
                </section>
              )}

              <div className="grid-two">
                <div className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650 }}>{t('提取的显式触发词', 'Extracted Trigger Phrases')}</h3>
                  {inspectedSkill.triggerPhrases.length > 0 ? (
                    <div className="row-wrap">
                      {inspectedSkill.triggerPhrases.map((p) => (
                        <span key={p} className="badge badge-accent">{p}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>{t('未提取到显式触发词列表。', 'No explicit quoted/listed trigger phrases parsed.')}</p>
                  )}
                </div>

                <div className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650 }}>{t('反向排除边界', 'Negative Boundaries')}</h3>
                  {inspectedSkill.negativeTriggers.length > 0 ? (
                    <div className="row-wrap">
                      {inspectedSkill.negativeTriggers.map((neg) => (
                        <span key={neg} className="badge badge-warn">NOT: {neg}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>{t('未声明反向排除边界，建议补充“不负责.../Do NOT use for...”。', 'None defined.')}</p>
                  )}
                </div>
              </div>

              {inspectedSkill.resources.length > 0 && (
                <section className="stack-sm">
                  <h3 style={{ fontSize: '0.88rem', fontWeight: 650, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <FolderTree size={15} aria-hidden="true" />
                    {t('附带脚本与参考资料', 'Bundled Resource Files')}
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
                  {t('SKILL.md 正文预览', 'Markdown Body Preview')}
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
