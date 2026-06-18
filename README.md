# 🧠 Autonomous Agent Second Brain — Graph-RAG Memory Core

[![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-zero-success.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-node.js%20%3E%3D%2018-orange.svg)](package.json)

A **zero-dependency, offline-first Graph-RAG memory system** that enables autonomous AI agents to share long-term memories, accumulate research, and coordinate workflows. 

Designed to operate natively as an **Obsidian Vault** on the filesystem and exposed as a clean REST API and Javascript SDK. By representing memories as interconnected nodes (`[[wikilinks]]`) and using a **Breadth-First Search (BFS) graph traversal**, it filters and delivers targeted context to LLMs, reducing typical agent input sizes by **95–99%** compared to reading entire codebases or directories.

![Graph Visualizer Preview](assets/dashboard_preview.png)

---

## 🚀 Why This Project Stands Out (Portfolio Highlights)

This project showcases several advanced backend engineering principles and data modeling architectures:

*   **Zero-Dependency Node.js Backend:** Built using pure native Node.js ES Modules (`http`, `fs`, `path`, `child_process`). Instantly boots in milliseconds, is highly secure against dependency vulnerability chains, and is extremely portable.
*   **Graph-RAG vs. Flat-RAG:** Flat RAG systems (using simple vector similarity) yield disconnected text chunks that lose context. This engine parses Obsidian-style wikilinks (`[[Page Name]]`) to build an adjacency map, tracing logical connections between ideas.
*   **Token Economics (Optimized Context):** Rather than feeding raw file structures (~50k tokens) or arbitrary chunks into LLM context windows, agents query `/recall` to receive a pre-assembled context payload restricted to a custom token budget (~300–2,000 tokens), preventing model attention degradation.
*   **Native File System Hot-Reloading (`fs.watch()`):** Automatically invalidates and refreshes the memory index in real time when files are edited (either manually in Obsidian or programmatically via the API). Built using native file system events with a debounce timer to sustain sub-millisecond query performance.
*   **Cached TF-IDF Search Engine Optimization:** To achieve sub-millisecond search latency, the backend pre-tokenizes vault contents and pre-calculates inverse document frequencies (IDF) and vector magnitudes during graph cache loading, eliminating O(N) tokenization and regex parsing on every search.
*   **Optimistic Concurrency Control (OCC):** Prevents concurrent write overrides. Nodes contain a `version` property in YAML frontmatter that increments on actual updates. `PATCH` calls require the matching `version`, failing with `409 Conflict` if modified concurrently.
*   **Strict Node Schema Validation:** Validates incoming payloads (`title` filename characters, `type` enums, `importance` bounds, and `tags` format) before writing files to disk, ensuring strict memory bank integrity.
*   **Granular Read & Write Authentication Security:** When `BRAIN_KEY` is configured, Bearer Token authentication is enforced across all endpoints—including search, recall, and graph views. The telemetry stream endpoint (`/stream`) requires a matching `?token=` parameter to block raw data exposure on public URLs.
*   **Interactive Agent Simulator UI:** Features a premium sidebar form in the dashboard where you can simulate multi-agent memory writes, watching the nodes, links, and EventSource telemetry update dynamically in the D3.js visualization.
*   **Human-Agent-in-the-Loop Coordination:** Because memories are serialized as plain Markdown files (`.md`) with YAML frontmatter, a human can open the same folder in Obsidian to audit agent reasoning, edit notes, or add guidelines directly into the graph.
*   **Asynchronous Auto-Git Sync:** Features an optional background syncing process. When agents write new thoughts, the server asynchronously handles staging, committing, and pushing updates back to GitHub, enabling seamless coordination across cloud VMs or GitHub Actions.

---

## ⚙️ Technical Architecture

```mermaid
graph TD
    subgraph Client Environments
        Agent1[Research Agent] -->|SDK: remember/recall| API[🧠 Second Brain REST API]
        Agent2[Pipeline Agent] -->|SDK: remember/recall| API
        Human[Human Operator] -->|Edits Notes| Obs[Obsidian Editor]
    end

    subgraph API Server
        API --> Engine[Graph Engine]
        Engine --> Cache[In-Memory Graph Cache]
        Engine --> FS[Local FS Watcher]
    end

    subgraph Storage Layer
        FS -->|Reads/Writes| Vault[(Markdown Vault)]
        Obs -->|Reads/Writes| Vault
        Engine -->|Optional Async Sync| Git[Git Sync Engine]
    end

    Git -->|Auto Commit & Push| GitHub[Private GitHub Repo]
```

---

## 🎨 Interactive Graph Visualizer UI

The project contains a dynamic, high-tech dashboard built with **D3.js (v7)** and **Marked.js**.

