import type { AuthMethodDescriptor } from "commons/types";

export type MethodKind = "fields" | "oauth" | "direct";

// The modal renders a different control for each kind. `direct` is a method
// that needs nothing from the user, only a click.
export function methodKind(method: AuthMethodDescriptor): MethodKind {
  if (method.fields && method.fields.length > 0) {
    return "fields";
  }
  return method.type === "oauth" ? "oauth" : "direct";
}
