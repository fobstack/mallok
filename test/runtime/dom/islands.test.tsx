import { afterEach, describe, expect, it } from 'vitest';
import { islandMarkup } from '../../../src/runtime/liquid/index.js';
import { mountIslands } from '../../../src/runtime/react/index.js';

/**
 * The island client against a real DOM.
 *
 * The case that matters most is two islands of the same name on one page:
 * each has to read its own nested props, or both carts show the same SKU.
 */

function Cart(props: Record<string, unknown>) {
  return <span className="cart">{String(props.sku ?? 'none')}</span>;
}

const registry = {
  cart: () => Promise.resolve({ default: Cart as never }),
};

/**
 * The markup the server actually emits, produced by the server's own function
 * rather than written out again here — a hand-copied approximation is exactly
 * how the two halves of the island contract drift apart.
 */
function placeholder(
  name: string,
  props: Record<string, unknown>,
  strategy?: 'eager' | 'idle' | 'visible',
): string {
  return islandMarkup(name, props, strategy);
}

/** Lets queued work (dynamic import, React render) finish. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountIslands', () => {
  it('mounts an island with its own props', async () => {
    document.body.innerHTML = placeholder('cart', {
      sku: 'GR5-10',
    });
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    expect(document.querySelector('.cart')?.textContent).toBe('GR5-10');
  });

  it('gives two carts on one page their own SKUs', async () => {
    document.body.innerHTML =
      placeholder('cart', { sku: 'A' }) + placeholder('cart', { sku: 'B' });
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    const rendered = [...document.querySelectorAll('.cart')].map(
      (node) => node.textContent,
    );
    expect(rendered).toEqual(['A', 'B']);
  });

  it('does not mount the same placeholder twice', async () => {
    document.body.innerHTML = placeholder('cart', {
      sku: 'A',
    });
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    // A second call — after a client-side navigation, say — must be a no-op
    // rather than a second React root fighting over the same container.
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    expect(document.querySelectorAll('.cart')).toHaveLength(1);
  });

  it('honours a strategy declared on the element', async () => {
    document.body.innerHTML = placeholder('cart', { sku: 'EAGER' }, 'eager');
    // The page default is idle; the element asked for eager and wins.
    mountIslands(registry, { defaultStrategy: 'idle' });
    await settle();
    expect(document.querySelector('.cart')?.textContent).toBe('EAGER');
  });

  it('leaves a placeholder alone when the registry has no such island', async () => {
    document.body.innerHTML = placeholder('unknown', {});
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    // Left exactly as the server sent it: its props script is still there,
    // and nothing was rendered into it.
    const element = document.querySelector('[data-island="unknown"]');
    expect(element?.querySelector('script[data-island-props]')).not.toBeNull();
    expect(element?.querySelector('.cart')).toBeNull();
  });

  it('mounts with empty props when the props script is missing', async () => {
    document.body.innerHTML = '<div data-island="cart"></div>';
    mountIslands(registry, { defaultStrategy: 'eager' });
    await settle();
    expect(document.querySelector('.cart')?.textContent).toBe('none');
  });
});
