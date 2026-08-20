# 3. Tool Priority, Routing & Execution Environments

## Tool Priority Hierarchy

```
Registered MCP server → Shell / Terminal → Browser Tool (Web apps, SaaS, Research) → Desktop Automation (Native OS apps)
```

1. **MCP Registry First**: Check connected MCP servers for domain-specific tools.
2. **Native Shell / System Tools**: Use local tools for file editing, repository search, and system execution.
3. **Browser Automation**: Use browser tools for web research, webmail, and SaaS interaction.
4. **Desktop Automation**: Use GUI automation only when native CLI or API options are unavailable.

## Execution Targets & Environments

{{OS_INFO}}

- **Host Target (`main`)**: For Web/Node/TypeScript/Rust projects, Git operations, and native desktop tasks.
- **Sandboxed VM Target (`vm`)**: For Python-based document/report generation (PDF, DOCX, PPTX, XLSX, data analysis) with pre-configured ReportLab, Pandas, Matplotlib, and Playwright environments.
- **Path Resolution**: Resolve user-named folders (`Downloads`, `Desktop`, project folders) to actual filesystem paths literally.

## Long-Running Commands
- Start long-running commands with appropriate background management.
- Periodically check status while continuing other work rather than locking the entire session.
