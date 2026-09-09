/**
 * The restricted Liquid engine (`src/runtime/liquid`).
 *
 * Generalised from Mallok's `src/core/liquid.ts`, which had already settled
 * the parts that matter and had been in production use. The rules it encodes:
 *
 * - **Templates are an in-memory map, not files.** A Worker has no file
 *   system, and this is also what makes `{% layout %}` and `{% render %}`
 *   resolve at all — liquidjs looks names up in `templates`, so a hand-rolled
 *   lookup outside the engine breaks partials with `ENOENT`.
 * - **Every `{{ output }}` is escaped** unless it is a {@link SafeHtml} the
 *   product itself produced. The built-in `raw` filter is replaced, so a
 *   template cannot launder untrusted data through `| raw`.
 * - **Themes are half-trusted**: they emit HTML, they do not run code, read
 *   files or reach the network. `strictFilters`, `ownPropertyOnly` and
 *   `jsTruthy: false` keep templates from reaching past their data.
 * - **Output is deterministic**: a fixed timezone and locale, so the same
 *   input renders the same bytes and can be cached and compared.
 */

import type { FilterImplOptions, Token } from 'liquidjs';
import { evalToken, Hash, Liquid, type Template } from 'liquidjs';

/** HTML the product has already sanitised or generated; output as-is. */
export class SafeHtml {
  constructor(readonly html: string) {}

