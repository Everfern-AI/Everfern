# EverFern CLI

Terminal UI for EverFern - Your autonomous AI workplace agent.

## Features

- **Interactive TUI** - Terminal-based chat interface (pi-tui, same as OpenClaw)
- **Session Management** - Multiple chat sessions with persistence  
- **Shared Storage** - Uses `~/.everfern/` directory (same as desktop app)
- **Rich Output** - Colored output, markdown rendering, syntax highlighting

## Quick Start

```bash
# Navigate to CLI folder
cd cli

# Install dependencies (first time)
npm install

# Launch TUI (interactive chat)
npm run dev

# Or use the CLI directly
node src/cli.js --help
node src/cli.js status
node src/cli.js doctor
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Launch TUI (interactive chat) |
| `node src/cli.js tui` | Launch TUI directly |
| `node src/cli.js chat` | Alias for tui |
| `node src/cli.js status` | Check EverFern agent status |
| `node src/cli.js doctor` | Run diagnostics |

## Shared Directory Structure

The CLI shares the same `~/.everfern/` directory as the desktop app:

```
~/.everfern/
├── store/           # SQLite database (shared with desktop app)
├── logs/           # Application logs
├── cache/          # Cached data
├── config.json     # Shared configuration
└── admin/          # Admin settings
```

This means:
- Same sessions available in both CLI and desktop
- Same agent settings and API keys
- Same conversation history

## TUI Keyboard Shortcuts

- `Enter` - Send message (when interactive mode is fully implemented)
- `Esc` - Abort active run
- `Ctrl+C` - Exit TUI
- `Ctrl+L` - Model picker (coming soon)
- `Ctrl+G` - Agent picker (coming soon)

## Architecture

```
cli/
├── src/
│   ├── cli.js              # Entry point (commander)
│   └── tui/
│       └── index.js         # TUI implementation (pi-tui)
├── package.json            # Dependencies: pi-tui, commander, chalk
└── README.md              # This file
```

## Connection to Main App

The CLI is designed to share the same agent engine as the desktop app:

1. **Agent Engine**: Connect to `main/agent/` LangGraph orchestration
2. **Store**: Uses SQLite database at `~/.everfern/store`
3. **Config**: Reads `~/.everfern/config.json`

To fully integrate with the agent:
```javascript
// In src/tui/index.js
const { AgentRunner } = require('../../main/agent/runner');
// Use agent to process messages
```

## Dependencies

- **@mariozechner/pi-tui** - Terminal UI framework (same as OpenClaw)
- **commander** - CLI framework
- **chalk** - Terminal styling

## Development

```bash
# Watch mode
npm run dev

# Test CLI commands
node src/cli.js --help
node src/cli.js status
node src/cli.js doctor

# Test TUI
node src/tui/index.js
```

## Current Status

- [x] Basic CLI structure
- [x] TUI with pi-tui
- [x] Shared `~/.everfern/` directory
- [ ] Interactive input handling
- [ ] Agent integration (`main/agent/`)
- [ ] Message history persistence
- [ ] Tool execution display

## License

MIT - See the main [project LICENSE.](.../LICENSE)
