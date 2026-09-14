/**
 * Database Migration Runner
 *
 * Executes SQL migration scripts in order and tracks applied migrations.
 * Ensures migrations are only applied once and provides rollback support.
 */

import fs from 'fs';
import path from 'path';
import { dbOps } from '../db';

interface MigrationInfo {
  version: string;
  filename: string;
  appliedAt?: string;
}

function getMigrationsDir(): string {
  const possibleDirs = [
    __dirname,
    path.join(__dirname, '..', 'lib', 'migrations'),
    path.join(__dirname, '..', '..', 'lib', 'migrations'),
    process.resourcesPath ? path.join(process.resourcesPath, 'migrations') : '',
    process.resourcesPath ? path.join(process.resourcesPath, 'main', 'lib', 'migrations') : '',
  ].filter(Boolean);

  for (const dir of possibleDirs) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.sql'))) {
        return dir;
      }
    } catch {
      // Continue
    }
  }
  return __dirname;
}

/**
 * Get list of all available migration files
 */
function getAvailableMigrations(): MigrationInfo[] {
  const migrationsDir = getMigrationsDir();
  if (!fs.existsSync(migrationsDir)) return [];

  const files = fs.readdirSync(migrationsDir);

  return files
    .filter(f => f.endsWith('.sql') && f.match(/^\d{3}_/))
    .sort()
    .map(filename => ({
      version: filename.replace('.sql', ''),
      filename
    }));
}

/**
 * Get list of applied migrations from database
 */
async function getAppliedMigrations(): Promise<MigrationInfo[]> {
  try {
    const rows = await dbOps.all(
      'SELECT version, applied_at FROM schema_migrations ORDER BY version'
    );
    return rows.map((row: any) => ({
      version: row.version,
      filename: `${row.version}.sql`,
      appliedAt: row.applied_at
    }));
  } catch (err) {
    // Table doesn't exist yet, no migrations applied
    return [];
  }
}

/**
 * Get list of pending migrations that need to be applied
 */
async function getPendingMigrations(): Promise<MigrationInfo[]> {
  const available = getAvailableMigrations();
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map(m => m.version));

  return available.filter(m => !appliedVersions.has(m.version));
}

/**
 * Execute a single migration file.
 *
 * MP-CORR-09: record the applied version in `schema_migrations` after success
 * and wrap the migration in a transaction so a mid-flight failure cannot leave
 * half-applied DDL. Previously versions were only recorded when a SQL file
 * self-stamped (005 doesn't), so migrations re-ran on every startup.
 */
async function executeMigration(migration: MigrationInfo): Promise<void> {
  const migrationsDir = getMigrationsDir();
  const migrationPath = path.join(migrationsDir, migration.filename);
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log(`[Migration] Applying ${migration.version}...`);

  try {
    // Ensure the tracking table exists (001 creates it, but a brand-new DB
    // applying migrations via this runner needs it too).
    await dbOps.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');

    // SQLite supports transactional DDL — wrap so failure rolls back cleanly.
    await dbOps.exec('BEGIN TRANSACTION');
    try {
      await dbOps.exec(sql);
      // Stamp only after the SQL succeeds (self-stamping INSERTs in older
      // files are OR IGNORE, so this is idempotent).
      await dbOps.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)', [migration.version]);
      await dbOps.exec('COMMIT');
    } catch (txErr) {
      await dbOps.exec('ROLLBACK').catch(() => {});
      throw txErr;
    }
    console.log(`[Migration] ✓ ${migration.version} applied successfully`);
  } catch (err) {
    console.error(`[Migration] ✗ ${migration.version} failed:`, err);
    throw err;
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  const pending = await getPendingMigrations();

  if (pending.length === 0) {
    console.log('[Migration] No pending migrations');
    return;
  }

  console.log(`[Migration] Found ${pending.length} pending migration(s)`);

  for (const migration of pending) {
    await executeMigration(migration);
  }

  console.log('[Migration] All migrations completed');
}
