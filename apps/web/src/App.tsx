import { useCallback, useEffect, useState } from 'react';
import {
  Compass,
  FolderSearch,
  GitCompareArrows,
  Laptop,
  LayoutDashboard,
  Layers,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Workflow,
} from 'lucide-react';
import type { SkillRecord, WorkspaceReport } from '@skilldeck/core';
import { fetchWorkspaceReport, type WorkspaceMode, type WorkspaceQuery } from './api.js';
import { AuditMcpView } from './components/AuditMcpView.js';
import { ConflictsView } from './components/ConflictsView.js';
import { OverviewView } from './components/OverviewView.js';
import { RouterSandboxView } from './components/RouterSandboxView.js';
import { SkillsView } from './components/SkillsView.js';
import { WorkflowExportView } from './components/WorkflowExportView.js';

type ActiveTab = 'overview' | 'skills' | 'router' | 'conflicts' | 'audit' | 'workflow';
type ThemeOverride = 'system' | 'light' | 'dark';

function readStoredTheme(): ThemeOverride {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // Ignore storage access errors
  }
  return 'system';
}

function applyThemeMeta(override: ThemeOverride): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = override === 'system' ? 'light dark' : override;
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [mode, setMode] = useState<WorkspaceMode>('demo');
  const [customPath, setCustomPath] = useState('');
  const [includeBuiltin, setIncludeBuiltin] = useState(false);

  const [report, setReport] = useState<WorkspaceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectedSkill, setInspectedSkill] = useState<SkillRecord | null>(null);

  const [themeOverride, setThemeOverride] = useState<ThemeOverride>(() => readStoredTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  // Sync system preference changes & cross-tab storage updates cleanly
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMqChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mq.addEventListener('change', onMqChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'color-scheme') {
        const next = readStoredTheme();
        setThemeOverride(next);
        applyThemeMeta(next);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Two-state color-scheme toggle per modern-web-guidance dark-mode-toggle spec
  function handleToggleColorScheme() {
    const currentlyRenderedDark =
      themeOverride === 'dark' || (themeOverride === 'system' && systemPrefersDark);
    const target: 'light' | 'dark' = currentlyRenderedDark ? 'light' : 'dark';
    const systemScheme: 'light' | 'dark' = systemPrefersDark ? 'dark' : 'light';

    let next: ThemeOverride;
    if (target === systemScheme) {
      next = 'system';
      try {
        localStorage.removeItem('color-scheme');
      } catch {
        // Ignore storage errors
      }
    } else {
      next = target;
      try {
        localStorage.setItem('color-scheme', target);
      } catch {
        // Ignore storage errors
      }
    }

    setThemeOverride(next);
    applyThemeMeta(next);
  }

  const query: WorkspaceQuery = { mode, customPath, includeBuiltin };

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWorkspaceReport({ mode, customPath, includeBuiltin });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach SkillDeck API');
    } finally {
      setLoading(false);
    }
  }, [mode, customPath, includeBuiltin]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function openSkillFromAnywhere(skill: SkillRecord) {
    setInspectedSkill(skill);
    setActiveTab('skills');
  }

  const isDarkRendered =
    themeOverride === 'dark' || (themeOverride === 'system' && systemPrefersDark);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: string | number;
    badgeTone?: string;
  }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    {
      id: 'skills',
      label: 'Skills Inventory',
      icon: Layers,
      badge: report?.summary.skillCount,
    },
    { id: 'router', label: 'Prompt Sandbox', icon: Compass },
    {
      id: 'conflicts',
      label: 'Conflict Radar',
      icon: GitCompareArrows,
      badge: report?.conflicts.length,
      badgeTone: (report?.summary.highConflictCount ?? 0) > 0 ? 'badge-danger' : 'badge-neutral',
    },
    {
      id: 'audit',
      label: 'MCP & Audit',
      icon: ShieldCheck,
      badge: report ? report.summary.errorCount + report.summary.warningCount : undefined,
      badgeTone: (report?.summary.errorCount ?? 0) > 0 ? 'badge-danger' : 'badge-warn',
    },
    { id: 'workflow', label: 'Workflow & Export', icon: Workflow },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Layers size={19} />
          </div>
          <div>
            <div className="brand-title">SkillDeck</div>
            <div className="brand-sub">AI Agent Skills &amp; MCP Control Tower</div>
          </div>
        </div>

        <div className="topbar-controls">
          <div className="segmented" role="group" aria-label="Workspace scan source">
            <button
              type="button"
              aria-pressed={mode === 'demo'}
              onClick={() => setMode('demo')}
            >
              <Sparkles size={13} aria-hidden="true" />
              Demo Workspace
            </button>
            <button
              type="button"
              aria-pressed={mode === 'local'}
              onClick={() => setMode('local')}
            >
              <Laptop size={13} aria-hidden="true" />
              My Machine (Read-Only)
            </button>
            <button
              type="button"
              aria-pressed={mode === 'custom'}
              onClick={() => setMode('custom')}
            >
              <FolderSearch size={13} aria-hidden="true" />
              Custom Path
            </button>
          </div>

          {mode === 'local' && (
            <label className="row-wrap" style={{ fontSize: '0.78rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeBuiltin}
                onChange={(e) => setIncludeBuiltin(e.target.checked)}
              />
              Include built-in skills
            </label>
          )}

          {mode === 'custom' && (
            <form
              className="row-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                void loadReport();
              }}
            >
              <label htmlFor="custom-dir-input" className="sr-only">
                Custom directory path to scan
              </label>
              <input
                id="custom-dir-input"
                type="text"
                className="input"
                placeholder="e.g. D:\my-project\.claude"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                style={{ inlineSize: '210px', paddingBlock: '0.32rem', fontSize: '0.8rem' }}
              />
              <button type="submit" className="btn btn-sm">Scan</button>
            </form>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadReport()}
            disabled={loading}
            aria-label="Rescan workspace"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Rescan
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleToggleColorScheme}
            aria-label={isDarkRendered ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDarkRendered ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            <span>{isDarkRendered ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="sidebar" aria-label="Primary control tower navigation">
          <nav>
            <ul className="nav-list">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="nav-btn"
                      aria-current={activeTab === item.id ? 'page' : undefined}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span className="nav-btn-left">
                        <Icon size={16} aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span className={`badge ${item.badgeTone ?? 'badge-neutral'}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {report && (
            <div className="sidebar-summary">
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Mode</span>
                <span className="badge badge-accent">{report.mode}</span>
              </div>
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Health Score</span>
                <strong className="mono">{report.summary.healthScore}/100</strong>
              </div>
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Always-On</span>
                <strong className="mono">{report.budget.totalAlwaysOnTokens.toLocaleString()}t</strong>
              </div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBlockStart: '0.2rem' }}>
                100% local · zero cloud telemetry · read-only discovery
              </div>
            </div>
          )}
        </aside>

        <main className="main-stage">
          {error && (
            <article className="card" role="alert" style={{ borderColor: 'var(--danger)' }}>
              <h2 className="card-title" style={{ color: 'var(--danger)' }}>
                Failed to load workspace telemetry
              </h2>
              <p>{error}</p>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => void loadReport()}>
                  Retry Scan
                </button>
              </div>
            </article>
          )}

          {loading && !report ? (
            <article className="card" style={{ padding: '3rem', alignItems: 'center' }}>
              <p className="muted">Scanning Agent Skills and MCP configurations...</p>
            </article>
          ) : report ? (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  report={report}
                  onInspectSkill={openSkillFromAnywhere}
                  onNavigate={(tab) => setActiveTab(tab)}
                />
              )}
              {activeTab === 'skills' && (
                <SkillsView
                  skills={report.skills}
                  issues={report.issues}
                  inspectedSkill={inspectedSkill}
                  onInspectSkill={setInspectedSkill}
                />
              )}
              {activeTab === 'router' && <RouterSandboxView query={query} />}
              {activeTab === 'conflicts' && (
                <ConflictsView
                  conflicts={report.conflicts}
                  skills={report.skills}
                  onInspectSkill={openSkillFromAnywhere}
                />
              )}
              {activeTab === 'audit' && (
                <AuditMcpView mcpServers={report.mcpServers} issues={report.issues} />
              )}
              {activeTab === 'workflow' && (
                <WorkflowExportView
                  skills={report.skills}
                  mcpServers={report.mcpServers}
                  query={query}
                  colorMode={isDarkRendered ? 'dark' : 'light'}
                />
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
