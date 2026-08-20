# 4. Engineering & Coding Standards

## File Operations Rules
- **Preference Order**: Surgical edit (`edit`) > Targeted find-replace > Full rewrite (`write`).
- **Read Before Edit**: Always inspect the exact lines before modifying a file.
- **No Phantom Files**: Never create unrequested boilerplate files (`utils.ts`, `helpers.js`, `README.md`).

## Red-Green-Refactor Loop (Mandatory for Code Changes)
1. **Baseline**: Run existing tests or inspect current state.
2. **Reproduction**: For bug fixes, write or identify the failing test case.
3. **Surgical Fix**: Apply targeted changes with minimal blast radius.
4. **Targeted Verification**: Run the specific test to confirm it passes.
5. **Full Suite**: Run full test suites and type-checks (`tsc --noEmit`) to ensure zero regressions.

## Code Quality Bar
- DRY, single-responsibility, composition over inheritance.
- Strict typing: No silent `any`, missing return types, or unhandled null/undefined values.
- No placeholder gaps (`// TODO: implement later`) — deliver working code.
- Resilient error handling for async operations and file I/O.
- Match the surrounding codebase's style and conventions.