*   **Force-Directed Graph Simulation:** Renders memory connections in real-time. Nodes are sized by their link degree (centrality) and colored by type (`core`, `memory`, `research`, `decision`, `task`, `insight`).
*   **Interactive Context Panel:** Clicking a node loads its markdown contents and renders it cleanly, listing clickable outgoing links and backlinks (inlinks) to navigate the thought tree.
*   **Live Filters & Live Reload:** Search and filter nodes by title, tags, or type. Sync vault changes instantly via `/reload`.

---

## 📡 REST API & Interface Directory

| Method | Endpoint | Payload / Query | Description |
|---|---|---|---|
| **GET** | `/health` | — | Returns server stats, port, and vault nodes/edges volume. |
| **GET** | `/nodes` | — | Gets list of all index nodes with trimmed previews. |
| **GET** | `/node/:id` | — | Gets specific note body, parsed outgoing links, and incoming backlinks. |
| **GET** | `/search` | `?q=query&limit=10` | Relevance-scored keyword search across titles, tags, and content. |
| **GET** | `/recall` | `?q=query&hops=1` | **Core Agent Context:** BFS graph context assembler within token budget. |
| **GET** | `/graph` | — | Returns complete adjacency map nodes and edges. |
| **POST** | `/remember` | `{title, content, type, agent}` | Commits a new markdown node into the vault directory. |
| **PATCH** | `/node/:id` | `{title, content, type, tags}` | Modifies an existing file's text content or YAML frontmatter metadata. |
| **DELETE**| `/node/:id` | — | Deletes a note from the disk. |
| **POST** | `/reload` | — | Refreshes the in-memory cache manually. |

---

## 📦 SDK Quick Start & Code Quality

The Client SDK is written in clean, modern Javascript using native `fetch`.

```javascript
import { SecondBrain } from './sdk/index.js';

// Initialize Client (Reads optional BRAIN_API & BRAIN_KEY env variables)
const brain = new SecondBrain({
  agent: 'pipeline-agent',
  api: 'http://localhost:3747',
  apiKey: process.env.BRAIN_KEY
});

/**
 * Workflow Scenario: Context Recall -> Task Execution -> Memory Write
 */
async function runAutoPipeline() {
  // 1. Fetch relevant context within 1 Graph Hop and 1500 token budget
  const context = await brain.recall('Gumroad publishing requirements', 1, 1500);
  
  // 2. Inject context directly into your LLM prompt
  const llmPrompt = `
    ${context.systemPrompt}
    
    Task: Prepare publishing schema for digital assets.
  `;
  const result = await myLlmClient.generate(llmPrompt);
  
  // 3. Save learnings back to the shared memory bank for other agents
  await brain.remember(result, {
    title: 'Etsy and Gumroad Publishing Schema',
    type: 'research',
    tags: ['publish', 'schema', 'automated-run']
  });
}
```

---

## 🔒 Security & Authentication Setup

By default, the server runs in local/development mode with authentication disabled. For cloud deployments, multi-agent networks, or when exposing the REST API endpoints publicly, you should enforce Bearer Token authentication:

1. **Set the Secret Key:**
   Define the `BRAIN_KEY` environment variable on your system or server:
   ```bash
   export BRAIN_KEY="your-highly-secure-secret-token"
   ```
2. **Enforced Protection:**
   Once `BRAIN_KEY` is set, all mutative endpoints (`POST /remember`, `POST /reload`, `POST /consolidate`, `PATCH /node/:id`, `DELETE /node/:id`) will block unauthorized requests and return `401 Unauthorized`.
3. **Authorization Header:**
   Incoming requests must include the token in the `Authorization` header:
   ```http
   Authorization: Bearer your-highly-secure-secret-token
   ```
4. **Client SDK Configuration:**
   When initializing the Javascript client SDK, inject the token using the `apiKey` configuration option:
   ```javascript
   const brain = new SecondBrain({
     api: 'http://localhost:3747',
     apiKey: process.env.BRAIN_KEY // Or pass the token directly
   });
   ```

---

## 🛠️ Configuration & Setup

### Requirements
*   Node.js (>= 18.0.0)
*   Web Browser (for Visualizer UI)

### Installation
Clone the repository:
```bash
git clone https://github.com/ara-5/mind-mri-agent-second-brain.git
cd mind-mri-agent-second-brain
```

### Environment Settings
Define environment variables to adjust server behavior:

| Variable | Description | Default |
|---|---|---|
| `BRAIN_PORT` | The port the REST API listens on. | `3747` |
| `BRAIN_KEY` | Optional. If set, mutative endpoints require a matching bearer token. | `""` |
| `AUTO_GIT_SYNC` | Optional. If `true`, the server commits & pushes modifications to GitHub. | `false` |

### Start Server
```bash
# Production start
npm start

# Development watch mode
npm run dev
```

### Launch Visualizer UI
```bash
npm run ui
```
*(Runs a cross-platform command to open `ui/index.html` in your default browser)*
