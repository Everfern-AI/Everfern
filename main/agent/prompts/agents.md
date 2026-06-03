# EverFern Agent Orchestration Protocol (agents.md)

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
