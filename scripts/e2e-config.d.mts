/**
 * Types for `e2e-config.mjs`, which is a plain ESM script on purpose: it runs
 * from `playwright.config.ts`'s `webServer` command before anything is
 * compiled, so it cannot be TypeScript.
 */
export declare const E2E_ENV: {
  readonly MALLOK_SETUP_KEY: string;
};

export declare function writeE2eConfig(
  outDir?: string,
  projectRoot?: string,
): Promise<{
  configPath: string;
  envPath: string;
  outDir: string;
}>;
