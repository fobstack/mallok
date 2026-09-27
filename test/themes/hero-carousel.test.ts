import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Atelier's homepage carousel is the one script an official theme ships
 * (docs/PRODUCT_CONTRACT.md §5), so its failure modes are product behaviour.
 *
 * The property that matters is not that the controls work — an end-to-end run
 * covers that against a real page — but that a template it cannot drive leaves
 * the content readable. The enhanced state hides every slide but one; if that
 * happens and the controls are then not wired, the hero is simply gone.
 */

const source = readFileSync(
  'src/themes/atelier/assets/hero-carousel.js',
  'utf8',
);

/** Runs the theme's IIFE against the current document. */
function runCarousel(): void {
  new Function(source)();
}

interface MarkupOptions {
  readonly omit?: string;
  readonly withoutImages?: boolean;
}

function markup({ omit, withoutImages }: MarkupOptions = {}): string {
  const part = (selector: string, html: string): string =>
    omit === selector ? '' : html;
  const image = withoutImages === true ? '' : '<img src="a.jpg" alt="" />';
  return `
    <section data-carousel>
      <div class="hero-stage">
        <div data-slide aria-label="First">${image}<h1>One</h1></div>
        <div data-slide aria-label="Second">${image}<h1>Two</h1></div>
      </div>
      <div class="hero-controls">
        <a href="#1" data-slide-link>1</a>
        <a href="#2" data-slide-link>2</a>
        ${part('[data-carousel-arrows]', '<div data-carousel-arrows hidden><button data-prev>P</button><button data-next>N</button></div>')}
      </div>
      <p data-carousel-status aria-live="polite"></p>
    </section>`;
}

function slides(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slide]')];
}

function visibleSlides(): number {
  return slides().filter((slide) => !slide.hidden).length;
}

describe("Atelier's hero carousel", () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows one slide at a time once it has taken over', () => {
    document.body.innerHTML = markup();

    runCarousel();

    expect(document.querySelector('[data-carousel]')?.className).toContain(
      'is-enhanced',
    );
    expect(visibleSlides()).toBe(1);
    expect(slides()[0]?.hidden).toBe(false);
  });

  it('advances and announces the slide it moved to', () => {
    document.body.innerHTML = markup();
    runCarousel();

    document.querySelector<HTMLElement>('[data-next]')?.click();

    expect(slides()[1]?.hidden).toBe(false);
    expect(document.querySelector('[data-carousel-status]')?.textContent).toBe(
      'Second',
    );
  });

  it('leaves every slide readable when a control is missing from the template', () => {
    // A theme is a directory of templates the site owner may edit.
    document.body.innerHTML = markup({ omit: '[data-carousel-arrows]' });

    runCarousel();

    expect(visibleSlides()).toBe(2);
    expect(document.querySelector('[data-carousel]')?.className).not.toContain(
      'is-enhanced',
    );
  });

  it('still works for a slide that has no image', () => {
    document.body.innerHTML = markup({ withoutImages: true });

    runCarousel();

    expect(visibleSlides()).toBe(1);
    document.querySelector<HTMLElement>('[data-next]')?.click();
    expect(slides()[1]?.hidden).toBe(false);
  });

  it('ignores a key name that happens to be an inherited object member', () => {
    // `event.key` is arbitrary text. Looked up on an object literal,
    // "constructor" resolves to a function, and the slide index becomes NaN —
    // which hides every slide at once.
    document.body.innerHTML = markup();
    runCarousel();

    for (const key of ['constructor', 'toString', 'valueOf']) {
      document
        .querySelector('.hero-controls')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(visibleSlides(), `after "${key}"`).toBe(1);
    }
  });
});
