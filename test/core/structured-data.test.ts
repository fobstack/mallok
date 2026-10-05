import { describe, expect, it } from 'vitest';
import { mergeStructuredData } from '../../src/core/index.js';

/**
 * What a plugin may add to the JSON-LD node the core builds
 * (docs/SEO_PERFORMANCE.md §5). The rule lives in core, so the Worker and
 * anything else that renders a page cannot disagree about it.
 */
const PRODUCT = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  url: 'https://example.com/products/widget',
};
const OFFERS = { '@type': 'Offer', price: '99.00', priceCurrency: 'USD' };

describe('mergeStructuredData', () => {
  it("adds an allowed property after the core's own, leaving the input alone", () => {
    const { node, dropped } = mergeStructuredData(PRODUCT, [
      { source: 'shop', properties: { offers: OFFERS } },
    ]);
    expect(node).toEqual({ ...PRODUCT, offers: OFFERS });
    expect(Object.keys(node ?? {})).toEqual([
      '@context',
      '@type',
      'name',
      'url',
      'offers',
    ]);
    expect(dropped).toEqual([]);
    expect(PRODUCT).not.toHaveProperty('offers');
  });

  it('says why each unused property was dropped', () => {
    const { node, dropped } = mergeStructuredData(PRODUCT, [
      {
        source: 'shop',
        properties: { name: 'Other', review: {}, offers: OFFERS },
      },
      { source: 'second', properties: { offers: { price: '1' } } },
    ]);
    expect(node).toEqual({ ...PRODUCT, offers: OFFERS });
    expect(dropped).toEqual([
      { source: 'shop', key: 'name', reason: 'core_key' },
      { source: 'shop', key: 'review', reason: 'not_allowed' },
      { source: 'second', key: 'offers', reason: 'already_set' },
    ]);
  });

  it('adds nothing to a node type with no allow-list, or to no node', () => {
    const article = { '@type': 'Article', headline: 'News' };
    expect(
      mergeStructuredData(article, [
        { source: 'shop', properties: { offers: OFFERS } },
      ]),
    ).toEqual({
      node: article,
      dropped: [{ source: 'shop', key: 'offers', reason: 'not_allowed' }],
    });
    expect(
      mergeStructuredData(null, [
        { source: 'shop', properties: { offers: OFFERS } },
      ]),
    ).toEqual({
      node: null,
      dropped: [{ source: 'shop', key: 'offers', reason: 'no_node' }],
    });
  });

  it('cannot be tricked by a property named like something inherited', () => {
    const { node, dropped } = mergeStructuredData(PRODUCT, [
      { source: 'shop', properties: { toString: 'x', constructor: 'y' } },
    ]);
    expect(node).toEqual(PRODUCT);
    expect(dropped.map((drop) => drop.reason)).toEqual([
      'not_allowed',
      'not_allowed',
    ]);
  });
});
