(() => {
  'use strict';
  const section = document.getElementById('tools');
  if (!section) return;
  const concepts = [
{name:'Логика',group:1,number:4,question:'На чём держится замысел?',answer:'Ищем основания, различения и следствия, из которых возникают проектные решения.'},
{name:'Прагматика',group:2,number:7,question:'Что здесь смогут делать люди?',answer:'Проверяем деятельность, реальные сценарии и условия, при которых решение будет работать.'},
{name:'Генетика',group:0,number:1,question:'Из чего это возникает?',answer:'Рассматриваем происхождение, историю, наследие и обстоятельства возникновения замысла.'},
{name:'Поэтика',group:1,number:5,question:'Как рождается выразительное целое?',answer:'Исследуем образ, композицию, язык и способ создания собственной формы.'},
{name:'Эстетика',group:2,number:8,question:'Как это будет восприниматься?',answer:'Учитываем материал, ритм, атмосферу, телесный и эмоциональный опыт.'},
{name:'Динамика',group:0,number:2,question:'Что поддерживает и изменяет проект?',answer:'Ищем силы, напряжения и процессы, способные менять его устройство и будущее.'},
{name:'Этика',group:1,number:6,question:'Чем нельзя поступиться?',answer:'Рассматриваем допустимое, достоинство людей, ответственность и последствия решений.'},
{name:'Онтика',group:2,number:9,question:'Что делает проект именно этим?',answer:'Выделяем свойства и отношения, без которых целое перестанет быть собой.'},
{name:'Телика',group:0,number:3,question:'Ради чего он существует?',answer:'Устанавливаем назначение и критерии осуществления, если они действительно определимы.'}
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
  const pauseButton = section.querySelector('#triads-pause');
  const resetButton = section.querySelector('#triads-reset');
  const fields = ['label', 'name', 'question', 'text'].map(name => section.querySelector('#triads-detail-' + name));
  const overview = fields.map(el => el.textContent);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let selected = -1, progress = 2 / 9, frameId = null, lastTime = null;
  let visible = !('IntersectionObserver' in window), paused = false, activeGroup = -1;
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
    return selected < 0 && !paused && !reduced.matches && visible && !document.hidden && !document.documentElement.classList.contains('kb-editor-editing') && !document.body.classList.contains('kb-editor-editing');
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
    orbiter.style.opacity = reduced.matches && selected < 0 ? '0' : '1';
    pauseButton.hidden = reduced.matches || selected >= 0;
    pauseButton.textContent = paused ? 'продолжить' : 'пауза';
    pauseButton.setAttribute('aria-label', paused ? 'Продолжить движение точки' : 'Приостановить движение точки');
    section.dataset.triadsState = selected >= 0 ? 'selected' : reduced.matches ? 'reduced' : paused ? 'paused' : canMove() ? 'moving' : 'offscreen';
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
    drawDot();
    syncMotion();
  }
  function select(index) {
    selected = index;
    progress = index / 9;
    paused = false;
    renderChoice();
  }
  buttons.forEach(button => {
    const index = Number(button.dataset.triadsSelect);
    const number = button.querySelector('.triads-node-number');
    if (number) number.textContent = String(concepts[index].number).padStart(2, '0');
    button.disabled = false;
    button.addEventListener('click', () => select(Number(button.dataset.triadsSelect)));
  });
  // Reuse these controls so keyboard focus survives a cross-triad transition.
  relatedLinks.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    select(Number(link.dataset.triadsPeer));
  }));
  resetButton.disabled = false;
  resetButton.addEventListener('click', () => { selected = -1; paused = false; renderChoice(); });
  pauseButton.addEventListener('click', () => { paused = !paused; syncMotion(); });
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
