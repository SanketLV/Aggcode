export type ToolIconKey =
  | "read"
  | "edit"
  | "search"
  | "terminal"
  | "web"
  | "agent"
  | "todo"
  | "generic";

const ICONS: Record<string, ToolIconKey> = {
  read: "read",
  edit: "edit",
  write: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  glob: "search",
  grep: "search",
  bash: "terminal",
  webfetch: "web",
  websearch: "web",
  task: "agent",
  todowrite: "todo",
};

// Claude reports tools as "Read", OpenCode as "read", so match on lower case.
export function toolIconKey(name: string): ToolIconKey {
  return ICONS[name.toLowerCase()] ?? "generic";
}
