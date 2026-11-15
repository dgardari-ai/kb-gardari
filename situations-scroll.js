(() => {
  'use strict';
  let restore = () => {};

  function readingBand(box, top, bottom) {
    const height = Math.max(0, box.height);
    if (!height || Math.min(box.bottom, bottom) <= Math.max(box.top, top)) {
      return {top: height, bottom: 0, hidden: true};
    }
    const cutTop = Math.min(height, Math.max(0, top - box.top));
    return {top: cutTop, bottom: Math.min(height - cutTop, Math.max(0, box.bottom - bottom)), hidden: false};
  }

  function init() {
    const section = document.getElementById('situations');
    const track = section?.querySelector('.situation-list');
    const heading = section?.querySelector(':scope > h2');
    const intro = section?.querySelector(':scope > .situations-intro');
    if (!section || !track || !heading || !intro) return;
    const items = [...track.querySelectorAll('.situation-item')].map(details => ({
      details, host: details.closest('li'), summary: details.querySelector(':scope > summary'),
      body: details.querySelector(':scope > .slider-reveal'),
      content: details.querySelector('.slider-content'), manual: null,
      expectedOpen: details.open,
      originalExpanded: details.querySelector(':scope > summary')?.getAttribute('aria-expanded')
    }));
    if (items.length !== 4 || items.some(s => !s.summary || !s.body || !s.content)) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const abort = new AbortController(), signal = abort.signal;
    const originals = new Map();
    let metrics = [], context = null, mode = 'static', frame = null, layoutFrame = null;
    let dirty = true, configuring = false, disposed = false;
    let active = 0, release = 0;

    const px = value => parseFloat(value) || 0;
    const editorMode = () => new URLSearchParams(location.search).has('editor_view')
      || document.documentElement.classList.contains('kb-editor-editing')
      || document.documentElement.classList.contains('vmg-editor-editing')
      || document.body.classList.contains('kb-editor-editing');

    function write(node, name, value) {
      value = String(value);
      if (node.style.getPropertyValue(name) === value) return;
      if (!originals.has(node)) originals.set(node, new Map());
      const properties = originals.get(node);
      if (!properties.has(name)) properties.set(name, [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
      node.style.setProperty(name, value);
    }
    function resetStyles() {
      originals.forEach((properties, node) => properties.forEach(([value, priority], name) => {
        if (value) node.style.setProperty(name, value, priority);
        else node.style.removeProperty(name);
      }));
      originals.clear();
    }
    function notify() {
      if (disposed || document.hidden || layoutFrame !== null) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        dispatchEvent(new CustomEvent('kb:layout', {detail: {source: 'situations-stack'}}));
      });
    }
    function fallback(reason) {
      const changed = mode === 'stack';
      mode = 'static';
      section.dataset.caseStackMode = mode;
      section.dataset.caseStackFallback = reason;
      delete section.dataset.caseStackActive;
      delete section.dataset.caseStackRelease;
      resetStyles();
      items.forEach(s => {
        delete s.details.dataset.caseStackPhase;
        delete s.details.dataset.caseStackFolded;
        delete s.body.dataset.caseStackClip;
        if (s.originalExpanded === null) s.summary.removeAttribute('aria-expanded');
        else s.summary.setAttribute('aria-expanded', s.originalExpanded);
      });
      metrics = []; context = null;
      if (changed) notify();
    }
    restore = () => fallback('error');

    function configure() {
      if (disposed || configuring) return;
      configuring = true; dirty = false;
      const supported = CSS.supports('selector(details::details-content)')
        && CSS.supports('position', 'sticky') && CSS.supports('display', 'contents')
        && CSS.supports('display', 'grid');
      const reason = editorMode() ? 'editor' : reduced.matches ? 'reduced-motion'
        : innerWidth <= 1024 ? 'narrow' : innerHeight < 640 ? 'short'
        : !supported ? 'unsupported-sticky-contents' : null;
      if (reason) { fallback(reason); configuring = false; return; }

      const native = mode === 'stack' && !!context;
      items.forEach(s => {
        const open = s.manual !== false;
        s.expectedOpen = open;
        if (s.details.open !== open) s.details.open = open;
      });
      const sectionBox = section.getBoundingClientRect();
      const unit = sectionBox.width / 964;
      if (!native) {
        const measure = node => {
          const box = node.getBoundingClientRect();
          return {top: box.top - sectionBox.top, left: box.left - sectionBox.left,
            width: box.width, height: box.height};
        };
        context = {unit, heading: measure(heading), intro: measure(intro),
          first: items[0].summary.getBoundingClientRect().top - sectionBox.top};
      }
      const ratio = unit / context.unit;
      // Match the visible heading rail of 0.4, retaining this section's own gaps.
      const origin = 35 * unit - context.heading.top * ratio;
      const firstRail = origin + context.first * ratio, gap = 4 * unit;
      let rail = firstRail, offset = 0;
      metrics = items.map((s, index) => {
        const headerHeight = s.summary.getBoundingClientRect().height;
        const style = getComputedStyle(s.content);
        const bodyHeight = s.details.open ? s.content.getBoundingClientRect().height
          + px(style.marginTop) + px(style.marginBottom) : 0;
        const item = {index, state: s, rail, offset, headerHeight, bodyHeight, gap,
          bodyTop: Math.min(rail + headerHeight + gap, innerHeight - bodyHeight - 12)};
        rail += headerHeight + gap;
        offset += headerHeight + gap + bodyHeight;
        return item;
      });
      const textStyle = getComputedStyle(items[0].content);
      const readingMinimum = Math.max(96, px(textStyle.lineHeight) * 3
        + px(textStyle.paddingTop) + px(textStyle.paddingBottom));
      if (rail + readingMinimum + 12 > innerHeight) {
        fallback('short'); configuring = false; return;
      }
      metrics.forEach(m => {
        const values = {index: m.index, 'header-row': m.index * 2 + 1,
          'body-row': m.index * 2 + 2, 'header-top': m.rail + 'px',
          'header-height': m.headerHeight + 'px', gap: m.gap + 'px',
          'body-top': m.bodyTop + 'px', 'body-height': m.bodyHeight + 'px'};
        Object.entries(values).forEach(([name,value]) => write(m.state.details, '--case-stack-' + name, value));
      });
      const paddingTop = px(getComputedStyle(section).paddingTop);
      const commonEnd = rail + 12;
      for (const name of ['heading','intro']) {
        const original = context[name], pinTop = origin + original.top * ratio;
        const values = {'normal-top': original.top * ratio, 'normal-left': original.left * ratio,
          width: original.width * ratio, height: original.height * ratio, 'pin-top': pinTop,
          reserve: Math.max(0, commonEnd - pinTop - original.height * ratio)};
        Object.entries(values).forEach(([property,value]) => write(section, '--case-context-' + name + '-' + property, value + 'px'));
      }
      write(section, '--case-context-padding-top', paddingTop + 'px');
      mode = 'stack'; section.dataset.caseStackMode = mode;
      delete section.dataset.caseStackFallback;
      configuring = false;
      notify();
    }

    function update() {
      frame = null;
      if (disposed || document.hidden) return;
      if (dirty) configure();
      if (mode !== 'stack' || !metrics.length) return;
      const box = track.getBoundingClientRect(), last = metrics[metrics.length - 1];
      const end = box.bottom - px(getComputedStyle(track).paddingBottom);
      release = Math.min(0, end - last.rail - last.headerHeight - last.gap);
      metrics.forEach(m => write(m.state.details, '--case-stack-header-top', m.rail + release + 'px'));
      const headers = metrics.map(m => m.state.summary.getBoundingClientRect());
      active = 0;
      metrics.forEach((m,i) => { if (headers[i].top <= m.rail + release + 6) active = i; });
      let clippedFocus = false;
      metrics.forEach((m,i) => {
        const top = headers[i].bottom + m.gap;
        const bottom = headers[i + 1]?.top ?? box.top + m.offset + m.headerHeight + m.gap + m.bodyHeight;
        const clip = readingBand(m.state.body.getBoundingClientRect(), top, bottom);
        write(m.state.body, '--case-stack-clip-top', clip.top + 'px');
        write(m.state.body, '--case-stack-clip-bottom', clip.bottom + 'px');
        m.state.body.dataset.caseStackClip = clip.hidden ? 'hidden' : 'visible';
        m.state.details.dataset.caseStackFolded = String(clip.hidden);
        const expanded = String(m.state.details.open && !clip.hidden);
        if (m.state.summary.getAttribute('aria-expanded') !== expanded) m.state.summary.setAttribute('aria-expanded', expanded);
        m.state.details.dataset.caseStackPhase = i < active ? 'stacked' : i === active ? 'active' : 'upcoming';
        m.clip = {bandTop: top, bandBottom: bottom, ...clip};
        if (m.state.body.contains(document.activeElement)) {
          const control = document.activeElement.getBoundingClientRect();
          clippedFocus ||= clip.hidden || control.bottom <= top || control.top >= bottom;
        }
      });
      section.dataset.caseStackActive = String(active + 1);
      section.dataset.caseStackRelease = String(release);
      if (clippedFocus) items[active].summary.focus({preventScroll: true});
    }
    function schedule() {
      if (!disposed && !document.hidden && frame === null) frame = requestAnimationFrame(update);
    }
    function invalidate() { dirty = true; schedule(); }

    section.addEventListener('click', event => {
      if (mode !== 'stack' || event.defaultPrevented || event.button > 0) return;
      const summary = event.target instanceof Element ? event.target.closest('.case-summary') : null;
      const s = items.find(item => item.summary === summary);
      if (!s || event.target.closest('a[href],button,input,select,textarea')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // A folded title returns to its normal reading span. It does not require
      // two clicks on an already-open native details whose body is scroll-clipped.
      const folded = s.details.dataset.caseStackFolded === 'true';
      const before = summary.getBoundingClientRect().top, wasScrolling = scrollY > 0;
      s.manual = folded || !s.details.open;
      s.expectedOpen = s.manual; s.details.open = s.manual;
      dirty = true; configure(); update();
      if (s.manual) {
        const metric = metrics.find(m => m.state === s);
        if (metric) scrollTo({top: Math.max(0, track.getBoundingClientRect().top + scrollY + metric.offset - metric.rail + 3), behavior: 'instant'});
      } else {
        const delta = summary.getBoundingClientRect().top - before;
        if (wasScrolling && Math.abs(delta) > .5) scrollTo({top: Math.max(0, scrollY + delta), behavior: 'instant'});
      }
      notify(); schedule();
    }, {capture: true, signal});
    items.forEach(s => s.details.addEventListener('toggle', () => {
      if (s.details.open !== s.expectedOpen) {
        s.manual = s.details.open; s.expectedOpen = s.details.open; invalidate();
      }
    }, {signal}));
    const observer = new ResizeObserver(invalidate);
    items.forEach(s => observer.observe(s.content));
    const editorObserver = new MutationObserver(() => { if (editorMode()) invalidate(); });
    editorObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['class']});
    editorObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
    addEventListener('scroll', schedule, {passive: true, signal});
    addEventListener('resize', invalidate, {passive: true, signal});
    addEventListener('kb:editor-mode', invalidate, {signal});
    addEventListener('pageshow', invalidate, {signal});
    reduced.addEventListener('change', invalidate, {signal});
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
      else invalidate();
    }, {signal});
    document.fonts?.ready.then(invalidate);
    addEventListener('pagehide', event => {
      if (event.persisted) return;
      disposed = true; abort.abort(); observer.disconnect(); editorObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    }, {signal});
    window.KBSituationsScroll = {refresh: invalidate, inspect: () => ({mode, active: active + 1, release,
      fallback: section.dataset.caseStackFallback || null,
      items: metrics.map(m => ({index: m.index + 1, rail: m.rail, headerHeight: m.headerHeight,
        gap: m.gap, bodyHeight: m.bodyHeight, open: m.state.details.open, manual: m.state.manual, clip: m.clip}))})};
    configure(); schedule();
  }
  function safeInit() {
    try { init(); } catch (error) { restore(); console.error('KB situations accordion:', error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit, {once: true});
  else safeInit();
})();
