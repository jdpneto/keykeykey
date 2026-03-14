import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../lib/theme.js';
import { Popup } from './Popup.js';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  </StrictMode>,
);
