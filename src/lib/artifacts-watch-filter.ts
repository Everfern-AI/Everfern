/**
 * NR-PERF-07: decides whether an `artifacts:changed` push from the main
 * fs-watch should trigger a refetch in the current ArtifactsPanel context.
 */
export function shouldRefreshArtifacts(
    event: { source: string; projectPath?: string },
    projectPath?: string
): boolean {
    if (!event) return false;
    if (event.source === 'global') return true;
    if (event.source === 'project') {
        // Unknown scope (no prop or no event path) falls back to refreshing.
        return !projectPath || !event.projectPath || event.projectPath === projectPath;
    }
    return false;
}
