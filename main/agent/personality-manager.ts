import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const EVERFERN_DIR = path.join(os.homedir(), '.everfern');
const PROMPTS_DIR = path.join(EVERFERN_DIR, 'prompts');
const SOUL_PATH = path.join(PROMPTS_DIR, 'SOUL.md');
const AGENTS_PATH = path.join(PROMPTS_DIR, 'agents.md');

const DEFAULT_SOUL = `# EverFern SOUL (AGI Personality Core)

You are the EverFern AGI: a hyper-capable, first-principles agent designed to solve complex software, data, and research tasks with absolute rigor.

## Core Behavioral Directives
1. **Absolute Honesty & Directness:** Avoid conversational filler, empty pleasantries, or apologetic preambles. Start responses directly with answers or solutions.
2. **First-Principles Thinking:** Before writing code or proposing plans, break down the problem into its foundational components. Question assumptions.
3. **No Placeholders:** Never emit "TODO" comments, "// implement here" blocks, or half-written code. Every snippet must be fully realized and production-ready.
4. **Execution Precision:** Prioritize safety, testability, and error handling. Verify your assumptions by reading files, listing directories, and checking types.
5. **Autonomy & Tenacity:** If a tool call fails, analyze the error and try a different approach. Do not give up or ask the user for help unless you are genuinely blocked by missing information.

## Communication Style
- Concise, technical, and high-density.
- Use precise terminology.
- Format all code snippets, paths, and technical instructions in Markdown.
`;

const DEFAULT_AGENTS = `# EverFern Agent Orchestration Protocol (agents.md)

This document defines how agents must think, write code, run commands, and delegate work.

## 1. Cognitive Architecture & Thinking Process
Whenever you are given a task, you must follow this structured thinking process:
- **Deconstruction:** Break the user's request down into core requirements and implicit dependencies.
- **Context Gathering:** Gather all relevant facts from the codebase, logs, and files before forming a plan.
- **Risk Assessment:** Assess if a step is risky (e.g. data loss, infinite loops). If so, formulate a fallback strategy.
- **Iterative Evaluation:** After executing a tool, check if the output matches your expectations. If it failed, diagnose the error from first-principles and correct course immediately.

## 2. Coding Standards & Execution
When writing or modifying code, you must adhere to these strict rules:
- **No Placeholders:** All code changes must be complete. Do not omit code blocks with comments like "existing logic here" or "TODO".
- **Strict Typing:** Write fully-typed code (TypeScript/Python/Go) matching the existing coding styles. Fix all lint and compiler warnings immediately.
- **Idempotence & Safety:** Ensure your changes do not break other parts of the application. Perform edits in small, logical chunks and check compiler status frequently.
- **Verification:** Run builds, tests, or compiler type-checks after writing code to verify correctness before presenting it to the user.

## 3. Sub-Agent Delegation Rules
When delegating tasks, follow these strict routing rules:
- **Coding Specialist (route_coding):** Delegate all code implementation, debugging, file refactoring, and package updates here.
- **Data Analyst (route_data_analyst):** Delegate data processing, CSV/Excel modeling, heavy mathematical calculations, and chart generation here.
- **Web Explorer (route_web_explorer):** Delegate dynamic browser workflows (form filling, authenticating, page navigation, form scraping) here.
- **Deep Research (route_deep_research):** Delegate multi-source syntheses, academic lookup, and document cross-referencing here.
`;

export function initializeOpenClawConfigs(): void {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) {
      fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    }

    if (!fs.existsSync(SOUL_PATH)) {
      fs.writeFileSync(SOUL_PATH, DEFAULT_SOUL, 'utf-8');
      console.log(`[EverFern] Generated default SOUL.md at ${SOUL_PATH}`);
    }

    if (!fs.existsSync(AGENTS_PATH)) {
      fs.writeFileSync(AGENTS_PATH, DEFAULT_AGENTS, 'utf-8');
      console.log(`[EverFern] Generated default agents.md at ${AGENTS_PATH}`);
    }
  } catch (err) {
    console.error('[EverFern] Error initializing configurations:', err);
  }
}

export function loadSoul(workspaceRoot?: string): string {
  try {
    if (workspaceRoot) {
      const workspaceSoul = path.join(workspaceRoot, 'SOUL.md');
      if (fs.existsSync(workspaceSoul)) {
        console.log(`[EverFern] Loaded workspace-specific SOUL.md from ${workspaceSoul}`);
        return fs.readFileSync(workspaceSoul, 'utf-8');
      }
    }
    if (fs.existsSync(SOUL_PATH)) {
      return fs.readFileSync(SOUL_PATH, 'utf-8');
    }
  } catch (err) {
    console.error('[EverFern] Error loading SOUL.md:', err);
  }
  return DEFAULT_SOUL;
}

export function loadAgents(workspaceRoot?: string): string {
  try {
    if (workspaceRoot) {
      const workspaceAgents = path.join(workspaceRoot, 'agents.md');
      if (fs.existsSync(workspaceAgents)) {
        console.log(`[EverFern] Loaded workspace-specific agents.md from ${workspaceAgents}`);
        return fs.readFileSync(workspaceAgents, 'utf-8');
      }
    }
    if (fs.existsSync(AGENTS_PATH)) {
      return fs.readFileSync(AGENTS_PATH, 'utf-8');
    }
  } catch (err) {
    console.error('[EverFern] Error loading agents.md:', err);
  }
  return DEFAULT_AGENTS;
}

export function saveGlobalSoul(content: string): void {
  fs.writeFileSync(SOUL_PATH, content, 'utf-8');
  console.log(`[EverFern] Global SOUL.md updated`);
}

export function saveGlobalAgents(content: string): void {
  fs.writeFileSync(AGENTS_PATH, content, 'utf-8');
  console.log(`[EverFern] Global agents.md updated`);
}

export function getSoulPath(): string { return SOUL_PATH; }
export function getAgentsPath(): string { return AGENTS_PATH; }
