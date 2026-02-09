# OpenBridge Coding Agents (MCP)

Start with an MCP-compatible coding agent. MCP (Model Context Protocol) is a simple standard that lets agents connect to external tools and knowledge sources.

## Choose your agent

- Claude Code: https://code.claude.com/docs/en/setup
- Codex CLI: https://developers.openai.com/codex/cli/
- Gemini CLI: https://geminicli.com/
- VS Code + Copilot (or Cursor): https://bridgable.ai/#mcp

## Add the OpenBridge MCP (AskBridge)

Paste the command for your agent:

```bash
claude mcp add --scope local --transport http askbridge https://mcp.bridgable.no/mcp
```

```bash
cursor mcp add askbridge https://mcp.bridgable.no/mcp --transport http
```

```bash
codex mcp add -- askbridge npx -y mcp-remote@latest https://mcp.bridgable.no/mcp
```

```bash
gemini mcp add askbridge https://mcp.bridgable.no/mcp --transport http
```

## Use it

1. Open your coding agent.
2. Ask: "what is a obc button?"
3. You should see the Bridgable MCP get triggered.
