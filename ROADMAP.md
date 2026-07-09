# EverFern Desktop Project Roadmap

This roadmap documents future high-impact features and strategic enhancements planned for EverFern.

---

## Speculative Sandboxed Branching (Multi-Variant Execution)

### Objective
Drastically reduce task completion latency and improve output quality by shifting the agent from serial single-hypothesis executions to concurrent multi-hypothesis sandboxing.

### Proposed Architecture

```mermaid
graph TD
    UserRequest[User Request] --> Decomposer[Task Decomposer]
    Decomposer --> Arbiter[Branch Arbiter]
    Arbiter --> BranchA[Speculative Sandbox A: Conservative]
    Arbiter --> BranchB[Speculative Sandbox B: High-Performance]
    Arbiter --> BranchC[Speculative Sandbox C: Extra Error-Guarded]
    BranchA --> TestRunner[Automated Test Verification]
    BranchB --> TestRunner
    BranchC --> TestRunner
    TestRunner --> DiffComparison[UI Diff Slider / Variant Selector]
    DiffComparison --> UserApproval[One-Click User Approval]
```

### Key Deliverables
1. **Lightweight Sandbox Orchestration:**
   - Integrate transient sub-workspaces or lightweight git branches for worker agents.
   - Run parallel workers simultaneously using isolated process/filesystem environments.
2. **Concurrent Task Solver:**
   - Modify the dispatcher to fork the agentic graph state into independent speculative execution tracks.
3. **Variant Selection Interface:**
   - Develop an Electron-native comparison viewer that displays parallel variant diffs side-by-side with build results and test scores.
