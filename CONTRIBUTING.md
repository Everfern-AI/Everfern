# Contributing to EverFern Desktop

Thanks for your interest in contributing to the EverFern desktop app! This guide covers everything you need to get started with the Electron + Next.js application.

## Quick Start

```bash
# Install dependencies
npm install

# Start development (builds Electron TS, then runs Next.js + Electron)
npm run dev
```

This launches:
- **Next.js** dev server on port 3001
- **Electron** with hot reload

## Prerequisites

- Node.js v20+
- npm v9+
- Windows 10/11, macOS 10.15+, or Linux
- Python 3.8+ (for native module rebuilding)

### Optional
- Ollama — for local AI models
- Playwright — for web automation features
- WSL or Docker — for isolated terminal execution

## Project Structure

```
apps/desktop/
├── main/                   # Electron main process
│   ├── main.ts            # App entry point
│   ├── agent/             # AI agent runtime & tools
│   ├── skills/            # Skills system
│   ├── context-engine/    # Context management
│   ├── integrations/      # Third-party integrations
│   ├── ipc/               # IPC handlers (main ↔ renderer)
│   ├── lib/               # Shared utilities (SQLite, migrations)
│   └── store/             # State management
├── preload/               # Electron preload scripts (IPC bridge)
├── src/                   # Next.js renderer (React UI)
│   ├── app/               # App Router pages
│   ├── components/        # React components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Client-side utilities
│   └── types/             # TypeScript type definitions
├── cli/                   # Terminal UI CLI
└── public/                # Static assets
```

## Development Workflow

### Running Tests

```bash
npm test              # Run all tests
npm run test:ui       # Run tests with UI
npm run test:coverage # Run with coverage
```

### Linting

```bash
npm run lint
```

### Building

```bash
# Full build (Next.js + Electron + packaging)
npm run build

# Platform-specific builds
npm run build:macos
npm run build:linux
```

### Rebuilding Native Modules

If you're having issues with native modules (better-sqlite3, sharp, etc.):

```bash
npm run rebuild:electron
```

## Code Style

### TypeScript/React
- Strict TypeScript throughout
- Functional components with hooks
- `"use client"` directive for client components
- Prefer `const` over `let`
- Use async/await over callbacks

### Styling
- **Tailwind CSS v4** for utilities
- **shadcn/ui** for UI primitives
- Design tokens in `globals.css`
- Avoid inline styles when Tailwind suffices

### Git Commits

Follow conventional commit format:

```
feat: add new tool for web scraping
fix: resolve crash when loading large files
docs: update README with new features
refactor: simplify agent runner logic
test: add tests for memory search tool
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes and add tests
3. Ensure all tests pass: `npm test`
4. Run the linter: `npm run lint`
5. Write a clear PR description explaining:
   - What changed
   - Why it changed
   - How to test it

### PR Checklist

- [ ] Tests pass
- [ ] Code follows project style
- [ ] No console errors or warnings
- [ ] Documentation updated (if applicable)
- [ ] Changes are backwards compatible

## Reporting Issues

### Bug Reports
Include:
- OS and version
- App version (Settings > About)
- Steps to reproduce
- Expected vs actual behavior
- Screenshots / console logs if available

### Feature Requests
- Check if it already exists or is planned
- Describe the use case
- Consider implementation approach

### Security Issues
Email everfernsupport@gmail.com directly — do not open public issues.

## Key Architecture Notes

- **Electron IPC**: Communication between main and renderer goes through `preload/` scripts. Use the typed IPC channels defined in `main/ipc/`.
- **Agent System**: The AI agent runtime lives in `main/agent/`. Tools are in `main/agent/tools/`.
- **SQLite**: Local data is stored via better-sqlite3. Migrations live in `main/lib/migrations/`.
- **Skills**: Reusable task modules in `main/skills/`.

## Community

- **GitHub**: https://github.com/Everfern-AI/Everfern
- **Discord**: https://discord.gg/wU2DuYSP7s

## License

MIT — by contributing, you agree your contributions are licensed under MIT.
