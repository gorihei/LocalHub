import "./theme.css";
import AppShell from "./shell/AppShell";
import { SettingsProvider } from "./settings/SettingsContext";
import { NotificationProvider } from "./notifications/NotificationContext";
import UpdateChecker from "./updates/UpdateChecker";

function App() {
  return (
    <SettingsProvider>
      <NotificationProvider>
        <UpdateChecker />
        <AppShell />
      </NotificationProvider>
    </SettingsProvider>
  );
}

export default App;
