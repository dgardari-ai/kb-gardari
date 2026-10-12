(() => {
  'use strict';
  const data=window.KB_CONTENT;
  if(!data)return;
  data.cases.forEach(item=>{const card=document.getElementById('example-'+item.id);if(card)item.number=card.dataset.address});
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
      section.dataset.asideOverflow=String(aside.getBoundingClientRect().height>innerHeight-headerTop()-12);
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
  function showDialog(trigger,label,heading,html,precedent=false){origin=trigger;kind.textContent=label;title.textContent=heading.replace(/\.+\s*$/,'');body.innerHTML=html;dialog.classList.toggle('precedent-detail',precedent);dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.dialog-close').focus()}
  document.querySelectorAll('[data-open-case]').forEach(button=>button.addEventListener('click',()=>{const c=data.cases.find(x=>x.id===button.dataset.openCase);if(!c)return;const paragraphs=c.detailParagraphs.map(p=>'<p>'+escape(p)+'</p>').join('');const facts='<div class="dialog-facts">'+c.detailFacts.map(f=>'<div><h3>'+escape(f.label)+'</h3><p>'+escape(f.text)+'</p></div>').join('')+'</div>';showDialog(button,data.labels.caseKind+' · '+c.number,c.detailTitle,paragraphs+facts+'<p class="dialog-model-note">'+escape(data.labels.caseNote)+'</p>')}));
  document.querySelector('[data-open-method]').addEventListener('click',event=>{const m=data.method;if(!m)return;const paragraphs=m.paragraphs.map(p=>'<p>'+escape(p)+'</p>').join('');const facts='<div class="dialog-facts">'+m.facts.map(f=>'<div><h3>'+escape(f.label)+'</h3><p>'+escape(f.text)+'</p></div>').join('')+'</div>';showDialog(event.currentTarget,document.getElementById('bureau').dataset.address+' · '+m.kind,m.title,paragraphs+facts+'<p class="dialog-model-note">'+escape(m.note)+'</p>')});
  document.querySelectorAll('[data-open-precedent]').forEach(button=>button.addEventListener('click',()=>{
    const item=data.precedents.find(p=>p.id===button.dataset.openPrecedent);if(!item)return;
    const paragraphs=item.paragraphs.map(p=>'<p>'+escape(p)+'</p>').join('');
    const sources='<div class="precedent-sources" aria-label="Источники">'+item.sources.filter(source=>/^https:\/\//.test(source.url)).map(source=>'<a href="'+escape(source.url)+'" target="_blank" rel="noopener noreferrer">'+escape(source.label)+'</a>').join('')+'</div>';
    showDialog(button,button.closest('.precedent-card').dataset.address+' · '+item.category,item.question,paragraphs+sources,true);
  }));
  dialog.querySelectorAll('.dialog-close').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close()}});
  dialog.addEventListener('close',()=>{if(origin)origin.focus({preventScroll:true})});

  const requestDialog=document.getElementById('request-dialog'),requestForm=document.getElementById('request-form');
  const requestText=document.getElementById('request-text'),requestMode=document.getElementById('request-mode');
  let requestOrigin=null;
  document.querySelectorAll('[data-open-request]').forEach(button=>button.addEventListener('click',()=>{
    requestOrigin=button;
    const card=button.closest('.participation-card');
    requestMode.textContent=card.dataset.address+' · '+card.querySelector('h3').textContent.trim();
    requestDialog.showModal();requestDialog.scrollTop=0;requestText.focus({preventScroll:true});
  }));
  requestText.addEventListener('input',()=>requestText.setCustomValidity(''));
  requestForm.addEventListener('submit',event=>{
    const text=requestText.value.trim();
    if(!text){event.preventDefault();requestText.setCustomValidity('Напишите несколько слов о вашей задаче.');requestText.reportValidity();return}
    // A native GET opens a draft in the named chat. Only the visitor sends it.
    document.getElementById('request-message').value='Запрос в КБ Гардари\n'+requestMode.textContent+'\n\n'+text;
  });
  requestDialog.querySelector('.dialog-close').addEventListener('click',()=>requestDialog.close());
  requestDialog.addEventListener('click',event=>{if(event.target===requestDialog){const b=requestDialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)requestDialog.close()}});
  requestDialog.addEventListener('close',()=>{if(requestOrigin)requestOrigin.focus({preventScroll:true})});
})();

// Author disclosure follows the actual edited title metrics, including wrapped names.
(() => {
  const people = [...document.querySelectorAll('.author-person')];
  const align = () => people.forEach(person => {
    const title = person.querySelector('.author-name');
    if (title) person.style.setProperty('--author-title-center', `${title.offsetTop + title.offsetHeight / 2}px`);
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(align);
    people.forEach(person => observer.observe(person.querySelector('.author-name')));
  }
  window.addEventListener('resize', align, { passive: true });
  document.fonts.ready.then(align);
  align();
})();
