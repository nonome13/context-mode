/**
 * util/tools-config — optional, opt-in per-tool overrides for the ctx_* MCP
 * tools registered in server.ts.
 *
 * Motivation: iterating on a tool's `description` (prompt-engineering the
 * wording the model sees) or trying life without a rarely-used tool
 * previously meant editing server.ts and rebuilding. This module lets that
 * happen via a small JSON file instead — edit the file, restart the client,
 * no rebuild needed.
 *
 * Fully opt-in, fail-safe by construction:
 *   - No file present            → {} (identical to today's behavior).
 *   - File present but not valid JSON/JSONC → {} + one stderr warning.
 *   - A given tool's entry is not an object → treated as {} for that tool.
 *   - A given field has the wrong type / is empty → that field is dropped;
 *     every other valid field on the same tool, and every other tool, is
 *     still applied. There is no "reject the whole entry" failure mode.
 *
 * Nothing here ever throws and nothing here ever writes to stdout — this
 * process speaks MCP JSON-RPC over stdout, so any diagnostic goes to stderr.
 *
 * File location (first match wins):
 *   1. CONTEXT_MODE_TOOLS_CONFIG env var — an absolute (or cwd-relative)
 *      path to any file. Useful for keeping several variants around while
 *      testing (`CONTEXT_MODE_TOOLS_CONFIG=./ctx-tools.experiment-a.json`).
 *   2. ~/.pi/ctx-tools.json — Pi's config dir, where settings.json already
 *      lives. No env var needed; just create the file and restart Pi.
 *
 * File format — a flat map of tool name to override:
 *   {
 *     "ctx_insight": { "enabled": false },
 *     "ctx_execute": { "description": "…text the model will see…" }
 *   }
 *
 * Recognized per-tool fields (all optional):
 *   - enabled: boolean     — false removes the tool from tools/list entirely.
 *   - description: string  — replaces the hardcoded description.
 *   - title: string        — replaces the hardcoded title (host approval-UI label).
 *
 * Limitation: inputSchema (the JSON Schema for tool parameters) is NOT
 * overridable via this file. The MCP SDK and sanitizeSchemaForStrictClients
 * validate inputSchema at registration time; accepting arbitrary JSON for
 * it would require deep validation and is out of scope. To experiment with
 * parameter changes, edit server.ts and rebuild.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseJsonc } from "./jsonc.js";

const CONFIG_PATH_ENV = "CONTEXT_MODE_TOOLS_CONFIG";
const CONFIG_FILENAME = "ctx-tools.json";
const PI_CONFIG_DIR = ".pi";

export interface ToolOverride {
  enabled?: boolean;
  description?: string;
  title?: string;
}

export type ToolsConfig = Readonly<Record<string, ToolOverride>>;

const warnedKeys = new Set<string>();
/** Test-only: allow suites to re-exercise the one-shot warning. */
export function __resetToolsConfigWarningsForTests(): void {
  warnedKeys.clear();
}

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  process.stderr.write(`[context-mode] ${message}\n`);
}

/**
 * Resolve where ctx-tools.json should be read from. Never throws — an invalid
 * CONTEXT_MODE_TOOLS_CONFIG value just resolves to a path that (most likely)
 * doesn't exist, which loadToolsConfig() treats as "no overrides".
 */
export function resolveToolsConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[CONFIG_PATH_ENV]?.trim();
  if (explicit) return isAbsolute(explicit) ? explicit : resolve(explicit);
  return join(homedir(), PI_CONFIG_DIR, CONFIG_FILENAME);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Field-level validation: pick only well-typed, non-empty fields. */
function normalizeOverride(raw: unknown): ToolOverride {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: ToolOverride = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (isNonEmptyString(r.description)) out.description = r.description;
  if (isNonEmptyString(r.title)) out.title = r.title;
  return out;
}

/**
 * Load + validate the tools config from `path`. Never throws. Any
 * file-level problem (missing, unreadable, not valid JSON/JSONC, non-object
 * root) yields `{}` — indistinguishable from "no overrides" to callers.
 */
export function loadToolsConfig(path: string): ToolsConfig {
  if (!existsSync(path)) return {};

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    warnOnce(path, `ctx-tools config at ${path} could not be read (${(err as Error).message}) — using built-in tool descriptions.`);
    return {};
  }

  const parsed = parseJsonc<unknown>(raw);
  if (parsed === undefined || parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnOnce(path, `ctx-tools config at ${path} is not valid JSON — using built-in tool descriptions.`);
    return {};
  }

  const out: Record<string, ToolOverride> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[name] = normalizeOverride(value);
  }
  return out;
}

/**
 * Apply a loaded override on top of a tool's hardcoded registerTool config.
 * Returns `null` when the tool should be skipped entirely (enabled: false) —
 * callers should treat that exactly like the existing suppression path
 * (don't register, don't add to any tools list). Returns a new object
 * (never mutates `config`) with `description`/`title` replaced only where a
 * valid override value was found; every other field of `config` — schema,
 * annotations, everything server.ts hardcodes — passes through untouched.
 */
export function applyToolOverride(
  name: string,
  config: Record<string, unknown>,
  toolsConfig: ToolsConfig,
): Record<string, unknown> | null {
  const override = toolsConfig[name];
  if (!override) return config;
  if (override.enabled === false) return null;

  const patched = { ...config };
  if (override.description) patched.description = override.description;
  if (override.title) patched.title = override.title;
  return patched;
}
