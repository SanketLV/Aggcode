export function ConnectingShell() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="flex w-72 shrink-0 flex-col border-r border-border bg-card"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-3.5">
          <div className="size-6.5 rounded-md bg-muted" />
          <div className="h-3 w-20 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
        </div>
        <div className="space-y-2 p-2 pt-4">
          <div className="h-9 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-9 w-4/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-9 w-3/5 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <div className="h-14 border-b border-border" />
        <div className="flex flex-1 items-center justify-center">
          <p role="status" className="text-ui text-muted-foreground">
            Connecting to the server…
          </p>
        </div>
      </div>
    </div>
  );
}
