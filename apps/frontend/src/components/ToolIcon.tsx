import {
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Search,
  SquareTerminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ICON_STROKE } from "../constants";
import { toolIconKey, type ToolIconKey } from "../lib/tools";

const ICONS: Record<ToolIconKey, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  search: Search,
  terminal: SquareTerminal,
  web: Globe,
  agent: Workflow,
  todo: ListChecks,
  generic: Wrench,
};

export function ToolIcon({ name }: { name: string }) {
  const Icon = ICONS[toolIconKey(name)];
  return (
    <Icon
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
      className="size-3.5 shrink-0"
    />
  );
}
