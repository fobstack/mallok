(() => {
  for (const root of document.querySelectorAll('[data-carousel]')) {
    const slides = [...root.querySelectorAll('[data-slide]')];
    const links = [...root.querySelectorAll('[data-slide-link]')];
    const status = root.querySelector('[data-carousel-status]');
    if (slides.length !== links.length || slides.length < 2) continue;
    let current = 0;
    const show = (index, announce = true) => {
      current = (index + slides.length) % slides.length;
      for (const [position, slide] of slides.entries()) {
        slide.hidden = position !== current;
        if (position === current) slide.querySelector('img').loading = 'eager';
        if (position === current)
          links[position].setAttribute('aria-current', 'true');
        else links[position].removeAttribute('aria-current');
      }
      if (announce)
        status.textContent = slides[current].getAttribute('aria-label');
    };
    root.classList.add('is-enhanced');
    root.querySelector('[data-carousel-arrows]').hidden = false;
    show(0, false);
    for (const [index, link] of links.entries()) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        show(index);
      });
    }
    root
      .querySelector('[data-prev]')
      .addEventListener('click', () => show(current - 1));
    root
      .querySelector('[data-next]')
      .addEventListener('click', () => show(current + 1));
    root
      .querySelector('.hero-controls')
      .addEventListener('keydown', (event) => {
        const target = {
          arrowleft: current - 1,
          arrowright: current + 1,
          home: 0,
          end: slides.length - 1,
        }[event.key.toLowerCase()];
        if (target === undefined) return;
        event.preventDefault();
        show(target);
        links[current].focus();
      });
    let start = null;
    const stage = root.querySelector('.hero-stage');
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
  }
})();
