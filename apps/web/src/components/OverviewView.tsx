import type { CSSProperties } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Cpu,
  Flame,
  Layers,
  Server,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { SkillRecord, WorkspaceReport } from '@skilldeck/core';
import { useI18n } from '../i18n.js';

interface OverviewViewProps {
  report: WorkspaceReport;
  onInspectSkill: (skill: SkillRecord) => void;
  onNavigate: (
    tab: 'superagent' | 'immune' | 'hub' | 'skills' | 'router' | 'conflicts' | 'audit' | 'workflow',
  ) => void;
}

export function OverviewView({ report, onInspectSkill, onNavigate }: OverviewViewProps) {
  const { t } = useI18n();
  const { summary, budget, skills, scannedSources, immune } = report;
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
    summary.healthScore >= 85
      ? t('健康', 'Healthy')
      : summary.healthScore >= 60
        ? t('需关注', 'Needs Attention')
        : t('待处理', 'Action Required');

  return (
    <section className="stack-md" aria-labelledby="overview-heading">
      <div className="card-header">
        <div>
          <h1 id="overview-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
            {t('总控台全局概览', 'Control Tower Overview')}
          </h1>
          <p className="card-subtitle">
            {t(
              '一站式实时遥测：跨 7 大 Agent 平台技能资产、MCP 网关、Token 预算、双语冲突与 Agent-Immune 双层免疫态势。',
              'Real-time telemetry across 7 Agent platforms, MCP servers, context budgets, trigger conflicts, and dual-layer Agent-Immune posture.',
            )}
          </p>
        </div>
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => onNavigate('immune')}>
            <ShieldCheck size={14} aria-hidden="true" />
            {t('查看免疫态势', 'Open Agent-Immune')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('superagent')}>
            <Bot size={14} aria-hidden="true" />
            {t('启动 SuperAgent 指挥台', 'Launch SuperAgent')}
          </button>
        </div>
      </div>

      <div className="grid-kpi">
        <article className="kpi-card">
          <div className="kpi-label">
            <span>{t('工作区健康度', 'Workspace Health')}</span>
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
            {t(
              `${summary.errorCount} 错误 · ${summary.warningCount} 警告 · ${summary.infoCount} 提示`,
              `${summary.errorCount} errors · ${summary.warningCount} warnings · ${summary.infoCount} info`,
            )}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>{t('Agent 免疫评分', 'Immunity Score')}</span>
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <span className="kpi-value">{summary.immunityScore}/100</span>
            <span className={`badge ${summary.quarantineSkillCount > 0 ? 'badge-danger' : 'badge-ok'}`}>
              {summary.quarantineSkillCount > 0
                ? t(`${summary.quarantineSkillCount} 需隔离`, `${summary.quarantineSkillCount} quarantine`)
                : t('免疫安全', 'Protected')}
            </span>
          </div>
          <p className="kpi-meta">
            {t(
              `${immune.agentImmuneBridge.activePitfallCount} 条 agent-immune 踩坑抗体已就绪`,
              `${immune.agentImmuneBridge.activePitfallCount} agent-immune pitfall antibodies ready`,
            )}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>{t('每轮常驻启动开销', 'Always-On Startup')}</span>
            <Flame size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">{budget.totalAlwaysOnTokens.toLocaleString()}t</span>
          <p className="kpi-meta">
            {t(
              `占推荐上限 (${budget.recommendedStartupLimit.toLocaleString()}t) 的 ${budget.startupUtilizationPct}%`,
              `${budget.startupUtilizationPct}% of ${budget.recommendedStartupLimit.toLocaleString()}t budget`,
            )}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>{t('已发现技能总数', 'Discovered Skills')}</span>
            <Layers size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">{summary.skillCount}</span>
          <p className="kpi-meta">
            {t(
              `按需正文 ${budget.totalOnDemandBodyTokens.toLocaleString()}t`,
              `${budget.totalOnDemandBodyTokens.toLocaleString()}t deferred bodies`,
            )}
          </p>
        </article>

        <article className="kpi-card">
          <div className="kpi-label">
            <span>{t('MCP 服务与冲突', 'MCP & Conflicts')}</span>
            <Server size={16} aria-hidden="true" />
          </div>
          <span className="kpi-value">
            {summary.activeMcpCount}/{summary.mcpServerCount}
          </span>
          <p className="kpi-meta">
            <AlertTriangle size={12} aria-hidden="true" style={{ verticalAlign: 'middle', marginInlineEnd: '0.25rem' }} />
            {t(
              `${report.conflicts.length} 对冲突 · ${summary.secretFindingCount} 密钥已脱敏`,
              `${report.conflicts.length} conflicts · ${summary.secretFindingCount} secrets redacted`,
            )}
          </p>
        </article>
      </div>

      {/* Context Budget Proportional Bar + Heatmap */}
      <article className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">
              <Cpu size={17} aria-hidden="true" />
              {t('常驻上下文预算 & Token 消耗热力图', 'Startup Context Budget & Token Heatmap')}
            </h2>
            <p className="card-subtitle">
              {t(
                '点击任意卡片即可深入体检。接入 SkillDeck MCP Hub 可把 MCP 常驻开销压缩至 ~580t。',
                'Click any tile to inspect details. Connect via SkillDeck MCP Hub to compress always-on overhead down to ~580t.',
              )}
            </p>
          </div>
          <div className="row-wrap">
            <span className="badge badge-accent">
              {t('技能目录：', 'Skills Catalog: ')}{budget.totalStartupSkillTokens.toLocaleString()}t
            </span>
            <span className="badge badge-purple">
              {t('MCP Schema：', 'MCP Schemas: ')}{budget.totalStartupMcpTokens.toLocaleString()}t
            </span>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('hub')}>
              {t('一键省流接入 Hub', 'Save Tokens via Hub')}
            </button>
          </div>
        </div>

        <div
          className="budget-track"
          role="img"
          aria-label={t(
            `常驻 Token 占用：技能目录 ${budget.totalStartupSkillTokens}t，MCP Schema ${budget.totalStartupMcpTokens}t`,
            `Startup token usage: ${budget.totalStartupSkillTokens}t skills and ${budget.totalStartupMcpTokens}t MCP schemas`,
          )}
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
                    {item.platform} · {item.sharePct}%
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="muted">{t('当前工作区暂未扫描到技能或活跃 MCP。', 'No skills or active MCP servers found.')}</p>
        )}
      </article>

      {/* Platform Breakdown + Scanned Roots */}
      <div className="grid-two">
        <article className="card">
          <h2 className="card-title">
            <Activity size={17} aria-hidden="true" />
            {t('各 Agent 平台分布（含 DSH / ZCode / Antigravity）', 'Breakdown by Agent Platform')}
          </h2>
          {budget.byPlatform.length === 0 ? (
            <p className="muted">{t('暂无数据', 'No platforms discovered yet.')}</p>
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
                      {t(`${row.skillCount} 技能 · ${row.mcpCount} MCP`, `${row.skillCount} skills · ${row.mcpCount} MCP`)}
                    </span>
                  </div>
                  <span className="mono" style={{ fontSize: '0.8rem' }}>
                    {row.startupTokens.toLocaleString()}t {t('常驻', 'startup')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card">
          <h2 className="card-title">{t('已扫描配置根目录（严格只读）', 'Scanned Discovery Roots (Read-Only)')}</h2>
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
                  {src.exists ? `${src.skillCount}S / ${src.mcpCount}M` : t('未找到', 'not found')}
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
