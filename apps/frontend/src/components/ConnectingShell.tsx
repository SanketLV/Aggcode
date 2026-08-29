export function ConnectingShell() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="w-72 shrink-0 border-r border-border bg-card p-4">
        <div className="h-4 w-20 rounded-md bg-muted" />
        <div className="mt-6 space-y-2">
          <div className="h-9 rounded-md bg-muted" />
          <div className="h-9 w-4/5 rounded-md bg-muted" />
          <div className="h-9 w-3/5 rounded-md bg-muted" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Connecting to the server
        </p>
      </div>
    </div>
  );
}
