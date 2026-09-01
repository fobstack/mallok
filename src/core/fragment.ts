/**
 * Stage one of the rendering pipeline: Markdown → sanitized HTML fragment.
 *
 * The fragment is independent of the active theme, so it is computed when
 * content is saved and cached in D1 (`render_cache`). The visitor request
 * path normally only runs stage two (see `page.ts`).
 *
 * Hard rules (docs/ARCHITECTURE.md §5):
 *  - content is untrusted, so the output passes an allow-list sanitizer;
 *  - the function is deterministic: same inputs, byte-identical output;
 *  - nothing here may touch the Workers runtime.
 */

import type { Root as HastRoot } from 'hast';
import { toString as hastToString } from 'hast-util-to-string';
import type { Root as MdastRoot } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { type AssetMap, rehypeResolveAssets } from './assets.js';
import { sha256Hex, stableStringify } from './hash.js';

/** Bump whenever the pipeline output may change for identical input. */
export const PIPELINE_VERSION = '1';

/** A `beforeRender` plugin hook. Must be a pure function of its arguments. */
export type BeforeRenderHook = (
  tree: MdastRoot,
  context: BeforeRenderContext,
) => void | Promise<void>;

/** Data available to `beforeRender` hooks. */
export interface BeforeRenderContext {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** The declaring plugin's settings; absent outside a plugin hook. */
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** Inputs of {@link renderFragment}. */
export interface FragmentInput {
  /** Markdown body, without the front matter block. */
  readonly body: string;
  /** Parsed front matter, exposed to hooks. */
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** Resolved media for the relative paths this content references. */
  readonly assets: AssetMap;
  /** Origin of the media host; empty for the Worker proxy. */
  readonly mediaBaseUrl: string;
  readonly hooks?: readonly BeforeRenderHook[];
  /**
   * Opaque identifier of the enabled plugin set and their settings. Part of
   * the cache key because hooks may change the output.
   */
  readonly pluginHash?: string;
}

/** One heading in the rendered document. */
export interface HeadingInfo {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
}

/** Derived metadata that travels with the fragment. */
export interface FragmentMeta {
  readonly headings: readonly HeadingInfo[];
  /** Plain-text excerpt taken from the first paragraph, at most 200 chars. */
  readonly excerpt: string;
  readonly readingTimeMinutes: number;
  /** Relative asset paths referenced by the body, in document order. */
  readonly refs: readonly string[];
  /** Referenced paths with no matching asset. */
  readonly missing: readonly string[];
}

/** Output of {@link renderFragment}. */
export interface RenderedFragment {
  /** Sanitized HTML with asset references resolved. */
  readonly html: string;
  readonly meta: FragmentMeta;
  /** Cache key covering every input that influences `html` and `meta`. */
  readonly cacheKey: string;
}

const EXCERPT_LENGTH = 200;
const WORDS_PER_MINUTE = 200;
const CJK_CHARS_PER_MINUTE = 400;
// Hiragana/Katakana, CJK Extension A, CJK Unified, Compatibility, Hangul.
const CJK_PATTERN =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * The sanitizer allow-list. It extends the GitHub-style default schema with
 * the attributes the asset resolver adds to images.
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'srcSet',
      'sizes',
      'width',
      'height',
      'loading',
      'decoding',
    ],
  },
};

/** Renders a Markdown body to a sanitized HTML fragment plus metadata. */
export async function renderFragment(
  input: FragmentInput,
): Promise<RenderedFragment> {
  const report = { refs: [] as string[], missing: [] as string[] };
  const headings: HeadingInfo[] = [];
  let excerpt = '';
  let readingTimeMinutes = 1;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(() => async (tree: MdastRoot) => {
      for (const hook of input.hooks ?? []) {
        await hook(tree, { frontmatter: input.frontmatter });
      }
      excerpt = extractExcerpt(tree);
      readingTimeMinutes = estimateReadingTime(mdastToString(tree));
    })
    .use(remarkRehype)
    .use(rehypeSanitize, sanitizeSchema)
    .use(() => (tree: HastRoot) => {
      collectHeadings(tree, headings);
    })
    .use(() =>
      rehypeResolveAssets(
        { assets: input.assets, mediaBaseUrl: input.mediaBaseUrl },
        report,
      ),
    )
    .use(rehypeStringify);

  const file = await processor.process(input.body);
  const html = String(file);
  const meta: FragmentMeta = {
    headings,
    excerpt,
    readingTimeMinutes,
    refs: report.refs,
    missing: report.missing,
  };
  const cacheKey = await computeFragmentCacheKey(input);
  return { html, meta, cacheKey };
}

/**
 * Computes the `render_cache` key for the given input. Anything that can
 * change the fragment must be part of it.
 */
export async function computeFragmentCacheKey(
  input: Pick<
    FragmentInput,
    'body' | 'frontmatter' | 'assets' | 'mediaBaseUrl' | 'pluginHash'
  >,
): Promise<string> {
  const bodyHash = await sha256Hex(input.body);
  return sha256Hex(
    stableStringify({
      pipeline: PIPELINE_VERSION,
      body: bodyHash,
      frontmatter: input.frontmatter,
      assets: input.assets,
      mediaBaseUrl: input.mediaBaseUrl,
      plugins: input.pluginHash ?? '',
    }),
  );
}

function extractExcerpt(tree: MdastRoot): string {
  for (const node of tree.children) {
    if (node.type === 'paragraph') {
      const text = mdastToString(node).replace(/\s+/g, ' ').trim();
      if (text !== '') {
        return text.length > EXCERPT_LENGTH
          ? `${text.slice(0, EXCERPT_LENGTH - 1)}…`
          : text;
      }
    }
  }
  return '';
}

function estimateReadingTime(text: string): number {
  const cjkChars = text.match(CJK_PATTERN)?.length ?? 0;
  const latinText = text.replace(CJK_PATTERN, ' ');
  const words = latinText.match(WORD_PATTERN)?.length ?? 0;
  const minutes = words / WORDS_PER_MINUTE + cjkChars / CJK_CHARS_PER_MINUTE;
  return Math.max(1, Math.ceil(minutes));
}

function collectHeadings(tree: HastRoot, out: HeadingInfo[]): void {
  visit(tree, 'element', (node) => {
    const match = /^h([1-6])$/.exec(node.tagName);
    if (match === null) {
      return;
    }
    const depth = Number(match[1]) as HeadingInfo['depth'];
    out.push({ depth, text: hastToString(node).trim() });
  });
}
