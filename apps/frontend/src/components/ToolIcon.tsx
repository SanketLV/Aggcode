import { ChevronRight, FilePen, FileText, Search, Wrench } from "lucide-react";
import { ICON_STROKE } from "../constants";

export function ToolIcon({ name }: { name: string }) {
  const Icon =
    name === "Read"
      ? FileText
      : name === "Edit"
        ? FilePen
        : name === "Glob"
          ? Search
          : Wrench;
  return <Icon strokeWidth={ICON_STROKE} className="size-3.5 shrink-0" />;
}
