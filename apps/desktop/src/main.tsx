import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setArgon2Adapter } from '@keykeykey/core';
import { tauriArgon2Adapter } from './lib/tauri-argon2-adapter';
import { installFetchProxy } from './lib/fetch-proxy';
import { installDevTauriMock, devArgon2Adapter } from './lib/dev-tauri-mock';
import { App } from './App';
import './styles/global.css';

// In dev mode without a Tauri runtime (plain browser / Playwright), install
// the localStorage-backed IPC mock before any invoke fires. Also use the fast
// dev argon2 adapter (t=1, m=64) so vault creation completes quickly in a
// browser tab — the production m=19456 preset takes 10-30 s in pure-JS.
// Dead-code-eliminated in production builds via import.meta.env.DEV.
const devMockActive = installDevTauriMock();
setArgon2Adapter(devMockActive ? devArgon2Adapter : tauriArgon2Adapter);

installFetchProxy();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
