import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Compass,
  FolderSearch,
  GitCompareArrows,
  Languages,
  Laptop,
  LayoutDashboard,
  Layers,
  Moon,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Workflow,
} from 'lucide-react';
import type { SkillRecord, WorkflowGraph, WorkspaceReport } from '@skilldeck/core';
import {
  fetchHubStatus,
  fetchWorkspaceReport,
  type HubStatusSnapshot,
  type WorkspaceMode,
  type WorkspaceQuery,
} from './api.js';
import { AuditMcpView } from './components/AuditMcpView.js';
import { ConflictsView } from './components/ConflictsView.js';
import { HubView } from './components/HubView.js';
import { ImmuneView } from './components/ImmuneView.js';
import { OverviewView } from './components/OverviewView.js';
import { RouterSandboxView } from './components/RouterSandboxView.js';
import { SkillsView } from './components/SkillsView.js';
import { SuperAgentView } from './components/SuperAgentView.js';
import { WorkflowExportView } from './components/WorkflowExportView.js';
import { useI18n } from './i18n.js';

type ActiveTab =
  | 'overview'
  | 'superagent'
  | 'immune'
  | 'hub'
  | 'skills'
  | 'router'
  | 'conflicts'
  | 'audit'
  | 'workflow';
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
  const { lang, toggleLang, t } = useI18n();
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [mode, setMode] = useState<WorkspaceMode>('demo');
  const [modeInitialized, setModeInitialized] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [includeBuiltin, setIncludeBuiltin] = useState(false);

  const [report, setReport] = useState<WorkspaceReport | null>(null);
  const [hubStatus, setHubStatus] = useState<HubStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectedSkill, setInspectedSkill] = useState<SkillRecord | null>(null);
  const [externalGraph, setExternalGraph] = useState<WorkflowGraph | null>(null);

  const [themeOverride, setThemeOverride] = useState<ThemeOverride>(() => readStoredTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

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

  const loadHub = useCallback(async () => {
    try {
      const status = await fetchHubStatus({ mode, customPath, includeBuiltin });
      setHubStatus(status);
    } catch {
      // Non-fatal
    }
  }, [mode, customPath, includeBuiltin]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, hub] = await Promise.all([
        fetchWorkspaceReport({ mode, customPath, includeBuiltin }),
        fetchHubStatus({ mode, customPath, includeBuiltin }).catch(() => null),
      ]);
      setReport(data);
      if (hub) setHubStatus(hub);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach SkillDeck API');
    } finally {
      setLoading(false);
    }
  }, [mode, customPath, includeBuiltin]);

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { defaultMode?: string } | null) => {
        if (!active) return;
        if (data?.defaultMode === 'local' || data?.defaultMode === 'demo') {
          setMode(data.defaultMode);
        }
        setModeInitialized(true);
      })
      .catch(() => {
        if (active) setModeInitialized(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!modeInitialized) return;
    void loadReport();
  }, [loadReport, modeInitialized]);

  function openSkillFromAnywhere(skill: SkillRecord) {
    setInspectedSkill(skill);
    setActiveTab('skills');
  }

  function handleSendToWorkflow(graph: WorkflowGraph) {
    setExternalGraph(graph);
    setActiveTab('workflow');
  }

  const isDarkRendered =
    themeOverride === 'dark' || (themeOverride === 'system' && systemPrefersDark);

  const pendingQuarantineCount =
    hubStatus?.quarantineQueue.filter((q) => q.status === 'pending').length ?? 0;

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: string | number;
    badgeTone?: string;
  }> = [
    { id: 'overview', label: t('总览看板', 'Overview'), icon: LayoutDashboard },
    { id: 'superagent', label: t('SuperAgent 指挥台', 'SuperAgent'), icon: Bot },
    {
      id: 'immune',
      label: t('Agent 免疫系统', 'Agent-Immune'),
      icon: ShieldAlert,
      badge: report
        ? report.immune.quarantineCount + pendingQuarantineCount ||
          report.immune.agentImmuneBridge.activePitfallCount
        : undefined,
      badgeTone:
        (report?.immune.quarantineCount ?? 0) + pendingQuarantineCount > 0
          ? 'badge-danger'
          : 'badge-ok',
    },
    {
      id: 'hub',
      label: t('MCP 聚合网关', 'MCP Hub'),
      icon: Radio,
      badge: hubStatus ? `-${hubStatus.estimatedTokenSavingsPct}%` : undefined,
      badgeTone: 'badge-accent',
    },
    {
      id: 'skills',
      label: t('技能资产与金库', 'Skills & Vault'),
      icon: Layers,
      badge: report?.summary.skillCount,
    },
    { id: 'router', label: t('路由仿真沙盒', 'Prompt Sandbox'), icon: Compass },
    {
      id: 'conflicts',
      label: t('触发冲突雷达', 'Conflict Radar'),
      icon: GitCompareArrows,
      badge: report?.conflicts.length,
      badgeTone: (report?.summary.highConflictCount ?? 0) > 0 ? 'badge-danger' : 'badge-neutral',
    },
    {
      id: 'audit',
      label: t('MCP 与规范审计', 'MCP & Audit'),
      icon: ShieldCheck,
      badge: report ? report.summary.errorCount + report.summary.warningCount : undefined,
      badgeTone: (report?.summary.errorCount ?? 0) > 0 ? 'badge-danger' : 'badge-warn',
    },
    { id: 'workflow', label: t('画布编排与运行', 'Workflow & Export'), icon: Workflow },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Layers size={19} />
          </div>
          <div>
            <div className="brand-title">SkillDeck v0.3</div>
            <div className="brand-sub">
              {t('SuperAgent 超级总控 · MCP 聚合网关 · Agent-Immune 双层免疫', 'SuperAgent Control Tower · MCP Hub · Agent-Immune Shield')}
            </div>
          </div>
        </div>

        <div className="topbar-controls">
          <div className="segmented" role="group" aria-label={t('选择扫描来源', 'Workspace scan source')}>
            <button type="button" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>
              <Sparkles size={13} aria-hidden="true" />
              {t('演示环境', 'Demo')}
            </button>
            <button type="button" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>
              <Laptop size={13} aria-hidden="true" />
              {t('扫描本机（只读）', 'My Machine')}
            </button>
            <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>
              <FolderSearch size={13} aria-hidden="true" />
              {t('自定义目录', 'Custom')}
            </button>
          </div>

          {mode === 'local' && (
            <label className="row-wrap" style={{ fontSize: '0.78rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeBuiltin}
                onChange={(e) => setIncludeBuiltin(e.target.checked)}
              />
              {t('含内置技能', 'Built-ins')}
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
                {t('自定义扫描目录路径', 'Custom directory path')}
              </label>
              <input
                id="custom-dir-input"
                type="text"
                className="input"
                placeholder="e.g. D:\my-project\.claude"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                style={{ inlineSize: '190px', paddingBlock: '0.32rem', fontSize: '0.8rem' }}
              />
              <button type="submit" className="btn btn-sm">{t('扫描', 'Scan')}</button>
            </form>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void loadReport()}
            disabled={loading}
            aria-label={t('重新扫描工作区', 'Rescan workspace')}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('刷新', 'Rescan')}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={toggleLang}
            aria-label={lang === 'zh' ? 'Switch to English' : '切换为简体中文'}
          >
            <Languages size={14} aria-hidden="true" />
            <span>{lang === 'zh' ? 'EN' : '中文'}</span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={handleToggleColorScheme}
            aria-label={isDarkRendered ? t('切换浅色模式', 'Switch to light theme') : t('切换深色模式', 'Switch to dark theme')}
          >
            {isDarkRendered ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            <span>{isDarkRendered ? t('浅色', 'Light') : t('深色', 'Dark')}</span>
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="sidebar" aria-label={t('主控制塔导航', 'Primary navigation')}>
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
                <span className="muted">{t('模式', 'Mode')}</span>
                <span className="badge badge-accent">{report.mode}</span>
              </div>
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{t('健康 / 免疫', 'Health / Immune')}</span>
                <strong className="mono">
                  {report.summary.healthScore} / {report.summary.immunityScore}
                </strong>
              </div>
              <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{t('常驻开销', 'Always-On')}</span>
                <strong className="mono">{report.budget.totalAlwaysOnTokens.toLocaleString()}t</strong>
              </div>
              <div className="muted" style={{ fontSize: '0.72rem', marginBlockStart: '0.2rem' }}>
                {t('100% 本地运行 · 零云端上报 · 原生兼容 agent-immune', '100% local · zero telemetry · agent-immune native')}
              </div>
            </div>
          )}
        </aside>

        <main className="main-stage">
          {error && (
            <article className="card" role="alert" style={{ borderColor: 'var(--danger)' }}>
              <h2 className="card-title" style={{ color: 'var(--danger)' }}>
                {t('无法连接 SkillDeck 本地服务端', 'Failed to load workspace telemetry')}
              </h2>
              <p>{error}</p>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => void loadReport()}>
                  {t('重试', 'Retry')}
                </button>
              </div>
            </article>
          )}

          {loading && !report ? (
            <article className="card" style={{ padding: '3rem', alignItems: 'center' }}>
              <p className="muted">{t('正在扫描本机 Agent Skills、MCP 配置与 agent-immune 数据库...', 'Scanning Agent Skills, MCP configs & agent-immune databases...')}</p>
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
              {activeTab === 'superagent' && (
                <SuperAgentView query={query} onSendToWorkflow={handleSendToWorkflow} />
              )}
              {activeTab === 'immune' && (
                <ImmuneView
                  immune={report.immune}
                  skills={report.skills}
                  quarantineQueue={hubStatus?.quarantineQueue ?? []}
                  query={query}
                  onRefresh={() => void loadReport()}
                  onRefreshHub={() => void loadHub()}
                />
              )}
              {activeTab === 'hub' && (
                <HubView
                  hubStatus={hubStatus}
                  mcpServers={report.mcpServers}
                  query={query}
                  onRefreshHub={() => void loadHub()}
                />
              )}
              {activeTab === 'skills' && (
                <SkillsView
                  skills={report.skills}
                  issues={report.issues}
                  immuneReports={report.immune.skillReports}
                  inspectedSkill={inspectedSkill}
                  onInspectSkill={setInspectedSkill}
                  query={query}
                  onRefreshWorkspace={() => void loadReport()}
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
                  externalGraph={externalGraph}
                />
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
