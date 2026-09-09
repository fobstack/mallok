/**
 * The page runtime's platform-free core (`src/runtime/core`).
 *
 * Nothing here imports a Cloudflare type, a database or a template engine:
 * the core is routing, the page lifecycle, HTML assembly and cache semantics.
 * The adapter (`../cloudflare`), the template engine (`../liquid`) and the
 * island client (`../react`) are separate modules on purpose, so a consumer
 * pays for what it uses and the core stays testable in plain Node.
 */

export {
  type CookieVerdict,
  cacheControlFor,
  classifyCookies,
  forbidsSharedCaching,
  grantsSharedCaching,
  isCacheableRequest,
  isStorable,
  TAG_HEADER_MAX_BYTES,
  TAG_MAX_LENGTH,
  type TagValidation,
  validateTags,
} from './cache.js';
export { definePage, type PageDefinition } from './define.js';
export { escapeHtml, escapeJson, renderHead } from './head.js';
export {
  compareSpecificity,
  matchSegments,
  parsePattern,
  type RouteParams,
  type Segment,
  shapeKey,
  splitPath,
} from './route.js';
export {
  type LocalePrefix,
  type LocaleResolution,
  type RouteMatch,
  Router,
} from './router.js';
export { type HandleOptions, type PageResult, Runtime } from './runtime.js';
export type {
  CachePolicy,
  DocumentParts,
  DocumentRenderer,
  HeadDescriptor,
  IslandEntry,
  IslandUse,
  PageContext,
  PageData,
  PageModule,
  PageOutput,
  RenderResult,
  RouteEntry,
  RouteManifest,
} from './types.js';
