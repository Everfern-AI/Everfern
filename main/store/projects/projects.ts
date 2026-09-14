import { dbOps } from '../../lib/db';

export interface Project {
  id: string;
  name: string;
  instructions?: string;
  path: string;
  isPinned?: boolean;
  isBookmarked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export class ProjectsStore {
  /**
   * List all projects, with pinned / bookmarked projects first.
   */
  async list(): Promise<Project[]> {
    try {
      const rows = await dbOps.all(`
        SELECT *
        FROM projects
        ORDER BY (is_pinned = 1 OR is_bookmarked = 1) DESC, updated_at DESC
      `);

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        instructions: row.instructions,
        path: row.path,
        isPinned: row.is_pinned === 1,
        isBookmarked: row.is_bookmarked === 1 || row.is_pinned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err) {
      console.error('[Projects] Failed to list projects:', err);
      return [];
    }
  }

  /**
   * Get a project by ID.
   */
  async get(id: string): Promise<Project | null> {
    try {
      const row = await dbOps.get('SELECT * FROM projects WHERE id = ?', [id]);
      if (!row) return null;

      return {
        id: row.id,
        name: row.name,
        instructions: row.instructions,
        path: row.path,
        isPinned: row.is_pinned === 1,
        isBookmarked: row.is_bookmarked === 1 || row.is_pinned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (err) {
      console.error(`[Projects] Failed to get project ${id}:`, err);
      return null;
    }
  }

  /**
   * Create a new project.
   */
  async create(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; project?: Project; error?: string }> {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const newProject: Project = {
        ...project,
        id,
        isPinned: false,
        isBookmarked: false,
        createdAt: now,
        updatedAt: now,
      };

      await dbOps.run(
        `INSERT INTO projects (id, name, instructions, path, is_pinned, is_bookmarked, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
        [
          newProject.id,
          newProject.name,
          newProject.instructions || null,
          newProject.path,
          newProject.createdAt,
          newProject.updatedAt,
        ]
      );

      const fs = require('fs/promises');
      const fssync = require('fs');
      const pathModule = require('path');

      // Create the project directory if it doesn't exist
      if (!fssync.existsSync(newProject.path)) {
        await fs.mkdir(newProject.path, { recursive: true });
      }

      // Copy files if provided
      if ((project as any).files && Array.isArray((project as any).files)) {
        for (const file of (project as any).files) {
          try {
            const fileName = pathModule.basename(file);
            const targetPath = pathModule.join(newProject.path, fileName);
            await fs.copyFile(file, targetPath);
          } catch (e) {
            console.error(`Failed to copy file ${file}:`, e);
          }
        }
      }

      return { success: true, project: newProject };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Projects] Failed to create project:`, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Update a project.
   */
  async update(id: string, updates: Partial<Project>): Promise<{ success: boolean; project?: Project; error?: string }> {
    try {
      const existing = await this.get(id);
      if (!existing) return { success: false, error: 'Project not found' };

      const name = updates.name !== undefined ? updates.name : existing.name;
      const instructions = updates.instructions !== undefined ? updates.instructions : existing.instructions;
      const path = updates.path !== undefined ? updates.path : existing.path;
      const isPinned = updates.isPinned !== undefined ? (updates.isPinned ? 1 : 0) : (existing.isPinned ? 1 : 0);
      const isBookmarked = updates.isBookmarked !== undefined ? (updates.isBookmarked ? 1 : 0) : (existing.isBookmarked ? 1 : 0);
      const now = new Date().toISOString();

      await dbOps.run(
        `UPDATE projects
         SET name = ?, instructions = ?, path = ?, is_pinned = ?, is_bookmarked = ?, updated_at = ?
         WHERE id = ?`,
        [name, instructions, path, isPinned, isBookmarked, now, id]
      );

      const updated = await this.get(id);
      return { success: true, project: updated || undefined };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Projects] Failed to update project ${id}:`, msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Toggle bookmark status for a project.
   */
  async toggleBookmark(id: string): Promise<{ success: boolean; isBookmarked: boolean; error?: string }> {
    try {
      const project = await this.get(id);
      if (!project) return { success: false, isBookmarked: false, error: 'Project not found' };

      const newStatus = !project.isBookmarked;
      const val = newStatus ? 1 : 0;
      await dbOps.run(
        `UPDATE projects SET is_bookmarked = ?, is_pinned = ?, updated_at = ? WHERE id = ?`,
        [val, val, new Date().toISOString(), id]
      );

      return { success: true, isBookmarked: newStatus };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Projects] Failed to toggle bookmark for project ${id}:`, msg);
      return { success: false, isBookmarked: false, error: msg };
    }
  }

  /**
   * Delete a project by ID.
   */
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      await dbOps.run('DELETE FROM projects WHERE id = ?', [id]);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Projects] Failed to delete project ${id}:`, msg);
      return { success: false, error: msg };
    }
  }
}

export const projectsStore = new ProjectsStore();
