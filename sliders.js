(() => {
  'use strict';

  // Intersect one real box with a shared viewport reading band. The two
  // columns use this same interval even when their own tops/heights differ.
  function clipBand(box, bandTop, bandBottom) {
    const height = Math.max(0, box.height);
    const visibleTop = Math.max(box.top, bandTop);
    const visibleBottom = Math.min(box.bottom, bandBottom);
    if (!height || visibleBottom <= visibleTop) return {top: height, bottom: 0, hidden: true};
    const top = Math.min(height, Math.max(0, bandTop - box.top));
    const bottom = Math.min(height - top, Math.max(0, box.bottom - bandBottom));
    return {top, bottom, hidden: false};
  }

  // Leave the track as one header stack, including its final margin gap.
  function stackRelease(timelineBottom, last) {
    return Math.min(0, timelineBottom - last.rail - last.headerHeight - last.gap);
  }

  // One layout-time map for native sticky grid items. No scroll-time writes.
  function nativeContextLayout(base, unit, railTop, headerEnd, trackInset, paddingTop) {
    const ratio = unit / base.unit;
    const q = base.sourceFirstSummaryNormalOffset * ratio;
    const pinOrigin = railTop - q;
    const commonEnd = headerEnd + trackInset;
    const nodes = {};
    Object.entries(base.nodes).forEach(([name, original]) => {
      const normalTop = original.normalTop * ratio;
      const height = original.height * ratio;
      const pinTop = pinOrigin + normalTop;
      nodes[name] = {normalTop, normalLeft: original.normalLeft * ratio,
        width: original.width * ratio, height, pinTop,
        reserve: Math.max(0, commonEnd - pinTop - height)};
    });
    nodes.skin = {normalTop: 0, normalLeft: 0, width: base.width * ratio,
      height: q, pinTop: pinOrigin, reserve: Math.max(0, commonEnd - railTop)};
    return {nodes, paddingTop, q, desiredHeadingTop: nodes.heading?.pinTop ?? null};
  }

  function init() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const startupFallback = !!document.documentElement.dataset.kbMotionFallback;
    const abort = new AbortController();
    const signal = abort.signal;
    const states = new Map();
    const practice = document.getElementById('practice');
    const restoringPage = performance.getEntriesByType?.('navigation')[0]?.type === 'back_forward';
    let processStates = [];
    let processActive = false;
    let processStackMode = 'static';
    let stackNeedsLayout = true;
    let stackConfiguring = false;
    let stackMetrics = [];
    let contextMetrics = null, contextShift = 0;
    let activeStep = -1;
    let userScrollIntent = 0, lastStepHashIntent = 0;
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
      // A completed parameter disclosure changes the left reading span. Rebuild
      // its measured height/offset after both opening and closing have settled.
      const processParameter = !!state.details.closest('#practice .process-terms');
      if (processParameter) stackNeedsLayout = true;
      if (state.isProcess || processParameter) scheduleProcess();
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
        stackNeedsLayout = true;
        if (processStackMode === 'stack') {
          const anchor = snapshotAnchor(state.summary);
          settle(state, open);
          configureProcess();
          preserveAnchor(anchor);
          scheduleProcess();
          return;
        }
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
            stackNeedsLayout = true;
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
        : !processActive && !reduced.matches && !editorMode() ? 'waiting-chapter'
        : processStackMode === 'stack' ? (state.stackPhase || 'upcoming')
        : state.desiredOpen ? 'static-open' : 'closed';
    }

    function setStepOffset(state, offset) {
      // The accepted donor is a native sticky accordion, without content parallax.
      state.parallaxOffset = 0;
      state.content.style.removeProperty('--step-scroll-offset');
      state.details.dataset.stepParallax = '0';
    }

    function snapshotAnchor(preferred) {
      const node = preferred || processStates.find(state => state.summary.getBoundingClientRect().bottom > 0)?.summary
        || practice?.nextElementSibling;
      return node ? { node, top: node.getBoundingClientRect().top, scrolling: scrollY > 0 } : null;
    }

    function preserveAnchor(anchor) {
      if (!anchor?.scrolling || !anchor.node.isConnected) return;
      const delta = anchor.node.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > .5) scrollTo({ top: Math.max(0, scrollY + delta), behavior: 'instant' });
    }

    function writeStyle(node, name, value) {
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    }

    function resetProcessContext() {
      contextMetrics = null;
      contextShift = 0;
      if (!practice) return;
      const skin = practice.querySelector(':scope > .process-context-skin');
      const wasNative = practice.dataset.processContextNative === 'true';
      delete practice.dataset.processContextNative;
      const properties = Array.from(practice.style).filter(name => name.startsWith('--process-context-'));
      properties.forEach(name => practice.style.removeProperty(name));
      skin?.remove();
      if (wasNative || skin || properties.length) dispatchEvent(new CustomEvent('kb:process-context'));
    }

    function ensureNativeContext() {
      let skin = practice.querySelector(':scope > .process-context-skin');
      if (!skin) {
        skin = document.createElement('div');
        skin.className = 'process-context-skin';
        skin.setAttribute('aria-hidden', 'true');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('process-context-outline');
        svg.setAttribute('aria-hidden', 'true');
        // geometry owns the shared-path <use> and all contour/mask dimensions.
        skin.append(svg);
        practice.append(skin);
      }
      return skin;
    }

    function applyNativeContext(base, metrics, unit, paddingTop) {
      const timeline = practice.querySelector('.process-timeline');
      const style = getComputedStyle(timeline);
      const trackInset = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      const last = metrics[metrics.length - 1];
      const layout = nativeContextLayout(base, unit, metrics[0].rail,
        last.rail + last.headerHeight + last.gap, trackInset, paddingTop);
      ensureNativeContext();
      writeStyle(practice, '--process-context-padding-top', paddingTop + 'px');
      Object.entries(layout.nodes).forEach(([name, node]) => {
        Object.entries(node).forEach(([property, value]) => {
          const cssName = property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
          writeStyle(practice, '--process-context-' + name + '-' + cssName, value + 'px');
        });
      });
      contextMetrics = {...base, layoutUnit: unit, headingNormalOffset: layout.nodes.heading.normalTop,
        firstSummaryNormalOffset: layout.q, desiredHeadingTop: layout.desiredHeadingTop};
      practice.dataset.processContextNative = 'true';
      // A layout transition is coherent before paint. Ordinary scroll never
      // writes context positions, CSS shift tokens or this synchronization event.
      dispatchEvent(new CustomEvent('kb:process-context'));
    }

    function readNativeContextShift() {
      if (!practice || !contextMetrics || practice.dataset.processContextNative !== 'true') return 0;
      const heading = practice.querySelector(':scope > h2');
      if (!heading) return 0;
      const shift = heading.getBoundingClientRect().top - practice.getBoundingClientRect().top
        - contextMetrics.headingNormalOffset;
      return Number.isFinite(shift) ? Math.max(0, shift) : 0;
    }

    function intrinsicHeight(node) {
      const style = getComputedStyle(node);
      const number = value => parseFloat(value) || 0;
      const children = Array.from(node.children).filter(child => getComputedStyle(child).display !== 'none');
      const content = children.reduce((height, child) => {
        const childStyle = getComputedStyle(child);
        return height + child.getBoundingClientRect().height
          + number(childStyle.marginTop) + number(childStyle.marginBottom);
      }, 0);
      return content + Math.max(0, children.length - 1) * number(style.rowGap)
        + number(style.paddingTop) + number(style.paddingBottom)
        + number(style.borderTopWidth) + number(style.borderBottomWidth);
    }

    function setStackMode(mode) {
      processStackMode = mode;
      if (practice) {
        practice.dataset.processStackMode = mode;
        if (mode === 'static') {
          resetProcessContext();
          activeStep = -1;
          delete practice.dataset.processStackActive;
          delete practice.dataset.processStackRelease;
          delete practice.dataset.processStackEndPacked;
          processStates.forEach(state => {
            const row = state.details.closest('.process-row');
            delete row.dataset.processStackPhase;
            state.stackClip = null;
            [state.body, row.querySelector('.process-terms')].forEach(node => {
              delete node.dataset.processStackClip;
              node.style.removeProperty('--process-stack-clip-top');
              node.style.removeProperty('--process-stack-clip-bottom');
            });
          });
        }
      }
    }

    function openProcessBodies() {
      processStates.forEach(state => {
        setStepOffset(state, 0);
        state.scrollReached = true;
        if (state.manualOverride === false) { reportStep(state); return; }
        if (!state.desiredOpen || state.animation) settle(state, true);
        else reportStep(state);
      });
    }

    function staticProcess() {
      if (stackConfiguring) return;
      stackConfiguring = true;
      const anchor = snapshotAnchor();
      setStackMode('static');
      openProcessBodies();
      preserveAnchor(anchor);
      stackConfiguring = false;
      notifyLayout();
    }

    function configureProcess() {
      if (!practice || !processStates.length || stackConfiguring) return;
      stackConfiguring = true;
      stackNeedsLayout = false;
      const nativeActive = processStackMode === 'stack'
        && practice.dataset.processContextNative === 'true' && !!contextMetrics;
      const detailsContents = window.CSS?.supports?.('selector(details::details-content)') === true;
      const stickyContents = window.CSS?.supports?.('position', 'sticky') === true
        && window.CSS?.supports?.('display', 'contents') === true
        && window.CSS?.supports?.('display', 'grid') === true;
      const fallback = startupFallback ? 'startup-fallback'
        : reduced.matches ? 'reduced-motion' : editorMode() ? 'editor'
        : innerWidth <= 1024 ? 'narrow' : !detailsContents || !stickyContents ? 'unsupported-sticky-contents' : null;
      if (fallback) {
        setStackMode('static');
        // A late enhancement must preserve the native disclosure states a reader saw.
        if (!startupFallback) openProcessBodies();
        stackMetrics = [];
        practice.dataset.processStackFallback = fallback;
        stackConfiguring = false;
        notifyLayout();
        return;
      }
      // Never take an already pinned context out of native layout just to read
      // expanded parameter heights. Only the initial activation measures static.
      if (!nativeActive) setStackMode('static');
      openProcessBodies();
      delete practice.dataset.processStackFallback;
      const practiceBox = practice.getBoundingClientRect();
      const unit = practiceBox.width / 964;
      const railTop = 304 * unit, gap = 4 * unit;
      const ratio = nativeActive ? unit / contextMetrics.unit : 1;
      let rail = railTop, offset = 0;
      const metrics = processStates.map((state, index) => {
        const row = state.details.closest('.process-row');
        const terms = row.querySelector('.process-terms');
        const headerBox = state.summary.getBoundingClientRect();
        const headerHeight = headerBox.height;
        const rowBox = nativeActive ? null : row.getBoundingClientRect();
        const termsOffset = nativeActive ? contextMetrics.termsOffsets[index] * ratio
          : Math.max(0, terms.getBoundingClientRect().top - rowBox.top - headerHeight);
        const headerLeft = nativeActive ? contextMetrics.headerLefts[index] * ratio
          : headerBox.left - rowBox.left;
        const rowMinimum = Math.max(0, (parseFloat(getComputedStyle(row).minHeight) || 0) - headerHeight);
        const bodyHeight = Math.max(state.desiredOpen ? intrinsicHeight(state.body) : 0,
          termsOffset + intrinsicHeight(terms), rowMinimum);
        const bodyTop = Math.min(rail + headerHeight + gap, innerHeight - bodyHeight - 12);
        const dot = getComputedStyle(row, '::before');
        const rowDotTop = parseFloat(dot.top) || headerHeight;
        const item = {index, state, row, terms, rail, offset, headerHeight, gap, bodyHeight,
          bodyTop, termsOffset, headerLeft, dotTop: Math.max(0, rowDotTop - headerHeight),
          dotImage: dot.backgroundImage, dotSize: dot.backgroundSize, dotWidth: dot.width,
          dotLeft: (parseFloat(dot.left) || 0) - headerLeft};
        rail += headerHeight + gap;
        offset += headerHeight + gap + bodyHeight;
        return item;
      });
      const minimumReadingBody = Math.max(48, (parseFloat(getComputedStyle(processStates[0].content).lineHeight) || 17) * 3);
      if (rail + minimumReadingBody + 12 > innerHeight) {
        setStackMode('static');
        openProcessBodies();
        stackMetrics = [];
        practice.dataset.processStackFallback = 'short';
        stackConfiguring = false;
        notifyLayout();
        return;
      }
      let base = contextMetrics;
      if (!nativeActive) {
        const selectors = {heading: ':scope > h2', intro: ':scope > .practice-intro', figure: ':scope > .process-figure'};
        const nodes = {};
        Object.entries(selectors).forEach(([name, selector]) => {
          const node = practice.querySelector(selector);
          if (!node) return;
          const box = node.getBoundingClientRect();
          nodes[name] = {normalTop: box.top - practiceBox.top, normalLeft: box.left - practiceBox.left,
            width: box.width, height: box.height};
        });
        if (!nodes.heading || !nodes.intro || !nodes.figure) {
          setStackMode('static');
          practice.dataset.processStackFallback = 'missing-context';
          stackMetrics = [];
          stackConfiguring = false;
          notifyLayout();
          return;
        }
        base = {unit, width: practiceBox.width, nodes,
          sourceFirstSummaryNormalOffset: processStates[0].summary.getBoundingClientRect().top - practiceBox.top,
          termsOffsets: metrics.map(item => item.termsOffset), headerLefts: metrics.map(item => item.headerLeft)};
      }
      metrics.forEach(item => {
        const {state, row, terms, index} = item;
        const values = {
          '--process-stack-index': index,
          '--process-stack-header-row': index * 2 + 1,
          '--process-stack-body-row': index * 2 + 2,
          '--process-stack-header-top': item.rail + 'px',
          '--process-stack-header-height': item.headerHeight + 'px',
          '--process-stack-gap': item.gap + 'px',
          '--process-stack-body-top': item.bodyTop + 'px',
          '--process-stack-body-height': item.bodyHeight + 'px',
          '--process-stack-terms-top': (item.bodyTop + item.termsOffset) + 'px',
          '--process-stack-terms-offset': item.termsOffset + 'px',
          '--process-stack-dot-left': item.dotLeft + 'px',
          '--process-stack-dot-top': item.dotTop + 'px',
          '--process-stack-dot-width': item.dotWidth,
          '--process-stack-dot-image': item.dotImage,
          '--process-stack-dot-size': item.dotSize
        };
        Object.entries(values).forEach(([name, value]) => writeStyle(row, name, String(value)));
        terms.dataset.processStackTerms = String(index + 1);
        if (!nativeActive) state.stackPhase = 'upcoming';
      });
      stackMetrics = metrics;
      setStackMode('stack');
      const paddingTop = parseFloat(getComputedStyle(practice).paddingTop) || 0;
      applyNativeContext(base, metrics, unit, paddingTop);
      stackConfiguring = false;
      processStates.forEach(reportStep);
      notifyLayout();
    }

    function updateProcess() {
      if (disposed || document.hidden || !processStates.length || stackConfiguring) return;
      if (!processActive && !reduced.matches && !editorMode()) return;
      if (stackNeedsLayout) configureProcess();
      if (processStackMode !== 'stack') {
        processStates.forEach(reportStep);
        return;
      }
      const timelineNode = practice.querySelector('.process-timeline');
      const timeline = timelineNode.getBoundingClientRect();
      const timelineStyle = getComputedStyle(timelineNode);
      // Native sticky is bounded by the track content edge, not its outer
      // padding/border edge. Include that same edge in the shared release.
      const timelineContentBottom = timeline.bottom - (parseFloat(timelineStyle.paddingBottom) || 0)
        - (parseFloat(timelineStyle.borderBottomWidth) || 0);
      const release = stackRelease(timelineContentBottom, stackMetrics[stackMetrics.length - 1]);
      practice.dataset.processStackRelease = String(release);
      stackMetrics.forEach(item => {
        const value = (item.rail + release) + 'px';
        if (item.row.style.getPropertyValue('--process-stack-header-top') !== value) {
          item.row.style.setProperty('--process-stack-header-top', value);
        }
      });
      contextShift = readNativeContextShift(); // Read-only metadata; native CSS owns the context.
      // Read actual header positions after the common release was applied.
      const headers = stackMetrics.map(item => item.state.summary.getBoundingClientRect());
      let current = 0;
      stackMetrics.forEach((item, index) => {
        if (headers[index].top <= item.rail + release + 6) current = index;
      });
      if (current !== activeStep) {
        activeStep = current;
        practice.dataset.processStackActive = stackMetrics[current].row.id;
      }
      const focused = document.activeElement;
      let focusClipped = false;
      stackMetrics.forEach((item, index) => {
        const {state, terms} = item;
        const bandTop = headers[index].bottom + item.gap;
        // The final body owns its normal-flow reading span. It is not clipped
        // merely because another header/section has left the viewport.
        const bandBottom = headers[index + 1]?.top
          ?? timeline.top + item.offset + item.headerHeight + item.gap + item.bodyHeight;
        const apply = node => {
          const box = node.getBoundingClientRect();
          const clip = clipBand(box, bandTop, bandBottom);
          const values = {'--process-stack-clip-top': clip.top + 'px',
            '--process-stack-clip-bottom': clip.bottom + 'px'};
          Object.entries(values).forEach(([name, value]) => {
            if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
          });
          node.dataset.processStackClip = clip.hidden ? 'hidden' : 'visible';
          if (node.contains(focused)) {
            const control = focused.getBoundingClientRect();
            focusClipped ||= clip.hidden || control.bottom <= bandTop || control.top >= bandBottom;
          }
          return clip;
        };
        state.stackClip = {top: bandTop, bottom: bandBottom,
          body: apply(state.body), terms: apply(terms)};
        const phase = index < current ? 'stacked' : index === current ? 'active' : 'upcoming';
        state.stackPhase = phase;
        item.row.dataset.processStackPhase = phase;
        reportStep(state);
      });
      const lastClip = stackMetrics[stackMetrics.length - 1].state.stackClip;
      practice.dataset.processStackEndPacked = String(current === stackMetrics.length - 1
        && !!lastClip?.body.hidden && !!lastClip?.terms.hidden);
      // Keep focus visible when a reading panel is folded by the next header.
      if (focusClipped) processStates[current].summary.focus({preventScroll: true});
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
      stackNeedsLayout = true;
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
      if (initial && restoringPage) return;
      const row = target.closest('.process-row');
      const index = processStates.findIndex(state => state.details.closest('.process-row') === row);
      const following = !!(practice.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !practice.contains(target);
      // A step row is display:contents in stack mode and has no anchor box.
      // An explicit step link uses its measured normal-flow track offset instead.
      const anchor = index < 0 ? snapshotAnchor(target) : null;
      openProcessBodies();
      configureProcess();
      preserveAnchor(anchor);
      if (index >= 0) {
        const state = processStates[index];
        const hashIntent = userScrollIntent;
        lastStepHashIntent = hashIntent;
        state.manualOverride = null;
        if (!state.desiredOpen) settle(state, true);
        const alignStep = () => {
          if (disposed || hashTarget() !== target || userScrollIntent !== hashIntent) return;
          if (stackNeedsLayout) configureProcess();
          const metric = stackMetrics[index];
          const timeline = practice.querySelector('.process-timeline');
          // KB1 goTo() uses the normal-flow offset, never a sticky title's
          // viewport position (which depends on the old scroll position).
          const top = processStackMode === 'stack' && metric && timeline
            ? timeline.getBoundingClientRect().top + scrollY + metric.offset - metric.rail + 3
            : state.summary.getBoundingClientRect().top + scrollY - 16 + 3;
          scrollTo({top: Math.max(0, top), behavior: 'instant'});
          scheduleProcess();
        };
        requestAnimationFrame(() => {
          alignStep();
          // Native hash anchoring may run after pageshow. Reconcile once more
          // after that frame, without retaining a scroll-position controller.
          requestAnimationFrame(alignStep);
        });
      } else if (following) scheduleProcess();
    }

    addEventListener('kb:chapter-start', event => {
      if (event.detail?.id === 'practice') activateProcess('chapter');
    }, { signal });
    // A one-frame hash reconciliation must not undo a newer user scroll.
    const noteScrollIntent = () => { userScrollIntent += 1; };
    addEventListener('wheel', noteScrollIntent, { passive: true, signal });
    addEventListener('touchstart', noteScrollIntent, { passive: true, signal });
    addEventListener('keydown', event => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) noteScrollIntent();
    }, { signal });
    addEventListener('scroll', scheduleProcess, { passive: true, signal });
    addEventListener('hashchange', () => revealHash(false), { signal });
    addEventListener('kb:editor-mode', () => { stackNeedsLayout = true; if (editorMode()) staticProcess(); scheduleProcess(); }, { signal });
    window.KBProcessScroll = {
      refresh: () => { stackNeedsLayout = true; scheduleProcess(); },
      inspect: () => ({ active: processActive, mode: processStackMode,
        release: parseFloat(practice?.dataset.processStackRelease) || 0,
        context: {native: practice?.dataset.processContextNative === 'true', shift: readNativeContextShift(),
          headingNormalOffset: contextMetrics?.headingNormalOffset ?? null,
          firstSummaryNormalOffset: contextMetrics?.firstSummaryNormalOffset ?? null,
          desiredHeadingTop: contextMetrics?.desiredHeadingTop ?? null},
        source: 'legacy-kb1-situations-native-sticky', activeStep: activeStep + 1,
        metrics: stackMetrics.map(item => ({id: item.row.id, rail: item.rail, offset: item.offset,
          headerHeight: item.headerHeight, gap: item.gap, bodyTop: item.bodyTop, bodyHeight: item.bodyHeight})),
        reducedMotion: reduced.matches,
        hidden: document.hidden, framePending: processFrame !== null,
        steps: processStates.map(state => ({ id: state.details.closest('.process-row')?.id,
          state: state.details.dataset.stepScroll, desiredOpen: state.desiredOpen,
          nativeOpen: state.details.open, reached: state.scrollReached,
          manualOverride: state.manualOverride, offset: state.parallaxOffset,
          animating: !!state.animation, clip: state.stackClip || null })) })
    };
    revealHash(true);
    if (reduced.matches || editorMode()) { staticProcess(); stackNeedsLayout = true; scheduleProcess(); }
    let contentObserver = null;
    let bodyObserver = null;
    if ('ResizeObserver' in window) {
      const byContent = new Map([...states.values()].map(state => [state.content, state]));
      contentObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          const state = byContent.get(entry.target);
          if (state?.isProcess || entry.target.closest('.process-terms')) stackNeedsLayout = true;
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
        stackNeedsLayout = true;
        scheduleProcess();
      });
    }

    addEventListener('resize', resized, { passive: true, signal });
    reduced.addEventListener('change', () => {
      stackNeedsLayout = true;
      if (reduced.matches) { finishAll(); staticProcess(); }
      scheduleProcess();
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
      } else { stackNeedsLayout = true; notifyLayout(); scheduleProcess(); }
    }, { signal });
    document.fonts?.ready.then(() => {
      if (disposed) return;
      resized();
      // Font reflow changes the donor's measured offsets. Reconcile only an
      // explicit step hash; ordinary scroll/history restoration stays native.
      if (!restoringPage && userScrollIntent === lastStepHashIntent && hashTarget()?.closest('.process-row')) {
        requestAnimationFrame(() => revealHash(true));
      }
    });
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
