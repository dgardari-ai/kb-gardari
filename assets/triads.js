(() => {
  'use strict';
  const section = document.getElementById('tools');
  if (!section) return;
  const concepts = [
{name:'Логика',group:1,number:4,question:'Что мы утверждаем и на каком основании?',answer:'Проверяем различения, доводы и следствия: что действительно обосновано, а где вывод выходит за пределы имеющихся оснований.'},
{name:'Прагматика',group:2,number:7,question:'Кто что может здесь делать?',answer:'Исследуем возможности и способы участия, реальные условия, ограничения и последствия действий.'},
{name:'Генетика',group:0,number:1,question:'Как возникло именно это?',answer:'Исследуем условия, события и отношения, из которых сложился предмет, отличая его действительное происхождение от рассказа о нём.'},
{name:'Поэтика',group:1,number:5,question:'Как мы видим и создаём осмысленное целое?',answer:'Выявляем или создаём образы, композиции и связи, позволяющие схватить разнородное как целое и придать ему определённую форму.'},
{name:'Эстетика',group:2,number:8,question:'Как переживается встреча с этим?',answer:'Рассматриваем качество чувственного опыта: материал, ритм, дистанцию, атмосферу и переживаемое время.'},
{name:'Динамика',group:0,number:2,question:'Что удерживает и преобразует это?',answer:'Рассматриваем процессы и взаимодействия, благодаря которым целое сохраняется, изменяется или утрачивает свою организацию.'},
{name:'Этика',group:1,number:6,question:'Что здесь допустимо и кто за что отвечает?',answer:'Выясняем, что следует поддержать, какие способы обращения оправданны и как распределяется ответственность за последствия.'},
{name:'Онтика',group:2,number:9,question:'Что это такое — и благодаря чему существует?',answer:'Различаем статус, состав и существенные отношения предмета: что уже существует, что только задумано и что позволяет ему оставаться собой при изменениях.'},
{name:'Телика',group:0,number:3,question:'Есть ли здесь цель — и что считать осуществлением?',answer:'Различаем цели и меры исполнения: ради чего нечто совершается и что позволяет признать его состоявшимся.'}
  ];
  const centerNames = ['становления', 'осмысления', 'присутствия'];
  const wheel = section.querySelector('.triads-wheel');
  const triangles = [...section.querySelectorAll('.triads-triangle')];
  const dots = [...section.querySelectorAll('.triads-node-dot')];
  const orbiter = section.querySelector('.triads-orbiter');
  const buttons = [...section.querySelectorAll('[data-triads-select]')];
  const centerValue = section.querySelector('.triads-center-value');
  const related = section.querySelector('.triads-related');
  const relatedLinks = [...related.querySelectorAll('[data-triads-peer]')];
  const fields = ['label', 'name', 'question', 'text'].map(name => section.querySelector('#triads-detail-' + name));
  const overview = fields.map(el => el.textContent);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let selected = -1, progress = 2 / 9, frameId = null, lastTime = null;
  let visible = !('IntersectionObserver' in window), activeGroup = -1;
  const period = 27000;

  function setGroup(group) {
    if (activeGroup === group) return;
    activeGroup = group;
    triangles.forEach(el => el.classList.toggle('is-active', Number(el.dataset.triadsGroup) === group));
    dots.forEach((el, index) => el.classList.toggle('is-active', concepts[index].group === group));
    centerValue.textContent = centerNames[group];
  }
  function drawDot() {
    const angle = (-160 + progress * 360) * Math.PI / 180;
    orbiter.setAttribute('cx', (360 + 226 * Math.cos(angle)).toFixed(4));
    orbiter.setAttribute('cy', (360 + 226 * Math.sin(angle)).toFixed(4));
    setGroup(concepts[Math.floor(progress * 9 + 1e-9) % 9].group);
  }
  function stop() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastTime = null;
  }
  function canMove() {
    return !reduced.matches && visible && !document.hidden && !document.documentElement.classList.contains('kb-editor-editing') && !document.body.classList.contains('kb-editor-editing');
  }
  function frame(now) {
    if (!canMove()) { stop(); return; }
    if (lastTime !== null) progress = (progress + Math.min(now - lastTime, 80) / period) % 1;
    lastTime = now;
    drawDot();
    frameId = requestAnimationFrame(frame);
  }
  function syncMotion() {
    stop();
    orbiter.hidden = false;
    orbiter.style.opacity = reduced.matches ? '0' : '1';
    section.dataset.triadsState = reduced.matches ? 'reduced' : canMove() ? 'moving' : 'offscreen';
    if (canMove()) frameId = requestAnimationFrame(frame);
  }
  function renderChoice() {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.triadsSelect) === selected)));
    if (selected < 0) {
      fields.forEach((field, index) => { field.textContent = overview[index]; });
      related.hidden = true;
    } else {
      const choice = concepts[selected];
      const texts = [String(choice.number).padStart(2, '0') + ' / 09 · триада ' + centerNames[choice.group], choice.name.toLowerCase(), choice.question, choice.answer];
      fields.forEach((field, index) => { field.textContent = texts[index]; });
      const peers = concepts.map((_, index) => index).filter(index => index !== selected && concepts[index].group === choice.group);
      relatedLinks.forEach((link, index) => {
        const peer = concepts[peers[index]];
        link.textContent = peer.name;
        link.dataset.triadsPeer = String(peers[index]);
        link.closest('.triads-related-item').querySelector('p').textContent = peer.answer;
      });
      related.hidden = false;
    }
  }
  function select(index) {
    selected = index;
    renderChoice();
  }
  buttons.forEach(button => {
    const index = Number(button.dataset.triadsSelect);
    const number = button.querySelector('.triads-node-number');
    if (number) number.textContent = String(concepts[index].number).padStart(2, '0');
    button.disabled = false;
    button.addEventListener('click', () => select(Number(button.dataset.triadsSelect)));
  });
  // Reuse these links so keyboard focus survives a choice within the same triad.
  relatedLinks.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    select(Number(link.dataset.triadsPeer));
  }));
  reduced.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  document.addEventListener('kb:editor-mode', syncMotion);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      syncMotion();
    }, {threshold: 0.01}).observe(wheel);
  }
  section.classList.add('triads-ready');
  drawDot();
  syncMotion();
})();

