<div align="center">

<img src="docs/assets/readme/72e3a0fe-eb3d-485a-9c5c-6456e4ed25a6.png" alt="Frakio Work Logo" width="100">

<h1>Frakio Work</h1>

<p>A multi-agent collaborative workspace powered by Hermes Agent and Pi.</p>

<p>
  <a href="https://madsgogo.com">🌱 Homepage</a>
  ·
  <a href="https://madsgogo.life">📚 Blog</a>
  ·
  <a href="https://qm.qq.com/q/EMhcKWipnW">💬 Community</a>
  ·
  <a href="README.md">🇨🇳 中文</a>
  ·
  <a href="README.en.md">🇺🇸 English</a>
</p>

</div>

Frakio Work is a cross-platform multi-agent workspace with Hermes Agent and Pi as dual runtimes. Switch runtimes freely for each Agent and let a team of Agents collaborate naturally in one conversation.

## Quick Setup

For direct use, download the desktop app from [GitHub Releases](https://github.com/MadsGao/frakio-work/releases). Download `arm64` for Apple Silicon or `x64` for an Intel Mac. The current macOS installer is not Apple-signed or notarized. If macOS blocks the first launch, Control-click Frakio Work in Finder and choose **Open**. If the app is reported as damaged after installation, run:

```bash
xattr -dr com.apple.quarantine "/Applications/Frakio Work.app"
```

The desktop app includes the Web UI, local API, and bundled Runtime files, so you do not need to run `npm run dev`. New releases can be checked from Settings, which opens the matching GitHub Releases download page.

### Self-hosted Web UI

The self-hosted Web UI includes Node, Python, Hermes Runtime, and Bridge. Windows and Linux users do not need to start it from source. Packages are available for Windows x64 and Linux x64; macOS users should use the desktop DMG.

Linux x64:

```bash
curl -fsSL https://raw.githubusercontent.com/MadsGao/frakio-work/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/MadsGao/frakio-work/main/scripts/install.ps1 | iex
```

The service starts automatically and prints the generated administrator password once. Open `http://127.0.0.1:8787` locally, or use the host's private LAN address from another device on the same trusted network. The `frakio-work` command supports `start`, `stop`, `restart`, `status`, `logs`, `update`, `rollback`, and `password reset`.

Linux x64 also supports the Docker image published from this repository:

```bash
docker run -d --name frakio-work \
  -p 8787:8787 \
  -v frakio-work-data:/data \
  -v "$PWD:/workspace" \
  ghcr.io/madsgao/frakio-work:latest
```

### Development from Source

Source development requires Node.js 24, npm, Git, and uv:

```bash
git clone https://github.com/MadsGao/frakio-work.git
cd frakio-work
npm ci
npm run runtime:build
npm run dev
```

After starting from source, the Web UI is available at `http://127.0.0.1:5173` and the local API is available at `http://127.0.0.1:8787`. User data, credentials, logs, Runtime files, and backups are stored under `~/.frakio-work` and are not written into the source repository.

---

## Core Idea

Frakio Work is a collaborative workspace built around multiple harnesses. Build a team of Agents with distinct personalities, let them work naturally in one conversation, and give them long-term evolving memory to support the OPC model.

Stitching together useful ideas is a central part of Frakio Work. It draws inspiration from the following open-source projects, in no particular order: Hermes Agent, Hermes Studio, Pi, Codex, Craft Agent, Cindy, QM, SuperConductor, and Orca.

![Frakio Work overview](docs/assets/readme/workbench-overview.png)

## Features

### Natural Collaboration in Conversation

Talk to any Agent in natural language, much like a group chat. Agents can autonomously @ mention one another for up to 64 turns; the limit is configurable in Settings.

![Natural multi-agent collaboration](docs/assets/readme/natural-agent-collaboration.png)

#### Conversation Follow Modes

![Conversation follow modes](docs/assets/readme/conversation-follow-mode.png)

Set the multi-agent mode at the top of each conversation:

1. Default follow: when you do not @ mention another Agent, the global default Agent handles the next reply. Set it in the Agent Configuration Center.
2. Conversation follow: after you @ mention an Agent, that Agent takes over the following replies.
3. Convert to project: turn a conversation into a project and add it to the current workspace's project area.
4. Knowledge Vault (Beta): connect a local Obsidian vault and use its rule index for deeper multi-agent collaboration.

#### Quick Conversation Index

![Quick conversation index](docs/assets/readme/conversation-quick-index.png)

Use the quick-jump index to find content quickly in longer conversations.

## Settings

### Agent Configuration Center

![Agent configuration center](docs/assets/readme/agent-configuration-center.png)

1. Manage otherwise scattered Agent settings together as cards.
2. Customize Agent avatars.
3. Set the global default Agent for replies where no Agent is specified.
4. Set an Agent's default model when no model is specified.

### Model Configuration

![Model configuration](docs/assets/readme/model-configuration.png)

Configure a model once and share it among multiple Agents, without repeating the same setup for every Agent.

### Monitoring Dashboard

![Monitoring dashboard](docs/assets/readme/monitoring-dashboard.png)

The monitoring page provides a visual dashboard inspired by the CC Switch Token dashboard.

### Personal Profile

![Personal profile](docs/assets/readme/personal-profile.png)

The profile page summarizes AI usage and supports a custom conversation avatar, which appears on the welcome screen and in conversations.

### LLM Wiki Knowledge Vault (Beta)

![LLM Wiki knowledge vault](docs/assets/readme/llm-wiki-vault.png)

Knowledge vaults let Agents collaborate through local working files rather than relying only on one-off context or guesses across sessions. Switch between vaults and use their rule indexes for different projects.

### Multiple Workspaces

![Multiple workspaces](docs/assets/readme/multi-workspaces.png)

Organize workspaces for product development, media operations, everyday chats, or independent-site operations. Each workspace can have its own name, icon, and color theme. Use a solid color or a gradient of up to three colors, then adjust brightness and noise.

## Closing

This is the current feature set and direction for Frakio Work. For questions or feedback, add the author on WeChat: `MadsGao`.
