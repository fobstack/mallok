/** Admin entry point. */

import { render } from 'preact';
import { App } from './app.js';
import { restore } from './state.js';
import './styles.css';

const root = document.getElementById('app');
if (root !== null) {
  render(<App />, root);
}
void restore();
