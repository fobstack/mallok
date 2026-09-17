export interface PackMetadata {
  readonly filename: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly integrity: string;
  readonly shasum: string;
}

export declare function parsePackMetadata(
  stdout: string,
  expectedFile: string,
  actualSize: number,
): PackMetadata;