// Align visible text and the circle independently of the taller right-hand column.
(() => {
  const section = document.getElementById('tools');
  if (!section) return;
  const heading = section.querySelector('.triads-heading');
  const title = section.querySelector('#triads-title');
  const intro = section.querySelector('.triads-heading > .kb-body');
  const order = section.querySelector('#triads-order');
  const wheel = section.querySelector('.triads-wheel');
  const ring = section.querySelector('.triads-ring');
  const detail = section.querySelector('.triads-detail');
  const divider = section.querySelector('.triads-download-row');
  if (!heading || !title || !intro || !order || !wheel || !ring || !detail || !divider) return;
  const context = document.createElement('canvas').getContext('2d');
  let scheduled = false;

  function firstLineInk(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !node.textContent.trim()) {}
    if (!node || !context) return element.getBoundingClientRect();
    const text = node.textContent;
    const start = text.search(/\S/);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 1);
    const first = range.getBoundingClientRect();
    let end = start + 1;
    for (; end < text.length; end++) {
      range.setStart(node, end);
      range.setEnd(node, end + 1);
      if (range.getBoundingClientRect().top > first.top + 1) break;
    }
    const style = getComputedStyle(node.parentElement);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.textBaseline = 'alphabetic';
    const metrics = context.measureText(text.slice(start, end).trimEnd());
    if (!Number.isFinite(metrics.fontBoundingBoxAscent)) return first;
    const baseline = first.top + metrics.fontBoundingBoxAscent;
    return { top: baseline - metrics.actualBoundingBoxAscent,
      bottom: baseline + metrics.actualBoundingBoxDescent };
  }
  function setOffset(element, name, value) {
    const previous = parseFloat(element.style.getPropertyValue(name)) || 0;
    if (Math.abs(previous - value) > .01) element.style.setProperty(name, `${value.toFixed(3)}px`);
  }
  function align() {
    scheduled = false;
    const introOffset = parseFloat(intro.style.getPropertyValue('--triads-intro-shift')) || 0;
    setOffset(intro, '--triads-intro-shift', innerWidth > 700
      ? firstLineInk(title).top - firstLineInk(intro).top + introOffset : 0);

    const wheelOffset = parseFloat(wheel.style.getPropertyValue('--triads-wheel-shift')) || 0;
    const bounds = ring.getBoundingClientRect();
    const center = bounds.top + bounds.height / 2 - wheelOffset;
    const target = (firstLineInk(order).bottom + divider.getBoundingClientRect().top) / 2;
    setOffset(wheel, '--triads-wheel-shift', innerWidth > 1100 ? target - center : 0);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(align);
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(schedule);
    [heading, title, intro, order, wheel, detail, divider].forEach(element => observer.observe(element));
  }
  window.addEventListener('resize', schedule, { passive: true });
  document.addEventListener('kb:editor-mode', schedule);
  document.fonts.ready.then(schedule);
  document.fonts.addEventListener('loadingdone', schedule);
  schedule();
})();
