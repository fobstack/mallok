/**
 * `definePage` — the typed way to write a page.
 *
 * Without it, a page's `head`, `render` and `cache` each have to restate the
 * shape `load` returned, and any drift between them is only caught when
 * something renders `undefined`. With it, the return type of `load` flows
 * into the other three, and `locals` is whatever the product's adapter
 * actually provides.
 *
 * It is a plain identity function: nothing is added at runtime, and a page
 * that prefers to export the members individually still works.
 */

import type {
  CachePolicy,
  HeadDescriptor,
  PageContext,
  PageData,
  PageModule,
  RenderResult,
} from './types.js';

/** A page whose data type is inferred from `load`. */
export interface PageDefinition<Data extends PageData, Locals> {
  readonly load?: (
    context: PageContext<Locals>,
  ) => Promise<Data | Response> | Data | Response;
  readonly action?: (
    context: PageContext<Locals>,
  ) => Promise<Data | Response> | Data | Response;
  readonly head?: (
    data: Data,
    context: PageContext<Locals>,
  ) => HeadDescriptor | Promise<HeadDescriptor>;
  readonly render: (
    data: Data,
    context: PageContext<Locals>,
  ) => RenderResult | Promise<RenderResult>;
  readonly cache?: (data: Data, context: PageContext<Locals>) => CachePolicy;
}

/**
 * Declares a page.
 *
 * ```ts
 * export default definePage<Locals>()({
 *   load: async ({ params, locals }) => ({
 *     product: await locals.db.product(params.slug),
 *   }),
 *   head: ({ product }) => ({ title: product.title }),
 *   render: ({ product }) => renderer.render('page/product', { product }),
 * });
 * ```
 *
 * The two-step call is what makes it work: `Locals` is named explicitly, and
 * `Data` is still inferred from `load` rather than having to be written out.
 *
 * The returned type erases `Data` again. Inside the definition it ties `load`
 * to `head`, `render` and `cache`, which is the whole point of it; outside,
 * nobody calls a page's `render` by hand, and a route manifest holds pages of
 * every shape at once, so keeping the precise type would only make a page
 * impossible to register.
 */
export function definePage<Locals = unknown>() {
  return <Data extends PageData>(
    page: PageDefinition<Data, Locals>,
  ): PageModule<PageData, Locals> =>
    page as unknown as PageModule<PageData, Locals>;
}
