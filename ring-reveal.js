(() => {
  'use strict';
  const scriptURL = document.currentScript?.src || location.href;
  const ns = 'http://www.w3.org/2000/svg';
  const active = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null, serial = 0, pausedAt = document.hidden ? performance.now() : null, pausedTotal = 0;
  const clock = () => (pausedAt === null ? performance.now() : pausedAt) - pausedTotal;
  const staticMode = () => reduced.matches || new URLSearchParams(location.search).has('editor_view')
    || ['kb-motion-static', 'kb-editor-editing', 'vmg-editor-editing'].some(name => document.documentElement.classList.contains(name))
    || document.body?.classList.contains('kb-editor-editing');
  const mapReady = fetch(new URL('assets/ring-map.json', scriptURL), { cache: 'no-cache' })
    .then(response => { if (!response.ok) throw Error('Ring geometry unavailable'); return response.json(); })
    .then(data => { if (data.schema !== 'kb-ring-reveal-1') throw Error('Invalid ring geometry'); return data.figures; })
    .catch(() => null);

  function restore(record, interrupted) {
    if (record.done) return;
    record.done = true;
    record.overlay?.remove();
    if (record.opacity) record.node.style.setProperty('opacity', record.opacity, record.opacityPriority);
    else record.node.style.removeProperty('opacity');
    record.node.dataset.kbRingState = 'complete';
    record.node.dataset.kbRingInterrupted = String(!!interrupted);
    if (record.cells) record.node.dataset.kbRingShown = String(record.cells.length);
    active.delete(record.node);
    record.resolve({ completed: true, interrupted: !!interrupted });
    if (!active.size && frame !== null) { cancelAnimationFrame(frame); frame = null; }
  }
  function finish(node) { const record = active.get(node); if (record) restore(record, true); }
  function finishAll() { [...active.values()].forEach(record => restore(record, true)); }
  function schedule() {
    if (frame === null && !document.hidden && [...active.values()].some(record => record.start !== null)) frame = requestAnimationFrame(tick);
  }
  function tick() {
    frame = null;
    if (document.hidden) return;
    const time = clock();
    active.forEach(record => {
      if (record.start === null) return;
      const box = record.node.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= innerHeight) { restore(record, true); return; }
      const elapsed = time - record.start;
      let shown = 0;
      record.cells.forEach(cell => {
        if (cell.complete) { shown += 1; return; }
        const t = Math.max(0, Math.min(1, (elapsed - cell.delay) / record.pop));
        if (!t) return;
        const progress = 1 - (1-t) ** 3;
        cell.circle.setAttribute('r', String(cell.radius * progress));
        if (t >= 1) { cell.complete = true; shown += 1; }
      });
      record.node.dataset.kbRingShown = String(shown);
      record.node.dataset.kbRingProgress = String(Math.min(1, elapsed / record.duration));
      if (elapsed >= record.duration) restore(record, false);
    });
    schedule();
  }
  function element(tag, attributes) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  async function prepare(record, key) {
    const [figures] = await Promise.all([mapReady, typeof record.node.decode === 'function' ? record.node.decode().catch(() => {}) : Promise.resolve()]);
    if (record.done) return;
    const figure = figures?.[key];
    const box = record.node.getBoundingClientRect();
    if (!figure || box.width <= 1 || box.height <= 1 || staticMode()) { restore(record, true); return; }
    const parent = record.node.offsetParent || record.node.parentElement;
    const origin = parent.getBoundingClientRect();
    const overlay = element('svg', { viewBox: `0 0 ${figure.width} ${figure.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    overlay.classList.add('kb-ring-overlay');
    Object.assign(overlay.style, {
      left: `${box.left-origin.left-parent.clientLeft+parent.scrollLeft}px`,
      top: `${box.top-origin.top-parent.clientTop+parent.scrollTop}px`,
      width: `${box.width}px`, height: `${box.height}px`
    });
    const defs = element('defs'), mask = element('mask', { id: `kb-rings-${++serial}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: figure.width, height: figure.height });
    mask.style.maskType = 'luminance';
    const totalWeight = figure.cells.reduce((sum, cell) => sum + cell[7], 0);
    let weight = 0;
    record.pop = 165;
    record.duration = key === 'hero-figure' ? 2150 : 2500;
    record.cells = figure.cells.map((cell, index) => {
      const [x, y, width, height, cx, cy, radius, importance] = cell;
      const clipId = `${mask.id}-cell-${index}`;
      const clip = element('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      // The cell aperture cannot expose the neighbouring ring ahead of its turn.
      clip.append(element('rect', { x, y, width: width+.0001, height: height+.0001 }));
      defs.append(clip);
      const circle = element('circle', { cx, cy, r: 0, fill: 'white', 'clip-path': `url(#${clipId})` });
      mask.append(circle);
      const delay = weight / totalWeight * (record.duration-record.pop);
      weight += importance;
      return { circle, radius, delay, complete: false };
    });
    defs.append(mask);
    overlay.append(defs, element('image', { href: record.node.currentSrc || record.node.src, width: figure.width, height: figure.height, preserveAspectRatio: 'none', mask: `url(#${mask.id})` }));
    record.overlay = overlay;
    record.node.after(overlay);
    record.node.dataset.kbRingTotal = String(record.cells.length);
    record.node.dataset.kbRingInkCells = String(figure.ink_cells);
    record.node.dataset.kbRingShown = '0';
    record.node.dataset.kbRingState = 'playing';
    record.start = clock();
    schedule();
  }
  function play(node) {
    if (!node) return Promise.resolve({ completed: true });
    const existing = active.get(node);
    if (existing) return existing.promise;
    if (staticMode() || node.dataset.kbRingState === 'complete') return Promise.resolve({ completed: true });
    const key = new URL(node.currentSrc || node.src, document.baseURI).pathname.split('/').at(-1)?.replace(/\.svg$/, '');
    if (!['hero-figure', 'process-figure'].includes(key)) return Promise.resolve({ completed: true });
    const record = { node, start: null, overlay: null, cells: null, done: false,
      opacity: node.style.getPropertyValue('opacity'), opacityPriority: node.style.getPropertyPriority('opacity') };
    record.promise = new Promise(resolve => { record.resolve = resolve; });
    active.set(node, record);
    node.style.opacity = '0';
    node.dataset.kbRingState = 'loading';
    prepare(record, key).catch(() => restore(record, true));
    return record.promise;
  }
  window.KBRingReveal = { play, finish, finishAll };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pausedAt === null) pausedAt = performance.now();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    } else {
      if (pausedAt !== null) { pausedTotal += performance.now()-pausedAt; pausedAt = null; }
      schedule();
    }
  });
  addEventListener('resize', finishAll, { passive: true });
  reduced.addEventListener('change', () => { if (reduced.matches) finishAll(); });
  addEventListener('kb:editor-mode', finishAll);
  addEventListener('pagehide', finishAll);
})();
