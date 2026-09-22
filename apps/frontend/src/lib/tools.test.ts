import { describe, expect, test } from "bun:test";
import { toolIconKey, type ToolIconKey } from "./tools";

describe("toolIconKey", () => {
  test.each<[string, ToolIconKey]>([
    ["Read", "read"],
    ["Edit", "edit"],
    ["Write", "edit"],
    ["MultiEdit", "edit"],
    ["NotebookEdit", "edit"],
    ["Glob", "search"],
    ["Grep", "search"],
    ["Bash", "terminal"],
    ["WebFetch", "web"],
    ["WebSearch", "web"],
    ["Task", "agent"],
    ["TodoWrite", "todo"],
  ])("%s -> %s", (name, key) => {
    expect(toolIconKey(name)).toBe(key);
  });

  // OpenCode reports its tools in lower case.
  test("matches regardless of case", () => {
    expect(toolIconKey("bash")).toBe("terminal");
    expect(toolIconKey("read")).toBe("read");
  });

  test("unknown and MCP tools fall back to the generic icon", () => {
    expect(toolIconKey("mcp__github__create_issue")).toBe("generic");
    expect(toolIconKey("")).toBe("generic");
  });
});
