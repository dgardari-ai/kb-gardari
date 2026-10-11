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

  const header=document.querySelector('.site-header');
  let ticking=false,layoutFrame=null;
  function headerTop(){return Math.ceil(header.getBoundingClientRect().bottom)+12}
  function createCardStack(section){
    const cards=[...section.querySelectorAll('.case-card')];
    const numbers=[...section.querySelectorAll('.case-numbers button')];
    const aside=section.querySelector('.case-aside'),stack=section.querySelector('.case-stack');
    const titles=cards.map(card=>card.querySelector('.case-header'));
    const currentLabel=section.querySelector('.case-current');
    let active=-1,offsets=[];
    function readingTop(card){return section.dataset.stackMode==='stack'?parseFloat(card.style.getPropertyValue('--flow-header-top')):null}
    function configure(){
      section.dataset.stackMode='static';
      if(reduced.matches||innerWidth<=1024)return;
      // Measure normal flow before pinning headers and bodies as independent layers.
      let rail=headerTop(),offset=0;
      const metrics=cards.map((card,i)=>{
        const style=getComputedStyle(card);
        const titleHeight=titles[i].getBoundingClientRect().height+parseFloat(style.borderTopWidth);
        const bottomBorder=parseFloat(style.borderBottomWidth);
        const bodyHeight=card.getBoundingClientRect().height-titleHeight-bottomBorder;
        const item={rail,offset,bodyHeight,bodyTop:Math.min(rail+titleHeight,innerHeight-bodyHeight-bottomBorder-12)};
        rail+=titleHeight;offset+=titleHeight+bodyHeight+bottomBorder;
        return item;
      });
      const minimumBody=Math.max(...cards.map(card=>card.querySelector('[data-open-case]')?.getBoundingClientRect().height||48))+16;
      if(rail+minimumBody+12>innerHeight)return;
      offsets=metrics.map(item=>item.offset);
      cards.forEach((card,i)=>{
        card.style.setProperty('--flow-header-top',metrics[i].rail+'px');
        card.style.setProperty('--flow-body-top',metrics[i].bodyTop+'px');
        card.style.setProperty('--flow-body-height',metrics[i].bodyHeight+'px');
      });
      section.style.setProperty('--flow-aside-top',headerTop()+'px');
      section.dataset.stackMode='stack';
    }
    function update(){
      let current=0;
      titles.forEach((title,i)=>{
        const readTop=readingTop(cards[i]),threshold=readTop===null?innerHeight*.35:readTop+6;
        if(title.getBoundingClientRect().top<=threshold)current=i;
      });
      if(current===active)return;
      active=current;
      cards.forEach((card,i)=>card.classList.toggle('is-active',i===current));
      numbers.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===current)));
      currentLabel.textContent=cards[current].dataset.address+' / '+titles[current].querySelector('h3').textContent;
    }
    function goTo(index,behavior=reduced.matches?'instant':'smooth'){
      configure();
      const readTop=readingTop(cards[index]);
      const target=readTop===null
        ?cards[index].getBoundingClientRect().top+scrollY-headerTop()
        :stack.getBoundingClientRect().top+scrollY+offsets[index]-readTop+3;
      scrollTo({top:target,behavior});queueScroll();
    }
    function restoreHash(){
      const target=location.hash.slice(1);
      const index=cards.findIndex(card=>card.id===target||card.querySelector('h3').id===target||card.querySelector('.case-body').id===target);
      if(target&&index>=0)requestAnimationFrame(()=>goTo(index,'instant'));
    }
    numbers.forEach((button,index)=>button.addEventListener('click',()=>goTo(index)));
    return {configure,update,restoreHash,observed:[aside,...titles]};
  }
  const stacks=[...document.querySelectorAll('.card-section')].map(createCardStack);
  function updateScroll(){
    ticking=false;stacks.forEach(stack=>stack.update());
    let sectionId='';document.querySelectorAll('section[id]').forEach(s=>{if(s.getBoundingClientRect().top<innerHeight*.35)sectionId=s.id});
    document.querySelectorAll('.desktop-nav a').forEach(a=>{if(a.hash==='#'+sectionId)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current')});
  }
  function queueScroll(){if(!ticking){requestAnimationFrame(updateScroll);ticking=true}}
  function configureStacks(){stacks.forEach(stack=>stack.configure())}
  function queueLayout(){if(layoutFrame===null)layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;configureStacks();queueScroll()})}
  function restoreCardHash(){stacks.forEach(stack=>stack.restoreHash())}
  addEventListener('scroll',queueScroll,{passive:true});
  addEventListener('resize',()=>{if(innerWidth>1024)closeMenu();queueLayout()});
  addEventListener('pageshow',()=>{queueLayout();restoreCardHash()});
  addEventListener('hashchange',restoreCardHash);
  const layoutObserver=new ResizeObserver(queueLayout);
  layoutObserver.observe(header);stacks.forEach(stack=>stack.observed.forEach(el=>layoutObserver.observe(el)));
  document.fonts.ready.then(()=>{configureStacks();updateScroll();restoreCardHash()});
  configureStacks();updateScroll();restoreCardHash();

  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}},{threshold:.08,rootMargin:'0px 0px -20px 0px'});
  document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));document.documentElement.classList.add('js');
  if(reduced.matches)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));
  reduced.addEventListener('change',()=>{if(reduced.matches)document.querySelectorAll('.reveal').forEach(el=>el.classList.add('is-visible'));queueLayout()});

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
