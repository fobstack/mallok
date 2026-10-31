/** Admin entry point. */

import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { restore } from './state.js';
import { startThemeMode } from './theme-mode.js';
import './styles.css';

startThemeMode();

const root = document.getElementById('app');
if (root !== null) {
  createRoot(root).render(<App />);
}
void restore();
