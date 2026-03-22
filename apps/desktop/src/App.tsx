import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { VaultProvider } from './lib/vault-context';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui/Toast';
import { StatusRouter } from './components/StatusRouter';
import { NavigationGuard } from './components/NavigationGuard';
import { AppShell } from './components/AppShell';
import { SetupScreen } from './screens/SetupScreen';
import { RecoveryScreen } from './screens/RecoveryScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VaultListScreen } from './screens/VaultListScreen';
import { AddItemScreen } from './screens/AddItemScreen';
import { ItemDetailScreen } from './screens/ItemDetailScreen';
import { EditItemScreen } from './screens/EditItemScreen';
import { GeneratorScreen } from './screens/GeneratorScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SyncSettingsScreen } from './screens/SyncSettingsScreen';
import { RestoreScreen } from './screens/RestoreScreen';
import { ImportScreen } from './screens/ImportScreen';
import { ExportScreen } from './screens/ExportScreen';

export function App() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <ToastProvider>
          <BrowserRouter>
            <NavigationGuard />
            <Routes>
              <Route path="/" element={<StatusRouter />} />
              <Route path="/setup" element={<SetupScreen />} />
              <Route path="/restore" element={<RestoreScreen />} />
              <Route path="/recovery" element={<RecoveryScreen />} />
              <Route path="/unlock" element={<UnlockScreen />} />
              <Route path="/vault" element={<AppShell />}>
                <Route index element={<VaultListScreen />} />
                <Route path="item/:id" element={<ItemDetailScreen />} />
                <Route path="add" element={<AddItemScreen />} />
                <Route path="edit/:id" element={<EditItemScreen />} />
                <Route path="generator" element={<GeneratorScreen />} />
                <Route path="settings" element={<SettingsScreen />} />
                <Route path="settings/sync" element={<SyncSettingsScreen />} />
                <Route path="settings/import" element={<ImportScreen />} />
                <Route path="settings/export" element={<ExportScreen />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </VaultProvider>
    </ThemeProvider>
  );
}
