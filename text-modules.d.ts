/**
 * Type declarations for files that Wrangler bundles as text modules
 * (see the `rules` section in wrangler.jsonc).
 */
declare module '*.liquid' {
  const text: string;
  export default text;
}

declare module '*.css' {
  const text: string;
  export default text;
}

declare module '*.sql' {
  const text: string;
  export default text;
}

declare module '*.md' {
  const text: string;
  export default text;
}
