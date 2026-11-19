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

interface AuditMcpViewProps {
  mcpServers: McpServerRecord[];
  issues: LintIssue[];
}

export function AuditMcpView({ mcpServers, issues }: AuditMcpViewProps) {
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
          MCP Servers &amp; Security Audit
        </h1>
        <p className="card-subtitle">
          Read-only MCP inventory with automatic credential redaction, executable PATH verification, and Agent Skills specification lint diagnostics.
        </p>
      </div>

      {/* MCP Servers Grid */}
      <article className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Server size={17} aria-hidden="true" />
            Discovered MCP Servers ({mcpServers.length})
          </h2>
          <span className="badge badge-ok">Secrets auto-redacted before render</span>
        </div>

        {mcpServers.length === 0 ? (
          <p className="muted">No MCP server configurations (`mcpServers`) were found in the scanned roots.</p>
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
                        <span className="badge badge-neutral">disabled</span>
                      ) : hasSecrets ? (
                        <span className="badge badge-danger">
                          <ShieldAlert size={12} aria-hidden="true" /> {srv.secretFindings.length} secret(s)
                        </span>
                      ) : srv.commandAvailable === false ? (
                        <span className="badge badge-warn">binary missing</span>
                      ) : (
                        <span className="badge badge-ok">
                          <CheckCircle2 size={12} aria-hidden="true" /> ready
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
                      Endpoint: {srv.url}
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
                    <span className="truncate-line" style={{ maxInlineSize: '72%' }}>{srv.configPath}</span>
                    <span>~{srv.estimatedSchemaTokens}t est. schema</span>
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
          <h2 className="card-title">Spec &amp; Security Diagnostics ({issues.length})</h2>
          <div className="segmented" role="group" aria-label="Filter diagnostics by severity">
            <button
              type="button"
              aria-pressed={severityFilter === 'all'}
              onClick={() => setSeverityFilter('all')}
            >
              All ({issues.length})
            </button>
            <button
              type="button"
              aria-pressed={severityFilter === 'error'}
              onClick={() => setSeverityFilter('error')}
            >
              Errors ({errorCount})
            </button>
            <button
              type="button"
              aria-pressed={severityFilter === 'warning'}
              onClick={() => setSeverityFilter('warning')}
            >
              Warnings ({warningCount})
            </button>
            <button
              type="button"
              aria-pressed={severityFilter === 'info'}
              onClick={() => setSeverityFilter('info')}
            >
              Info ({infoCount})
            </button>
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <p className="muted">No diagnostics match the selected severity filter.</p>
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
                    {issue.filePath}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem' }}>{issue.message}</p>
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  <strong>Suggested fix:</strong> {issue.suggestion}
                </p>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
