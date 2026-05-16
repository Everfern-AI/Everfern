<div align="center">
  <img src="public/images/banner.jpg" alt="EverFern" width="100%" />
</div>

# EverFern

> Your autonomous AI desktop agent — free, open-source, and runs entirely on your machine.

**EverFern** is a free, open-source AI desktop agent that automates complex tasks on your computer using natural language. Think of it as your personal AI coworker that can:
- Research topics and synthesize findings
- Write and edit code, documents, and presentations
- Browse the web and interact with websites
- Operate your desktop GUI (click, type, navigate)
- Process files, analyze data, and generate reports

EverFern is the open-source alternative to **Manus Desktop**, **Claude Cowork**, and similar commercial AI agents — available to everyone, completely free.

---

## Why EverFern?

| Feature | EverFern | Commercial Alternatives |
|---------|----------|--------------------------|
| **Price** | Free & open-source | $200+/month |
| **Data Privacy** | Everything stays local | Cloud processing required |
| **Self-Hosting** | Run on your own hardware | Not supported |
| **Customization** | Full source access | Proprietary, locked |
| **AI Providers** | Local or cloud of your choice | Provider-locked |

---

## ✨ Features

- **🤖 Autonomous Task Execution** — Tell EverFern what you want in plain English. It plans, reasons, and executes multi-step tasks autonomously.

- **🖥️ Desktop Automation** — EverFern can control your mouse and keyboard, take screenshots, and interact with any application just like a human would.

- **🔍 Web Research** — Browse websites, extract information, compare products, and summarize findings automatically.

- **📄 Document Processing** — Read, analyze, and create documents in formats like PDF, Word, Excel, PowerPoint, CSV, and more.

- **💻 Code Assistant** — Write, review, debug, and refactor code across multiple languages with full project context.

- **🔌 Extensible Tools** — Connect to 30+ built-in tools or add custom ones via MCP (Model Context Protocol).

- **🛠️ Multi-Provider Support** — Use local AI (Ollama, LMStudio) for privacy or cloud providers (OpenAI, Anthropic, DeepSeek, etc.) for power.

- **🔒 Privacy-First** — All data stays on your machine. No cloud dependency. Your conversations never leave your desktop.

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- Windows 10/11, macOS, or Linux

### Installation

```bash
# Clone the repository
git clone https://github.com/everfern/desktop.git
cd desktop

# Install dependencies
npm install

# Start the application
npm run dev
```

### Build for Production

```bash
npm run build
npm run make
```

---

## 💬 How It Works

Just tell EverFern what you need:

```
"Research the top 5 AI coding assistants and create a comparison table"

"Summarize all the PDF reports in my Downloads folder"

"Open VS Code and refactor the auth module to use JWT tokens"

"Create a PowerPoint presentation about our Q1 sales data"

"Find and organize all my photos from last year into albums"
```

EverFern breaks down your request, plans the steps, and executes them — showing you its thinking process in real-time.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Desktop                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │              EverFern (Frontend + Backend)           │    │
│  │  ┌──────────────────┐    ┌────────────────────────┐  │    │
│  │  │   React UI       │    │   Agent Engine          │  │    │
│  │  │   (Chat + Tools) │◄──►│   (LangGraph-based)    │  │    │
│  │  └──────────────────┘    └────────────────────────┘  │    │
│  └─────────────────────────┬────────────────────────────┘    │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐              │
│         │                  │                  │              │
│    ┌────▼────┐       ┌─────▼─────┐      ┌─────▼─────┐       │
│    │Local AI │       │Cloud AI   │      │  Tools    │       │
│    │Ollama   │       │Anthropic  │      │  GUI Auto │       │
│    │LMStudio │       │OpenAI     │      │  Web Scrape│       │
│    └─────────┘       └───────────┘      └───────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**Frontend**: Next.js with real-time streaming UI
**Backend**: Electron with LangGraph-powered agent orchestration
**AI**: Your choice of local or cloud providers

---

## 🔧 Configuration

### AI Provider Setup

EverFern supports multiple AI providers. Configure yours in the app settings:

**Local (Privacy-First)**
- [Ollama](https://ollama.ai/) — Run models locally
- [LMStudio](https://lmstudio.ai/) — Local model server

**Cloud (More Power)**
- OpenAI (GPT-4, GPT-4o)
- Anthropic (Claude 3.5, Opus)
- DeepSeek
- Google Gemini
- And more...

### Environment Variables

```bash
NEXT_TELEMETRY_DISABLED=1    # Disable telemetry
UV_THREADPOOL_SIZE=4         # Async operation threads
```

---

## 📂 Project Structure

```
everfern/
├── src/                    # Next.js frontend
│   ├── app/                # App router (chat, settings)
│   └── components/         # React components
├── main/                   # Electron backend
│   ├── agent/              # Agent orchestration
│   │   ├── runner/         # Graph execution nodes
│   │   ├── tools/          # Built-in tools
│   │   └── skills/         # Document processing
│   └── acp/                # AI provider clients
├── docs/                   # Architecture docs
└── public/                 # Static assets
```

---

## 🔐 Privacy & Security

- **Local Storage** — All data, keys, and history stored in `~/.everfern/store`
- **No Cloud Sync** — Your conversations never leave your machine
- **Your Keys** — API keys encrypted and stored locally
- **Open Source** — Audit the code yourself for trust

---

## 🤝 Contributing

Contributions welcome! Whether it's bug reports, features, or code:

- **Issues** — Report bugs on GitHub
- **Discussions** — Join community conversations
- **Code** — Submit pull requests

---

## 📄 License

MIT License — free for personal and commercial use.

**Copyright © 2026 EverFern Community**

---

## 🙏 Built With

- [LangGraph](https://langchain-ai.github.io/langgraph/) — Agent orchestration
- [Next.js](https://nextjs.org/) — Frontend framework
- [Electron](https://www.electronjs.org/) — Desktop application framework
- [TypeScript](https://www.typescriptlang.org/) — Type-safe development

---

**Made with ❤️ by the EverFern Community**