
<div align="center">
  <img src="public/images/banner.jpg" alt="EverFern" width="100%" />

  <h1>EverFern</h1>
  <p><b>The open-source Claude Cowork.</b> Free forever. Runs on your machine. No subscription.</p>

  <p>
    <a href="https://everfern.app"><b>Website</b></a> ·
    <a href="#installation"><b>Installation</b></a> ·
    <a href="#features"><b>Features</b></a> ·
    <a href="#demo"><b>Demo</b></a> ·
    <a href="https://discord.gg/wU2DuYSP7s"><b>Discord</b></a> ·
    <a href="https://github.com/Everfern-AI/Everfern/blob/main/LICENSE"><b>MIT License</b></a>
  </p>

  <p>
    <img src="https://img.shields.io/github/stars/Everfern-AI/Everfern?style=flat-square" />
    <img src="https://img.shields.io/github/license/Everfern-AI/Everfern?style=flat-square" />
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" />
    <a href="https://discord.gg/wU2DuYSP7s"><img src="https://img.shields.io/badge/Discord-Join%20Us-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  </p>
</div>

<br/>

## What is EverFern?

EverFern is a desktop AI agent that uses your computer the way you would — clicking buttons, navigating apps, filling forms, running workflows. Tell it what you want in plain English. It plans the steps and does it.

**Nothing leaves your machine.** No cloud processing, no subscription, no vendor lock-in.

Think of it as the free, open-source alternative to **Claude Cowork**, **Manus Desktop**, and **OpenWork** — with a few tricks they don't have.

<br/>

### How it stacks up

| | 🌿 EverFern | 🤖 Claude Cowork | 🚀 Manus Desktop | 🛠️ OpenWork |
| --- | --- | --- | --- | --- |
| **Price** | Free forever | $20+/mo | $200+/mo | Free |
| **Runs locally** | ✅ | ❌ Cloud only | ❌ Cloud only | ⚠️ Partial |
| **Open source** | ✅ MIT | ❌ | ❌ | ✅ |
| **AI providers** | 10+ (local & cloud) | Anthropic only | Locked | 3–4 |
| **Browser agent** | ✅ Navis | Limited | ✅ | ❌ |

<br/>

## Demo

**Prompt:** *"Research Cursor, the AI code editor — how teams are using it, adoption numbers, and any reported ROI or productivity data — and summarize what you find."*

Navis, EverFern's built-in browser agent, opens a browser, searches, reads through multiple sources, and compiles the findings — no scripts, no scraping code, just the prompt above.




https://github.com/user-attachments/assets/e9bd901e-67fb-4110-8ea6-053730d0be34






<br/>

## Why people switch to EverFern

