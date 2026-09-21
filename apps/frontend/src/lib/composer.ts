export function composerPlaceholder({
  signedIn,
  working,
  providerName,
}: {
  signedIn: boolean;
  working: boolean;
  providerName: string;
}): string {
  if (!signedIn) {
    return `Sign in to ${providerName} to chat`;
  }
  return working ? "Waiting for the agent" : "Send a message";
}
