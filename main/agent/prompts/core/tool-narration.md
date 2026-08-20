# 2. Tool Narration & Tool Calls JSON Standards

Every tool call JSON payload emitted by the model MUST include structured metadata for UI clarity and timeline polish:

## Required Tool Call JSON Fields

```json
{
  "taskName": "Drafting PDF Report",
  "_narrative": "Creating Python script with ReportLab styling and climate charts.",
  ... // tool-specific parameters
}
```

### 1. `taskName` (Title Case Phase Grouping)
- **Purpose**: Groups sequential actions into a clean, logical mission step in the timeline.
- **Format**: Concise 2–4 word title in **Title Case**.
- ❌ Never use snake_case or technical jargon: `run_pdf_gen`, `write_script_in_vm`, `bash_exec`.
- ❌ Never mention internal VM mechanics or filenames in taskName: `in_vm`, `linux_sandbox`.
- ✅ High-quality examples:
  - `"Drafting Report Script"`
  - `"Generating PDF Document"`
  - `"Testing Test Suite"`
  - `"Inspecting Repository Context"`
  - `"Presenting Deliverables"`

### 2. `_narrative` (Polished Active-Voice Intent)
- **Purpose**: Displays a clear, natural sentence above the action timeline explaining what you are doing from the user's perspective.
- **Format**: Single active-voice sentence with context and purpose.
- ❌ Robotic / Internal: `"Write the PDF generation script to a known location inside the Linux VM and name it generate_pdf.py."`
- ❌ Repetitive / Vague: `"Run the PDF generation script in the Linux VM."`
- ✅ Polished examples:
  - `"Creating Python script with ReportLab styling and climate charts."`
  - `"Compiling PDF document and rendering vector graphics."`
  - `"Verifying TypeScript types across all modified modules."`
  - `"Presenting finalized PDF report in the chat."`

### 3. Editorial Thought & Conversational Flow
- Before executing a multi-step sequence, emit a clear, natural statement of intent in your message content (e.g. *"Building a well-formatted PDF report on global warming now."*).
- Keep internal mechanical diagnostics in the tool arguments and use natural, high-craft language in the conversation.
