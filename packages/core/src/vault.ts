import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillMarkdown } from './frontmatter.js';
import type {
  SkillRecord,
  VaultSkillEntry,
  VaultStatus,
  VaultSyncPreviewItem,
  VaultTransaction,
  VaultTransactionOp,
} from './types.js';

function slugify(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return clean || 'skill';
}

export function getDefaultVaultRoot(): string {
  return path.join(os.homedir(), '.skilldeck', 'vault');
}

function getTxLogPath(vaultRoot: string): string {
  return path.join(vaultRoot, 'transactions.json');
}

function getBackupDir(vaultRoot: string): string {
  return path.join(vaultRoot, 'backups');
}

function getVaultSkillsDir(vaultRoot: string): string {
  return path.join(vaultRoot, 'skills');
}

function ensureVaultDirs(vaultRoot: string): void {
  fs.mkdirSync(getVaultSkillsDir(vaultRoot), { recursive: true });
  fs.mkdirSync(getBackupDir(vaultRoot), { recursive: true });
}

function loadTransactions(vaultRoot: string): VaultTransaction[] {
  const txPath = getTxLogPath(vaultRoot);
  if (!fs.existsSync(txPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(txPath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as VaultTransaction[]) : [];
  } catch {
    return [];
  }
}

function saveTransactions(vaultRoot: string, transactions: VaultTransaction[]): void {
  ensureVaultDirs(vaultRoot);
  fs.writeFileSync(
    getTxLogPath(vaultRoot),
    `${JSON.stringify(transactions.slice(0, 60), null, 2)}\n`,
    'utf8',
  );
}

function makeTxId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Reads all canonical skills stored inside the local SkillDeck Vault plus transaction history.
 */
export function getVaultStatus(vaultRoot = getDefaultVaultRoot()): VaultStatus {
  const skillsDir = getVaultSkillsDir(vaultRoot);
  const skills: VaultSkillEntry[] = [];

  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      try {
        const raw = fs.readFileSync(skillFile, 'utf8');
        const parsed = parseSkillMarkdown(raw);
        const metaFile = path.join(skillsDir, entry.name, '.vault-meta.json');
        let importedFrom: string | undefined;
        let importedAt = fs.statSync(skillFile).mtime.toISOString();
        if (fs.existsSync(metaFile)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as {
              importedFrom?: string;
              importedAt?: string;
            };
            importedFrom = meta.importedFrom;
            if (meta.importedAt) importedAt = meta.importedAt;
          } catch {
            // Ignore malformed metadata
          }
        }
        skills.push({
          slug: entry.name,
          name:
            typeof parsed.frontmatter.name === 'string' && parsed.frontmatter.name.trim()
              ? parsed.frontmatter.name.trim()
              : entry.name,
          vaultPath: skillFile,
          description:
            typeof parsed.frontmatter.description === 'string'
              ? parsed.frontmatter.description.trim()
              : '',
          importedFrom,
          importedAt,
          contentHash: createHash('sha256').update(raw).digest('hex').slice(0, 16),
        });
      } catch {
        // Skip unreadable skill
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return {
    vaultRoot,
    skills,
    transactions: loadTransactions(vaultRoot),
  };
}

/**
 * Imports one or more discovered SkillRecords into the canonical SkillDeck Vault
 * with full transaction logging so imports are auditable and reversible.
 */
export function importSkillsToVault(
  skills: SkillRecord[],
  vaultRoot = getDefaultVaultRoot(),
): VaultTransaction {
  ensureVaultDirs(vaultRoot);
  const operations: VaultTransactionOp[] = [];
  const txId = makeTxId('import');
  const backupBase = path.join(getBackupDir(vaultRoot), txId);

  for (const skill of skills) {
    const slug = slugify(skill.name);
    const destDir = path.join(getVaultSkillsDir(vaultRoot), slug);
    const destSkillFile = path.join(destDir, 'SKILL.md');
    const existedBefore = fs.existsSync(destSkillFile);
    let backupPath: string | undefined;

    if (existedBefore) {
      backupPath = path.join(backupBase, slug, 'SKILL.md');
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(destSkillFile, backupPath);
    }

    const srcDir = path.dirname(skill.filePath);
    if (skill.kind === 'skill' && fs.existsSync(srcDir)) {
      copyDirRecursive(srcDir, destDir);
    } else {
      fs.mkdirSync(destDir, { recursive: true });
      const raw = fs.readFileSync(skill.filePath, 'utf8');
      fs.writeFileSync(destSkillFile, raw, 'utf8');
    }

    fs.writeFileSync(
      path.join(destDir, '.vault-meta.json'),
      JSON.stringify(
        {
          importedFrom: skill.filePath,
          importedAt: new Date().toISOString(),
          platform: skill.platform,
        },
        null,
        2,
      ),
      'utf8',
    );

    operations.push({
      kind: 'copy',
      sourcePath: skill.filePath,
      targetPath: destSkillFile,
      backupPath,
      existedBefore,
    });
  }

  const tx: VaultTransaction = {
    id: txId,
    timestamp: new Date().toISOString(),
    action: 'import',
    summary: `Imported ${skills.length} skill(s) into SkillDeck Vault.`,
    rolledBack: false,
    operations,
  };

  const history = loadTransactions(vaultRoot);
  saveTransactions(vaultRoot, [tx, ...history]);
  return tx;
}

/**
 * Generates a safe Dry-Run preview showing what syncing the Vault into targetRoot would change.
 */
export function previewVaultSync(
  targetRoot: string,
  vaultRoot = getDefaultVaultRoot(),
  slugs?: string[],
): VaultSyncPreviewItem[] {
  const status = getVaultStatus(vaultRoot);
  const selected =
    slugs && slugs.length > 0
      ? status.skills.filter((s) => slugs.includes(s.slug))
      : status.skills;

  const resolvedTarget = path.resolve(targetRoot);
  return selected.map((entry) => {
    const destFile = path.join(resolvedTarget, entry.slug, 'SKILL.md');
    if (!fs.existsSync(destFile)) {
      return {
        skillName: entry.name,
        slug: entry.slug,
        targetPath: destFile,
        change: 'create',
      };
    }
    const existingHash = createHash('sha256')
      .update(fs.readFileSync(destFile, 'utf8'))
      .digest('hex')
      .slice(0, 16);
    return {
      skillName: entry.name,
      slug: entry.slug,
      targetPath: destFile,
      change: existingHash === entry.contentHash ? 'unchanged' : 'update',
    };
  });
}

/**
 * Atomically syncs selected Vault skills into targetRoot, backing up overwritten files
 * so every sync can be rolled back in one click.
 */
export function applyVaultSync(
  targetRoot: string,
  vaultRoot = getDefaultVaultRoot(),
  slugs?: string[],
): VaultTransaction {
  ensureVaultDirs(vaultRoot);
  const preview = previewVaultSync(targetRoot, vaultRoot, slugs);
  const txId = makeTxId('sync');
  const backupBase = path.join(getBackupDir(vaultRoot), txId);
  const operations: VaultTransactionOp[] = [];

  for (const item of preview) {
    if (item.change === 'unchanged') continue;
    const srcFile = path.join(getVaultSkillsDir(vaultRoot), item.slug, 'SKILL.md');
    if (!fs.existsSync(srcFile)) continue;

    const existedBefore = fs.existsSync(item.targetPath);
    let backupPath: string | undefined;
    if (existedBefore) {
      backupPath = path.join(backupBase, item.slug, 'SKILL.md');
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(item.targetPath, backupPath);
    }

    fs.mkdirSync(path.dirname(item.targetPath), { recursive: true });
    fs.copyFileSync(srcFile, item.targetPath);

    operations.push({
      kind: 'copy',
      sourcePath: srcFile,
      targetPath: item.targetPath,
      backupPath,
      existedBefore,
    });
  }

  const tx: VaultTransaction = {
    id: txId,
    timestamp: new Date().toISOString(),
    action: 'sync',
    summary: `Synced ${operations.length} skill(s) from Vault to ${path.resolve(targetRoot)}.`,
    rolledBack: false,
    operations,
  };

  const history = loadTransactions(vaultRoot);
  saveTransactions(vaultRoot, [tx, ...history]);
  return tx;
}

/**
 * Safely quarantines/disables or re-enables a skill file by renaming SKILL.md <-> SKILL.md.disabled,
 * recorded in the Vault Transaction Log for instant 1-click undo.
 */
export function toggleSkillFileState(
  skillFilePath: string,
  action: 'disable' | 'enable' | 'quarantine',
  vaultRoot = getDefaultVaultRoot(),
): VaultTransaction {
  ensureVaultDirs(vaultRoot);
  const resolved = path.resolve(skillFilePath);
  let sourcePath = resolved;
  let targetPath = resolved;

  if (action === 'disable' || action === 'quarantine') {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Skill file not found: ${sourcePath}`);
    }
    targetPath = `${sourcePath}.disabled`;
  } else {
    sourcePath = resolved.endsWith('.disabled') ? resolved : `${resolved}.disabled`;
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Disabled skill file not found: ${sourcePath}`);
    }
    targetPath = sourcePath.replace(/\.disabled$/, '');
  }

  fs.renameSync(sourcePath, targetPath);

  const tx: VaultTransaction = {
    id: makeTxId(action),
    timestamp: new Date().toISOString(),
    action,
    summary: `${action.toUpperCase()}: ${path.basename(path.dirname(sourcePath))} (${path.basename(sourcePath)} -> ${path.basename(targetPath)})`,
    rolledBack: false,
    operations: [
      {
        kind: 'rename',
        sourcePath,
        targetPath,
        existedBefore: true,
      },
    ],
  };

  const history = loadTransactions(vaultRoot);
  saveTransactions(vaultRoot, [tx, ...history]);
  return tx;
}