- 🖥️ **Computer Use** — sees your screen, clicks, types, and drives any desktop app like a human would. No integrations needed.
- 🌐 **Navis, our built-in browser agent** — fills forms, scrapes data, and drives web apps in plain English. ([source](https://github.com/Everfern-AI/Navis-Extension))
- 🧬 **Self-evolving tools** — when EverFern hits a wall, it writes and compiles new tools at runtime, gated behind a human-approval step before anything activates.
- 📚 **Reusable skills** — the agent turns what it learns into saved, reusable instructions that make future tasks faster.
- 🛡️ **Self-healing runs** — failed terminal commands or edits trigger automatic rollback, root-cause analysis, and a retry — no babysitting required.
- 🤝 **Peer agent debate** — for hard tasks, specialized agents argue out the best plan before executing anything.
- 🧠 **Persistent memory** — remembers your preferences across sessions, and compresses old context with no information loss.
- 🔒 **Sandboxed execution** — every shell command runs in an isolated Linux VM, so nothing touches your real system by accident.
- 📄 **Document handling** — reads and writes PDFs, Word, Excel, PowerPoint, and CSVs out of the box.
- ⚙️ **Workflow builder** — chain actions, save them, schedule them, automate the boring stuff.

<br/>

## Bring your own model

Run fully offline with **Ollama** or **LM Studio**, or connect to **OpenAI, Anthropic, DeepSeek, Gemini, OpenRouter, Nvidia NIM, Mistral, Groq**, and more. Switch providers anytime — nothing else changes.

<br/>

## Installation

### Download a build

Prebuilt releases for Windows, macOS, and Linux are available at:
[https://github.com/Everfern-AI/Everfern/releases](https://github.com/Everfern-AI/Everfern/releases)

### Build from source

**Prerequisites**

- **macOS:** Node.js v18+
- **Windows:** Node.js v18+ (Windows 10/11)
- **Linux:** Node.js v18+

**Steps**

```
git clone https://github.com/Everfern-AI/Everfern.git
cd Everfern
npm install
npm run dev
```

For packaged builds:

```
npm run build
npm run make
```

<br/>

## Try asking it

```
"Open Spotify and play my liked songs"
"Summarize all the PDFs in my Downloads folder into one document"
"Open VS Code and refactor the auth module to use JWT tokens"
"Research Cursor's ROI and adoption numbers and summarize the findings"
"Find all my photos from last year and organize them by month"
```

EverFern breaks the request into steps, shows its reasoning live, and pauses for your confirmation before anything destructive.

<br/>

## Architecture

<details>
<summary><b>Click to expand full system diagram</b></summary>

```
┌───────────────────────────┐
│         React UI          │
│   (Next.js App Router)    │
│  Chat Interface & Timeline│
└─────────────┬─────────────┘
              │
┌─────────────▼─────────────┐
│   Electron Preload IPC    │
└─────────────┬─────────────┘
              │
┌─────────────▼──────────────────────────────────────────┐
│                Electron Main Process                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │             LangGraph Orchestrator               │   │
│  │  Peer Agent Debate   │   Memory Compression       │   │
│  │        ↓                        ↓                 │   │
│  │  Coding Specialist │ Data Analyst │ Web Explorer  │   │
│  └────────────────────────┬──────────────────────────┘   │
│                            ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 Tool Gateway Layer                │   │
│  │  Computer Use │ Navis Browser │ Terminal Runner   │   │
│  │  Tool Synthesizer │ Skill Synthesizer │ MCP       │   │
│  └────────────────────────┬──────────────────────────┘   │
│                            ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Persistence & Database Layer             │   │
│  │  SQLite (WAL) │ Rollback Snapshots │ Vector DB     │   │
│  └────────────────────────┬──────────────────────────┘   │
│                            ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            AI Client Gateway Registry              │   │
│  │  Local: Ollama, LM Studio                          │   │
│  │  Cloud: Anthropic, OpenAI, DeepSeek, Gemini...     │   │
│  └─────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

</details>

<br/>

## Privacy & Security

- Data, keys, and history live in `~/.everfern/store` — nothing is synced anywhere
- API keys are encrypted locally
- Shell commands run inside an isolated Linux VM
- Full source available for you to audit

<br/>

## Project Structure

```
everfern/
├── src/          # Next.js frontend (chat interface, settings)
├── main/         # Electron backend
│   ├── agent/    # LangGraph orchestration
│   ├── tools/    # Built-in tools
│   └── acp/      # AI provider clients
├── docs/         # Architecture documentation
└── public/       # Static assets
```

<br/>

## Contributing

Bug reports, feature requests, and PRs are welcome.

- 🐛 [Report a bug](../../issues)
- 💡 [Suggest a feature](../../issues)
- 💬 [Join the discussion](../../discussions)
- 🔧 See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines

If EverFern is useful to you, a ⭐ helps more people find it.

<br/>

## License

MIT — free for personal and commercial use.
Copyright © 2026 EverFern Community

<br/>

<div align="center">
Built with LangGraph, Next.js, Electron, and TypeScript.<br/>
Made with ❤️ by the EverFern Community
</div>
