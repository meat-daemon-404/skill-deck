import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  KeyRound,
  Server,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import type { LintIssue, LintSeverity, McpServerRecord } from '@skilldeck/core';
import { maskLocalHomePath } from '../api.js';
import { useI18n } from '../i18n.js';

interface AuditMcpViewProps {
  mcpServers: McpServerRecord[];
  issues: LintIssue[];
}

export function AuditMcpView({ mcpServers, issues }: AuditMcpViewProps) {
  const { t } = useI18n();
  const [severityFilter, setSeverityFilter] = useState<'all' | LintSeverity>('all');

  const filteredIssues = useMemo(() => {
    if (severityFilter === 'all') return issues;
    return issues.filter((i) => i.severity === severityFilter);
  }, [issues, severityFilter]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return (
    <section className="stack-md" aria-labelledby="audit-heading">
      <div>
        <h1 id="audit-heading" style={{ fontSize: '1.35rem', fontWeight: 750, letterSpacing: '-0.02em' }}>
          {t('MCP 配置与规范安全审计', 'MCP Servers & Spec Security Audit')}
        </h1>
        <p className="card-subtitle">
          {t(
            '严格只读扫描 MCP 配置，渲染前自动遮罩敏感密钥、检测本机 PATH 可执行文件并按 14 条规则诊断规范漂移。',
            'Read-only MCP inventory with automatic credential redaction, executable PATH verification, and 14-rule spec diagnostics.',
          )}
        </p>
      </div>

      {/* MCP Servers Grid */}
      <article className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Server size={17} aria-hidden="true" />
            {t(`已发现 MCP 服务 (${mcpServers.length})`, `Discovered MCP Servers (${mcpServers.length})`)}
          </h2>
          <span className="badge badge-ok">
            {t('所有密钥已在核心层自动脱敏', 'Secrets auto-redacted before render')}
          </span>
        </div>

        {mcpServers.length === 0 ? (
          <p className="muted">{t('未扫描到 MCP 服务配置。', 'No MCP server configurations found.')}</p>
        ) : (
          <div className="grid-two">
            {mcpServers.map((srv) => {
              const hasSecrets = srv.secretFindings.length > 0;
              return (
                <div
                  key={srv.id}
                  style={{
                    padding: '0.9rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${hasSecrets ? 'var(--danger)' : 'var(--border)'}`,
                    background: 'var(--bg-elevated)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                    <div className="row-wrap">
                      <strong className="mono" style={{ fontSize: '0.92rem' }}>{srv.name}</strong>
                      <span className="badge badge-neutral">{srv.platform}</span>
                      <span className="badge badge-purple">{srv.transport}</span>
                    </div>
                    <div className="row-wrap">
                      {srv.disabled ? (
                        <span className="badge badge-neutral">{t('已禁用', 'disabled')}</span>
                      ) : hasSecrets ? (
                        <span className="badge badge-danger">
                          <ShieldAlert size={12} aria-hidden="true" /> {srv.secretFindings.length} {t('密钥告警', 'secret(s)')}
                        </span>
                      ) : srv.commandAvailable === false ? (
                        <span className="badge badge-warn">{t('缺少命令', 'binary missing')}</span>
                      ) : (
                        <span className="badge badge-ok">
                          <CheckCircle2 size={12} aria-hidden="true" /> {t('就绪', 'ready')}
                        </span>
                      )}
                    </div>
                  </div>

                  {srv.command && (
                    <div className="row-wrap mono" style={{ fontSize: '0.77rem' }}>
                      <Terminal size={13} aria-hidden="true" className="muted" />
                      <span className="truncate-line">
                        {srv.command} {srv.redactedArgs.join(' ')}
                      </span>
                    </div>
                  )}

                  {srv.url && (
                    <div className="mono muted truncate-line" style={{ fontSize: '0.77rem' }}>
                      {t('地址：', 'Endpoint: ')}{srv.url}
                    </div>
                  )}

                  {Object.keys(srv.redactedEnv).length > 0 && (
                    <div
                      style={{
                        padding: '0.5rem 0.65rem',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--code-bg)',
                        border: '1px solid var(--border)',
                        fontSize: '0.74rem',
                      }}
                      className="mono stack-sm"
                    >
                      {Object.entries(srv.redactedEnv).map(([key, val]) => (
                        <div key={key} className="truncate-line">
                          <KeyRound size={11} aria-hidden="true" style={{ marginInlineEnd: '0.35rem', verticalAlign: 'middle' }} />
                          <strong>{key}</strong>={val}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="row-wrap muted mono" style={{ justifyContent: 'space-between', fontSize: '0.72rem' }}>
                    <span className="truncate-line" style={{ maxInlineSize: '72%' }}>{maskLocalHomePath(srv.configPath)}</span>
                    <span>~{srv.estimatedSchemaTokens}t</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      {/* Spec & Security Linter Explorer */}
      <article className="card">
        <div className="card-header">
          <h2 className="card-title">
            {t(`规范与安全诊断列表 (${issues.length})`, `Spec & Security Diagnostics (${issues.length})`)}
          </h2>
          <div className="segmented" role="group" aria-label={t('按严重等级筛选', 'Filter diagnostics by severity')}>
            <button type="button" aria-pressed={severityFilter === 'all'} onClick={() => setSeverityFilter('all')}>
              {t(`全部 (${issues.length})`, `All (${issues.length})`)}
            </button>
            <button type="button" aria-pressed={severityFilter === 'error'} onClick={() => setSeverityFilter('error')}>
              {t(`错误 (${errorCount})`, `Errors (${errorCount})`)}
            </button>
            <button type="button" aria-pressed={severityFilter === 'warning'} onClick={() => setSeverityFilter('warning')}>
              {t(`警告 (${warningCount})`, `Warnings (${warningCount})`)}
            </button>
            <button type="button" aria-pressed={severityFilter === 'info'} onClick={() => setSeverityFilter('info')}>
              {t(`提示 (${infoCount})`, `Info (${infoCount})`)}
            </button>
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <p className="muted">{t('当前筛选条件下无诊断问题。', 'No diagnostics match the selected filter.')}</p>
        ) : (
          <div className="stack-sm">
            {filteredIssues.map((issue) => (
              <div
                key={issue.id}
                style={{
                  padding: '0.8rem 0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                  <div className="row-wrap">
                    <span
                      className={`badge ${
                        issue.severity === 'error'
                          ? 'badge-danger'
                          : issue.severity === 'warning'
                            ? 'badge-warn'
                            : 'badge-neutral'
                      }`}
                    >
                      {issue.severity === 'error' ? (
                        <AlertCircle size={12} aria-hidden="true" />
                      ) : issue.severity === 'warning' ? (
                        <AlertTriangle size={12} aria-hidden="true" />
                      ) : (
                        <Info size={12} aria-hidden="true" />
                      )}
                      {issue.ruleId} · {issue.severity.toUpperCase()}
                    </span>
                    <strong style={{ fontSize: '0.88rem' }}>{issue.targetName}</strong>
                    <span className="badge badge-neutral">{issue.category}</span>
                  </div>
                  <span className="mono muted truncate-line" style={{ fontSize: '0.73rem', maxInlineSize: '360px' }}>
                    {maskLocalHomePath(issue.filePath)}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem' }}>{issue.message}</p>
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  <strong>{t('修复建议：', 'Suggested fix: ')}</strong>
                  {issue.suggestion}
                </p>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
