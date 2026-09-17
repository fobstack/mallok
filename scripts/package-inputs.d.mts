export declare const TEMPLATE_FILES: readonly string[];

export declare function resetCompiledAssets(path?: string): Promise<void>;

export declare function stageTemplate(
  source: string,
  destination: string,
): Promise<void>;
