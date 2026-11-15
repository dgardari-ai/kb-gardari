(() => {
  'use strict';
  let emergencyRestore = () => {};

  function init() {
    const root = document.documentElement;
    const main = document.querySelector('main.page-shell');
    const hero = document.querySelector('#top');
    const sciences = hero?.querySelector('.hero-disciplines');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const abort = new AbortController();
    const signal = abort.signal;
    const chapters = main ? [...main.children].filter(node => node.matches('section, footer') && node !== hero) : [];
    const animations = new Set();
    const pausedAnimations = new Set();
    const restorers = new Set();
    const jobs = new Set();
    const initialHash = location.hash;
    const navigationType = performance.getEntriesByType?.('navigation')[0]?.type;
    let initialRootAnchor = ['#top', '#main'].includes(initialHash) && navigationType !== 'back_forward';
    const rootHash = hash => !hash || hash === '#' || hash === '#top' || hash === '#main';
    const clamp = value => Math.max(0, Math.min(1, value));
    let stopped = false;
    let staticMode = false;
    let gateOpened = false;
    let centered = false;
    let hasScrolled = scrollY > 1 && !initialRootAnchor;
    let frame = null;
    let layoutFrame = null;
    let observer = null;
    let sizeObserver = null;
    let entranceStarted = false;
    let introDone = false;
    let layoutPending = false;
    let pausedAt = document.hidden ? performance.now() : null;
    let pausedDuration = 0;
    const epoch = performance.now();

    function editorActive() {
      return root.classList.contains('kb-editor-editing')
        || document.body.classList.contains('kb-editor-editing')
        || root.classList.contains('vmg-editor-editing')
        || new URLSearchParams(location.search).has('editor_view');
    }

    function suppressInitialAnchorScroll() {
      if (!initialRootAnchor || staticMode || scrollY <= 0) return false;
      // Fragment scrolling may arrive after pageshow. Only real intent releases
      // the initial #top/#main guard, so that delayed jump cannot end the intro.
      scrollTo({ top: 0, behavior: 'instant' });
      hasScrolled = false;
      return true;
    }

    function clock() {
      return (pausedAt === null ? performance.now() : pausedAt) - epoch - pausedDuration;
    }

    function schedule() {
      if (!stopped && !staticMode && !document.hidden && frame === null) frame = requestAnimationFrame(tick);
    }

    function tick() {
      frame = null;
      if (stopped || staticMode || document.hidden) return;
      updateScroll();
      const elapsed = clock();
      [...jobs].forEach(job => { if (job(elapsed) === false) jobs.delete(job); });
      if (entranceStarted && !introDone && !jobs.size) finishEntrance();
      if (jobs.size) schedule();
    }

    function addJob(job) { jobs.add(job); schedule(); }

    function animate(node, frames, options) {
      if (!node || typeof node.animate !== 'function') return null;
      const animation = node.animate(frames, { fill: 'both', ...options });
      animations.add(animation);
      if (document.hidden) { animation.pause(); pausedAnimations.add(animation); }
      animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
      return animation;
    }

    function finishEntrance() {
      const wasDone = introDone;
      window.KBRingReveal?.finish(hero?.querySelector('.hero-figure'));
      jobs.clear();
      animations.forEach(animation => animation.cancel());
      animations.clear();
      pausedAnimations.clear();
      [...restorers].forEach(restore => restore());
      restorers.clear();
      hero?.querySelectorAll('.hero-scene > *').forEach(node => {
        node.dataset.kbEntrance = 'shown';
        node.style.removeProperty('clip-path');
      });
      const border = hero?.querySelector('.hero-window .frame-skin');
      if (border) border.dataset.kbBorder = 'shown';
      if (hero) hero.dataset.kbTraceStage = 'complete';
      introDone = true;
      if (!wasDone) dispatchEvent(new CustomEvent('kb:hero-complete'));
      root.classList.add('kb-motion-ready');
    }

    function resetCenter(preservePosition) {
      if (!centered || !main) return;
      const before = main.getBoundingClientRect().top;
      const position = scrollY;
      main.removeAttribute('data-kb-centered');
      main.style.removeProperty('--kb-intro-offset');
      centered = false;
      if (preservePosition && position > 1) {
        scrollTo({ top: Math.max(0, position + main.getBoundingClientRect().top - before), behavior: 'instant' });
      }
    }

    function showAll({ resetPosition = false } = {}) {
      staticMode = true;
      root.classList.remove('intro-mode');
      root.classList.add('kb-motion-static', 'kb-motion-ready');
      observer?.disconnect();
      finishEntrance();
      chapters.forEach(chapter => { chapter.dataset.kbReveal = 'shown'; });
      window.KBChapterMotion?.showAll({ keepDialogs: !reduced.matches && !editorActive() });
      if (sciences) {
        sciences.style.removeProperty('--kb-science-progress');
        sciences.style.removeProperty('--kb-science-shift');
        sciences.removeAttribute('data-kb-science-visible');
      }
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (resetPosition) resetCenter(true);
    }
    emergencyRestore = () => showAll({ resetPosition: true });

    function centerScene(preservePosition = true) {
      if (stopped || staticMode || !main || !hero) return;
      const boxes = ['.hero-window', '.hero-logo'].map(selector => hero.querySelector(selector)?.getBoundingClientRect())
        .filter(rect => rect && rect.width > 0 && rect.height > 0);
      if (boxes.length !== 2) return;
      const height = Math.max(...boxes.map(rect => rect.bottom)) - Math.min(...boxes.map(rect => rect.top));
      const offset = Math.max(12, (innerHeight - height) / 2);
      const oldTop = main.getBoundingClientRect().top;
      const position = scrollY;
      main.style.setProperty('--kb-intro-offset', `${offset}px`);
      main.setAttribute('data-kb-centered', '');
      centered = true;
      const shift = main.getBoundingClientRect().top - oldTop;
      if (preservePosition && position > 1 && Math.abs(shift) > .1) {
        scrollTo({ top: Math.max(0, position + shift), behavior: 'instant' });
      }
    }

    function revealPassedChapters() {
      if (window.KBChapterMotion) return;
      chapters.forEach(chapter => {
        if (chapter.dataset.kbReveal !== 'shown' && chapter.getBoundingClientRect().top < innerHeight * .94) {
          chapter.dataset.kbReveal = 'shown';
          observer?.unobserve(chapter);
        }
      });
    }

    function openGate() {
      if (gateOpened) return;
      gateOpened = true;
      if (window.KBChapterMotion) {
        window.KBChapterMotion.start();
        chapters.forEach(chapter => { chapter.dataset.kbReveal = 'shown'; });
        return;
      }
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          if (document.hidden || staticMode) return;
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.dataset.kbReveal = 'shown';
              observer.unobserve(entry.target);
            }
          });
        }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
        chapters.forEach(chapter => observer.observe(chapter));
      }
    }

    function updateScroll() {
      if (staticMode || !main) return;
      suppressInitialAnchorScroll();
      // A person's scroll also wins while fonts are still loading, before entrance starts.
      if (!introDone && !initialRootAnchor && scrollY > 1) finishEntrance();
      const heroRect = hero.getBoundingClientRect();
      if (entranceStarted && jobs.size && (heroRect.bottom < 0 || heroRect.top > innerHeight)) finishEntrance();
      const progress = gateOpened ? 1 : initialRootAnchor ? 0 : clamp(Math.max(0, scrollY) / 180);
      if (!initialRootAnchor && scrollY > 1) hasScrolled = true;
      if (sciences) {
        sciences.style.setProperty('--kb-science-progress', String(progress));
        sciences.style.setProperty('--kb-science-shift', `${16 * (1 - progress)}px`);
        sciences.dataset.kbScienceVisible = progress > 0 ? 'true' : 'false';
      }
      if (introDone && progress >= 1) openGate();
      if (gateOpened) revealPassedChapters();
    }

    function graphemes(text) {
      if (typeof Intl.Segmenter === 'function') {
        return [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(text)]
          .map(item => ({ text: item.segment, offset: item.index }));
      }
      const result = [];
      let offset = 0;
      for (const letter of text) { result.push({ text: letter, offset }); offset += letter.length; }
      return result;
    }

    function textRanges(line, glyphs) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let offset = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        nodes.push({ node, start: offset, end: offset + node.length });
        offset += node.length;
      }
      function boundary(index, end) {
        const item = nodes.find(entry => end ? index <= entry.end && index > entry.start : index < entry.end)
          || nodes.at(-1);
        return item ? [item.node, Math.max(0, Math.min(item.node.length, index - item.start))] : null;
      }
      return glyphs.map(glyph => {
        const start = boundary(glyph.offset, false);
        const end = boundary(glyph.offset + glyph.text.length, true);
        if (!start || !end) return null;
        const range = document.createRange();
        range.setStart(...start); range.setEnd(...end);
        return range.getBoundingClientRect();
      });
    }

    function foldHeading() {
      const heading = hero.querySelector('h1');
      const lines = heading ? [...heading.querySelectorAll('.type-line')] : [];
      if (!lines.length) return;
      const originals = lines.map(line => ({ line, nodes: [...line.childNodes], rect: line.getBoundingClientRect() }));
      const originalLabel = heading.getAttribute('aria-label');
      const headingRect = heading.getBoundingClientRect();
      const pieces = [];
      let restored = false;
      function restore() {
        if (restored) return;
        restored = true;
        originals.forEach(({ line, nodes }) => line.replaceChildren(...nodes));
        if (originalLabel === null) heading.removeAttribute('aria-label');
        else heading.setAttribute('aria-label', originalLabel);
        heading.removeAttribute('data-kb-fold');
        restorers.delete(restore);
      }
      restorers.add(restore);
      heading.setAttribute('aria-label', lines.map(line => line.textContent).join(' ').replace(/\s+/g, ' ').trim());
      for (const { line, nodes } of originals) {
        const glyphs = graphemes(line.textContent);
        const ranges = textRanges(line, glyphs);
        // Keep native wrapped or right-to-left runs rather than changing their layout.
        if (!glyphs.length || ranges.some((rect, index) => !rect || (index
          && (Math.abs(rect.top - ranges[index - 1].top) > 1 || rect.left < ranges[index - 1].left - .1)))) {
          restore(); return;
        }
        const fragment = document.createDocumentFragment();
        glyphs.forEach((glyph, index) => {
          const segment = document.createElement('span');
          segment.className = 'kb-fold-segment';
          segment.setAttribute('aria-hidden', 'true');
          segment.style.width = `${Math.max(0, (ranges[index + 1]?.left ?? ranges[index].right) - ranges[index].left)}px`;
          const piece = document.createElement('span');
          piece.className = 'kb-fold-piece';
          piece.textContent = glyph.text;
          piece.dataset.foldText = glyph.text;
          piece.style.transform = 'rotateX(-92deg)';
          piece.style.opacity = '0';
          segment.append(piece); fragment.append(segment); pieces.push(piece);
        });
        // Empty baseline markers remain measurable; the original nodes return at finish.
        nodes.filter(node => node.nodeType === Node.ELEMENT_NODE && !node.textContent)
          .forEach(node => fragment.append(node.cloneNode(true)));
        line.replaceChildren(fragment);
      }
      const after = heading.getBoundingClientRect();
      if (Math.abs(after.width - headingRect.width) > .5 || Math.abs(after.height - headingRect.height) > .5
        || originals.some(({ line, rect }) => {
          const next = line.getBoundingClientRect();
          return Math.abs(next.width - rect.width) > .5 || Math.abs(next.height - rect.height) > .5;
        })) { restore(); return; }
      heading.dataset.kbFold = 'entering';
      const start = clock();
      addJob(time => {
        let complete = true;
        pieces.forEach((piece, index) => {
          const t = clamp((time - start - index * 45) / 650);
          const progress = 1 - (1 - t) ** 4;
          if (t < 1) complete = false;
          piece.style.transform = `rotateX(${-92 * (1 - progress)}deg)`;
          piece.style.opacity = String(progress);
          piece.style.setProperty('--kb-heading-crease', String(.55 * (1 - progress)));
        });
        if (complete) { restore(); return false; }
        return true;
      });
    }

    function revealBrand() {
      const brand = hero.querySelector('.brand-hero');
      const orb = brand?.querySelector('.brand-orb');
      const capsule = brand?.querySelector('.brand-capsule');
      const copy = brand?.querySelector('.brand-copy');
      if (!brand || !orb || !capsule || !copy) return;
      const rect = capsule.getBoundingClientRect();
      const style = getComputedStyle(capsule);
      const shell = document.createElement('span');
      shell.className = 'kb-brand-shell';
      shell.setAttribute('aria-hidden', 'true');
      Object.assign(shell.style, {
        left: `${-parseFloat(style.borderLeftWidth || 0)}px`,
        top: `${-parseFloat(style.borderTopWidth || 0)}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
        border: style.border, borderRadius: style.borderRadius,
        background: style.background, boxShadow: style.boxShadow
      });
      capsule.prepend(shell);
      capsule.classList.add('kb-capsule-entering');
      const orbAnimation = animate(orb, [
        { transform: 'scale(.015)', opacity: 1, offset: 0, easing: 'cubic-bezier(.3,0,.35,1)' },
        { transform: 'scale(1.3)', opacity: 1, offset: .65, easing: 'ease-in-out' },
        { transform: 'scale(1)', opacity: 1, offset: 1 }
      ], { duration: 800, easing: 'ease-in-out' });
      const shellAnimation = animate(shell, [
        { width: `${rect.height}px`, opacity: 0, offset: 0 },
        { width: `${rect.height + (rect.width - rect.height) * .08}px`, opacity: 1, offset: .12 },
        { width: `${rect.width}px`, opacity: 1, offset: 1 }
      ], { duration: 440, delay: 456, easing: 'cubic-bezier(.16,1,.3,1)' });
      const line = copy.matches('.type-line') ? copy : copy.querySelector('.type-line') || copy;
      const originalNodes = [...line.childNodes];
      const originalLabel = copy.getAttribute('aria-label');
      const text = line.textContent;
      const glyphs = [];
      const fragment = document.createDocumentFragment();
      graphemes(text).forEach(glyph => {
        const span = document.createElement('span');
        span.textContent = glyph.text;
        span.style.visibility = 'hidden';
        span.setAttribute('aria-hidden', 'true');
        glyphs.push(span); fragment.append(span);
      });
      originalNodes.filter(node => node.nodeType === Node.ELEMENT_NODE && !node.textContent)
        .forEach(node => fragment.append(node.cloneNode(true)));
      copy.setAttribute('aria-label', text);
      line.replaceChildren(fragment);
      let restored = false;
      function restore() {
        if (restored) return;
        restored = true;
        orbAnimation?.cancel(); shellAnimation?.cancel(); shell.remove();
        capsule.classList.remove('kb-capsule-entering');
        line.replaceChildren(...originalNodes);
        if (originalLabel === null) copy.removeAttribute('aria-label');
        else copy.setAttribute('aria-label', originalLabel);
        restorers.delete(restore);
      }
      restorers.add(restore);
      let visible = 0;
      const start = clock();
      addJob(time => {
        const elapsed = time - start - 956 - 140;
        const count = elapsed < 0 ? 0 : Math.min(glyphs.length, Math.floor(elapsed / 45) + 1);
        while (visible < count) glyphs[visible++].style.visibility = 'visible';
        if (elapsed >= 0 && visible === glyphs.length) { restore(); return false; }
        return true;
      });
    }

    function revealSimple(node, frames, options = {}) {
      if (!node) return;
      node.dataset.kbEntrance = 'shown';
      const effect = animate(node, frames, { duration: 190, easing: 'cubic-bezier(.16,1,.3,1)', ...options });
      if (!effect) return;
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        effect.cancel();
        restorers.delete(restore);
      };
      restorers.add(restore);
      effect.finished.then(restore, () => {});
    }

    function traceEntrance() {
      const svg = hero.querySelector('.hero-window .frame-skin');
      const originalPath = svg?.querySelector('path');
      const band = hero.querySelector('.top-band');
      const formula = hero.querySelector('.top-formula');
      const figure = hero.querySelector('.hero-figure');
      const logo = hero.querySelector('.hero-logo');
      if (!svg || !originalPath || !band || !formula || !figure || !logo) { showAll(); return; }
      const start = clock();
      hero.dataset.kbTraceStage = 'band';
      revealSimple(band, [{ transform: 'scaleX(0)', transformOrigin: 'left center' },
        { transform: 'scaleX(1)', transformOrigin: 'left center' }], { duration: 200 });
      revealSimple(formula, [{ clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)' }], { duration: 240, delay: 60 });

      let renderer = null;
      let borderStart = null;
      let ringsStarted = false, ringsDone = false;
      const speed = 700 / 1000; // Constant CSS-pixel speed through visible AND logo intervals.
      const ns = 'http://www.w3.org/2000/svg';
      function prepare() {
        const frame = svg.getBoundingClientRect();
        const w = frame.width, h = frame.height;
        if (!w || !h || !originalPath.getAttribute('d')) return null;
        const r = Math.min(26 * w / 964, (w - 1) / 2, (h - 1) / 2);
        const report = window.KBFrameGeometry?.measure?.().find(item => item.className?.includes('hero-window'));
        const bandJoin = report?.joins?.find(join => join.name === 'hero-band' && join.status === 'joined');
        // Computed layout dimensions keep fractional authored edges while scaleX is in flight.
        const bandStyle = getComputedStyle(band);
        const bandBox = band.getBoundingClientRect();
        const bandLeft = bandJoin?.gap[0] ?? bandBox.left - frame.left;
        const bandRight = bandJoin?.gap[1] ?? bandLeft + parseFloat(bandStyle.width);
        const y0 = report?.pathTop ?? bandBox.top - frame.top + (parseFloat(getComputedStyle(originalPath).strokeWidth) || 1) / 2;
        const from = Math.max(r, Math.min(w - r, bandRight));
        const to = Math.max(r, Math.min(w - r, bandLeft));
        const routeD = `M${from},${y0}H${w-r}A${r},${r} 0 0 1 ${w},${y0+r}`
          + `V${h-r}A${r},${r} 0 0 1 ${w-r},${h}H${r}`
          + `A${r},${r} 0 0 1 0,${h-r}V${y0+r}A${r},${r} 0 0 1 ${r},${y0}H${to}`;
        const defs = document.createElementNS(ns, 'defs');
        const mask = document.createElementNS(ns, 'mask');
        mask.id = 'kb-hero-clockwise-mask';
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('x', '-8'); mask.setAttribute('y', '-8');
        mask.setAttribute('width', String(w + 16)); mask.setAttribute('height', String(h + 16));
        mask.style.maskType = 'luminance';
        const route = document.createElementNS(ns, 'path');
        route.setAttribute('d', routeD);
        Object.assign(route.style, { fill: 'none', stroke: '#fff', strokeWidth: '5px',
          strokeLinecap: 'butt', strokeLinejoin: 'round' });
        mask.append(route); defs.append(mask);
        // geometry.paint() must continue to find the original visible path FIRST.
        svg.append(defs);
        const length = route.getTotalLength();
        route.style.strokeDasharray = `${length} ${length}`;
        route.style.strokeDashoffset = String(length);
        const previousMask = originalPath.getAttribute('mask');
        originalPath.setAttribute('mask', `url(#${mask.id})`);
        svg.dataset.kbBorder = 'drawing';
        const quarter = Math.PI * r / 2;
        const rightStart = w - r - from + quarter;
        const bottomStart = rightStart + h - y0 - 2 * r + quarter;
        const relative = node => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top - frame.top, left: rect.left - frame.left,
            right: rect.right - frame.left, height: rect.height, width: rect.width };
        };
        const figureBox = relative(figure), logoBox = relative(logo);
        const logoRight = report?.joins?.find(join => join.name === 'hero')?.silhouette?.[1] ?? logoBox.right;
        const events = [
          ['.brand-hero', revealBrand],
          ['.section-label', null],
          ['h1', foldHeading],
          ['.hero-intro', null],
          ['.hero-contact', null]
        ].map(([selector, action]) => {
          const node = hero.querySelector('.hero-scene ' + selector);
          return { node, action, at: rightStart + Math.max(0, Math.min(h - y0 - 2*r, relative(node).top - y0 - r)), fired: false };
        }).sort((a,b) => a.at - b.at);
        let cleaned = false;
        function cleanup() {
          if (cleaned) return;
          cleaned = true;
          if (previousMask === null) originalPath.removeAttribute('mask');
          else originalPath.setAttribute('mask', previousMask);
          defs.remove();
          figure.style.removeProperty('clip-path'); logo.style.removeProperty('clip-path');
          svg.dataset.kbBorder = 'shown';
          restorers.delete(cleanup);
        }
        restorers.add(cleanup);
        return { length, cleanup, draw(distance) {
          route.style.strokeDashoffset = String(Math.max(0, length - distance));
          svg.dataset.kbBorderProgress = String(Math.min(1, distance / length));
          if (distance < rightStart) hero.dataset.kbTraceStage = 'top';
          else if (distance < bottomStart) hero.dataset.kbTraceStage = 'right';
          else if (distance < bottomStart + w - 2*r) hero.dataset.kbTraceStage = 'bottom';
          else hero.dataset.kbTraceStage = 'left';
          const currentY = distance >= bottomStart ? h : y0 + r + Math.max(0, distance - rightStart);
          const figureProgress = clamp((currentY - figureBox.top) / figureBox.height);
          if (figureProgress > 0) {
            figure.dataset.kbEntrance = 'shown';
            if (window.KBRingReveal) {
              if (!ringsStarted) {
                ringsStarted = true;
                window.KBRingReveal.play(figure).then(() => { ringsDone = true; schedule(); });
                addJob(() => ringsDone ? false : true);
              }
            } else {
              figure.style.clipPath = `inset(0 0 ${100*(1-figureProgress)}% 0)`;
              if (figureProgress >= 1) figure.style.removeProperty('clip-path');
            }
          }
          events.forEach(event => {
            if (event.fired || distance < event.at) return;
            event.fired = true;
            event.node.dataset.kbEntrance = 'shown';
            if (event.action) event.action();
            else revealSimple(event.node, [{ clipPath:'inset(0 100% 0 0)' },{ clipPath:'inset(0 0% 0 0)' }]);
          });
          const currentX = w - r - Math.max(0, distance - bottomStart);
          if (distance >= bottomStart && currentX <= logoRight) {
            logo.dataset.kbEntrance = 'shown';
            const hidden = 100 * clamp((currentX - logoBox.left) / logoBox.width);
            logo.style.clipPath = `inset(0 0 0 ${hidden}%)`;
            if (!hidden) logo.style.removeProperty('clip-path');
          }
        } };
      }
      addJob(time => {
        if (!renderer) {
          if (svg.dataset.geometryState === 'profile-error' || time - start > 1800) {
            showAll(); return false;
          }
          if (svg.dataset.geometryState !== 'ready') return true;
          renderer = prepare();
          if (!renderer) return true;
          borderStart = Math.max(start + 300, time);
        }
        if (time < borderStart) return true;
        const distance = Math.min(renderer.length, (time - borderStart) * speed);
        renderer.draw(distance);
        if (distance >= renderer.length) {
          renderer.cleanup();
          hero.dataset.kbTraceStage = 'outline-complete';
          return false;
        }
        return true;
      });
    }

    function startEntrance() {
      if (stopped || staticMode || entranceStarted) return;
      entranceStarted = true;
      if (hasScrolled) { finishEntrance(); return; }
      traceEntrance();
      root.classList.add('kb-motion-ready');
      schedule();
    }

    function queueLayout() {
      if (stopped || staticMode || layoutFrame !== null) return;
      if (document.hidden) { layoutPending = true; return; }
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        if (document.hidden) { layoutPending = true; return; }
        layoutPending = false;
        if (entranceStarted) finishEntrance();
        centerScene(true);
        updateScroll();
      });
    }

    function pause() {
      if (pausedAt === null) pausedAt = performance.now();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const active = [...animations, ...chapters.flatMap(chapter => chapter.getAnimations?.() || [])];
      active.forEach(animation => {
        if (animation.playState === 'running') { animation.pause(); pausedAnimations.add(animation); }
      });
    }

    function resume() {
      if (pausedAt !== null) { pausedDuration += performance.now() - pausedAt; pausedAt = null; }
      pausedAnimations.forEach(animation => {
        if (animation.playState === 'paused') animation.play();
      });
      pausedAnimations.clear();
      if (layoutPending) queueLayout();
      schedule();
    }

    function destroy() {
      if (stopped) return;
      finishEntrance();
      stopped = true;
      abort.abort(); observer?.disconnect(); sizeObserver?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    }

    if (!main || !hero || !sciences || !rootHash(initialHash) || reduced.matches || editorActive()) {
      showAll({ resetPosition: true }); return;
    }
    if (hasScrolled) { showAll(); return; }
    root.classList.add('js', 'intro-mode');
    chapters.forEach(chapter => { chapter.dataset.kbReveal = 'waiting'; });
    if (initialRootAnchor) scrollTo({ top: 0, behavior: 'instant' });
    centerScene(false);
    updateScroll();

    // Only suppress the browser's first #top/#main jump, never a person's scroll.
    function releaseInitialAnchor() { initialRootAnchor = false; }
    addEventListener('wheel', releaseInitialAnchor, { passive: true, signal });
    addEventListener('touchstart', releaseInitialAnchor, { passive: true, signal });
    addEventListener('touchmove', releaseInitialAnchor, { passive: true, signal });
    addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Tab', 'Enter'].includes(event.key)) releaseInitialAnchor();
    }, { signal });
    addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.clientX >= document.documentElement.clientWidth - 24) releaseInitialAnchor();
    }, { passive: true, signal });
    addEventListener('scroll', () => { suppressInitialAnchorScroll(); schedule(); }, { passive: true, signal });
    addEventListener('resize', queueLayout, { passive: true, signal });
    addEventListener('hashchange', () => {
      // Following a deep link reveals its target before native anchor scrolling.
      if (!rootHash(location.hash)) showAll();
      else schedule();
    }, { signal });
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
      if (link) releaseInitialAnchor();
      if (link && !rootHash(link.hash)) showAll();
    }, { capture: true, signal });
    reduced.addEventListener('change', () => { if (reduced.matches) showAll({ resetPosition: true }); }, { signal });
    addEventListener('kb:editor-mode', () => showAll({ resetPosition: true }), { signal });
    document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume(), { signal });
    addEventListener('pagehide', event => { if (event.persisted) pause(); else destroy(); }, { signal });
    addEventListener('pageshow', event => {
      if (event.persisted) resume();
      if (initialRootAnchor) {
        scrollTo({ top: 0, behavior: 'instant' });
        hasScrolled = false;
        centerScene(false);
        schedule();
        return;
      }
      // A restored scroll position is continuation, never a new entrance.
      if (!rootHash(location.hash) || (scrollY > 1 && !hasScrolled)) showAll();
      else { centerScene(true); schedule(); }
    }, { signal });
    if ('ResizeObserver' in window) {
      let first = true;
      sizeObserver = new ResizeObserver(() => {
        if (first) { first = false; return; }
        queueLayout();
      });
      ['.hero-window', '.hero-logo'].forEach(selector => {
        const node = hero.querySelector(selector);
        if (node) sizeObserver.observe(node);
      });
    }
    const editorObserver = new MutationObserver(() => {
      if (editorActive()) { showAll({ resetPosition: true }); editorObserver.disconnect(); }
    });
    editorObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
    editorObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    signal.addEventListener('abort', () => editorObserver.disconnect(), { once: true });
    Promise.resolve(document.fonts?.ready).then(() => {
      if (!stopped && !staticMode) { centerScene(true); startEntrance(); }
    }).catch(() => showAll({ resetPosition: true }));
  }

  function safeInit() {
    try { init(); }
    catch (error) {
      emergencyRestore();
      document.documentElement.classList.remove('intro-mode');
      document.documentElement.classList.add('kb-motion-static', 'kb-motion-ready');
      console.error('KB motion:', error);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeInit, { once: true });
  else safeInit();
})();
