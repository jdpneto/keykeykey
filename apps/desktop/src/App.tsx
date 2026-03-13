import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { VaultProvider } from './lib/vault-context';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui/Toast';
import { StatusRouter } from './components/StatusRouter';
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

export function App() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<StatusRouter />} />
              <Route path="/setup" element={<SetupScreen />} />
              <Route path="/recovery" element={<RecoveryScreen />} />
              <Route path="/unlock" element={<UnlockScreen />} />
              <Route path="/vault" element={<AppShell />}>
                <Route index element={<VaultListScreen />} />
                <Route path="item/:id" element={<ItemDetailScreen />} />
                <Route path="add" element={<AddItemScreen />} />
                <Route path="edit/:id" element={<EditItemScreen />} />
                <Route path="generator" element={<GeneratorScreen />} />
                <Route path="settings" element={<SettingsScreen />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </VaultProvider>
    </ThemeProvider>
  );
}
