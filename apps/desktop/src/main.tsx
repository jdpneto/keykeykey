import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setArgon2Adapter } from '@keykeykey/core';
import { tauriArgon2Adapter } from './lib/tauri-argon2-adapter';
import { installFetchProxy } from './lib/fetch-proxy';
import { App } from './App';
import './styles/global.css';

setArgon2Adapter(tauriArgon2Adapter);
installFetchProxy();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
