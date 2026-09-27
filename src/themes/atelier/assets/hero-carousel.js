(() => {
  for (const root of document.querySelectorAll('[data-carousel]')) {
    const slides = [...root.querySelectorAll('[data-slide]')];
    const links = [...root.querySelectorAll('[data-slide-link]')];
    const status = root.querySelector('[data-carousel-status]');
    const arrows = root.querySelector('[data-carousel-arrows]');
    const previous = root.querySelector('[data-prev]');
    const next = root.querySelector('[data-next]');
    const controls = root.querySelector('.hero-controls');
    const stage = root.querySelector('.hero-stage');
    // Checked before anything is mutated. These templates are a theme's to
    // edit, and a half-applied carousel is worse than none: it hides slides it
    // can no longer bring back, leaving the hero blank.
    if (
      slides.length !== links.length ||
      slides.length < 2 ||
      status === null ||
      arrows === null ||
      previous === null ||
      next === null ||
      controls === null ||
      stage === null
    )
      continue;

    let current = 0;
    const show = (index, announce = true) => {
      current = (index + slides.length) % slides.length;
      for (const [position, slide] of slides.entries()) {
        slide.hidden = position !== current;
        if (position === current) {
          // A slide without an image still works; only its preloading hint
          // is lost.
          const image = slide.querySelector('img');
          if (image !== null) image.loading = 'eager';
          links[position].setAttribute('aria-current', 'true');
        } else links[position].removeAttribute('aria-current');
      }
      if (announce)
        status.textContent = slides[current].getAttribute('aria-label') ?? '';
    };

    /** Reverts to the no-JavaScript state: every slide visible, no controls. */
    const disable = () => {
      root.classList.remove('is-enhanced');
      arrows.hidden = true;
      for (const slide of slides) slide.hidden = false;
      for (const link of links) link.removeAttribute('aria-current');
      status.textContent = '';
    };

    try {
      root.classList.add('is-enhanced');
      arrows.hidden = false;
      show(0, false);

      for (const [index, link] of links.entries()) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          show(index);
        });
      }
      previous.addEventListener('click', () => show(current - 1));
      next.addEventListener('click', () => show(current + 1));

      // A Map rather than an object literal: `event.key` is arbitrary text,
      // and an inherited member would resolve to a function here.
      const steps = new Map([
        ['arrowleft', () => current - 1],
        ['arrowright', () => current + 1],
        ['home', () => 0],
        ['end', () => slides.length - 1],
      ]);
      controls.addEventListener('keydown', (event) => {
        const step = steps.get((event.key ?? '').toLowerCase());
        if (step === undefined) return;
        event.preventDefault();
        show(step());
        links[current].focus();
      });

      let start = null;
      stage.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch' || event.target.closest('a, button'))
          return;
        start = { x: event.clientX, y: event.clientY, id: event.pointerId };
        stage.setPointerCapture(event.pointerId);
      });
      stage.addEventListener('pointerup', (event) => {
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
          show(current + (dx < 0 ? 1 : -1));
      });
      stage.addEventListener('pointercancel', () => {
        start = null;
      });
    } catch {
      // Leaving the hero in the enhanced state with no working controls would
      // cost the visitor the content itself.
      disable();
    }
  }
})();
