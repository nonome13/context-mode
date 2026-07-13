# ctx-tools.json — Per-Tool Overrides

Optional configuration file for customizing context-mode's MCP tool descriptions and visibility without rebuilding. Edit the file, restart the client, see the change — no `npm run build` needed.

## Location

The file is read from the first matching path:

1. **`CONTEXT_MODE_TOOLS_CONFIG` env var** — absolute or cwd-relative path to any file. Useful for keeping multiple variants while testing.
2. **`~/.pi/ctx-tools.json`** — Pi's config directory (same folder as `settings.json`). No env var needed; just create the file and restart Pi.

If no file exists at either location, the built-in tool descriptions are used (identical to default behavior).

## Format

A flat JSON object mapping tool names to overrides. [JSONC](https://code.visualstudio.com/docs/languages/json#_json-with-comments) is supported (comments and trailing commas are stripped before parsing).

```json
{
  // Disable a tool you never use
  "ctx_insight": { "enabled": false },

  // Iterate on tool descriptions without rebuilding
  "ctx_execute": {
    "description": "Run code in a sandbox. Only stdout enters context."
  },

  // Change the title shown in host approval UIs
  "ctx_search": {
    "title": "Search Knowledge Base"
  }
}
```

## Fields

All fields are optional. Unknown fields are silently ignored.

| Field | Type | Effect |
|---|---|---|
| `enabled` | boolean | `false` removes the tool from `tools/list` entirely. `true` or omitted → tool is registered normally. |
| `description` | string | Replaces the hardcoded description the model sees in the tool list. Must be non-empty. |
| `title` | string | Replaces the hardcoded title (shown in host approval UIs). Must be non-empty. |

## Fail-safe behavior

This feature is designed to never break the MCP server:

- **Missing file** → no overrides (silent).
- **Invalid JSON** → no overrides + one stderr warning.
- **Wrong-type field** → that field is dropped; other valid fields on the same tool still apply.
- **Wrong-type tool entry** → treated as empty override for that tool.

Nothing here ever throws or writes to stdout (the MCP server speaks JSON-RPC over stdout; diagnostics go to stderr).

## Limitations

- **`inputSchema` is not overridable.** The JSON Schema for tool parameters is validated by the MCP SDK and `sanitizeSchemaForStrictClients` at registration time. To experiment with parameter changes, edit `src/server.ts` and rebuild.
- Changes require a **client restart** — the file is read once at MCP server boot, not watched for live reload.

## Available tools

The 11 `ctx_*` tools that can be overridden:

| Tool | What it does |
|---|---|
| `ctx_execute` | Run code in a sandbox |
| `ctx_execute_file` | Run code over a file |
| `ctx_index` | Index content into FTS5 |
| `ctx_search` | Search indexed content |
| `ctx_fetch_and_index` | Fetch URL and index |
| `ctx_batch_execute` | Batch commands + search |
| `ctx_stats` | Session statistics |
| `ctx_doctor` | Run diagnostics |
| `ctx_upgrade` | Upgrade plugin |
| `ctx_purge` | Purge knowledge base |
| `ctx_insight` | Open Insight dashboard |

## Example

See `ctx-tools.json.example` in the repository root.
