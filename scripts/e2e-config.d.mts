/**
 * Types for `e2e-config.mjs`, which is a plain ESM script on purpose: it runs
 * from `playwright.config.ts`'s `webServer` command before anything is
 * compiled, so it cannot be TypeScript.
 */
export declare const E2E_ENV: {
  readonly MALLOK_SECRET: string;
  readonly MALLOK_SETUP_KEY: string;
  readonly MALLOK_DEV_VARS_CANARY: string;
};

export declare function writeE2eConfig(): Promise<{
  configPath: string;
  envPath: string;
  outDir: string;
}>;
