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
      <DialogContent className="max-w-xl p-0 overflow-hidden bg-background border-border">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <Key strokeWidth={ICON_STROKE} className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                AI Provider Authentication
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Manage credentials and authentication for available AI
                providers.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Provider Tabs / Selector */}
        <div className="flex border-b border-border bg-muted/30 px-6 gap-2">
          {providerDescriptors.map((p) => {
            const isSelected = p.id === selectedProviderId;
            const pAuth = providerAuth[p.id];
            const isAuth = pAuth?.isAuthenticated ?? false;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedProviderId(p.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  isSelected
                    ? "border-primary text-foreground bg-background/50"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    isAuth ? "bg-success" : "bg-warning"
                  }`}
                />
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Status Card */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={`size-2.5 rounded-full ${
                    isAuthenticated ? "bg-success" : "bg-warning"
                  }`}
                />
                <span className="text-sm font-medium">
                  {currentDescriptor?.name || selectedProviderId}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                    isAuthenticated
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning"
                  }`}
                >
                  {isAuthenticated ? "Authenticated" : "Not Signed In"}
                </span>
              </div>

              {isAuthenticated && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={authActionState.loading}
                  onClick={() => logoutProvider(selectedProviderId)}
                  className="h-7 text-xs gap-1.5"
                >
                  {authActionState.loading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <LogOut strokeWidth={ICON_STROKE} className="size-3" />
                  )}
                  Sign Out
                </Button>
              )}
            </div>

            {currentAuth?.details && (
              <p className="text-xs text-muted-foreground font-mono bg-muted/50 rounded-md p-2.5">
                {currentAuth.details}
              </p>
            )}

            {/* Sub-providers list if available (e.g. OpenCode connected providers) */}
            {currentAuth?.connectedSubProviders &&
              currentAuth.connectedSubProviders.length > 0 && (
                <div className="pt-2 border-t border-border/60">
                  <span className="text-xs text-muted-foreground block mb-1.5">
                    Connected Accounts / Providers:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {currentAuth.connectedSubProviders.map((sub) => (
                      <span
                        key={sub}
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-mono text-foreground border border-border"
                      >
                        {sub}
                        <button
                          type="button"
                          title={`Disconnect ${sub}`}
                          disabled={authActionState.loading}
                          onClick={() =>
                            logoutProvider(selectedProviderId, sub)
                          }
                          className="hover:text-destructive transition-colors ml-0.5"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>

          {/* Feedback banner */}
          {authActionState.message && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
              <CheckCircle2
                strokeWidth={ICON_STROKE}
                className="size-4 shrink-0"
              />
              <span>{authActionState.message}</span>
            </div>
          )}

          {authActionState.error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
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
                {isAuthenticated
                  ? "Update or Connect Credentials"
                  : "Sign In or Connect"}
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
                        onClick={() => setSelectedMethodId(method.id)}
                        className={`text-left p-3 rounded-lg border text-xs transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                            : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                      >
                        <div className="font-medium text-foreground">
                          {method.label}
                        </div>
                        {method.description && (
                          <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
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
                  {currentMethod.fields && currentMethod.fields.length > 0 ? (
                    <div className="space-y-3">
                      {currentMethod.fields.map((field) => (
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
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          />
                          {field.description && (
                            <p className="text-[11px] text-muted-foreground">
                              {field.description}
                            </p>
                          )}
                        </div>
                      ))}

                      <Button
                        type="submit"
                        disabled={authActionState.loading}
                        className="w-full h-8 text-xs font-medium gap-2"
                      >
                        {authActionState.loading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <ShieldCheck
                              strokeWidth={ICON_STROKE}
                              className="size-3.5"
                            />
                            Connect Credentials
                          </>
                        )}
                      </Button>
                    </div>
                  ) : currentMethod.type === "oauth" ? (
                    <div className="pt-1">
                      <Button
                        type="submit"
                        disabled={authActionState.loading}
                        className="w-full h-8 text-xs font-medium gap-2"
                      >
                        {authActionState.loading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Opening browser...
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
                      <p className="mt-2 text-center text-[11px] text-muted-foreground">
                        Clicking this will launch your browser to complete
                        authentication.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground">
                      {currentMethod.description || "No credentials required."}
                    </div>
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
