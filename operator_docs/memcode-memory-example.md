# Optional MemCode memory example

This [standalone example](../examples/memcode-memory.mjs) is **not wired into EverFern**. It demonstrates the smallest hosted integration boundary for maintainers to review without changing EverFern's local memory, defaults, or agent tool registry. Nothing is sent to MemCode unless a caller explicitly sets `enabled: true` and selects `scope: 'personal'`.

The example uses the existing MCP SDK and `mcp-remote@0.14.3` as a stdio-to-hosted-MCP bridge. On first use, the bridge opens MemCode OAuth in the browser; there is no API key in the repository or model prompt. The hosted resource is `https://mcp.memcode.in/i/everfern/mcp`. Its public alias supports server-side integration attribution but is not an authentication secret. The connected MemCode account, not a caller-supplied user ID, determines personal access.

The flow is `search_memories` → show retrieved results as **untrusted external context** → propose a compact note → show that exact note to the human → call `save_memory` only after approval. `save_memory` starts an asynchronous ingest job; its response is not proof the memory is ready. The caller can continue using EverFern's local memory if the remote connection fails. The sample never captures raw transcripts, page content, or every turn automatically.

The current personal MCP tools do **not** guarantee project-level isolation. Accordingly, this example refuses `scope: 'project'` before connecting. A production project-scoped integration should wait for a server-enforced scope contract and tests that prove two projects cannot read each other. Prefixing a memory with a project name or relying on a model instruction is not isolation.

To try the control flow without credentials or network, run `node --test examples/memcode-memory.test.mjs`. This test injects a fake connection; it does not launch `mcp-remote` or a server. A production UI would need a real enable switch, OAuth status, an exact-note confirmation dialog, disconnect/deletion affordances, and a prompt-injection boundary for recalled text before exposing this to agents.
