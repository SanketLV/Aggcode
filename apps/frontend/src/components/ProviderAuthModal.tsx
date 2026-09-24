import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Key,
  Loader2,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
import { ICON_STROKE } from "../constants";
import { useApp } from "../context/AppContext";
import { methodKind } from "../lib/authMethod";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function ProviderAuthModal() {
  const {
    providers,
    providerAuth,
    providerDescriptors,
    authModalOpen,
    setAuthModalOpen,
    authModalProviderId,
    authActionState,
    loginProvider,
    logoutProvider,
    refreshProviderAuth,
  } = useApp();

  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [selectedMethodId, setSelectedMethodId] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const wasOpenRef = useRef(false);
  const requestedProviderRef = useRef<string | null>(null);

  // Sync selected provider only once per modal opening / target change.
  // The old effect reran whenever providerDescriptors/providers refreshed,
  // which overwrote the user's tab choice (e.g. OpenCode -> back to Claude).
  useEffect(() => {
    if (!authModalOpen) {
      wasOpenRef.current = false;
      requestedProviderRef.current = null;
      return;
    }

    const targetChanged =
      requestedProviderRef.current !== (authModalProviderId ?? null);

    if (!wasOpenRef.current || targetChanged) {
      const initialId =
        authModalProviderId ||
        providers[0]?.id ||
        providerDescriptors[0]?.id ||
        "claude";
      setSelectedProviderId(initialId);
      requestedProviderRef.current = authModalProviderId ?? null;
      wasOpenRef.current = true;
      refreshProviderAuth();
    }
  }, [authModalOpen, authModalProviderId, providers, providerDescriptors]);

  const currentDescriptor = providerDescriptors.find(
    (d) => d.id === selectedProviderId,
  );
  const currentAuth = providerAuth[selectedProviderId];
  const authMethods = currentDescriptor?.authMethods || [];

  // Set default method when switching provider
  useEffect(() => {
    if (authMethods.length > 0) {
      setSelectedMethodId(authMethods[0]?.id || "");
      setFormValues({});
    }
  }, [selectedProviderId, authMethods.length]);

  const currentMethod = authMethods.find((m) => m.id === selectedMethodId);
  const currentKind = currentMethod ? methodKind(currentMethod) : undefined;

  const handleInputChange = (fieldId: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId || !selectedMethodId) return;
    loginProvider(selectedProviderId, selectedMethodId, formValues);
  };

  const isAuthenticated = currentAuth?.isAuthenticated ?? false;

  return (
    <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg border border-border-strong bg-muted text-muted-foreground">
              <Key strokeWidth={ICON_STROKE} className="size-4" />
            </div>
            <div>
              <DialogTitle>Providers</DialogTitle>
              <DialogDescription className="text-xs">
                Sign in to the AI providers that run your sessions.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Provider Tabs / Selector */}
        <div
          role="tablist"
          aria-label="Providers"
          className="flex gap-1 border-b border-border px-4"
        >
          {providerDescriptors.map((p) => {
            const isSelected = p.id === selectedProviderId;
            const pAuth = providerAuth[p.id];
            const isAuth = pAuth?.isAuthenticated ?? false;

            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedProviderId(p.id)}
                className={`focus-ring -mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors motion-reduce:transition-none ${
                  isSelected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    isAuth ? "bg-success" : "bg-warning"
                  }`}
                />
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
          {/* Status Card */}
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-ui font-medium">
                  {currentDescriptor?.name || selectedProviderId}
                </span>
                <span
                  className={`inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-micro font-medium ${
                    isAuthenticated
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-warning/25 bg-warning/10 text-warning"
                  }`}
                >
                  {isAuthenticated ? (
                    <CheckCircle2
                      strokeWidth={2}
                      aria-hidden="true"
                      className="size-3"
                    />
                  ) : (
                    <AlertCircle
                      strokeWidth={2}
                      aria-hidden="true"
                      className="size-3"
                    />
                  )}
                  {isAuthenticated ? "Signed in" : "Not signed in"}
                </span>
              </div>

              {isAuthenticated && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={authActionState.loading}
                  onClick={() => logoutProvider(selectedProviderId)}
                  className="gap-1.5"
                >
                  {authActionState.loading ? (
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <LogOut strokeWidth={ICON_STROKE} className="size-3" />
                  )}
                  Sign out
                </Button>
              )}
            </div>

            {currentAuth?.details && (
              <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
                {currentAuth.details}
              </p>
            )}

            {/* Sub-providers list if available (e.g. OpenCode connected providers) */}
            {currentAuth?.connectedSubProviders &&
              currentAuth.connectedSubProviders.length > 0 && (
                <div className="border-t border-border pt-3">
                  <span className="mb-1.5 block text-xs text-muted-foreground">
                    Connected accounts
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {currentAuth.connectedSubProviders.map((sub) => (
                      <span
                        key={sub}
                        className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-muted pr-0.5 pl-2 font-mono text-micro text-foreground"
                      >
                        {sub}
                        <button
                          type="button"
                          aria-label={`Disconnect ${sub}`}
                          title={`Disconnect ${sub}`}
                          disabled={authActionState.loading}
                          onClick={() =>
                            logoutProvider(selectedProviderId, sub)
                          }
                          className="focus-ring flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/12 hover:text-destructive disabled:opacity-50 motion-reduce:transition-none"
                        >
                          <X strokeWidth={ICON_STROKE} className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>

          {/* Feedback banner */}
          {authActionState.message && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/10 p-3 text-xs text-success"
            >
              <CheckCircle2
                strokeWidth={ICON_STROKE}
                className="size-4 shrink-0"
              />
              <span>{authActionState.message}</span>
            </div>
          )}

          {authActionState.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/8 p-3 text-xs text-destructive"
            >
              <AlertCircle
                strokeWidth={ICON_STROKE}
                className="size-4 shrink-0"
              />
              <span>{authActionState.error}</span>
            </div>
          )}

          {/* Authentication Options / Forms */}
          {authMethods.length > 0 && (
            <div className="space-y-4">
              <div className="text-xs font-medium text-foreground">
                {isAuthenticated ? "Change sign-in" : "Sign in"}
              </div>

              {/* Method Picker if multiple */}
              {authMethods.length > 1 && (
                <div className="grid grid-cols-2 gap-2">
                  {authMethods.map((method) => {
                    const isSelected = method.id === selectedMethodId;
                    return (
                      <button
                        key={method.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedMethodId(method.id)}
                        className={`focus-ring rounded-md border p-3 text-left text-xs transition-colors motion-reduce:transition-none ${
                          isSelected
                            ? "border-primary/60 bg-accent text-foreground"
                            : "border-border bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        }`}
                      >
                        <div className="font-medium text-foreground">
                          {method.label}
                        </div>
                        {method.description && (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {method.description}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Method Form */}
              {currentMethod && (
                <form onSubmit={handleSubmit} className="space-y-3.5">
                  {currentMethod.description && authMethods.length === 1 && (
                    <p className="text-xs text-muted-foreground">
                      {currentMethod.description}
                    </p>
                  )}

                  {/* Render fields dynamically */}
                  {currentKind === "fields" ? (
                    <div className="space-y-3">
                      {(currentMethod.fields ?? []).map((field) => (
                        <div key={field.id} className="space-y-1">
                          <label
                            htmlFor={`field-${field.id}`}
                            className="block text-xs font-medium text-foreground"
                          >
                            {field.label}
                            {field.required && (
                              <span className="text-destructive ml-0.5">*</span>
                            )}
                          </label>
                          <input
                            id={`field-${field.id}`}
                            type={
                              field.type === "password" ? "password" : "text"
                            }
                            placeholder={field.placeholder}
                            value={formValues[field.id] || ""}
                            onChange={(e) =>
                              handleInputChange(field.id, e.target.value)
                            }
                            required={field.required}
                            className="focus-ring h-8 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground placeholder:text-subtle-foreground"
                          />
                          {field.description && (
                            <p className="text-xs text-muted-foreground">
                              {field.description}
                            </p>
                          )}
                        </div>
                      ))}

                      <Button
                        type="submit"
                        disabled={authActionState.loading}
                        className="w-full gap-2"
                      >
                        {authActionState.loading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                            Connecting…
                          </>
                        ) : (
                          <>
                            <ShieldCheck
                              strokeWidth={ICON_STROKE}
                              className="size-3.5"
                            />
                            Connect
                          </>
                        )}
                      </Button>
                    </div>
                  ) : currentKind === "oauth" ? (
                    <div className="pt-1">
                      <Button
                        type="submit"
                        disabled={authActionState.loading}
                        className="w-full gap-2"
                      >
                        {authActionState.loading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                            Opening browser…
                          </>
                        ) : (
                          <>
                            <ExternalLink
                              strokeWidth={ICON_STROKE}
                              className="size-3.5"
                            />
                            {currentMethod.label}
                          </>
                        )}
                      </Button>
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        Your browser opens to finish signing in.
                      </p>
                    </div>
                  ) : (
                    <Button
                      type="submit"
                      disabled={authActionState.loading}
                      className="w-full gap-2"
                    >
                      {authActionState.loading ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                          Connecting…
                        </>
                      ) : (
                        <>
                          <ShieldCheck
                            strokeWidth={ICON_STROKE}
                            className="size-3.5"
                          />
                          Connect
                        </>
                      )}
                    </Button>
                  )}
                </form>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
