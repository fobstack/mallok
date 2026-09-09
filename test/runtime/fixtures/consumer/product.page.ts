/**
 * The README's example, as a file the compiler checks.
 *
 * A documentation snippet that has never been compiled is a guess. This is
 * the same code, under the package's own strict settings — `noImplicitAny`,
 * `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — so a change that
 * breaks the published example breaks the build instead of a reader's day.
 *
 * What it is really pinning is inference: `load`'s return type has to flow
 * into `head`, `render` and `cache` without any of them restating it, and
 * `locals` has to be the product's own type rather than `unknown`.
 */

import { definePage } from '../../../../src/runtime/core/define.js';

interface Product {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

/** What this product's adapter puts in `locals`. */
interface Locals {
  readonly db: {
    product(slug: string): Promise<Product | null>;
  };
  readonly renderer: {
    render(template: string, view: Record<string, unknown>): Promise<string>;
  };
}

export default definePage<Locals>()({
  load: async ({ params, locals }) => {
    const slug = params['slug'] ?? '';
    const product = await locals.db.product(slug);
    if (product === null) {
      // Stopping the lifecycle from `load` is how a page 404s.
      return new Response('Not found', { status: 404 });
    }
    return { product };
  },

  head: ({ product }) => ({
    title: product.title,
    canonical: `https://example.com/products/${product.slug}`,
  }),

  render: ({ product }, { locals }) =>
    locals.renderer.render('page/product', { product }),

  cache: ({ product }) => ({
    mode: 'public',
    edgeSeconds: 300,
    tags: [`product:${product.id}`],
  }),
});
