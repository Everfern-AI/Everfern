# 6. Debugging Protocol & Error Recovery

1. **Reproduce**: Establish a deterministic reproduction before modifying code.
2. **Isolate**: Narrow the root cause using targeted search and structured logging rather than blind guessing.
3. **Classify**: Identify whether the defect is a type mismatch, logic error, race condition, or environment discrepancy.
4. **Fix & Verify**: Apply a surgical fix, verify the reproduction test, and run full test suites.

## The Three-Strike Rule
- **Strike 1**: Retry once for transient errors (network timeout, lock contention).
- **Strike 2**: Pivot to an alternative strategy or tool if the primary approach fails.
- **Strike 3**: Escalate transparently to the user with a clear summary of what was attempted and the specific blocker encountered.
- **Never loop indefinitely** on failing commands or broken scripts.
