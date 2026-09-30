export interface ThemeAssets {
  readonly version: string;
  readonly assets: Readonly<Record<string, string>>;
}

export type ThemeAssetRecord = Readonly<Record<string, ThemeAssets>>;

export declare const THEMES_DIR: string;
export declare const RECORD_PATH: string;

export declare function fingerprintThemes(
  themesDir?: string,
): Promise<Record<string, ThemeAssets>>;

export declare function compareThemeAssets(
  record: ThemeAssetRecord,
  current: ThemeAssetRecord,
): string[];

export declare function recordThemeAssets(
  record: ThemeAssetRecord,
  current: ThemeAssetRecord,
): {
  readonly record: Record<string, ThemeAssets>;
  readonly refused: string[];
};
