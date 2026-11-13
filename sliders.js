(() => {
  'use strict';

  function init() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const abort = new AbortController();
    const signal = abort.signal;
    const states = new Map();
    const practice = document.getElementById('practice');
    const restoringPage = performance.getEntriesByType?.('navigation')[0]?.type === 'back_forward';
    let processStates = [];
    let processActive = false;
    let processFrame = null;
    let layoutFrame = null;
    let resizeFrame = null;
    let disposed = false;

    function notifyLayout() {
      if (disposed || document.hidden || layoutFrame !== null) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        dispatchEvent(new CustomEvent('kb:layout', { detail: { source: 'sliders' } }));
      });
    }

    function restoreBodyStyles(state) {
      for (const [name, value, priority] of state.originalStyles) {
        if (value) state.body.style.setProperty(name, value, priority);
        else state.body.style.removeProperty(name);
      }
    }

    function writeOpen(state, open) {
      state.nativeOpen = open;
      state.details.open = open;
    }

    function settle(state, open) {
      state.generation += 1;
      state.animation?.cancel();
      state.animation = null;
      state.desiredOpen = open;
      writeOpen(state, open);
      restoreBodyStyles(state);
      state.details.dataset.sliderState = open ? 'open' : 'closed';
      reportStep(state);
      notifyLayout();
      if (state.isProcess) scheduleProcess();
    }

    function measuredHeight(state) {
      // This is measured with no active height effect. It includes authored padding.
      restoreBodyStyles(state);
      return state.body.getBoundingClientRect().height;
    }

    function transition(state, open) {
      if (disposed) return;
      const previousHeight = state.details.open ? state.body.getBoundingClientRect().height : 0;
      state.generation += 1;
      const generation = state.generation;
      state.animation?.cancel();
      state.animation = null;
      state.desiredOpen = open;
      reportStep(state);

      if (reduced.matches || document.hidden || typeof state.body.animate !== 'function') {
        settle(state, open);
        return;
      }
      // Keep native content rendered until the closing height reaches zero.
      writeOpen(state, true);
      const naturalHeight = measuredHeight(state);
      const targetHeight = open ? naturalHeight : 0;
      state.targetHeight = targetHeight;
      if (Math.abs(targetHeight - previousHeight) < .5) {
        settle(state, open);
        return;
      }

      state.body.style.height = `${previousHeight}px`;
      state.body.style.overflow = 'hidden';
      state.details.dataset.sliderState = open ? 'opening' : 'closing';
      const distance = Math.abs(targetHeight - previousHeight);
      const duration = Math.max(140, Math.min(380, 160 + Math.sqrt(distance) * 10));
      const animation = state.body.animate([
        { height: `${previousHeight}px` },
        { height: `${targetHeight}px` }
      ], { duration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' });
      state.animation = animation;
      reportStep(state);
      notifyLayout();
      animation.finished.then(() => {
        if (disposed || generation !== state.generation) return;
        settle(state, open);
      }, () => {
        // Reversal and resize deliberately cancel an obsolete animation.
      });
    }

    function setOpen(state, open) {
      if (state.isProcess) {
        state.manualOverride = open;
        if (open) state.scrollReached = true;
        setStepOffset(state, 0);
      }
      if (open && state.details.classList.contains('situation-item')) {
        states.forEach(other => {
          if (other !== state && other.details.classList.contains('situation-item')
            && (other.desiredOpen || other.details.open)) transition(other, false);
        });
      }
      transition(state, open);
    }

    document.querySelectorAll('details[data-slider]').forEach(details => {
      const summary = [...details.children].find(node => node.tagName === 'SUMMARY');
      const body = [...details.children].find(node => node.classList.contains('slider-reveal'));
      if (!summary || !body) return;
      const state = {
        details, summary, body,
        content: body.firstElementChild || body,
        isProcess: details.classList.contains('step-details') && !!details.closest('#practice'),
        manualOverride: null,
        scrollReached: false,
        parallaxOffset: 0,
        desiredOpen: details.open,
        nativeOpen: details.open,
        animation: null,
        generation: 0,
        targetHeight: 0,
        originalStyles: ['height', 'overflow'].map(name => [name,
          body.style.getPropertyValue(name), body.style.getPropertyPriority(name)])
      };
      states.set(details, state);
      details.dataset.sliderState = details.open ? 'open' : 'closed';
      if (state.isProcess) {
        details.dataset.stepScrollManaged = 'true';
        details.dataset.stepParallax = '0';
        state.scrollReached = details.open;
        reportStep(state);
      }
      summary.addEventListener('click', event => {
        if (event.defaultPrevented || event.button > 0) return;
        const control = event.target instanceof Element
          ? event.target.closest('a[href], button, input, select, textarea') : null;
        if (control && control !== summary) return;
        event.preventDefault();
        // Keyboard Enter/Space generates the same native summary click.
        setOpen(state, !state.desiredOpen);
      }, { signal });
      details.addEventListener('toggle', () => {
        // Respect an external/native open change, including find-in-page.
        if (details.open !== state.nativeOpen) {
          // Native find-in-page or another explicit control wins over scroll.
          if (state.isProcess) {
            state.manualOverride = details.open;
            state.scrollReached = state.scrollReached || details.open;
            setStepOffset(state, 0);
          }
          settle(state, details.open);
        }
      }, { signal });
    });

    if (!states.size) return;
    processStates = [...states.values()].filter(state => state.isProcess);

    function editorMode() {
      return document.documentElement.classList.contains('kb-editor-editing')
        || document.body.classList.contains('kb-editor-editing')
        || document.documentElement.classList.contains('vmg-editor-editing')
        || new URLSearchParams(location.search).has('editor_view');
    }

    function reportStep(state) {
      if (!state.isProcess) return;
      state.details.dataset.stepDesiredOpen = String(state.desiredOpen);
      state.details.dataset.stepScroll = state.manualOverride !== null
        ? (state.manualOverride ? 'manual-open' : 'manual-closed')
        : (reduced.matches || editorMode()) && state.desiredOpen ? 'static-open'
        : !processActive ? 'waiting-chapter'
        : !state.scrollReached ? 'waiting'
        : state.animation ? 'opening' : 'open';
    }

    function setStepOffset(state, offset) {
      const value = Math.round(offset * 100) / 100;
      if (Math.abs(value - state.parallaxOffset) < .01) return;
      state.parallaxOffset = value;
      state.content.style.setProperty('--step-scroll-offset', `${value}px`);
      state.details.dataset.stepParallax = String(value);
    }

    function snapshotAnchor(preferred) {
      const node = preferred || processStates.find(state => state.summary.getBoundingClientRect().bottom > 0)?.summary
        || practice?.nextElementSibling;
      return node ? { node, top: node.getBoundingClientRect().top, scrolling: scrollY > 0 } : null;
    }

    function preserveAnchor(anchor) {
      if (!anchor?.scrolling || !anchor.node.isConnected) return;
      const delta = anchor.node.getBoundingClientRect().top - anchor.top;
      // Native scroll anchoring may already have compensated; only correct the remainder.
      if (Math.abs(delta) > .5) scrollTo({ top: Math.max(0, scrollY + delta), behavior: 'instant' });
    }

    function staticProcess() {
      const anchor = snapshotAnchor();
      processStates.forEach(state => {
        setStepOffset(state, 0);
        if (state.manualOverride === false) { reportStep(state); return; }
        state.scrollReached = true;
        if (!state.desiredOpen || state.animation) settle(state, true);
        else reportStep(state);
      });
      preserveAnchor(anchor);
    }

    function updateProcess() {
      if (disposed || document.hidden || !processStates.length) return;
      if (reduced.matches || editorMode()) { staticProcess(); return; }
      if (!processActive) return;
      const trigger = innerHeight * .78;
      const anchor = snapshotAnchor();
      let openedAbove = false;
      let visibleOpening = false;
      processStates.forEach(state => {
        if (!state.animation || !state.desiredOpen || state.manualOverride !== null) return;
        if (state.summary.getBoundingClientRect().bottom < 0) {
          settle(state, true);
          openedAbove = true;
        } else visibleOpening = true;
      });
      // Re-measure after each opening: natural-flow growth moves the later rows.
      processStates.forEach(state => {
        if (state.manualOverride !== null || state.scrollReached) { reportStep(state); return; }
        const rect = state.summary.getBoundingClientRect();
        if (rect.top > trigger) return;
        if (rect.bottom >= 0 && visibleOpening) return;
        state.scrollReached = true;
        if (rect.bottom < 0) {
          // A fast pass/deep link never waits for invisible height animations.
          settle(state, true);
          openedAbove = true;
        } else { transition(state, true); visibleOpening = !!state.animation; }
      });
      if (openedAbove) preserveAnchor(anchor);
      processStates.forEach(state => {
        if (!state.desiredOpen || state.manualOverride !== null) { setStepOffset(state, 0); return; }
        const top = state.summary.getBoundingClientRect().top;
        const progress = Math.max(0, Math.min(1, (trigger - top) / Math.max(1, innerHeight * .36)));
        // Keep all ink inside the reveal box even before the parallax reaches zero.
        const bottomPadding = parseFloat(getComputedStyle(state.content).paddingBottom) || 0;
        const travel = Math.min(18, Math.max(0, bottomPadding - 2));
        setStepOffset(state, travel * (1-progress) ** 2);
      });
    }

    function scheduleProcess() {
      if (disposed || document.hidden || processFrame !== null
        || (!processActive && !reduced.matches && !editorMode())) return;
      processFrame = requestAnimationFrame(() => {
        processFrame = null;
        updateProcess();
      });
    }

    function activateProcess(reason) {
      if (!processStates.length) return;
      processActive = true;
      practice.dataset.processScroll = reason || 'chapter';
      processStates.forEach(reportStep);
      scheduleProcess();
    }

    function hashTarget() {
      if (!location.hash || ['#', '#main', '#top'].includes(location.hash)) return null;
      try { return document.getElementById(decodeURIComponent(location.hash.slice(1))); }
      catch { return null; }
    }

    function revealHash(initial = false) {
      const target = hashTarget();
      if (!target || !practice || (!initial && target !== practice && !practice.contains(target))) return;
      activateProcess('deep-link');
      // A history restoration may carry an old hash while restoring a different
      // scroll position. Reveal only what that actual viewport has passed.
      if (initial && restoringPage) return;
      const row = target.closest('.process-row');
      const index = processStates.findIndex(state => state.details.closest('.process-row') === row);
      const following = !!(practice.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !practice.contains(target);
      if (index < 0 && !following) return;
      const anchor = snapshotAnchor(target);
      processStates.forEach((state, i) => {
        if ((!following && i > index) || (state.manualOverride === false && i !== index)) return;
        if (i === index) state.manualOverride = null;
        state.scrollReached = true;
        setStepOffset(state, 0);
        settle(state, true);
      });
      preserveAnchor(anchor);
      scheduleProcess();
    }

    addEventListener('kb:chapter-start', event => {
      if (event.detail?.id === 'practice') activateProcess('chapter');
    }, { signal });
    addEventListener('scroll', scheduleProcess, { passive: true, signal });
    addEventListener('hashchange', () => revealHash(false), { signal });
    addEventListener('kb:editor-mode', () => { if (editorMode()) staticProcess(); }, { signal });
    window.KBProcessScroll = {
      refresh: scheduleProcess,
      inspect: () => ({ active: processActive, reducedMotion: reduced.matches,
        hidden: document.hidden, framePending: processFrame !== null,
        steps: processStates.map(state => ({ id: state.details.closest('.process-row')?.id,
          state: state.details.dataset.stepScroll, desiredOpen: state.desiredOpen,
          nativeOpen: state.details.open, reached: state.scrollReached,
          manualOverride: state.manualOverride, offset: state.parallaxOffset,
          animating: !!state.animation })) })
    };
    revealHash(true);
    if (reduced.matches || editorMode()) staticProcess();
    let contentObserver = null;
    let bodyObserver = null;
    if ('ResizeObserver' in window) {
      const byContent = new Map([...states.values()].map(state => [state.content, state]));
      contentObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          const state = byContent.get(entry.target);
          if (!state?.details.open) return;
          if (state.animation && state.desiredOpen) {
            const style = getComputedStyle(state.content);
            const outer = state.content.getBoundingClientRect().height
              + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
            if (Math.abs(outer - state.targetHeight) > 1) transition(state, true);
          }
        });
        notifyLayout();
        scheduleProcess();
      });
      bodyObserver = new ResizeObserver(() => { notifyLayout(); scheduleProcess(); });
      states.forEach(state => {
        contentObserver.observe(state.content);
        bodyObserver.observe(state.body);
      });
    }

    function finishAll() {
      states.forEach(state => {
        if (state.animation) settle(state, state.desiredOpen);
      });
      notifyLayout();
    }

    function resized() {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        // A width change may reflow paragraphs. Return each native body to auto height.
        finishAll();
        scheduleProcess();
      });
    }

    addEventListener('resize', resized, { passive: true, signal });
    reduced.addEventListener('change', () => {
      if (reduced.matches) { finishAll(); staticProcess(); }
      else scheduleProcess();
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        finishAll();
        processStates.forEach(state => setStepOffset(state, 0));
        if (processFrame !== null) cancelAnimationFrame(processFrame);
        processFrame = null;
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        layoutFrame = null;
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      } else { notifyLayout(); scheduleProcess(); }
    }, { signal });
    document.fonts?.ready.then(() => { if (!disposed) resized(); });
    addEventListener('pageshow', event => {
      notifyLayout();
      if (!event.persisted) revealHash(true);
      scheduleProcess();
    }, { signal });
    addEventListener('pagehide', event => {
      finishAll();
      if (event.persisted) return;
      disposed = true;
      abort.abort();
      contentObserver?.disconnect(); bodyObserver?.disconnect();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (processFrame !== null) cancelAnimationFrame(processFrame);
    }, { signal });
    notifyLayout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
