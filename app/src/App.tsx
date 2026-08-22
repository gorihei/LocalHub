import "./theme.css";
import AppShell from "./shell/AppShell";
import { SettingsProvider } from "./settings/SettingsContext";
import { NotificationProvider } from "./notifications/NotificationContext";

function App() {
  return (
    <SettingsProvider>
      <NotificationProvider>
        <AppShell />
      </NotificationProvider>
    </SettingsProvider>
  );
}

export default App;
