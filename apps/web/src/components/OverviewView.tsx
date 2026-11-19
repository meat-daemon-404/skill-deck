import type { CSSProperties } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Flame,
  Layers,
  Server,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { SkillRecord, WorkspaceReport } from '@skilldeck/core';

interface OverviewViewProps {
  report: WorkspaceReport;
  onInspectSkill: (skill: SkillRecord) => void;
  onNavigate: (tab: 'skills' | 'router' | 'conflicts' | 'audit' | 'workflow') => void;
}

export function OverviewView({ report, onInspectSkill, onNavigate }: OverviewViewProps) {
  const { summary, budget, skills, scannedSources } = report;
  const skillMap = new Map(skills.map((s) => [s.id, s]));

  const totalBarBase = Math.max(budget.recommendedStartupLimit, budget.totalAlwaysOnTokens, 1);
  const skillPct = (budget.totalStartupSkillTokens / totalBarBase) * 100;
  const mcpPct = (budget.totalStartupMcpTokens / totalBarBase) * 100;

  const healthBadgeClass =
    summary.healthScore >= 85
      ? 'badge-ok'
      : summary.healthScore >= 60
        ? 'badge-warn'
        : 'badge-danger';

  const healthStatusLabel =
    summary.healthScore >= 85 ? 'Healthy' : summary.healthScore >= 60 ? 'Needs Attention' : 'Action Required';

  return (
    <section className="stack-md" aria-labelledby="overview-heading">
      <div className="card-header">
        <div>
          <h1 id="overview-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            Control Tower Overview
          </h1>
          <p className="card-subtitle">
            Real-time telemetry across discovered Agent Skills, MCP servers, context budgets, and routing hygiene.
          </p>
        </div>
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => onNavigate('router')}>
            Test Prompt Routing
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('workflow')}>
            Open Workflow Composer
          </button>
        </div>
      </div>

      <div className="grid-kpi">
        <article className="kpi-card">
          <div className="kpi-label">
            <span>Workspace Health</span>
            {summary.healthScore >= 80 ? (
              <ShieldCheck size={16} aria-hidden="true" />
            ) : (
              <ShieldAlert size={16} aria-hidden="true" />
            )}
          </div>
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <span className="kpi-value">{summary.healthScore}/100</span>
            <span className={`badge ${healthBadgeClass}`}>{healthStatusLabel}</span>
          </div>
          <p className="kpi-meta">
            {summary.errorCount} errors · {summary.warningCount} warnings · {summary.infoCount} info
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>Always-On Startup</span>
            <Flame size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">{budget.totalAlwaysOnTokens.toLocaleString()}t</span>
          <p className="kpi-meta">
            {budget.startupUtilizationPct}% of {budget.recommendedStartupLimit.toLocaleString()}t budget
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>Discovered Skills</span>
            <Layers size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">{summary.skillCount}</span>
          <p className="kpi-meta">
            {budget.totalOnDemandBodyTokens.toLocaleString()}t deferred on-demand bodies
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>MCP Servers</span>
            <Server size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">
            {summary.activeMcpCount}/{summary.mcpServerCount}
          </span>
          <p className="kpi-meta">
            {summary.secretFindingCount > 0
              ? `${summary.secretFindingCount} secret(s) auto-redacted`
              : 'Zero hardcoded secrets detected'}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>Trigger Conflicts</span>
            <AlertTriangle size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">{report.conflicts.length}</span>
          <p className="kpi-meta">
            {summary.highConflictCount} high-severity overlapping pairs
          </p>
        </article>
      </div>

      {/* Context Budget Proportional Bar + Heatmap */}
      <article className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Cpu size={17} aria-hidden="true" />
              Startup Context Budget &amp; Token Heatmap
            </h2>
            <p className="card-subtitle">
              Click any skill tile to open the inspector. Always-on tokens are injected on every prompt turn before a single skill activates.
            </p>
          </div>
          <div className="row-wrap">
            <span className="badge badge-accent">
              Skills Catalog: {budget.totalStartupSkillTokens.toLocaleString()}t
            </span>
            <span className="badge badge-purple">
              MCP Schemas: {budget.totalStartupMcpTokens.toLocaleString()}t
            </span>
          </div>
        </div>

        <div
          className="budget-track"
          role="img"
          aria-label={`Startup token budget usage: ${budget.totalStartupSkillTokens} tokens from skills and ${budget.totalStartupMcpTokens} tokens from MCP servers`}
        >
          <div className="budget-seg-skills" style={{ inlineSize: `${skillPct}%` }} />
          <div className="budget-seg-mcp" style={{ inlineSize: `${mcpPct}%` }} />
        </div>

        {budget.topStartupConsumers.length > 0 ? (
          <div className="heatmap-grid">
            {budget.topStartupConsumers.map((item) => {
              const skillObj = item.type === 'skill' ? skillMap.get(item.id) : undefined;
              const tier =
                item.type === 'skill' && item.startupTokens >= 240
                  ? 'hot'
                  : item.startupTokens >= 150 && item.type === 'skill'
                    ? 'warm'
                    : 'cool';

              return (
                <button
                  key={item.id}
                  type="button"
                  className="heatmap-cell"
                  data-tier={tier}
                  style={{ '--weight': Math.max(1, Math.round(item.sharePct)) } as CSSProperties}
                  onClick={() => {
                    if (skillObj) {
                      onInspectSkill(skillObj);
                    } else {
                      onNavigate('audit');
                    }
                  }}
                >
                  <div className="row-wrap" style={{ justifyContent: 'space-between', inlineSize: '100%' }}>
                    <span className={`badge ${item.type === 'mcp' ? 'badge-purple' : 'badge-accent'}`}>
                      {item.type.toUpperCase()}
                    </span>
                    <span className="mono" style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                      {item.startupTokens}t
                    </span>
                  </div>
                  <span className="truncate-line" style={{ fontWeight: 650, fontSize: '0.86rem' }}>
                    {item.name}
                  </span>
                  <span className="muted mono" style={{ fontSize: '0.73rem' }}>
                    {item.platform} · {item.sharePct}% share
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="muted">No skills or active MCP servers found in the selected workspace.</p>
        )}
      </article>

      {/* Platform Breakdown + Scanned Roots */}
      <div className="grid-two">
        <article className="card">
          <h2 className="card-title">
            <Activity size={17} aria-hidden="true" />
            Breakdown by Agent Platform
          </h2>
          {budget.byPlatform.length === 0 ? (
            <p className="muted">No agent platforms discovered yet.</p>
          ) : (
            <div className="stack-sm">
              {budget.byPlatform.map((row) => (
                <div
                  key={row.platform}
                  className="row-wrap"
                  style={{
                    justifyContent: 'space-between',
                    padding: '0.55rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="row-wrap">
                    <span className="badge badge-neutral">{row.platform}</span>
                    <span style={{ fontSize: '0.84rem' }}>
                      {row.skillCount} skills · {row.mcpCount} MCP
                    </span>
                  </div>
                  <span className="mono" style={{ fontSize: '0.8rem' }}>
                    {row.startupTokens.toLocaleString()}t startup
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <h2 className="card-title">Scanned Discovery Roots (Read-Only)</h2>
          <div className="stack-sm" style={{ maxBlockSize: '260px', overflow: 'auto' }}>
            {scannedSources.map((src) => (
              <div
                key={src.rootPath}
                className="row-wrap"
                style={{
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.7rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  flexWrap: 'nowrap',
                }}
              >
                <span className="truncate-line mono" style={{ fontSize: '0.76rem' }}>
                  {src.rootPath}
                </span>
                <span className={`badge ${src.exists ? 'badge-ok' : 'badge-neutral'}`}>
                  {src.exists ? `${src.skillCount}S / ${src.mcpCount}M` : 'not found'}
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
