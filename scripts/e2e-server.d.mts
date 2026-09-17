export declare class E2eLockError extends Error {}
export declare class E2eInterrupted extends Error {
  readonly signal: string;
}

export interface E2eLockOptions {
  readonly lockPath?: string;
  readonly pid?: number;
  readonly token?: string;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
  readonly afterQuarantine?: () => void | Promise<void>;
}

export declare function acquireE2eLock(
  path?: string,
  options?: E2eLockOptions,
): Promise<() => Promise<void>>;

export declare function withE2eLock<T>(
  task: () => T | Promise<T>,
  options?: E2eLockOptions,
): Promise<T>;

export interface E2eRunManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly lockToken: string;
  readonly runRoot: string;
  readonly sourceRoot: string;
  readonly configPath: string;
  readonly envPath: string;
  readonly statePath: string;
}

export declare function createE2eSourceSnapshot(
  sourceRoot: string,
  targetRoot: string,
  dependencies?: string,
): Promise<string>;

export declare function readE2eRunManifest(
  path?: string,
): Promise<E2eRunManifest>;

export declare function assertReusableE2eRun(options?: {
  readonly manifestPath?: string;
  readonly expectedLockPath?: string;
  readonly expectedRunsPath?: string;
  readonly isAlive?: (pid: number) => boolean;
}): Promise<E2eRunManifest>;

export interface ChildSupervisor {
  requestStop(signal: NodeJS.Signals): void;
  assertRunning(): void;
  run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string },
  ): Promise<void>;
}

export declare function createChildSupervisor(options?: {
  readonly cwd?: string;
  readonly stdio?: 'inherit' | 'ignore' | 'pipe';
}): ChildSupervisor;

export declare function runE2eServer(): Promise<void>;
