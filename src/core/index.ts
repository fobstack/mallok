/**
 * Public surface of `src/core`: the rendering pipeline and content model
 * shared by the Worker, the CLI and the admin preview.
 *
 * Nothing in this directory may import Cloudflare or Node-only APIs.
 */

export {
  type AssetMap,
  buildFileUrls,
  buildImageViews,
  type ImageView,
  mediaUrl,
  normalizeRelativePath,
  type ResolvedAsset,
  variantUrl,
} from './assets.js';
export {
  type BundleIdentity,
  type BundleStatus,
  bundleFileName,
  collectAssetPaths,
  deriveFrontmatter,
  detectLayout,
  formatBundleIdentity,
  type ImportLayout,
  localeFromFileName,
  parseBundleIdentity,
  resolveStatus,
} from './bundle.js';
export { LOCALE_OPTIONS_KEY } from './constants.js';
export { exportPathKey, exportPathProblem } from './export-path.js';
export {
  type BeforeRenderHook,
  computeFragmentCacheKey,
  type FragmentInput,
  type FragmentMeta,
  type HeadingInfo,
  PIPELINE_VERSION,
  type RenderedFragment,
  renderFragment,
} from './fragment.js';
export {
  FrontmatterError,
  joinFrontmatter,
  parseFrontmatter,
  type SplitDocument,
  splitFrontmatter,
} from './frontmatter.js';
export { sha256Hex, sha256HexOfBytes, stableStringify, toHex } from './hash.js';
export {
  type CompiledTheme,
  compileTheme,
  escapeHtml,
  renderTextTemplate,
  SafeHtml,
} from './liquid.js';
export {
  ACCEPTED_TYPES,
  DEFAULT_VARIANT_WIDTHS,
  findType,
  type ImageSize,
  type MediaKind,
  type MediaType,
  mediaObjectKey,
  planVariants,
  readImageSize,
  sniffMediaType,
  themeAssetKey,
  variantObjectKey,
} from './media.js';
export {
  type AlternateView,
  type ContentSummaryView,
  type ContentView,
  type FaqPairView,
  type ListView,
  type NavItemView,
  type PageMetaView,
  type PageView,
  type RelationsView,
  renderPage,
  type SiteView,
  type ThemeView,
} from './page.js';
export {
  buildHomePath,
  buildPublicPath,
  LOCALE_PATTERN,
  type ParsedPath,
  type PublicPathInput,
  parsePublicPath,
  slugify,
} from './paths.js';
export {
  PLUGIN_API_VERSION,
  PLUGIN_HOOKS,
  type PluginHookName,
  type PluginManifest,
  parsePluginManifest,
  pluginManifestSchema,
  settingsValidator,
} from './plugin.js';
export {
  buildFeed,
  buildRobots,
  buildSitemap,
  buildSitemapIndex,
  type FeedInput,
  type FeedItem,
  type RobotsInput,
  type SitemapEntry,
} from './seo.js';
export {
  parseThemeManifest,
  THEME_API_VERSION,
  THEME_FIELD_TYPES,
  type ThemeField,
  type ThemeFieldType,
  type ThemeFiles,
  type ThemeManifest,
  themeFieldSchema,
  themeLanguageNames,
  themeManifestSchema,
  themeStrings,
} from './theme.js';
export {
  readThemePackage,
  THEME_ASSET_TYPES,
  type ThemePackage,
  ThemePackageError,
  type ThemeSourceFile,
} from './theme-package.js';
export {
  buildContentPageView,
  buildHeadTags,
  buildHomePageView,
  buildListPageView,
  buildRelationsView,
  buildSiteView,
  buildSummaryView,
  buildThemeView,
  type ContentInput,
  type FaqPair,
  type FragmentInputView,
  faqPairs,
  type ListInput,
  type NavEntry,
  type RelationsInput,
  type SiteConfig,
  type SummaryInput,
  themeAssetBase,
  type ViewContext,
} from './view.js';
