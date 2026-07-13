import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import {
  applyToolOverride,
  loadToolsConfig,
  resolveToolsConfigPath,
  __resetToolsConfigWarningsForTests,
} from "../../src/util/tools-config.js";

describe("tools-config", () => {
  // ═══════════════════════════════════════════════════════════
  // resolveToolsConfigPath
  // ═══════════════════════════════════════════════════════════

  describe("resolveToolsConfigPath", () => {
    it("returns env var path when CONTEXT_MODE_TOOLS_CONFIG is absolute", () => {
      const path = resolveToolsConfigPath({ CONTEXT_MODE_TOOLS_CONFIG: "/abs/ctx-tools.json" });
      expect(path).toBe("/abs/ctx-tools.json");
    });

    it("resolves env var path relative to cwd when not absolute", () => {
      const path = resolveToolsConfigPath({ CONTEXT_MODE_TOOLS_CONFIG: "./ctx-tools.json" });
      expect(path).toBe(join(process.cwd(), "ctx-tools.json"));
    });

    it("falls back to ~/.pi/ctx-tools.json when env var is not set", () => {
      const path = resolveToolsConfigPath({});
      expect(path).toBe(join(homedir(), ".pi", "ctx-tools.json"));
    });

    it("ignores empty/whitespace env var and falls back to default", () => {
      const path = resolveToolsConfigPath({ CONTEXT_MODE_TOOLS_CONFIG: "   " });
      expect(path).toBe(join(homedir(), ".pi", "ctx-tools.json"));
    });
  });

  // ═══════════════════════════════════════════════════════════
  // loadToolsConfig
  // ═══════════════════════════════════════════════════════════

  describe("loadToolsConfig", () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "ctx-tools-test-"));
      configPath = join(tmpDir, "ctx-tools.json");
      __resetToolsConfigWarningsForTests();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns {} when file does not exist", () => {
      expect(loadToolsConfig(join(tmpDir, "nonexistent.json"))).toEqual({});
    });

    it("returns {} for invalid JSON and warns once", () => {
      writeFileSync(configPath, "{ not valid json");
      expect(loadToolsConfig(configPath)).toEqual({});
      // Second call should not warn again (one-shot)
      writeFileSync(configPath, "{ still not valid");
      expect(loadToolsConfig(configPath)).toEqual({});
    });

    it("returns {} for non-object root (array)", () => {
      writeFileSync(configPath, "[1, 2, 3]");
      expect(loadToolsConfig(configPath)).toEqual({});
    });

    it("returns {} for non-object root (string)", () => {
      writeFileSync(configPath, '"hello"');
      expect(loadToolsConfig(configPath)).toEqual({});
    });

    it("returns {} for non-object root (null)", () => {
      writeFileSync(configPath, "null");
      expect(loadToolsConfig(configPath)).toEqual({});
    });

    it("parses valid JSONC with comments and trailing comma", () => {
      writeFileSync(configPath, `{
        // disable insight tool
        "ctx_insight": { "enabled": false },
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({ ctx_insight: { enabled: false } });
    });

    it("parses valid JSON", () => {
      writeFileSync(configPath, '{"ctx_execute": {"description": "new desc"}}');
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({ ctx_execute: { description: "new desc" } });
    });

    it("normalizes per-field validation: drops wrong-type fields, keeps valid ones", () => {
      writeFileSync(configPath, `{
        "ctx_execute": {
          "enabled": "not a boolean",
          "description": "valid desc",
          "title": 123
        }
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({
        ctx_execute: { description: "valid desc" },
      });
    });

    it("drops empty-string description/title", () => {
      writeFileSync(configPath, `{
        "ctx_execute": { "description": "  ", "title": "" }
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({ ctx_execute: {} });
    });

    it("treats non-object tool entry as empty override", () => {
      writeFileSync(configPath, `{
        "ctx_execute": "not an object",
        "ctx_search": { "enabled": false }
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({
        ctx_execute: {},
        ctx_search: { enabled: false },
      });
    });

    it("handles null tool entry as empty override", () => {
      writeFileSync(configPath, `{
        "ctx_execute": null,
        "ctx_search": { "enabled": false }
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({
        ctx_execute: {},
        ctx_search: { enabled: false },
      });
    });

    it("handles array tool entry as empty override", () => {
      writeFileSync(configPath, `{
        "ctx_execute": [1, 2, 3]
      }`);
      const config = loadToolsConfig(configPath);
      expect(config).toEqual({ ctx_execute: {} });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // applyToolOverride
  // ═══════════════════════════════════════════════════════════

  describe("applyToolOverride", () => {
    const baseConfig = { description: "original", title: "Original Title" };

    it("returns config unchanged when no override exists", () => {
      const result = applyToolOverride("ctx_execute", baseConfig, {});
      expect(result).toEqual(baseConfig);
    });

    it("returns config unchanged when tool has empty override", () => {
      const result = applyToolOverride("ctx_execute", baseConfig, {
        ctx_execute: {},
      });
      expect(result).toEqual(baseConfig);
    });

    it("returns null when enabled is false", () => {
      const result = applyToolOverride("ctx_insight", baseConfig, {
        ctx_insight: { enabled: false },
      });
      expect(result).toBeNull();
    });

    it("returns config when enabled is true", () => {
      const result = applyToolOverride("ctx_insight", baseConfig, {
        ctx_insight: { enabled: true },
      });
      expect(result).toEqual(baseConfig);
    });

    it("replaces description when override has one", () => {
      const result = applyToolOverride("ctx_execute", baseConfig, {
        ctx_execute: { description: "new desc" },
      });
      expect(result).toEqual({ description: "new desc", title: "Original Title" });
    });

    it("replaces title when override has one", () => {
      const result = applyToolOverride("ctx_execute", baseConfig, {
        ctx_execute: { title: "New Title" },
      });
      expect(result).toEqual({ description: "original", title: "New Title" });
    });

    it("replaces both description and title", () => {
      const result = applyToolOverride("ctx_execute", baseConfig, {
        ctx_execute: { description: "new", title: "New" },
      });
      expect(result).toEqual({ description: "new", title: "New" });
    });

    it("does not mutate the original config object", () => {
      const config = { description: "original", title: "Original" };
      applyToolOverride("ctx_execute", config, {
        ctx_execute: { description: "new" },
      });
      expect(config.description).toBe("original");
    });

    it("passes through extra config fields untouched", () => {
      const config = { description: "original", annotations: { readOnlyHint: true } };
      const result = applyToolOverride("ctx_execute", config, {
        ctx_execute: { description: "new" },
      });
      expect(result).toEqual({ description: "new", annotations: { readOnlyHint: true } });
    });
  });
});
