export function composerPlaceholder({
  signedIn,
  working,
  providerName,
  workspaceName,
}: {
  signedIn: boolean;
  working: boolean;
  providerName: string;
  workspaceName: string;
}): string {
  if (!signedIn) {
    return `Sign in to ${providerName} to start chatting`;
  }
  if (working) {
    return `${providerName} is working on this session…`;
  }
  return `Ask ${providerName} to change something in ${workspaceName}…`;
}

export type ComposerHint = { text: string; tone: "muted" | "warning" };

// The line under the composer says exactly one thing: the reason sending is
// blocked, most blocking first, or the keyboard hint when nothing is.
export function composerHint({
  online,
  signedIn,
  working,
  providerName,
  authDetails,
}: {
  online: boolean;
  signedIn: boolean;
  working: boolean;
  providerName: string;
  authDetails: string | undefined;
}): ComposerHint {
  if (!online) {
    return {
      text: "Disconnected from the server, so messages can't be saved.",
      tone: "muted",
    };
  }
  if (!signedIn) {
    return {
      text:
        authDetails ||
        `Not signed in to ${providerName}. Sign in to send messages.`,
      tone: "warning",
    };
  }
  if (working) {
    return { text: "One turn at a time per session.", tone: "muted" };
  }
  return { text: "Enter to send · Shift+Enter for a new line", tone: "muted" };
}