/**
 * Rolls back any previous Vault transaction (import, sync, disable, quarantine) cleanly.
 */
export function rollbackVaultTransaction(
  transactionId: string,
  vaultRoot = getDefaultVaultRoot(),
): VaultTransaction {
  const history = loadTransactions(vaultRoot);
  const targetTx = history.find((t) => t.id === transactionId);
  if (!targetTx) {
    throw new Error(`Transaction not found: ${transactionId}`);
  }
  if (targetTx.rolledBack) {
    throw new Error(`Transaction "${transactionId}" was already rolled back.`);
  }

  for (const op of [...targetTx.operations].reverse()) {
    if (op.kind === 'rename' && op.sourcePath) {
      if (fs.existsSync(op.targetPath) && !fs.existsSync(op.sourcePath)) {
        fs.renameSync(op.targetPath, op.sourcePath);
      }
    } else if (op.kind === 'copy' || op.kind === 'write') {
      if (op.existedBefore && op.backupPath && fs.existsSync(op.backupPath)) {
        fs.mkdirSync(path.dirname(op.targetPath), { recursive: true });
        fs.copyFileSync(op.backupPath, op.targetPath);
      } else if (!op.existedBefore && fs.existsSync(op.targetPath)) {
        fs.rmSync(op.targetPath, { force: true });
      }
    }
  }

  targetTx.rolledBack = true;
  const rollbackRecord: VaultTransaction = {
    id: makeTxId('rollback'),
    timestamp: new Date().toISOString(),
    action: 'rollback',
    summary: `Rolled back transaction ${targetTx.id} (${targetTx.summary})`,
    rolledBack: false,
    operations: [],
  };

  saveTransactions(vaultRoot, [rollbackRecord, ...history]);
  return rollbackRecord;
}
