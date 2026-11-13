(() => {
  'use strict';
  const track = document.querySelector('.hero-motion-track');
  const hero = track.querySelector('.hero');
  const intro = track.querySelector('.hero-intro');
  const eyebrow = intro.querySelector('.eyebrow');
  const title = intro.querySelector('h1');
  const description = intro.querySelector('.hero-description');
  const actions = intro.querySelector('.hero-actions');
  const travel = track.querySelector('.collage-travel');
  const float = track.querySelector('.collage-float');
  const img = float.querySelector('img');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width:768px), (min-width:520px) and (min-height:680px) and (hover:hover) and (pointer:fine)');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  let enabled = false, start = 0, startY = 0, range = 0, referenceRange = 0;
  let exitStart = 0, sceneHeight = 0, spring = 0, velocity = 0;
  let renderedY = 0;
  let handoffGap = 0;
  const copyMetrics = new Map();
  let headerBottom = 0, actionExtraLift = 0;
  let textLiftMax = 0, fadesMoving = false;
  const alphaValues = new Map();
  let raf = 0, last = 0, resizeRaf = 0;
  const speed = 1.3;
  const exitSpeed = 3.2, accelerationLength = 110;
  const exitTravel = y => {
    const t = Math.max(0, y - exitStart);
    return (exitSpeed - speed) * (t < accelerationLength
      ? t * t / (2 * accelerationLength)
      : t - accelerationLength / 2);
  };
  const springTarget = y => -104 * clamp((y - 80) / 100, 0, 1);
  const ease = (value, from, to) => {
    const p = clamp((value - from) / Math.max(.001, to - from), 0, 1);
    return p * p * (3 - 2 * p);
  };
  const smoothAlpha = (key, target, dt) => {
    const previous = alphaValues.get(key) ?? target;
    let value = dt ? previous + (target - previous) * (1 - Math.exp(-dt / .26)) : target;
    if (Math.abs(target - value) < .0005) value = target;
    alphaValues.set(key, value);
    if (value !== target) fadesMoving = true;
    return value;
  };
  const opacity = (element, target, dt) => {
    const value = smoothAlpha(element, target, dt);
    element.style.opacity = String(value);
    element.style.visibility = value <= 0 ? 'hidden' : '';
  };
  function position(dt = 0) {
    fadesMoving = false;
    const y = Math.min(renderedY, range);
    const extra = exitTravel(y);
    const artY = startY - y * speed - extra;
    travel.style.transform = `translate3d(0,${artY}px,0)`;
    float.style.transform = `translate3d(0,${spring}px,0)`;
    const sceneExit = clamp(scrollY - start - range, 0, sceneHeight);
    const progress = clamp(y / Math.max(1, range), 0, 1);
    const handoff = clamp((renderedY - range - handoffGap) / Math.max(1, sceneHeight), 0, 1);
    // Separate copy trajectories: a steady headline, a quieter description and
    // an extra, later upward movement for the actions. No frozen foreground.
    const commonLift = textLiftMax * .55 * ease(progress, 0, 1);
    const titleLift = textLiftMax * .45 * ease(progress, .20, 1) + sceneHeight * .12 * handoff;
    const buttonLift = actionExtraLift * ease(progress, .58, 1) + sceneHeight * .22 * handoff;
    intro.style.transform = `translate3d(0,${-commonLift}px,0)`;
    title.style.transform = `translate3d(0,${-titleLift}px,0)`;
    actions.style.transform = `translate3d(0,${-buttonLift}px,0)`;
    const softProgress = ease(progress, .15, .94);
    // Move a soft white boundary through the visible top of the artwork.
    // The original raster remains opaque, and its lower portion remains visible.
    const visibleTop = Math.max(0, sceneExit - artY - spring);
    const solid = visibleTop + sceneHeight * .40 * softProgress;
    float.style.setProperty('--dissolve-solid', `${solid}px`);
    float.style.setProperty('--dissolve-end', `${solid + sceneHeight * .65}px`);
    float.style.setProperty('--dissolve-opacity', String(smoothAlpha('white', .8 * softProgress, dt)));
    for (const element of [eyebrow, description, title, actions]) {
      const metrics = copyMetrics.get(element);
      const extraLift = element === title ? titleLift : element === actions ? buttonLift : 0;
      const visibleHeight = metrics.bottom - commonLift - extraLift - sceneExit - headerBottom;
      const topExit = ease(visibleHeight / Math.max(1, metrics.height), 0, .85);
      const readingPhase = element === description ? 1 - ease(progress, .55, .88) : 1;
      opacity(element, Math.min(topExit, readingPhase), dt);
    }
    // The picture stays until the gray section really enters the viewport.
    // It only vanishes completely once that section owns most of the screen.
    opacity(float, 1 - ease(handoff, .12, .80), dt);
    return fadesMoving;
  }
  function frame(time) {
    raf = 0;
    if (!enabled) return;
    const requestedY = clamp(scrollY - start, 0, range + handoffGap + sceneHeight);
    // A jump straight back to the opening frame is navigation, not a fade phase.
    // Native scrolling has already removed the gray cover; restore the opening
    // composition immediately instead of showing the old hidden layers briefly.
    if (requestedY === 0 && renderedY > range + handoffGap + sceneHeight * .25) {
      renderedY = spring = velocity = 0;
      alphaValues.clear();
      position();
      last = 0;
      return;
    }
    const dt = Math.min(last ? (time - last) / 1000 : 1 / 60, 1 / 30);
    last = time;
    // One damped clock drives movement AND every opacity; wheel bursts cannot
    // skip the white/text/button intermediate states. Native scrolling is intact.
    renderedY += (requestedY - renderedY) * (1 - Math.exp(-dt / .24));
    if (Math.abs(requestedY - renderedY) < .015) renderedY = requestedY;
    const target = springTarget(Math.min(renderedY, range));
    // Damped spring from the reference: stiffness120 / damping26 / mass0.8.
    velocity += ((target - spring) * 120 - velocity * 26) / .8 * dt;
    spring += velocity * dt;
    if (Math.abs(target - spring) < .015 && Math.abs(velocity) < .015) { spring = target; velocity = 0; }
    const fading = position(dt);
    if (renderedY !== requestedY || spring !== target || velocity || fading) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function wake() { if (enabled && !raf) raf = requestAnimationFrame(frame); }
  function measure() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    enabled = desktop.matches && !motion.matches && !document.documentElement.classList.contains('kb-editor-editing') && img.naturalWidth > 0;
    track.classList.toggle('is-parallax', enabled);
    for (const el of [intro,eyebrow,title,description,actions,travel,float]) {
      el.style.transform = ''; el.style.opacity = ''; el.style.visibility = '';
    }
    track.style.height = '';
    alphaValues.clear();
    for (const name of ['--dissolve-solid','--dissolve-end','--dissolve-opacity']) float.style.removeProperty(name);
    spring = velocity = 0;
    if (!enabled) return;
    const box = hero.getBoundingClientRect();
    sceneHeight = box.height;
    const copy = intro.getBoundingClientRect();
    headerBottom = document.querySelector('.site-header').getBoundingClientRect().bottom;
    if (innerWidth < 768 && copy.bottom - box.top + headerBottom > sceneHeight - 8) {
      // Short mouse panels use normal flow if the complete introduction cannot fit.
      enabled = false;
      track.classList.remove('is-parallax');
      return;
    }
    textLiftMax = Math.max(0, title.getBoundingClientRect().top - box.top - headerBottom - 12);
    start = track.getBoundingClientRect().top + scrollY;
    startY = Math.max(copy.bottom - box.top + 12, box.height * .68);
    const artHeight = img.getBoundingClientRect().height;
    const distance = Math.max(0, startY + artHeight - box.height);
    // Invert both motions together; a fixed minimum leaves a gap on tall tablets.
    const solveRange = displacement => {
      let low = 0, high = distance / speed;
      for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (displacement(mid) < distance) low = mid;
        else high = mid;
      }
      return high;
    };
    referenceRange = solveRange(y => y * speed - springTarget(y));
    exitStart = Math.min(300, referenceRange * .55);
    range = solveRange(y => y * speed + exitTravel(y) - springTarget(y));
    track.style.height = `${box.height + range}px`;
    const next = track.nextElementSibling;
    handoffGap = next ? Math.max(0, next.getBoundingClientRect().top - track.getBoundingClientRect().bottom) : 0;
    actionExtraLift = Math.max(0, actions.getBoundingClientRect().top - description.getBoundingClientRect().bottom)
      + Math.min(56, sceneHeight * .06);
    copyMetrics.clear();
    for (const element of [eyebrow, description, title, actions]) {
      const rect = element.getBoundingClientRect();
      copyMetrics.set(element, { bottom: rect.bottom - box.top, height: rect.height });
    }
    // Restore the correct settled position when re-opening in the middle.
    renderedY = clamp(scrollY - start, 0, range + handoffGap + sceneHeight);
    spring = springTarget(Math.min(renderedY, range));
    position();
  }
  function resize() { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(measure); }
  addEventListener('scroll', wake, { passive:true });
  addEventListener('resize', resize, { passive:true });
  addEventListener('pageshow', resize);
  document.addEventListener('kb:editor-mode', resize);
  motion.addEventListener('change', resize);
  desktop.addEventListener('change', resize);
  Promise.all([document.fonts.ready, img.decode().catch(() => {})]).then(measure);
})();
