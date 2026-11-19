# Use statmesh from Claude and ChatGPT

Status: setup steps below are written from the code and the README. **None of them has been run
in the real app.** The commands were not run in Claude Desktop, Claude Code or ChatGPT.

statmesh offers two ways in: local over stdio (Claude) and a public HTTPS host (ChatGPT). Print the
exact config for your checkout with `statmesh mcp --print-config <target>`.

| App | Transport | Needs a public host | Data leaves your machine |
|---|---|---|---|
| Claude Desktop | stdio, local | no | queries and results go to Anthropic when Claude reads them |
| Claude Code | stdio, local | no | queries and results go to Anthropic when Claude reads them |
| ChatGPT (connector) | remote MCP at `/mcp` | yes, HTTPS | queries and results go to OpenAI; statmesh logs the client IP |
| ChatGPT (GPT Action) | REST from `/openapi.json` | yes, HTTPS | as above |

## Before you start

`statmesh mcp` refuses to start without `STATMESH_CONTACT_EMAIL` (SEC EDGAR needs it), unless you
set `STATMESH_DISABLE=sec_edgar`. Put one of them in `.env`. The generated stdio config runs
`uv run --env-file .env`, so `.env` must be in the checkout.

Load some data first, or the tools return empty results. The offline demo in the README (step 1)
is enough to try the setup.

## Claude Desktop (local)

1. Print the config:

   ```sh
   uv run statmesh mcp --print-config claude-desktop
   ```

   The output is one JSON object with a `mcpServers` entry. It runs statmesh in your checkout
   over stdio.
2. Merge the `statmesh` entry into `claude_desktop_config.json`. On macOS that file is
   `~/Library/Application Support/Claude/claude_desktop_config.json`. Keep any other servers you
   already have. The config runs `uv` by name; Claude Desktop may not find it on its PATH, so
   replace `"command": "uv"` with the output of `which uv`.
3. Quit and reopen Claude Desktop. Look for `statmesh` in the tools menu.
4. Ask a question from the README, for example "unemployment rate in India since 2015", and check
   that the answer carries a citation.

Privacy: the server runs on your machine and reads your local `data/` directory. Remote series are
still fetched on demand from the upstream source. Claude sends your prompts and the tool results to
Anthropic under its own terms.

## Claude Code (local)

1. Print the command:

   ```sh
   uv run statmesh mcp --print-config claude-code
   ```

2. Run the printed `claude mcp add ...` line once, from any directory.
3. Check with `claude mcp list`, then start a session and ask a statistics question.

The command passes `STATMESH_DATA_DIR` and starts the server with `uv --directory <checkout> run`.
If you move the checkout, run the print command again and replace the entry.

Privacy: as for Claude Desktop. The server is local, and results go to Anthropic when Claude reads
them.

## ChatGPT (hosted, public HTTPS only)

ChatGPT calls the server from OpenAI's side. A laptop or `127.0.0.1` cannot serve it. You need a
public HTTPS host, which means the hosted mirror (`docs/hosted.md`, `docs/hosted-runbook.md`).

Serve only data you may redistribute:

- `STATMESH_MODE=hosted`: only `redistribute: yes` series are served.
- `STATMESH_ALLOWED_HOSTS=<your host>`: the Host header allow-list for REST and `/mcp`.
- TLS at the reverse proxy. The API listens on localhost.

Then print the setup for your host:

```sh
uv run statmesh mcp --print-config chatgpt --url https://<your-host>/mcp
```

It prints two URLs.

**Connector (MCP).** In ChatGPT, turn on developer mode in the settings, create a connector, and
paste the `/mcp` URL. Use it in a chat as a tool.

**GPT Action (REST).** Create a GPT, open Configure, then Actions, then Import from URL. Paste the
`/openapi.json` URL. The spec has one operation per endpoint, each with a unique `operationId` and a summary. Set the
authentication to none: the mirror has no accounts.

Check first:

- `https://<your-host>/healthz` returns `{"ok": true}`.
- `https://<your-host>/llms.txt` returns the agent guide.

Privacy: no accounts, so the only personal data is the client IP address in the server logs.
`docs/hosted.md` suggests a 14-day retention. ChatGPT sends your prompts and the tool results to
OpenAI under its own terms.

## Missing data

All three setups use the same rules. The MCP server's instructions state them, and so does
`docs/llms.txt`. When statmesh does not have a number, the assistant should say what it searched,
show the 3 closest series and how each differs, name the source that would hold the data, and not
give a number from memory. If a setup answers a statistics question with an uncited number, treat it
as a failed check.
