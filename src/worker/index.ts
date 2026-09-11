/**
 * This repository's own Worker entry.
 *
 * It is deliberately the same four lines a generated project gets
 * (`template/src/worker/index.ts`): Mallok's own site is built with the
 * framework's public entry, so a change that breaks a generated shell breaks
 * this repository's tests first.
 */

import { atelier, createMallok, inquiry } from './framework.js';

export default createMallok({ theme: atelier, plugins: [inquiry] });
