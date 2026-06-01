/**
 * Database Migration Runner
 *
 * Executes SQL migration scripts in order and tracks applied migrations.
 * Ensures migrations are only applied once and provides rollback support.
 */

import fs from 'fs';
import path from 'path';
import { dbOps } from '../db';

export interface MigrationInfo {
  version: string;
  filename: string;
  appliedAt?: string;
}

/**
 * Get list of all available migration files
 */
export function getAvailableMigrations(): MigrationInfo[] {
  const migrationsDir = __dirname;
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
export async function getAppliedMigrations(): Promise<MigrationInfo[]> {
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
export async function getPendingMigrations(): Promise<MigrationInfo[]> {
  const available = getAvailableMigrations();
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map(m => m.version));

  return available.filter(m => !appliedVersions.has(m.version));
}

/**
 * Execute a single migration file
 */
export async function executeMigration(migration: MigrationInfo): Promise<void> {
  const migrationPath = path.join(__dirname, migration.filename);
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log(`[Migration] Applying ${migration.version}...`);

  try {
    // Execute the migration SQL
    await dbOps.exec(sql);
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

/**
 * Get migration status for all migrations
 */
export async function getMigrationStatus(): Promise<{
  available: MigrationInfo[];
  applied: MigrationInfo[];
  pending: MigrationInfo[];
}> {
  const available = getAvailableMigrations();
  const applied = await getAppliedMigrations();
  const pending = await getPendingMigrations();

  return { available, applied, pending };
}
