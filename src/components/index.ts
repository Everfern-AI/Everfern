/**
 * EverFern Desktop Component Library
 * Categorized & Modularized Component Exports
 */

// 1. Agent & Execution Stream
export * from './agent/AgentTimeline';
export * from './agent/PillNarrativeTimeline';
export * from './agent/MissionTimeline';
export * from './agent/MissionProgressCard';
export * from './agent/InlineDebateProgress';
export * from './agent/SubagentPills';
export * from './agent/ReasoningComponents';
export * from './agent/reasoning';
export * from './agent/reasoning-panel';
export * from './agent/StreamView';
export * from './agent/tool-group';

// 2. Execution Plans
export * from './plans/PlanComponents';
export * from './plans/PlanStepCard';
export * from './plans/PlanApprovalBanner';

// 3. Tools & Capabilities
export * from './tools/ToolCallComponents';
export * from './tools/ToolCallCodePane';
export { default as ToolDetailSidePanel } from './tools/ToolDetailSidePanel';
export * from './tools/ToolSettingsSection';
export * from './tools/ComputerPane';
export * from './tools/LocalExecutionPermissionCard';
export * from './tools/VisionDowngradeNotice';

// 4. File Operations & Artifacts
export * from './files/ArtifactsPanel';
export * from './files/FileOperationCard';
export { default as FileViewerModal } from './files/FileViewerModal';
export * from './files/FileWritingProgress';
export * from './files/FileCreationNotification';
export * from './files/SimpleFileNotification';
export * from './files/diff-viewer';

// 5. Integrations
export * from './integrations/DiscordConfig';
export * from './integrations/TelegramConfig';
export * from './integrations/IntegrationSettings';

// 6. Tasks
export * from './tasks/ScheduledTaskModal';
export * from './tasks/ScheduledTasksPanel';

// 7. Projects
export * from './projects/CreateProjectModal';
export * from './projects/ProjectCreator';
export * from './projects/ProjectDashboard';

// 8. Visual Effects & Media
export * from './visuals/agent-audio-visualizer-aura';
export * from './visuals/siri-orb';
export * from './visuals/react-shader-toy';
export * from './visuals/CursorOverlaySystem';
export * from './visuals/GradientBorderSystem';
export * from './visuals/ShimmerProgressComponent';

// 9. IDE & Workspace
export * from './ide/IDEMode';
export * from './ide/IDEPane';
export * from './ide/CodePanel';

// 10. Common & Utilities
export * from './common/FormComponents';
export * from './common/MarkdownComponents';
export * from './common/markdown-text';
export * from './common/ErrorBoundary';
export * from './common/ThemeProvider';
export * from './common/AnnouncementPopup';
export * from './common/UpdateNotification';
export * from './common/ProviderDropdown';
export * from './common/ProviderLogos';
export * from './common/FaviconCitation';
export * from './common/CustomTooltip';
export * from './common/tooltip-icon-button';
export * from './common/UIIcons';
export * from './common/MaterialSymbolsLoader';
export * from './common/InlineVisualization';
export * from './common/ReportComponents';