  toString(): string {
    return this.html;
  }
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** The engine's output filter: `SafeHtml` passes through, everything escapes. */
export function escapeOutput(value: unknown): string {
  if (value instanceof SafeHtml) {
    return value.html;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return escapeHtml(String(value));
}

export interface LiquidRendererOptions {
  /** Templates by name, e.g. `{ 'layouts/page.liquid': '…' }`. */
  readonly templates: Readonly<Record<string, string>>;
  /** Extension `{% render %}` and `{% layout %}` may omit. Default `.liquid`. */
  readonly extname?: string;
  /** Extra filters. `raw` is reserved and cannot be replaced. */
  readonly filters?: Readonly<Record<string, FilterImplOptions>>;
  /** Parser and memory ceilings, so a hostile template cannot hang a Worker. */
  readonly parseLimit?: number;
  readonly memoryLimit?: number;
}

/** Renders named Liquid templates with a shared parse cache. */
export class LiquidRenderer {
  private readonly engine: Liquid;
  private readonly templates: Readonly<Record<string, string>>;
  private readonly parsed = new Map<string, Template[]>();

  constructor(options: LiquidRendererOptions) {
    this.templates = options.templates;
    this.engine = new Liquid({
      // Passing the map to the engine is what lets `{% layout %}` and
      // `{% render %}` resolve names without a file system.
      templates: { ...options.templates },
      extname: options.extname ?? '.liquid',
      cache: true,
      strictFilters: true,
      strictVariables: false,
      ownPropertyOnly: true,
      jsTruthy: false,
      // Fixed timezone and locale keep `date` deterministic, so the same
      // input renders the same bytes and caching stays meaningful.
      timezoneOffset: 0,
      locale: 'en-US',
      outputEscape: escapeOutput,
      parseLimit: options.parseLimit ?? 1e6,
      memoryLimit: options.memoryLimit ?? 5e7,
    });
    // The built-in `raw` would bypass escaping for any value; this one only
    // lets `SafeHtml` through, so `{{ userInput | raw }}` is still escaped.
    this.engine.registerFilter('raw', { raw: true, handler: escapeOutput });
    for (const [name, filter] of Object.entries(options.filters ?? {})) {
      if (name === 'raw') {
        throw new Error('The "raw" filter is reserved and cannot be replaced.');
      }
      this.engine.registerFilter(name, filter);
    }
    this.registerIslandTag();
  }

  /**
   * Renders one template.
   *
   * The view is passed as both scope and globals, so a `{% render %}` partial
   * can read the same data the page did without every call site threading it
   * through by hand.
   */
  async render(name: string, view: Record<string, unknown>): Promise<string> {
    const output: unknown = await this.engine.render(this.parse(name), view, {
      globals: view,
    });
    return String(output);
  }

  private parse(name: string): Template[] {
    const cached = this.parsed.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const source = this.templates[name];
    if (source === undefined) {
      throw new Error(`No template named "${name}".`);
    }
    const compiled = this.engine.parse(source, name);
    this.parsed.set(name, compiled);
    return compiled;
  }

  /**
   * `{% island "cart", sku: product.sku %}` — the marker the core scans for
   * when deciding which scripts a page needs, plus the props it mounts with.
   *
   * The name is a Liquid value and the props are Liquid's own hash syntax,
   * read through `evalToken` and `Hash`. Handing the raw argument text to an
   * expression evaluator does not work: Liquid expressions are not
   * JavaScript, and `{ "sku": sku }` there evaluates to nothing at all.
   *
   * Nothing else in a template can pull in JavaScript, which is what keeps
   * "this page ships no JS" a property you can check rather than hope for.
   */
  private registerIslandTag(): void {
    // liquidjs calls `parse` and `render` on the same tag instance, so the
    // parsed pieces are stashed on it between the two. Optional *and*
    // explicitly `| undefined`: the first lets the cast from liquidjs's own
    // `Tag` succeed, the second satisfies `exactOptionalPropertyTypes`.
    interface IslandTag {
      islandName?: Token | undefined;
      islandProps?: Hash | undefined;
    }
    this.engine.registerTag('island', {
      parse(token) {
        const tag = this as IslandTag;
        tag.islandName = token.tokenizer.readValue();
        tag.islandProps = new Hash(token.tokenizer.remaining());
      },
      *render(context) {
        const tag = this as IslandTag;
        const name =
          tag.islandName === undefined
            ? ''
            : ((yield evalToken(tag.islandName, context)) as unknown);
        const hash =
          tag.islandProps === undefined
            ? {}
            : ((yield tag.islandProps.render(context)) as Record<
                string,
                unknown
              >);
        // `strategy` tells the client *when* to mount; it is not data the
        // component renders, so it is taken out before the rest becomes props.
        const { strategy, ...props } = hash;
        return islandMarkup(String(name ?? ''), props, strategyOf(strategy));
      },
    });
  }
}

/** An island name has to be safe in an attribute and in an element id. */
const ISLAND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** When the client should mount an island. Mirrors `HydrationStrategy`. */
const STRATEGIES = ['eager', 'idle', 'visible'] as const;

export type IslandStrategy = (typeof STRATEGIES)[number];

/** Validates the `strategy:` parameter, which is a tag argument, not a prop. */
function strategyOf(value: unknown): IslandStrategy | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const name = String(value);
  if (!(STRATEGIES as readonly string[]).includes(name)) {
    throw new Error(
      `Island strategy "${name}" is not one of ${STRATEGIES.join(', ')}.`,
    );
  }
  return name as IslandStrategy;
}

/**
 * The markup an island placeholder becomes.
 *
 * **The props script is a child of the placeholder, not a sibling with an id.**
 * An id would have to be unique across the page, which means counting islands
 * as they render — and a counter is state. Held on the renderer it leaked
 * across requests, so the same template and data rendered different bytes
 * each time; held per render it would still have to be threaded through
 * Liquid's own recursion. Nesting the props needs no counter at all: each
 * placeholder owns its payload, two islands of the same name cannot collide,
 * and the output depends only on the input.
 *
 * Props travel in a `<script type="application/json">` rather than an
 * attribute, because attribute escaping and JSON escaping disagree about
 * quotes often enough that one of the two eventually loses.
 */
export function islandMarkup(
  name: string,
  props: Record<string, unknown>,
  strategy?: IslandStrategy,
): string {
  if (!ISLAND_NAME.test(name)) {
    throw new Error(
      `Island name "${name}" must be a lowercase slug, e.g. "add-to-cart".`,
    );
  }
  const json = JSON.stringify(props ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const attributes = [
    `data-island="${escapeHtml(name)}"`,
    ...(strategy === undefined
      ? []
      : [`data-island-strategy="${escapeHtml(strategy)}"`]),
  ].join(' ');
  return [
    `<div ${attributes}>`,
    `<script type="application/json" data-island-props>${json}</script>`,
    '</div>',
  ].join('');
}
