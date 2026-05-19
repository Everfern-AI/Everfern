# Task 2.4 Implementation: Output Format Consistency

## Task Description
Ensure the tool's output format (stdout, stderr, exit code) is unchanged — the agent sees the same structure regardless of execution path (VM vs native).

## Implementation Summary

### Changes Made

#### 1. Updated `pi-tools.ts` (lines 70-90)
Modified the `executePwsh` tool handler to ensure consistent output format between VM and native execution paths.

**Key Changes:**
- **Success case (exitCode === 0)**: Returns `{ success: true, output: stdout }`
- **Failure case (exitCode !== 0)**: Returns `{ success: false, output: errorOutput, error: errorOutput }`
  - Where `errorOutput = stderr || stdout` (prefers stderr, falls back to stdout if stderr is empty)
- **Critical consistency**: The `output` and `error` fields are always identical on failure

### Output Format Specification

#### Success Response
```typescript
{
  success: true,
  output: string  // Contains stdout
  // error field is undefined
}
```

#### Failure Response
```typescript
{
  success: false,
  output: string,  // Contains stderr (or stdout if stderr is empty)
  error: string    // Always identical to output field
}
```

### Consistency Guarantees

1. **Structure Consistency**: Both VM and native execution paths return the same ToolResult structure
2. **Field Consistency**: The `success`, `output`, and `error` fields are present in the same way regardless of execution path
3. **Value Consistency**: For failures, `output` and `error` fields always contain identical values
4. **ANSI Stripping**: Both paths apply `stripAnsi()` to ensure clean output

### Test Coverage

#### Unit Tests
- `output-format-consistency.test.ts`: Tests the transformation logic in isolation
  - Success case formatting
  - Failure case formatting with stderr
  - Failure case formatting with only stdout
  - Ensures output and error fields are identical

#### Integration Tests
- `output-format-integration.test.ts`: Tests cross-path consistency
  - VM execution path formatting
  - Native execution path formatting
  - Cross-path comparison (VM vs native)
  - Edge cases (empty output, multiline, mixed stdout/stderr)

#### Existing Tests
- `pi-tools-vm-routing.test.ts`: Comprehensive routing and format tests
  - Verifies VM routing by default
  - Verifies native routing with `local: true`
  - Verifies output format consistency across both paths
  - Tests error handling and fallback behavior

### Code Flow

```
executePwsh tool called
    ↓
Check if local === true
    ↓
NO → Route to Linux VM
    ↓
runInLinuxVM(command)
    ↓
Returns { stdout, stderr, exitCode }
    ↓
Transform to ToolResult:
  - exitCode === 0 → { success: true, output: stdout }
  - exitCode !== 0 → { success: false, output: stderr||stdout, error: stderr||stdout }
    ↓
Apply stripAnsi()
    ↓
Return ToolResult

YES → Route to native executor
    ↓
executor(id, args)
    ↓
Returns { content: [...], isError: boolean }
    ↓
Transform to ToolResult:
  - isError === false → { success: true, output: text }
  - isError === true → { success: false, output: text, error: text }
    ↓
Apply stripAnsi()
    ↓
Return ToolResult
```

### Verification

All tests pass:
- ✅ `output-format-consistency.test.ts` (6 tests)
- ✅ `output-format-integration.test.ts` (11 tests)
- ✅ `pi-tools-vm-routing.test.ts` (existing tests)

### Requirements Satisfied

From `requirements.md`:

**AC-1.6**: ✅ "Output from the Linux VM is returned to the agent in the same format as local terminal output."

**P-1.B (Transparency)**: ✅ "The agent's tool call interface for shell execution is identical whether the command runs in the VM or locally — only the routing layer changes."

### Implementation Notes

1. **Error Field Consistency**: The most critical aspect of this task was ensuring that the `error` field is always identical to the `output` field on failures. This prevents any discrepancies that could confuse the agent.

2. **Stderr Preference**: On failure, we prefer stderr over stdout because stderr typically contains the actual error message, while stdout might contain partial output before the error occurred.

3. **Fallback Handling**: If stderr is empty on a failed command, we fall back to stdout to ensure the agent always gets some information about what went wrong.

4. **ANSI Stripping**: Both paths apply ANSI stripping to ensure the agent doesn't see color codes or cursor movement sequences that could confuse its context window.

### Future Considerations

- The output format is now consistent and well-tested
- Any future changes to the output format should update both VM and native paths simultaneously
- The test suite provides regression protection against format inconsistencies
