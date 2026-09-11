/**
 * Refuses `npm publish` from the repository root.
 *
 * There are two `package.json` files that look publishable — this one and the
 * generated `dist/pkg/package.json` — and only the second is the product.
 * Publishing from here would push the entire repository to npm under the name
 * `mallok`: source, tests, docs and all.
 *
 * `"private": true` already blocks a real publish, but `npm publish --dry-run`
 * skips that check, so the safe-looking rehearsal succeeds and the mistake is
 * only caught by the real thing. This runs in both.
 */
console.error(
  [
    '',
    'Refusing to publish from the repository root.',
    '',
    'The published package is the framework, built from this repository:',
    '',
    '  pnpm release:pack          # builds dist/pkg and packs it',
    '  cd dist/pkg && npm publish',
    '',
    'See docs/RELEASE_GATE.md §3.',
    '',
  ].join('\n'),
);
process.exit(1);
