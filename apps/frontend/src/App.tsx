import "./index.css";
import "streamdown/styles.css";
import { AppProvider } from "./context/AppContext";
import { useApp } from "./context/AppContext";
import { ConnectingShell } from "./components/ConnectingShell";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { ProviderAuthModal } from "./components/ProviderAuthModal";

function AppLayout() {
  const { loading } = useApp();

  if (loading) {
    return <ConnectingShell />;
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar />
      <ChatPane />
      <ProviderAuthModal />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
