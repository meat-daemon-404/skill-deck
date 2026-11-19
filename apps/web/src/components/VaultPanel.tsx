import { useEffect, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  FolderSync,
  History,
  RotateCcw,
} from 'lucide-react';
import type { VaultStatus, VaultSyncPreviewItem } from '@skilldeck/core';
import {
  applyVaultSyncApi,
  fetchVaultStatus,
  importToVaultApi,
  previewVaultSyncApi,
  rollbackVaultApi,
  type WorkspaceQuery,
} from '../api.js';
import { useI18n } from '../i18n.js';

interface VaultPanelProps {
  query: WorkspaceQuery;
  onRefreshWorkspace: () => void;
}

export function VaultPanel({ query, onRefreshWorkspace }: VaultPanelProps) {
  const { t } = useI18n();
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [previewItems, setPreviewItems] = useState<VaultSyncPreviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refreshVault() {
    const data = await fetchVaultStatus();
    setVault(data);
  }

  useEffect(() => {
    void refreshVault();
  }, []);

  async function handleImportHealthy() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await importToVaultApi(query);
      setVault(res.vault);
      setFeedback(
        t(
          `已将当前工作区 ${res.transaction.operations.length} 个安全技能纳管进统一金库（自动跳过隔离技能）。`,
          `Imported ${res.transaction.operations.length} healthy skill(s) into canonical Vault (quarantined skills excluded).`,
        ),
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviewSync() {
    if (!targetDir.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await previewVaultSyncApi(targetDir.trim());
      setPreviewItems(res.items);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleApplySync() {
    if (!targetDir.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await applyVaultSyncApi(targetDir.trim());
      setVault(res.vault);
      setPreviewItems(null);
      setFeedback(res.transaction.summary);
      onRefreshWorkspace();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRollback(txId: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await rollbackVaultApi(txId);
      setVault(res.vault);
      setFeedback(res.transaction.summary);
      onRefreshWorkspace();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">
            <Archive size={17} aria-hidden="true" />
            {t('Skill Vault 统一金库与事务同步（支持预演 + 一键回滚）', 'Skill Vault & Transactional Sync (Dry-Run + Rollback)')}
          </h2>
          <p className="card-subtitle">
            {t(
              `单一真源目录：${vault?.vaultRoot ?? '~/.skilldeck/vault'} · 所有同步、隔离、启停操作均自动备份并支持一键撤销。`,
              `Single source of truth: ${vault?.vaultRoot ?? '~/.skilldeck/vault'} · Every sync/disable/quarantine records backups for 1-click undo.`,
            )}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void handleImportHealthy()}
        >
          <Archive size={13} aria-hidden="true" />
          {t('纳管当前安全技能进金库', 'Import Healthy Skills to Vault')}
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          style={{
            padding: '0.6rem 0.85rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-soft)',
            fontSize: '0.82rem',
          }}
        >
          {feedback}
        </div>
      )}

      <div className="grid-two">
        {/* Vault Sync Panel */}
        <div className="stack-sm">
          <strong style={{ fontSize: '0.88rem' }}>
            {t(`金库已纳管技能 (${vault?.skills.length ?? 0})`, `Canonical Vault Skills (${vault?.skills.length ?? 0})`)}
          </strong>
          {vault && vault.skills.length > 0 ? (
            <div className="row-wrap" style={{ maxBlockSize: '120px', overflow: 'auto' }}>
              {vault.skills.map((s) => (
                <span key={s.slug} className="badge badge-accent">{s.name}</span>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {t('金库为空，点击右上角即可安全复制纳管。', 'Vault is empty. Click Import above to populate.')}
            </p>
          )}

          <div className="row-wrap" style={{ marginBlockStart: '0.35rem' }}>
            <label htmlFor="vault-sync-target" className="sr-only">
              {t('同步目标技能目录', 'Target skills directory')}
            </label>
            <input
              id="vault-sync-target"
              className="input"
              style={{ flex: '1 1 200px', fontSize: '0.8rem' }}
              placeholder={t('输入目标目录进行预演同步，如 D:\\tmp\\sync-test', 'Target directory for Dry-Run sync...')}
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || !targetDir.trim() || (vault?.skills.length ?? 0) === 0}
              onClick={() => void handlePreviewSync()}
            >
              <FolderSync size={13} aria-hidden="true" />
              {t('沙盒预演', 'Dry-Run')}
            </button>
            {previewItems && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void handleApplySync()}
              >
                <CheckCircle2 size={13} aria-hidden="true" />
                {t('确认执行同步', 'Apply Sync')}
              </button>
            )}
          </div>

          {previewItems && (
            <div className="stack-sm" style={{ maxBlockSize: '140px', overflow: 'auto', fontSize: '0.77rem' }}>
              {previewItems.map((it) => (
                <div key={it.slug} className="row-wrap">
                  <span className={`badge ${it.change === 'create' ? 'badge-ok' : it.change === 'update' ? 'badge-warn' : 'badge-neutral'}`}>
                    {it.change.toUpperCase()}
                  </span>
                  <span className="mono">{it.skillName}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transaction Rollback History */}
        <div className="stack-sm">
          <strong style={{ fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <History size={15} aria-hidden="true" />
            {t(`事务日志与时光机回滚 (${vault?.transactions.length ?? 0})`, `Transaction History & Rollback (${vault?.transactions.length ?? 0})`)}
          </strong>
          {!vault || vault.transactions.length === 0 ? (
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {t('尚未发生文件写入事务。', 'No filesystem transactions recorded yet.')}
            </p>
          ) : (
            <div className="stack-sm" style={{ maxBlockSize: '185px', overflow: 'auto' }}>
              {vault.transactions.slice(0, 12).map((tx) => (
                <div
                  key={tx.id}
                  className="row-wrap"
                  style={{
                    justifyContent: 'space-between',
                    padding: '0.45rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    fontSize: '0.76rem',
                  }}
                >
                  <div className="row-wrap" style={{ minInlineSize: 0, flex: '1 1 auto' }}>
                    <span className={`badge ${tx.rolledBack ? 'badge-neutral' : 'badge-accent'}`}>
                      {tx.action.toUpperCase()}
                    </span>
                    <span className="truncate-line">{tx.summary}</span>
                  </div>
                  {!tx.rolledBack && tx.action !== 'rollback' && tx.operations.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void handleRollback(tx.id)}
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                      {t('一键回滚', 'Undo')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
