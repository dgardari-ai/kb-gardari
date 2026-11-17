(() => {
  'use strict';
  const init = () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = matchMedia('(max-width:760px)');
    const abort = new AbortController(), signal = abort.signal;
    const records = new Map(), effects = new Set(), paused = new Set();
    let started = false, chapterStatic = false, dialogsEnabled = true, disposed = false;
    let frame = null, observer = null, serial = 0;
    let activeChapter = null, heroCompleted = false, forwardPermit = false, overlayWasOpen = false;
    let intentRevision = 0, forwardRevision = 0, completionRevision = 0, completedAt = 0;
    let lastScrollPosition = scrollY, lastScrollAt = -Infinity, fallbackSuppressedUntil = 0;
    let lastWheelAt = -Infinity, lastWheelDirection = 0, touchActive = false, touchY = 0, touchRevision = 0;
    let scrollbarActive = false, endRequested = false, readableEnd = false;
    const pressedScrollKeys = new Set(), main = document.querySelector('main.page-shell');
    let pauseAt = document.hidden ? performance.now() : null, pausedTime = 0;
    const epoch = performance.now(), ns = 'http://www.w3.org/2000/svg';
    const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
    const clock = () => (pauseAt === null ? performance.now() : pauseAt) - epoch - pausedTime;
    const mandatoryStatic = () => reduced.matches
      || document.documentElement.classList.contains('kb-editor-editing')
      || document.body.classList.contains('kb-editor-editing')
      || document.documentElement.classList.contains('vmg-editor-editing')
      || new URLSearchParams(location.search).has('editor_view');

    const configurations = {
      situations: { svg: '.situations-window .frame-skin', logo: '.situations-logo', join: 'situations', caseStack: true,
        nodes: ':scope > .section-label, :scope > h2, .situations-intro, .situation-item > summary, .situation-item > .slider-reveal' },
      bureau: { nodes: ':scope > .section-label, :scope > h2, :scope > blockquote, .precedent-grid > *' },
      practice: { svg: '.process-outline', process: true,
        nodes: '.process-figure, :scope > .section-label, :scope > h2, .practice-intro, .process-terms, .step-details > summary, .step-details > .slider-reveal, .process-contact' },
      projects: { nodes: ':scope > .section-label, :scope > h2, .projects-intro, .project-grid > *' },
      author: { nodes: ':scope > .section-label, .author-logo, .author-row' },
      questions: { svg: '.faq-window .frame-skin', nodes: '.faq-window > .section-label, .faq-window > h2, .faq-item, .faq-contact' },
      contact: { svg: '.footer-window .frame-skin', logo: '.footer-logo', join: 'footer', topLogo: true, logoFirst: true,
        nodes: '.brand-footer, .footer-tool, .footer-resources h2, .footer-resources a, .contact-card, .legal-footer' },
      'agent-dialog': { svg: '.agent-window .frame-skin', logo: '.agent-logo', join: 'agent', dialog: true, traceSpeed: 2.1,
        nodes: '.agent-description, .agent-input, .agent-close' }
    };

    function schedule() {
      if (!disposed && !document.hidden && frame === null) frame = requestAnimationFrame(tick);
    }
    function announce(record) {
      if (record.announced || record.config.dialog) return;
      record.announced = true;
      dispatchEvent(new CustomEvent('kb:chapter-start', { detail: { id: record.element.id } }));
    }
    function create(element, config) {
      const record = { element, config, nodes: [...element.querySelectorAll(config.nodes)],
        svg: config.svg ? element.querySelector(config.svg) : null,
        logo: config.logo ? element.querySelector(config.logo) : null,
        phase: 'idle', announced: false, renderer: null, effects: new Set(), start: 0,
        shown: new Set(), rings: new Map(), token: 0, pulseStarted: false, size: null };
      records.set(element, record);
      return record;
    }
    Object.entries(configurations).forEach(([id, config]) => {
      const element = document.getElementById(id);
      if (element) create(element, config);
    });
    const chapterQueue = [...(main?.children || [])].map(node => records.get(node))
      .filter(record => record && !record.config.dialog);
    const overlayOpen = () => !!document.querySelector('dialog[open]');
    const settled = record => !record.effects.size && !record.rings.size;
    const traceSpeed = record => record.config.traceSpeed || .7;
    function frameState(record,state) {
      if(record.svg)record.svg.dataset.kbChapterFrame=state;
      if(record.config.process){
        const upper=record.element.querySelector('.process-context-outline');
        if(upper)upper.dataset.kbChapterFrame=state;
      }
    }

    function queueState() {
      if (!main) return;
      const next = chapterQueue.find(record => record.phase === 'waiting');
      main.dataset.kbChapterActive = activeChapter?.element.id || '';
      main.dataset.kbChapterNext = next?.element.id || '';
      main.dataset.kbChapterQueue = chapterStatic ? 'static' : overlayOpen() ? 'dialog'
        : activeChapter ? activeChapter.phase : !heroCompleted ? 'waiting-hero'
        : !started ? 'waiting-gate' : !next ? 'done' : forwardPermit ? 'waiting-viewport' : 'waiting-scroll';
      main.dataset.kbScrollRevision = String(intentRevision);
      main.dataset.kbCompletedScrollRevision = String(completionRevision);
    }
    function latchQueue() {
      forwardPermit = false;
      completionRevision = intentRevision;
      completedAt = performance.now();
      queueState();
    }

    function arm(record) {
      record.token += 1;
      record.phase = 'waiting'; record.renderer = null; record.traceStart = null; record.shown.clear(); record.pulseStarted = false;
      record.element.dataset.kbChapterState = 'waiting';
      record.nodes.forEach(node => { node.dataset.kbChapterNode = 'waiting'; });
      if (record.logo) record.logo.dataset.kbChapterNode = 'waiting';
      frameState(record,'waiting');
    }
    function cleanupRenderer(record) {
      record.renderer?.cleanup(); record.renderer = null;
    }
    function finishRecord(record, announceStart = true, reason = 'complete') {
      if (!record) return;
      const wasActive = record === activeChapter;
      record.token += 1;
      cleanupRenderer(record);
      record.rings.forEach((promise, node) => { try { window.KBRingReveal?.finish?.(node); } catch {} });
      record.rings.clear();
      record.effects.forEach(effect => { effect.cancel(); effects.delete(effect); paused.delete(effect); });
      record.effects.clear();
      [...record.nodes, record.logo].filter(Boolean).forEach(node => {
        node.dataset.kbChapterNode = 'shown'; record.shown.add(node);
      });
      frameState(record,'shown');
      record.phase = 'done'; record.element.dataset.kbChapterState = 'done';
      observer?.unobserve(record.element);
      if (wasActive) { activeChapter = null; latchQueue(); }
      if (announceStart && (record.announced || wasActive || ['passed', 'static', 'navigation', 'end'].includes(reason))) announce(record);
    }
    function play(record, node, frames, options = {}) {
      if (typeof node.animate !== 'function' || mandatoryStatic()) return null;
      const effect = node.animate(frames, { duration: 340, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both', ...options });
      const token = record.token;
      record.effects.add(effect); effects.add(effect);
      if (document.hidden) { effect.pause(); paused.add(effect); }
      const cleanup = () => {
        effect.cancel(); record.effects.delete(effect); effects.delete(effect); paused.delete(effect);
        if (token === record.token) schedule();
      };
      effect.finished.then(cleanup, () => {
        record.effects.delete(effect); effects.delete(effect); paused.delete(effect);
        if (token === record.token) schedule();
      });
      return effect;
    }
    function pulse(record, delay = 0) {
      if (!record.config.dialog || record.pulseStarted) return;
      record.pulseStarted = true;
      const circle = record.element.querySelector('.agent-input > button:last-child');
      if (circle) play(record, circle, [
        { scale: '1', offset: 0 }, { scale: '2', offset: .25 },
        { scale: '1', offset: .5 }, { scale: '2', offset: .75 }, { scale: '1', offset: 1 }
      ], { duration: 1200, delay, easing: 'ease-in-out' });
    }
    function reveal(record, node, instant = false, horizontal = false) {
      if (!node || record.shown.has(node)) return;
      record.shown.add(node); node.dataset.kbChapterNode = 'shown';
      if (node.matches('.process-figure, .hero-figure') && window.KBRingReveal?.play) {
        if (instant) { window.KBRingReveal.finish?.(node); return; }
        try {
          const promise = window.KBRingReveal.play(node), token = record.token;
          if (promise && typeof promise.then === 'function') {
            record.rings.set(node, promise);
            Promise.resolve(promise).then(() => {
              if (token !== record.token) return;
              record.rings.delete(node); schedule();
            }, () => {
              if (token !== record.token) return;
              window.KBRingReveal?.finish?.(node);
              record.rings.delete(node); schedule();
            });
            return;
          }
        } catch { window.KBRingReveal?.finish?.(node); }
      }
      if (!instant) play(record, node, [
        { clipPath: horizontal ? 'inset(0 100% 0 0)' : 'inset(0 0 100% 0)', opacity: 0 },
        { clipPath: 'inset(0 0 0 0)', opacity: 1 }
      ]);
      if (record.config.dialog && node.matches('.agent-input')) pulse(record, instant ? 0 : 360);
    }
    function begin(record) {
      if (record.phase !== 'waiting') return;
      if (!record.config.dialog) {
        if (activeChapter && activeChapter !== record) return;
        activeChapter = record; forwardPermit = false;
      }
      record.phase = record.config.logoFirst && record.logo ? 'logo' : 'tracing'; record.start = clock();
      record.element.dataset.kbChapterState = record.phase;
      record.size = record.element.getBoundingClientRect();
      const frameBox = record.svg?.getBoundingClientRect();
      record.frameVisible = !!frameBox && frameBox.width > 1 && frameBox.height > 1;
      // Focus must never remain on a control made invisible by enhancement.
      record.nodes.forEach(node => {
        if (node.contains(document.activeElement)) reveal(record, node, true);
      });
      // The footer frame originates in its already visible large logo.
      if (record.phase === 'logo') reveal(record, record.logo, false, true);
      announce(record);
      queueState();
      schedule();
    }

    function measureReport(record, w, h) {
      return window.KBFrameGeometry?.measure?.().find(item => item.className === record.svg.parentElement?.className
        && Math.abs(item.width - w) < .6 && Math.abs(item.height - h) < .6);
    }
    function makeRenderer(record) {
      const svg = record.svg, original = [...svg.children].find(node => node.localName === 'path');
      if (!original || svg.dataset.geometryState !== 'ready') return null;
      const box = svg.getBoundingClientRect(), w = box.width, h = box.height;
      const viewBox = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      if (w <= 1 || h <= 1 || Math.abs(viewBox[2] - w) > .6 || Math.abs(viewBox[3] - h) > .6) return null;
      const report = measureReport(record, w, h);
      const inset = report?.pathInset ?? (record.config.dialog ? (parseFloat(getComputedStyle(original).strokeWidth) || 1) / 2 : 0);
      const x0 = inset, x1 = w - inset, y1 = h - inset;
      const y0 = (record.config.process || record.config.topLogo) && Number.isFinite(report?.pathTop) ? report.pathTop : inset;
      const radiusHeight = record.config.process ? y1 - y0 : h;
      const r = Math.max(0, Math.min(26 * w / (record.config.process ? 708.91 : 964), (w - 1) / 2, (radiusHeight - 1) / 2));
      const join = report?.joins?.find(item => item.name === record.config.join && item.status === 'joined');
      let topGap = (svg.dataset.topGap || '').split(',').map(Number);
      topGap = topGap.length === 2 && topGap.every(Number.isFinite) ? topGap.map(n => n * w / 964) : null;
      if (record.element.id === 'situations' && mobile.matches) topGap = null;
      if (record.config.topLogo && join?.gap) topGap = join.gap;
      const from = topGap ? clamp(topGap[1], x0 + r, x1 - r) : x0 + r;
      const to = topGap ? clamp(topGap[0], x0 + r, x1 - r) : x0 + r;
      const originalD = original.getAttribute('d');
      if (!originalD) return null;
      const routeD = record.config.process ? originalD
        : `M${from},${y0}H${x1-r}A${r},${r} 0 0 1 ${x1},${y0+r}`
          + `V${y1-r}A${r},${r} 0 0 1 ${x1-r},${y1}H${x0+r}`
          + `A${r},${r} 0 0 1 ${x0},${y1-r}V${y0+r}A${r},${r} 0 0 1 ${x0+r},${y0}H${to}`;
      const defs = document.createElementNS(ns, 'defs'), mask = document.createElementNS(ns, 'mask');
      mask.id = `kb-chapter-mask-${++serial}`;
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '-8'); mask.setAttribute('y', '-8');
      mask.setAttribute('width', String(w + 16)); mask.setAttribute('height', String(h + 16));
      mask.style.maskType = 'luminance';
      const route = document.createElementNS(ns, 'path'); route.setAttribute('d', routeD);
      Object.assign(route.style, { fill: 'none', stroke: '#fff', strokeWidth: '5px', strokeLinecap: 'butt', strokeLinejoin: 'round' });
      mask.append(route); defs.append(mask); svg.append(defs); // Original path remains first for geometry.paint().
      const length = route.getTotalLength(), previousMask = original.getAttribute('mask');
      route.style.strokeDasharray = `${length} ${length}`; route.style.strokeDashoffset = String(length);
      original.setAttribute('mask', `url(#${mask.id})`); frameState(record,'tracing');
      const quarter = Math.PI * r / 2;
      const rightStart = (record.config.process ? x1 - r - x0 : x1 - r - from) + quarter;
      const bottomStart = rightStart + y1 - y0 - 2 * r + quarter;
      // The FAQ's bottom CTA removes a real piece of the visible frame. Do not
      // spend trace time crossing that empty gap: the visible front would stop.
      const faqGap = record.element.id === 'questions'
        ? report?.joins?.find(item => item.name === 'faq-cta' && item.status === 'joined')?.gap : null;
      const skipFrom = faqGap ? clamp(bottomStart + x1 - r - faqGap[1], 0, length) : length;
      const skipTo = faqGap ? clamp(bottomStart + x1 - r - faqGap[0], skipFrom, length) : length;
      const invisibleLength = skipTo - skipFrom, visibleLength = length - invisibleLength;
      // The native upper fragment contains the top edge, corner, and a piece of
      // the right side. Its end is the seam with the normal-flow lower frame.
      function nativeSpan(){
        const upper=record.config.process?record.element.querySelector('.process-context-outline'):null;
        const upperBox=upper?.getBoundingClientRect(),upperHeight=upperBox?.height||0;
        if(!upper||record.element.dataset.processStackMode!=='stack'||upperHeight<=0)return {gap:0,end:length};
        // Reconfiguration can replace the skin without changing the source d.
        const end=clamp(upperHeight<r
          ?x1-r-x0+r*(Math.asin(clamp((upperHeight-r)/r,-1,1))+Math.PI/2)
          :rightStart+clamp(upperHeight-y0-r,0,y1-y0-2*r),0,length);
        return {gap:clamp(upperBox.top-svg.getBoundingClientRect().top,0,length-end),end};
      }
      const relative = node => {
        const rect = node.getBoundingClientRect(),origin=record.config.process||record.config.caseStack?svg.getBoundingClientRect():box;
        return { top: rect.top - origin.top, left: rect.left - origin.left, right: rect.right - origin.left,
          width: rect.width, height: rect.height };
      };
      const nodes = record.nodes.map(node => ({ node, box: relative(node) })).map(item => ({ ...item,
        at: item.node.matches('.legal-footer') ? length : rightStart + clamp(item.box.top - y0 - r, 0, y1 - y0 - 2 * r) }));
      const logoBox = record.logo ? relative(record.logo) : null;
      const logoAt = !logoBox ? Infinity : record.config.logoFirst ? 0 : record.config.topLogo ? length
        : bottomStart + Math.max(0, x1 - r - (join?.silhouette?.[1] ?? logoBox.right));
      let cleaned = false;
      return { get length(){return visibleLength-nativeSpan().gap;}, width: w, height: h, original, originalD,
        cleanup() {
          if (cleaned) return; cleaned = true;
          if (previousMask === null) original.removeAttribute('mask'); else original.setAttribute('mask', previousMask);
          defs.remove(); frameState(record,'shown');
        },
        draw(distance) {
          const span=nativeSpan(),gap=span.gap,logicalLength=visibleLength-gap;
          const removed=record.config.process?(distance>=span.end?gap:0):(distance>=skipFrom?invisibleLength:0);
          const routeDistance = Math.min(length, distance + removed);
          route.style.strokeDashoffset = String(Math.max(0, length - routeDistance));
          svg.dataset.kbChapterProgress = String(clamp(distance / logicalLength));
          nodes.forEach(item => {
            const at=record.config.process||record.config.caseStack?rightStart+clamp(relative(item.node).top-y0-r,0,y1-y0-2*r):item.at;
            if (routeDistance >= at) reveal(record, item.node, false, true);
          });
          if (routeDistance >= logoAt) reveal(record, record.logo, false, record.config.topLogo);
        }
      };
    }

    function updateFlow(record, time) {
      const sorted = record.nodes.slice().sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return ar.top - br.top || ar.left - br.left;
      });
      sorted.forEach((node, index) => {
        const box = node.getBoundingClientRect();
        if (box.bottom <= 0) reveal(record, node, true);
        else if (box.top < innerHeight * .94 && time - record.start >= Math.min(index * 90, 450)) reveal(record, node);
      });
      if (record.nodes.every(node => record.shown.has(node)) && settled(record)) finishRecord(record);
    }
    function updateFrame(record, time) {
      if (record.config.process) {
        record.nodes.filter(node => !node.matches('.process-terms, .step-details > summary, .step-details > .slider-reveal, .process-contact'))
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          .forEach((node, index) => { if (time - record.start >= index * 110) reveal(record, node); });
        if (time - record.start < 650) return;
      }
      if (!record.renderer) {
        if (record.svg.dataset.geometryState === 'profile-error' || time - record.start > 1900) { finishRecord(record); return; }
        record.renderer = makeRenderer(record);
        if (!record.renderer) return;
        if (record.traceStart === null) record.traceStart = time;
      }
      let renderer = record.renderer;
      const box = record.svg.getBoundingClientRect();
      if (Math.abs(box.width - renderer.width) > .5 || Math.abs(box.height - renderer.height) > .5
        || renderer.original.getAttribute('d') !== renderer.originalD) {
        if (!record.config.process && !record.config.caseStack) { finishRecord(record); return; }
        // Its inline steps grow while the front travels: retain time/distance and
        // already revealed rows, but rebuild only after geometry publishes its new d.
        if (renderer.original.getAttribute('d') === renderer.originalD) return;
        const viewBox = (record.svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        if (Math.abs(viewBox[2] - box.width) > .6 || Math.abs(viewBox[3] - box.height) > .6) {
          // Height effects can run one frame ahead of geometry. Keep the live mask
          // until both describe the same frame instead of ending the whole chapter.
          renderer.draw(Math.min(renderer.length, (time - record.traceStart) * traceSpeed(record)));
          return;
        }
        cleanupRenderer(record);
        record.renderer = makeRenderer(record);
        if (!record.renderer) { finishRecord(record); return; }
        renderer = record.renderer;
      }
      const distance = Math.min(renderer.length, (time - record.traceStart) * traceSpeed(record));
      renderer.draw(distance);
      if (distance >= renderer.length) {
        cleanupRenderer(record);
        record.nodes.forEach(node => reveal(record, node));
        if (record.logo) reveal(record, record.logo);
        record.phase = 'settling'; record.element.dataset.kbChapterState = 'settling';
      }
    }

    function advance(record, time) {
      try {
        if (record.phase === 'logo' && settled(record)) {
          record.phase = 'tracing'; record.element.dataset.kbChapterState = 'tracing';
          record.start = time; record.traceStart = null;
        }
        if (record.phase === 'tracing') {
          if (record.frameVisible) updateFrame(record, time); else updateFlow(record, time);
        }
        if (record.phase === 'settling' && settled(record)) finishRecord(record);
      } catch (error) {
        record.element.dataset.kbChapterError = String(error.message || error);
        finishRecord(record);
      }
    }
    function update() {
      const time = clock(), overlay = overlayOpen();
      if (overlay !== overlayWasOpen) {
        if (activeChapter) finishRecord(activeChapter);
        latchQueue(); overlayWasOpen = overlay;
      }
      records.forEach(record => {
        if (!record.config.dialog || ['idle', 'done'].includes(record.phase)) return;
        if (!record.element.open) finishRecord(record, false); else advance(record, time);
      });
      if (!started || chapterStatic || overlay) { queueState(); return; }
      if (readableEnd) {
        readableEnd = false;
        chapterQueue.forEach(record => { if (record.phase !== 'done') finishRecord(record, true, 'end'); });
        latchQueue(); queueState(); return;
      }
      // Fast navigation may pass a chapter completely. Restore its readable final
      // state, but never turn that skip into permission to animate a future chapter.
      chapterQueue.forEach(record => {
        if (record.phase !== 'done' && record.element.getBoundingClientRect().bottom <= 0) finishRecord(record, true, 'passed');
      });
      if (activeChapter) {
        const current = activeChapter;
        if (current.element.getBoundingClientRect().top > innerHeight * 1.2) finishRecord(current);
        else advance(current, time);
        queueState(); return; // A completion never starts its successor in this tick.
      }
      const next = chapterQueue.find(record => record.phase === 'waiting');
      if (next && heroCompleted && forwardPermit && next.element.getBoundingClientRect().top < innerHeight * .9) {
        begin(next); advance(next, time);
      }
      queueState();
    }
    function tick() {
      frame = null;
      if (disposed || document.hidden) return;
      update();
      const now = clock();
      if ([...records.values()].some(record => record.phase === 'logo'
        || record.phase === 'tracing' && (record.frameVisible || now - record.start < 500))) schedule();
    }

    function start() {
      if (disposed || started || chapterStatic) return;
      if (mandatoryStatic()) { showAll({ keepDialogs: false }); return; }
      started = true;
      if (!heroCompleted) { heroCompleted = true; latchQueue(); }
      records.forEach(record => { if (!record.config.dialog) arm(record); });
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(schedule, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
        records.forEach(record => { if (!record.config.dialog) observer.observe(record.element); });
      }
      schedule();
    }
    function showAll(options = {}) {
      chapterStatic = true;
      dialogsEnabled = options.keepDialogs !== false && !mandatoryStatic();
      observer?.disconnect();
      records.forEach(record => {
        if (!record.config.dialog || !dialogsEnabled || record.element.open) finishRecord(record, true, 'static');
      });
      latchQueue(); queueState();
    }
    function finish(target) {
      const element = typeof target === 'string' ? document.querySelector(target) || document.getElementById(target) : target;
      const record = records.get(element);
      if (record) finishRecord(record, true, 'navigation');
    }
    function refresh() { schedule(); }
    window.KBChapterMotion = { start, showAll, finish, refresh };

    const atBottom = () => scrollY >= Math.max(0, document.documentElement.scrollHeight - innerHeight) - 2;
    function noteIntent(forward = true) {
      if (overlayOpen() || document.hidden) return;
      intentRevision += 1;
      if (forward) forwardRevision = intentRevision;
      // At the physical bottom a fresh forward gesture cannot produce scrollY.
      // It may still admit the next visible chapter after its predecessor ended.
      if (forward && heroCompleted && !activeChapter && atBottom() && intentRevision > completionRevision) forwardPermit = true;
      queueState(); schedule();
    }
    function onScroll(event) {
      const now = performance.now(), position = scrollY, delta = position - lastScrollPosition;
      if (delta > .5 && !overlayOpen() && !document.hidden) {
        if (endRequested || (atBottom() && delta > innerHeight * .7)) readableEnd = true;
        if (heroCompleted && !activeChapter && !chapterStatic) {
          const continuingGesture = now - lastWheelAt < 220 || touchActive || scrollbarActive || pressedScrollKeys.size > 0;
          const freshNativeScroll = event.isTrusted !== false && !continuingGesture
            && now - lastScrollAt > 220 && now >= completedAt && now > fallbackSuppressedUntil;
          if (forwardRevision > completionRevision || freshNativeScroll) {
            if (freshNativeScroll && forwardRevision <= completionRevision) { intentRevision += 1; forwardRevision = intentRevision; }
            forwardPermit = true;
          }
        }
      }
      endRequested = false;
      lastScrollPosition = position; lastScrollAt = now;
      schedule();
    }
    addEventListener('kb:hero-complete', () => {
      heroCompleted = true; latchQueue(); schedule();
    }, { signal });
    addEventListener('wheel', event => {
      const now = performance.now(), direction = Math.sign(event.deltaY);
      const fresh = now - lastWheelAt > 220 || (direction > 0 && lastWheelDirection <= 0);
      lastWheelAt = now; lastWheelDirection = direction;
      if (direction > 0 && fresh) noteIntent();
    }, { passive: true, signal });
    addEventListener('keydown', event => {
      if (event.defaultPrevented || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === ' ' && event.target?.closest?.('button, summary, a[href]')) return;
      const forward = ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key);
      if (!forward || overlayOpen()) return;
      pressedScrollKeys.add(event.code || event.key);
      if (!event.repeat) noteIntent();
      if (event.key === 'End' || (event.key === 'ArrowDown' && event.metaKey)) {
        endRequested = true;
        if (atBottom()) { readableEnd = true; schedule(); }
      }
    }, { signal });
    addEventListener('keyup', event => pressedScrollKeys.delete(event.code || event.key), { signal });
    addEventListener('touchstart', event => {
      touchActive = true; touchY = event.touches[0]?.clientY || 0;
      noteIntent(false); touchRevision = intentRevision;
    }, { passive: true, signal });
    addEventListener('touchmove', event => {
      const y = event.touches[0]?.clientY ?? touchY;
      if (y < touchY && !overlayOpen()) forwardRevision = touchRevision;
      touchY = y;
    }, { passive: true, signal });
    const endTouch = () => { touchActive = false; };
    addEventListener('touchend', endTouch, { passive: true, signal });
    addEventListener('touchcancel', endTouch, { passive: true, signal });
    addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.clientX >= innerWidth - 24) {
        scrollbarActive = true; noteIntent();
      }
    }, { passive: true, signal });
    addEventListener('pointerup', () => { scrollbarActive = false; }, { passive: true, signal });
    addEventListener('blur', () => { pressedScrollKeys.clear(); touchActive = false; scrollbarActive = false; }, { signal });

    const dialog = document.getElementById('agent-dialog'), dialogRecord = records.get(dialog);
    const dialogObserver = dialogRecord ? new MutationObserver(() => {
      if (!dialog.open) { finishRecord(dialogRecord, false); return; }
      if (!dialogsEnabled || mandatoryStatic()) { finishRecord(dialogRecord, false); return; }
      finishRecord(dialogRecord, false); arm(dialogRecord); begin(dialogRecord);
      window.KBFrameGeometry?.refresh?.();
    }) : null;
    if (dialog) dialogObserver?.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    addEventListener('scroll', onScroll, { passive: true, signal });
    dialog?.addEventListener('scroll', () => { if (dialogRecord?.phase === 'tracing') finishRecord(dialogRecord, false); }, { passive: true, signal });
    addEventListener('resize', () => {
      records.forEach(record => { if (['tracing', 'settling'].includes(record.phase)) finishRecord(record); });
      fallbackSuppressedUntil = performance.now() + 250;
      latchQueue();
      schedule();
    }, { passive: true, signal });
    addEventListener('kb:layout', () => {
      fallbackSuppressedUntil = performance.now() + 120; schedule();
    }, { signal });
    document.addEventListener('toggle', schedule, { capture: true, signal });
    document.addEventListener('focusin', event => {
      const record = [...records.values()].find(item => item.element.contains(event.target));
      if (record && ['waiting', 'tracing'].includes(record.phase) && !record.config.dialog) {
        if (activeChapter && activeChapter !== record) finishRecord(activeChapter);
        chapterQueue.slice(0, chapterQueue.indexOf(record) + 1).forEach(item => {
          if (item.phase !== 'done') finishRecord(item, true, 'navigation');
        });
        latchQueue();
      }
    }, { signal });
    reduced.addEventListener('change', () => { if (reduced.matches) showAll({ keepDialogs: false }); }, { signal });
    addEventListener('kb:editor-mode', () => showAll({ keepDialogs: false }), { signal });
    const editorObserver = new MutationObserver(() => { if (mandatoryStatic()) showAll({ keepDialogs: false }); });
    editorObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    editorObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const sizeObserver = 'ResizeObserver' in window ? new ResizeObserver(schedule) : null;
    records.forEach(record => { sizeObserver?.observe(record.element); if (record.svg) sizeObserver?.observe(record.svg); });
    function pause() {
      if (pauseAt === null) pauseAt = performance.now();
      if (frame !== null) cancelAnimationFrame(frame); frame = null;
      effects.forEach(effect => { if (effect.playState === 'running') { effect.pause(); paused.add(effect); } });
    }
    function resume() {
      if (pauseAt !== null) { pausedTime += performance.now() - pauseAt; pauseAt = null; }
      paused.forEach(effect => { if (effect.playState === 'paused') effect.play(); }); paused.clear(); schedule();
    }
    document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume(), { signal });
    addEventListener('pageshow', event => { if (event.persisted) resume(); else schedule(); }, { signal });
    addEventListener('pagehide', event => {
      if (event.persisted) { pause(); return; }
      records.forEach(record => finishRecord(record, false));
      disposed = true; abort.abort(); observer?.disconnect(); dialogObserver?.disconnect();
      editorObserver.disconnect(); sizeObserver?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    }, { signal });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
