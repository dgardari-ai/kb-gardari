(() => {
  'use strict';
  const data=window.KB_CONTENT;
  if(!data)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const menuButton=document.querySelector('.menu-toggle'),menu=document.querySelector('#mobile-menu');
  function closeMenu(){menu.hidden=true;menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','Открыть меню')}
  menuButton.addEventListener('click',()=>{const opened=menuButton.getAttribute('aria-expanded')==='true';menu.hidden=opened;menuButton.setAttribute('aria-expanded',String(!opened));menuButton.setAttribute('aria-label',opened?'Открыть меню':'Закрыть меню')});
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){closeMenu();menuButton.focus()}});
  document.addEventListener('click',event=>{if(!menu.hidden&&!event.target.closest('.site-header'))closeMenu()});

  const cards=[...document.querySelectorAll('.case-card')],numbers=[...document.querySelectorAll('[data-case-index]')];
  const caseSection=document.getElementById('situations'),aside=document.querySelector('.case-aside'),stack=document.querySelector('.case-stack'),header=document.querySelector('.site-header');
  const caseHeaders=cards.map(card=>card.querySelector('.case-header'));
  let activeCase=-1,ticking=false,layoutFrame=null,caseOffsets=[];
  function headerTop(){return Math.ceil(header.getBoundingClientRect().bottom)+12}
  function readingTop(card){return caseSection.dataset.stackMode==='stack'?parseFloat(card.style.getPropertyValue('--flow-header-top')):null}
  function configureStack(){
    caseSection.dataset.stackMode='static';
    if(reduced.matches||innerWidth<=1024)return;
    // Measure in normal flow; an article keeps its semantics but has no box in
    // stack mode. Header and body then pin independently in one shared layer tree.
    let rail=headerTop(),offset=0;
    const metrics=cards.map((card,i)=>{
      const style=getComputedStyle(card);
      const titleHeight=caseHeaders[i].getBoundingClientRect().height+parseFloat(style.borderTopWidth);
      const bottomBorder=parseFloat(style.borderBottomWidth);
      const bodyHeight=card.getBoundingClientRect().height-titleHeight-bottomBorder;
      const item={rail,offset,bodyHeight,bodyTop:Math.min(rail+titleHeight,innerHeight-bodyHeight-bottomBorder-12)};
      rail+=titleHeight;offset+=titleHeight+bodyHeight+bottomBorder;
      return item;
    });
    const minimumBody=Math.max(...cards.map(card=>card.querySelector('[data-open-case]').getBoundingClientRect().height))+16;
    if(rail+minimumBody+12>innerHeight)return;
    caseOffsets=metrics.map(item=>item.offset);
    cards.forEach((card,i)=>{
      card.style.setProperty('--flow-header-top',metrics[i].rail+'px');
      card.style.setProperty('--flow-body-top',metrics[i].bodyTop+'px');
      card.style.setProperty('--flow-body-height',metrics[i].bodyHeight+'px');
    });
    caseSection.style.setProperty('--flow-aside-top',headerTop()+'px');
    caseSection.dataset.stackMode='stack';
  }
  function setActive(index){if(index===activeCase)return;activeCase=index;cards.forEach((c,i)=>c.classList.toggle('is-active',i===index));numbers.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));document.querySelector('.case-current').textContent=data.cases[index].number+' / '+data.cases[index].label}
  function updateScroll(){
    ticking=false;let current=0;
    caseHeaders.forEach((title,i)=>{const top=title.getBoundingClientRect().top,readTop=readingTop(cards[i]),threshold=readTop===null?window.innerHeight*.35:readTop+6;if(top<=threshold)current=i});
    setActive(current);
    let sectionId='';document.querySelectorAll('section[id]').forEach(s=>{if(s.getBoundingClientRect().top<innerHeight*.35)sectionId=s.id});
    document.querySelectorAll('.desktop-nav a').forEach(a=>{if(a.hash==='#'+sectionId)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')});
  }
  function queueScroll(){if(!ticking){requestAnimationFrame(updateScroll);ticking=true}}
  function queueLayout(){if(layoutFrame===null)layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;configureStack();queueScroll()})}
  addEventListener('scroll',queueScroll,{passive:true});addEventListener('resize',()=>{if(innerWidth>1024)closeMenu();queueLayout()});addEventListener('pageshow',queueLayout);
  const layoutObserver=new ResizeObserver(queueLayout);layoutObserver.observe(header);layoutObserver.observe(aside);caseHeaders.forEach(title=>layoutObserver.observe(title));
  document.fonts.ready.then(queueLayout);
  function scrollToCase(index,behavior=reduced.matches?'instant':'smooth'){
    configureStack();let target;const readTop=readingTop(cards[index]);
    if(readTop!==null){const top=stack.getBoundingClientRect().top+scrollY;target=top+caseOffsets[index]-readTop+3}
    else target=cards[index].getBoundingClientRect().top+scrollY-headerTop();
    scrollTo({top:target,behavior});queueScroll();
  }
  numbers.forEach((button,index)=>button.addEventListener('click',()=>scrollToCase(index)));
  function restoreCaseHash(){
    const target=location.hash.slice(1),index=cards.findIndex(card=>card.id===target||card.querySelector('h3').id===target);
    if(index>=0)requestAnimationFrame(()=>scrollToCase(index,'instant'));
  }
  addEventListener('hashchange',restoreCaseHash);addEventListener('pageshow',restoreCaseHash);
  document.fonts.ready.then(restoreCaseHash);
  configureStack();updateScroll();restoreCaseHash();


  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}},{threshold:.08,rootMargin:'0px 0px -20px 0px'});
  document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));document.documentElement.classList.add('js');
  if(reduced.matches)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));
  reduced.addEventListener('change',()=>{if(reduced.matches)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));queueLayout()});

  const processButtons=[...document.querySelectorAll('[data-process]')],image=document.querySelector('#process-image');
  let imageTimer;
  function changeProcessImage(index){const item=data.process[index];if(image.getAttribute('src')===item.image)return;clearTimeout(imageTimer);if(!reduced.matches)image.classList.add('is-changing');imageTimer=setTimeout(()=>{image.src=item.image;image.alt=item.image.includes('dialogue')?'Разговор за столом у книжных полок':'Работа с книгой и записями, вид сверху';image.style.objectPosition=item.image.includes('dialogue')?'50% 57%':'30% 42%';image.onload=()=>image.classList.remove('is-changing');if(image.complete)image.classList.remove('is-changing')},reduced.matches?0:110)}
  function processPanel(button,open){const panel=document.getElementById(button.getAttribute('aria-controls'));button.setAttribute('aria-expanded',String(open));if(reduced.matches){panel.hidden=!open;panel.style.height=open?'auto':'0px';return}if(open){panel.hidden=false;panel.style.height='0px';requestAnimationFrame(()=>{panel.style.height=panel.scrollHeight+'px'})}else{panel.style.height=panel.scrollHeight+'px';requestAnimationFrame(()=>{panel.style.height='0px'})}setTimeout(()=>{if(button.getAttribute('aria-expanded')==='true')panel.style.height='auto';else panel.hidden=true},360)}
  processButtons.forEach((button,index)=>button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';processButtons.forEach(b=>{const want=b===button&&open;if((b.getAttribute('aria-expanded')==='true')!==want)processPanel(b,want)});if(open)changeProcessImage(index)}));

  const dialog=document.getElementById('detail-dialog'),title=document.getElementById('detail-title'),body=document.getElementById('detail-body'),kind=document.getElementById('detail-kind');
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let origin=null;
  function showDialog(trigger,label,heading,html){origin=trigger;kind.textContent=label;title.textContent=heading.replace(/\.+\s*$/,'');body.innerHTML=html;dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.dialog-close').focus()}
  document.querySelectorAll('[data-open-case]').forEach(button=>button.addEventListener('click',()=>{const c=data.cases.find(x=>x.id===button.dataset.openCase);if(!c)return;const paragraphs=c.detailParagraphs.map(p=>'<p>'+escape(p)+'</p>').join('');const facts='<div class="dialog-facts">'+c.detailFacts.map(f=>'<div><h3>'+escape(f.label)+'</h3><p>'+escape(f.text)+'</p></div>').join('')+'</div>';showDialog(button,'Модельная ситуация · '+c.number,c.detailTitle,paragraphs+facts+'<p class="dialog-model-note">Пример объясняет возможное поручение и способ разработки. Это модельная ситуация, а не выполненный заказ КБ.</p>')}));
  document.querySelector('[data-open-method]').addEventListener('click',event=>showDialog(event.currentTarget,'0.3 · Подход бюро','Проект как целое.','<p>У проекта может быть много профессионально выполненных частей — и не быть собственного устройства. Концептуальная архитектура связывает назначение, содержание, образ, человеческие сценарии, технологию и хозяйство в общее основание решений.</p><p>Исследование и создание идут вместе. Образ способен открыть направление, расчёт — породить новый ход, сценарная проба — изменить постановку. Задача состоит в том, чтобы найденное выдержало встречу с реальностью и могло направлять дальнейшую работу.</p><div class="dialog-facts"><div><h3>Что существенно</h3><p>Назначение и связи, без которых проект перестаёт быть самим собой. Они должны сохраняться при разработке отдельных частей.</p></div><div><h3>Что можно менять</h3><p>Конкретное воплощение, материал, технология или инструмент — если изменение сохраняет замысел и необходимое действие.</p></div><div><h3>Как проверить</h3><p>На фактах, материальной пробе, человеческом сценарии, технической возможности и хозяйственном расчёте.</p></div><div><h3>Как продолжать</h3><p>Из концепта разворачиваются самостоятельные задания. Участники понимают основания и могут принимать решения, не изобретая целое заново.</p></div></div><p class="dialog-model-note">Глубина разработки и участие бюро определяются конкретным поручением.</p>'));
  dialog.querySelectorAll('.dialog-close').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close()}});
  dialog.addEventListener('close',()=>{if(origin)origin.focus({preventScroll:true})});
})();
