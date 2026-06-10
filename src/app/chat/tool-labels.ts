import React from 'react';
import {
  ComputerDesktopIcon,
  CameraIcon,
  CommandLineIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  DocumentTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  TrashIcon,
  Cog6ToothIcon,
  Square3Stack3DIcon,
  BookOpenIcon,
  PencilSquareIcon,
  PresentationChartBarIcon
} from '@heroicons/react/24/outline';

/**
 * EverFern Desktop — Tool Label Resolver
 *
 * Maps tool names + args to human-readable labels for the chat UI.
 * Inspired by OpenClaw's tool-display-common.ts pattern.
 */

export interface ToolDisplayInfo {
  icon: React.ReactNode; // React node for the tool icon
  label: string;      // human-readable action label
  color: string;      // accent color for the tag
  useEnhancedCard?: boolean;
  operation?: 'edit' | 'create';
}

export function resolveToolDisplay(toolName: string, args?: Record<string, unknown>): ToolDisplayInfo {
  switch (toolName) {

    case 'computer_use': {
      const task = typeof args?.task === 'string' ? args.task.trim() : '';
      const label = task ? truncate(task, 80) : 'Controlling computer';
      return { icon: React.createElement('img', { src: '/assets/tool-browser.svg', width: 16, height: 16, className: 'opacity-80' }), label, color: '#6366f1' };
    }

    case 'take_screenshot':
      return { icon: React.createElement('img', { src: '/assets/tool-browser.svg', width: 16, height: 16, className: 'opacity-80' }), label: 'Taking screenshot', color: '#8b5cf6' };

    case 'approve_actions':
      return { 
        icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
          React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" })
        ),
        label: 'Security Check',
        color: '#201e24' 
      };

    case 'ask_user_question':
      return { 
        icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
          React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" })
        ),
        label: 'Clarification Needed',
        color: '#6366f1' 
      };

    case 'run_terminal':
    case 'run_command':
    case 'bash': {
      const cmdStr = args?.command || args?.CommandLine || args?.commandLine || '';
      const cmd = typeof cmdStr === 'string' ? cmdStr.trim() : '';
      const label = cmd ? resolveTerminalLabel(cmd) : 'Running command';

      // Enhanced logging for debugging
      console.log(`[ToolDisplay] run_command - cmdStr:`, cmdStr);
      console.log(`[ToolDisplay] run_command - cmd:`, cmd);
      console.log(`[ToolDisplay] run_command - label:`, label);

      if (cmd && cmd.startsWith('ls')) {
        return {
          icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
            React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" })
          ),
          label,
          color: '#10b981'
        };
      }
      return { icon: React.createElement('img', { src: '/assets/tool-terminal.svg', width: 16, height: 16, className: 'opacity-80' }), label, color: '#10b981' };
    }

    case 'create_plan':
    case 'execution_plan':
    case 'update_plan':
    case 'update_plan_step': {
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      return {
        icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
          React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "m21 7.5-2.25-1.313M21 7.5v2.25m0-2.25-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3 2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75 2.25-1.313M12 21.75V19.5m0 2.25-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25" })
        ),
        label: title ? `Planning: ${truncate(title, 60)}` : 'Creating plan',
        color: '#f59e0b'
      };
    }

    case 'update_step': {
      const step = typeof args?.step === 'string' ? args.step.trim() : '';
      const status = typeof args?.status === 'string' ? args.status : '';
      return { icon: React.createElement(CheckCircleIcon, { width: 16, height: 16 }), label: step ? `${status === 'done' ? 'Completed' : 'Updated'}: ${truncate(step, 60)}` : 'Updating step', color: '#14b8a6' };
    }

    case 'todo_write': {
      const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
      const inProgress = tasks.filter((task: any) => task?.status === 'in_progress').length;
      const completed = tasks.filter((task: any) => task?.status === 'completed').length;
      const label = tasks.length
        ? `Todo list: ${completed}/${tasks.length} done${inProgress ? `, ${inProgress} active` : ''}`
        : 'Updating todo list';
      return {
        icon: React.createElement(ClipboardDocumentListIcon, { width: 16, height: 16 }),
        label,
        color: '#14b8a6',
      };
    }

    case 'web_search': {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      return { icon: React.createElement('img', { src: '/assets/tool-search.svg', width: 16, height: 16, className: 'opacity-80' }), label: query ? `Searching for "${truncate(query, 60)}"` : 'Searching web', color: '#3b82f6' };
    }

    case 'search_mcp_registry': {
      const keyword = typeof args?.keyword === 'string'
        ? args.keyword.trim()
        : typeof args?.query === 'string'
          ? args.query.trim()
          : '';
      return {
        icon: React.createElement(Cog6ToothIcon, { width: 16, height: 16 }),
        label: keyword ? `Searching MCP registry: ${truncate(keyword, 60)}` : 'Searching MCP registry',
        color: '#06b6d4'
      };
    }

    case 'show_user_url': {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      return {
        icon: React.createElement('img', { src: '/assets/tool-browser.svg', width: 16, height: 16, className: 'opacity-80' }),
        label: url ? `Opening ${truncate(url, 60)}` : 'Opening browser',
        color: '#3b82f6'
      };
    }

    case 'read_file': {
      const path = typeof args?.path === 'string' ? args.path.trim() : '';
      return { icon: React.createElement(BookOpenIcon, { width: 16, height: 16 }), label: path ? `Reading ${basename(path)}` : 'Reading file', color: '#64748b' };
    }

    case 'write_file':
    case 'write':
    case 'write_to_file':
    case 'edit_file':
    case 'edit':
    case 'replace': {
      const path = typeof args?.path === 'string' ? args.path.trim() : '';
      const isEdit = ['edit_file', 'edit', 'replace'].includes(toolName);
      return {
        icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
          React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" })
        ),
        label: path ? `${isEdit ? 'Editing' : 'Writing'} ${basename(path)}` : `${isEdit ? 'Editing' : 'Writing'} file`,
        color: '#f59e0b',
        // Enhanced file operation display
        useEnhancedCard: true,
        operation: isEdit ? 'edit' : 'create'
      };
    }

    case 'system_files': {
      const action = typeof args?.action === 'string' ? args.action.trim() : '';
      const root = typeof args?.root === 'string' ? args.root.trim() : '';
      const filePath = typeof args?.path === 'string' ? args.path.trim() : '';
      const from = typeof args?.from === 'string' ? args.from.trim() : '';
      const to = typeof args?.to === 'string' ? args.to.trim() : '';
      const rootName = root ? basename(root) : '';
      let label = 'System files';
      let icon = React.createElement(FolderIcon, { width: 16, height: 16 });
      if (action === 'list') {
        icon = React.createElement(FolderOpenIcon, { width: 16, height: 16 });
        label = `Scanning ${filePath && filePath !== '.' ? basename(filePath) : rootName || 'folder'}`;
      } else if (action === 'mkdirp') {
        icon = React.createElement(FolderPlusIcon, { width: 16, height: 16 });
        label = `Creating folder ${filePath ? basename(filePath) : ''}`;
      } else if (action === 'move') {
        icon = React.createElement(DocumentDuplicateIcon, { width: 16, height: 16 });
        label = from ? `Moving ${basename(from)}${to ? ' → ' + basename(to) : ''}` : 'Moving file';
      } else if (action === 'rename') {
        icon = React.createElement(PencilIcon, { width: 16, height: 16 });
        label = from ? `Renaming ${basename(from)}${to ? ' → ' + basename(to) : ''}` : 'Renaming file';
      } else if (action === 'delete') {
        icon = React.createElement(TrashIcon, { width: 16, height: 16 });
        label = `Deleting ${filePath ? basename(filePath) : 'item'}`;
      }
      return { icon, label, color: '#22c55e' };
    }

    case 'view_skill': {
      const name = typeof args?.name === 'string' ? args.name.trim() : '';
      return { icon: React.createElement(MagnifyingGlassIcon, { width: 16, height: 16 }), label: name ? `Consulting Skill: ${name}` : 'Consulting skill', color: '#8b5cf6' };
    }

    case 'create_artifact': {
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      return {
        icon: React.createElement(PencilSquareIcon, { width: 16, height: 16 }),
        label: title ? `Building: ${truncate(title, 60)}` : 'Building artifact',
        color: '#f59e0b'
      };
    }

    case 'create_site': {
      const name = typeof args?.name === 'string' ? args.name.trim() : '';
      return {
        icon: React.createElement(Square3Stack3DIcon, { width: 16, height: 16 }),
        label: name ? `Creating site: ${truncate(name, 60)}` : 'Creating site',
        color: '#06b6d4'
      };
    }

    case 'visualize': {
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      return {
        icon: React.createElement(PresentationChartBarIcon, { width: 16, height: 16 }),
        label: title ? `Visualizing: ${truncate(title, 60)}` : 'Generating visual',
        color: '#8b5cf6'
      };
    }

    case 'pptx_generator': {
      const title = typeof args?.title === 'string' ? args.title.trim() : '';
      const outputPath = typeof args?.outputPath === 'string' ? args.outputPath.trim() : '';
      const slides = Array.isArray(args?.slides) ? args.slides : [];
      const target = title || (outputPath ? basename(outputPath) : '');
      return {
        icon: React.createElement(PresentationChartBarIcon, { width: 16, height: 16 }),
        label: target
          ? `Generating deck: ${truncate(target, 60)}`
          : slides.length
            ? `Generating ${slides.length}-slide deck`
            : 'Generating presentation',
        color: '#8b5cf6'
      };
    }

    case 'visual_classification_sheet': {
      const directory = typeof args?.directory === 'string' ? args.directory.trim() : '';
      const question = typeof args?.question === 'string' ? args.question.trim() : '';
      return {
        icon: React.createElement(CameraIcon, { width: 16, height: 16 }),
        label: directory
          ? `${question ? 'Classifying sheet' : 'Creating image sheet'}: ${truncate(basename(directory), 60)}`
          : question
            ? 'Classifying image sheet'
            : 'Creating image sheet',
        color: '#8b5cf6'
      };
    }

    case 'mcp_call': {
      const server = typeof args?.server === 'string' ? args.server.trim() : '';
      const tool = typeof args?.tool === 'string' ? args.tool.trim() : '';
      const label = server && tool ? `MCP: ${server}/${tool}` : tool ? `MCP: ${tool}` : 'MCP tool';
      return { icon: React.createElement('svg', { xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor", width: 16, height: 16 },
        React.createElement('path', { strokeLinecap: "round", strokeLinejoin: "round", d: "M5.25 5.653c0-.856.917-1.398 1.667-.986A11.952 11.952 0 0 1 12 5.25c.713 0 1.392.1 2.03.36l.777.611a1.25 1.25 0 0 0 1.766 0l.777-.611c.638-.312 1.098.1.998.986a11.952 11.952 0 0 1 5.083 4.26 1.25 1.25 0 0 0 0 2.118 11.952 11.952 0 0 1-5.083 4.26c-.856 0-1.398-.917-.986-1.667a11.952 11.952 0 0 1-.36-2.03c0-.713-.1-1.392-.36-2.03a1.25 1.25 0 0 0-2.118 0 11.952 11.952 0 0 1-4.26-5.083 1.25 1.25 0 0 0 0-2.118zM15.75 15.5l-3-3m0 0l-3 3m3-3v11.25" })
      ), label, color: '#06b6d4' };
    }

    default: {
      const cleaned = toolName.replace(/_/g, ' ').trim();
      const label = cleaned ? capitalize(cleaned) : 'Running tool';
      return { icon: React.createElement('img', { src: '/assets/tool-generic.svg', width: 16, height: 16, className: 'opacity-80' }), label, color: '#71717a' };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function basename(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resolveTerminalLabel(command: string): string {
  // Strip cd preambles like `cd /foo && npm test`
  const clean = command.replace(/^(cd\s+\S+\s*&&\s*)+/, '').trim();
  const words = clean.split(/\s+/);
  const bin = words[0]?.toLowerCase() ?? '';

  const gitSubcmd = bin === 'git' ? words[1]?.toLowerCase() : undefined;
  const gitMap: Record<string, string> = {
    status: 'git status', diff: 'git diff', log: 'git log',
    commit: 'git commit', pull: 'git pull', push: 'git push',
    add: 'git add', checkout: 'git checkout', switch: 'git switch',
    stash: 'git stash', fetch: 'git fetch', merge: 'git merge',
    rebase: 'git rebase', reset: 'git reset',
  };
  if (gitSubcmd && gitMap[gitSubcmd]) return gitMap[gitSubcmd];

  const simpleMap: Record<string, string> = {
    ls: 'list files', cat: 'read file', npm: `npm ${words[1] ?? ''}`.trim(),
    npx: `npx ${words[1] ?? ''}`.trim(), node: 'run node', python: 'run python',
    python3: 'run python', pip: `pip ${words[1] ?? ''}`.trim(),
  };
  if (simpleMap[bin]) return simpleMap[bin];

  return truncate(clean, 70);
}
