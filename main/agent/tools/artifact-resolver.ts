/**
 * EverFern Desktop — Artifact Resolver
 *
 * Resolves natural language references to artifacts using:
 * - Recency tracking (most recently created/edited)
 * - Exact filename matching
 * - Fuzzy matching by title/description
 */

import { listArtifacts, type ArtifactMeta } from '../../store/artifacts';
import { compareTwoStrings } from 'string-similarity';
import path from 'path';
import os from 'os';

export interface ArtifactReference {
  chatId: string;
  filename: string;
  path: string;
  title?: string;
  lastEdited: number;
}

interface RecentArtifactCache {
  [chatId: string]: {
    filename: string;
    timestamp: number;
  };
}

export class ArtifactResolver {
  private recentCache: RecentArtifactCache = {};
  private readonly FUZZY_THRESHOLD = 0.6;

  /**
   * Sets the most recently created or edited artifact for a session.
   */
  setMostRecent(chatId: string, filename: string): void {
    this.recentCache[chatId] = {
      filename,
      timestamp: Date.now()
    };
  }

  /**
   * Gets the most recently created or edited artifact for a session.
   */
  async getMostRecent(chatId: string, projectPath?: string): Promise<ArtifactReference | null> {
    const recent = this.recentCache[chatId];
    if (!recent) return null;

    const artifacts = await listArtifacts(chatId, projectPath);
    const artifact = artifacts.find(a => a.name === recent.filename);

    if (!artifact) return null;

    return this.toReference(artifact, projectPath);
  }

  /**
   * Resolves a natural language reference to an artifact.
   *
   * @param chatId - The chat session identifier
   * @param reference - Natural language reference (e.g., "the artifact", "sales dashboard")
   * @param filename - Exact filename (e.g., "sales-dashboard.html")
   * @param projectPath - Optional project path
   * @returns ArtifactReference or null if not found
   * @throws Error if reference is ambiguous
   */
  async resolve(
    chatId: string,
    reference?: string,
    filename?: string,
    projectPath?: string
  ): Promise<ArtifactReference | null> {
    // 1. Exact filename match (highest priority)
    if (filename) {
      const artifacts = await listArtifacts(chatId, projectPath);
      const artifact = artifacts.find(a => a.name === filename);
      return artifact ? this.toReference(artifact, projectPath) : null;
    }

    // 2. Natural language reference
    if (reference) {
      // 2a. Check for recency indicators
      if (/^(the|that|this|it)$/i.test(reference.trim())) {
        return await this.getMostRecent(chatId, projectPath);
      }

      // 2b. Fuzzy match by title/description
      const matches = await this.fuzzyMatch(chatId, reference, projectPath);
      if (matches.length === 1) {
        return matches[0];
      } else if (matches.length > 1) {
        const matchList = matches.map((m, i) => `${i + 1}. ${m.title || m.filename}`).join('\n');
        throw new Error(`Ambiguous reference. Did you mean:\n${matchList}`);
      }
      return null;
    }

    // 3. No reference provided - use most recent
    return await this.getMostRecent(chatId, projectPath);
  }

  /**
   * Fuzzy matches artifacts by title or filename.
   */
  private async fuzzyMatch(chatId: string, query: string, projectPath?: string): Promise<ArtifactReference[]> {
    const artifacts = await listArtifacts(chatId, projectPath);
    const matches: Array<{ ref: ArtifactReference; score: number }> = [];

    for (const artifact of artifacts) {
      const titleScore = artifact.name ? compareTwoStrings(query.toLowerCase(), artifact.name.toLowerCase()) : 0;
      const filenameScore = compareTwoStrings(query.toLowerCase(), artifact.name.toLowerCase());
      const maxScore = Math.max(titleScore, filenameScore);

      if (maxScore >= this.FUZZY_THRESHOLD) {
        matches.push({
          ref: this.toReference(artifact, projectPath),
          score: maxScore
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    return matches.map(m => m.ref);
  }

  /**
   * Lists all artifacts for a session, sorted by lastEdited descending.
   */
  async listArtifacts(chatId: string, projectPath?: string): Promise<ArtifactReference[]> {
    const artifacts = await listArtifacts(chatId, projectPath);
    return artifacts.map(a => this.toReference(a, projectPath));
  }

  /**
   * Converts ArtifactMeta to ArtifactReference.
   */
  private toReference(artifact: ArtifactMeta, projectPath?: string): ArtifactReference {
    let fullPath: string;
    if (projectPath && artifact.chatId === 'project') {
      fullPath = path.join(projectPath, '.everfern', 'artifacts', artifact.name);
    } else {
      fullPath = path.join(os.homedir(), '.everfern', 'artifacts', artifact.chatId, artifact.name);
    }

    return {
      chatId: artifact.chatId,
      filename: artifact.name,
      path: fullPath,
      title: artifact.name,
      lastEdited: artifact.lastEdited
    };
  }
}
