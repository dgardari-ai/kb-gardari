'use strict';
(() => {
  // Open frame paths enter the actual black silhouette. No coloured covers.
  const scriptURL=document.currentScript?.src||new URL('geometry.js',document.baseURI).href;
  const mobile=matchMedia('(max-width:760px)');
  // Affinity measures frame centre-lines. Keep that origin; the 1px stroke
  // may extend by half a pixel outside the SVG viewport (overflow is visible).
  const EDGE=0, JOIN_OVERLAP=.75, EPS=1e-10;
  const frames=new Set(), observed=new WeakSet(), reports=new WeakMap(), profileCache=new Map();
  let logoProfile=null, profileFailed=false, pending=0;
  const number=v=>Math.round(v*10000)/10000;
  const set=(node,name,value)=>{const v=String(value);if(node.getAttribute(name)!==v)node.setAttribute(name,v);};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const valueAt=(a,b,c,d,t)=>{const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;};
  function quadraticRoots(a,b,c){
    if(Math.abs(a)<EPS)return Math.abs(b)<EPS?[]:[-c/b];
    const d=b*b-4*a*c;if(d < -EPS)return [];
    const s=Math.sqrt(Math.max(0,d));return [(-b-s)/(2*a),(-b+s)/(2*a)];
  }
  function cubicIntersections(segment,y){
    const [,x0,y0,x1,y1,x2,y2,x3,y3]=segment;
    if(y<Math.min(y0,y1,y2,y3)-EPS||y>Math.max(y0,y1,y2,y3)+EPS)return [];
    const turns=quadraticRoots(-y0+3*y1-3*y2+y3,2*(y0-2*y1+y2),y1-y0).filter(t=>t>EPS&&t<1-EPS);
    const cuts=[0,...turns.sort((a,b)=>a-b),1],hits=[];
    for(let i=1;i<cuts.length;i++){
      let lo=cuts[i-1],hi=cuts[i];
      const a=valueAt(y0,y1,y2,y3,lo),b=valueAt(y0,y1,y2,y3,hi);
      if(y<Math.min(a,b)-EPS||y>Math.max(a,b)+EPS)continue;
      if(Math.abs(a-b)<EPS){
        if(Math.abs(y-a)<EPS){
          const xt=quadraticRoots(-x0+3*x1-3*x2+x3,2*(x0-2*x1+x2),x1-x0).filter(t=>t>lo&&t<hi);
          [lo,...xt,hi].forEach(t=>hits.push(valueAt(x0,x1,x2,x3,t)));
        }
        continue;
      }
      const increasing=b>a;
      // Split at Y extrema, then solve each monotonic interval independently.
      for(let j=0;j<38;j++){
        const mid=(lo+hi)/2,ym=valueAt(y0,y1,y2,y3,mid);
        if((ym<y)===increasing)lo=mid;else hi=mid;
      }
      hits.push(valueAt(x0,x1,x2,x3,(lo+hi)/2));
    }
    return hits;
  }
  function logoIntersection(y){
    if(!logoProfile||y < -EPS||y>1+EPS)return null;
    const key=y.toFixed(9);if(profileCache.has(key))return profileCache.get(key);
    const hits=[];
    logoProfile.paths.forEach(path=>path.segments.forEach(s=>{
      if(s[0]==='C')hits.push(...cubicIntersections(s,y));
      else{
        const [,x0,y0,x1,y1]=s;
        if(Math.abs(y1-y0)<EPS){if(Math.abs(y-y0)<EPS)hits.push(x0,x1);}
        else if(y>=Math.min(y0,y1)-EPS&&y<=Math.max(y0,y1)+EPS)hits.push(x0+(x1-x0)*(y-y0)/(y1-y0));
      }
    }));
    const result=hits.length?[Math.min(...hits),Math.max(...hits)]:null;
    if(profileCache.size>512)profileCache.clear();profileCache.set(key,result);return result;
  }
  function logoGap(img,frame,lineY,name){
    if(!img)return {name,status:'element-missing'};
    const rect=img.getBoundingClientRect();if(!rect.width||!rect.height)return {name,status:'not-visible'};
    const y=(frame.top+lineY-rect.top)/rect.height,hit=logoIntersection(y);
    if(!hit)return {name,status:'not-crossing',normalizedY:y};
    const left=rect.left-frame.left+hit[0]*rect.width,right=rect.left-frame.left+hit[1]*rect.width;
    return {name,status:'joined',normalizedY:y,silhouette:[left,right],gap:[left+JOIN_OVERLAP,right-JOIN_OVERLAP]};
  }
  function radius(value,width,height){
    const p=value.trim().split(/\s+/),parse=(v,axis)=>v.endsWith('%')?parseFloat(v)*axis/100:parseFloat(v)||0;
    return [parse(p[0],width),parse(p[1]||p[0],height)];
  }
  function pillGap(button,frame,lineY,name){
    if(!button)return {name,status:'element-missing'};
    const r=button.getBoundingClientRect(),y=frame.top+lineY-r.top;
    if(!r.width||!r.height||y<0||y>r.height)return {name,status:'not-crossing'};
    const st=getComputedStyle(button),cs=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(k=>radius(st[k],r.width,r.height));
    const [tl,tr,br,bl]=cs;
    const k=Math.min(1,r.width/(tl[0]+tr[0]||1),r.width/(bl[0]+br[0]||1),r.height/(tl[1]+bl[1]||1),r.height/(tr[1]+br[1]||1));
    cs.forEach(c=>{c[0]*=k;c[1]*=k;});
    const inset=(c,d)=>c[1]&&d<c[1]?c[0]*(1-Math.sqrt(Math.max(0,1-((d-c[1])/c[1])**2))):0;
    const left=r.left-frame.left+Math.max(inset(tl,y),inset(bl,r.height-y));
    const right=r.right-frame.left-Math.max(inset(tr,y),inset(br,r.height-y));
    return {name,status:'joined',silhouette:[left,right],gap:[left+JOIN_OVERLAP,right-JOIN_OVERLAP]};
  }
  function logoBinding(svg){
    if(svg.closest('.hero-window'))return ['bottom',svg.closest('.hero')?.querySelector('.hero-logo'),'hero'];
    if(svg.closest('.situations-window'))return ['bottom',svg.closest('.situations')?.querySelector('.situations-logo'),'situations'];
    if(svg.closest('.footer-window'))return ['top',svg.closest('.footer')?.querySelector('.footer-logo'),'footer'];
    if(svg.closest('.agent-window'))return ['bottom',svg.closest('.agent-dialog')?.querySelector('.agent-logo'),'agent'];
    return null;
  }
  function horizontal(x0,x1,y,gap){
    if(!gap||gap[1]<=x0||gap[0]>=x1||gap[1]<=gap[0])return `M${number(x0)},${number(y)}H${number(x1)}`;
    const a=clamp(gap[0],x0,x1),b=clamp(gap[1],x0,x1);
    return `M${number(x0)},${number(y)}H${number(a)}M${number(b)},${number(y)}H${number(x1)}`;
  }
  function paint(svg,d,w,h,joins,inset=EDGE){
    const path=svg.querySelector('path');if(!path)return;
    set(svg,'viewBox',`0 0 ${number(w)} ${number(h)}`);set(svg,'preserveAspectRatio','none');set(path,'d',d);
    // Inline width overrides the inherited desktop/mobile 1.66/1.3px rules.
    if(path.style.strokeWidth!=='1px')path.style.strokeWidth='1px';
    if(path.style.strokeLinecap!=='butt')path.style.strokeLinecap='butt';
    if(path.style.strokeLinejoin!=='round')path.style.strokeLinejoin='round';
    if(path.style.vectorEffect!=='non-scaling-stroke')path.style.vectorEffect='non-scaling-stroke';
    if(path.style.fill!=='none')path.style.fill='none';
    if((path.style.stroke||'').toLowerCase()!=='currentcolor')path.style.stroke='currentColor';
    set(svg,'data-geometry-state',profileFailed?'profile-error':'ready');
    set(svg,'data-geometry-joins',joins.map(j=>`${j.name}:${j.status}`).join(' '));
    reports.set(svg,{width:w,height:h,strokeWidth:1,pathInset:inset,joins});
  }
  function drawProcess(svg,rect){
    const w=rect.width,h=rect.height,k=w/708.91,x0=EDGE,y0=EDGE,x1=w-EDGE,y1=h-EDGE,r=Math.min(26*k,(w-1)/2,(h-1)/2);
    const join=pillGap(svg.closest('.practice')?.querySelector('.process-contact'),rect,y1,'process-cta');
    const tail=join.status==='joined'?join.gap[1]:w-199.38*k;
    const d=`M${x0},${y0}H${number(x1-r)}A${number(r)},${number(r)} 0 0 1 ${number(x1)},${number(y0+r)}`
      +`V${number(y1-r)}A${number(r)},${number(r)} 0 0 1 ${number(x1-r)},${number(y1)}H${number(clamp(tail,x0,x1-r))}`;
    paint(svg,d,w,h,[join]);
  }
  function draw(svg){
    if(!svg.isConnected){frames.delete(svg);return;}
    const rect=svg.getBoundingClientRect(),w=rect.width,h=rect.height;if(w<=1||h<=1)return;
    if(svg.hasAttribute('data-process-frame')){drawProcess(svg,rect);return;}
    const binding=logoBinding(svg);
    if(binding&&!logoProfile&&!profileFailed){set(svg,'data-geometry-state','loading-profile');return;}
    // The scrolling agent dialog clips overflow at the SVG edges: a centre-line
    // at zero loses half its straight stroke, while inset corners stay full-width.
    // Keep its whole 1px stroke inside; the other Affinity frames retain EDGE=0.
    const inset=svg.closest('.agent-window') ? 0.5 : EDGE;
    const k=w/964,r=Math.min(26*k,(w-1)/2,(h-1)/2),x0=inset,y0=inset,x1=w-inset,y1=h-inset;
    const parse=value=>value?.split(',').map(Number).map(n=>n*k);
    let top=parse(svg.dataset.topGap),bottom=parse(svg.dataset.bottomGap);
    // The upper interruption around the disciplines is a separate layout detail.
    if(mobile.matches&&svg.closest('.situations-window'))top=null;
    const joins=[];
    if(binding&&logoProfile){
      const [edge,img,name]=binding,join=logoGap(img,rect,edge==='top'?y0:y1,name);joins.push(join);
      if(edge==='top')top=join.gap||null;else bottom=join.gap||null;
    }
    if(svg.closest('.faq-window')){
      const join=pillGap(svg.closest('.faq-window').querySelector('.faq-contact'),rect,y1,'faq-cta');joins.push(join);bottom=join.gap||null;
    }
    const d=horizontal(x0+r,x1-r,y0,top)
      +`M${number(x1-r)},${y0}A${number(r)},${number(r)} 0 0 1 ${number(x1)},${number(y0+r)}V${number(y1-r)}A${number(r)},${number(r)} 0 0 1 ${number(x1-r)},${number(y1)}`
      +horizontal(x0+r,x1-r,y1,bottom)
      +`M${number(x0+r)},${number(y1)}A${number(r)},${number(r)} 0 0 1 ${x0},${number(y1-r)}V${number(y0+r)}A${number(r)},${number(r)} 0 0 1 ${number(x0+r)},${y0}`;
    paint(svg,d,w,h,joins,inset);
  }
  function refresh(){
    if(pending)return;
    pending=requestAnimationFrame(()=>{
      pending=0;
      document.querySelectorAll('[data-frame], [data-process-frame]').forEach(svg=>{if(svg.tagName.toLowerCase()==='svg'){frames.add(svg);watch(svg);}});
      document.querySelectorAll('.large-logo,.faq-contact,.process-contact,.page-shell,.chapter,.agent-dialog').forEach(watch);
      frames.forEach(draw);
    });
  }
  const observer=new ResizeObserver(refresh);
  function watch(node){
    if(observed.has(node))return;observed.add(node);observer.observe(node);
    if(node instanceof HTMLImageElement)node.addEventListener('load',refresh);
    // Element scroll events do not bubble to the window scroll listener.
    if(node.matches?.('.agent-dialog'))node.addEventListener('scroll',refresh,{passive:true});
  }
  const layoutSelector='.page-shell,.chapter,.hero-scene,.framed,.large-logo,.faq-contact,.process-contact,[data-frame],[data-process-frame]';
  const mutations=new MutationObserver(records=>{
    // Motion updates individual letters and the brand every animation frame.
    // Those style writes cannot move a frame/logo junction and must not redraw it.
    const affectsLayout=records.some(record=>{
      if(record.type==='attributes')return record.target===document.body
        ||record.target===document.documentElement||record.target.matches?.(layoutSelector);
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1
        &&(node.matches?.(layoutSelector)||node.querySelector?.('[data-frame],[data-process-frame],.large-logo')));
    });
    if(affectsLayout)refresh();
  });
  mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','open','hidden','src','width','height']});
  mutations.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
  addEventListener('resize',refresh,{passive:true});addEventListener('scroll',refresh,{passive:true});addEventListener('pageshow',refresh);addEventListener('kb:layout',refresh);
  document.addEventListener('toggle',refresh,true);document.addEventListener('transitionend',refresh,true);document.addEventListener('animationend',refresh,true);
  mobile.addEventListener('change',refresh);document.fonts?.ready.then(refresh);document.fonts?.addEventListener('loadingdone',refresh);
  window.KBFrameGeometry={refresh,measure:()=>[...frames].map(svg=>({className:svg.parentElement?.className,visible:svg.getBoundingClientRect().width>1,...reports.get(svg)})),profileSource:()=>logoProfile?.sourceSha256||null};
  fetch(new URL('assets/geometry-logo-profile.json',scriptURL),{cache:'no-cache'})
    .then(response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.json();})
    .then(data=>{if(data.schema!=='kb-logo-horizontal-intersections-1'||data.paths?.length!==5)throw Error('Invalid logo profile');logoProfile=data;refresh();})
    .catch(error=>{profileFailed=true;console.error('KB frame geometry:',error);refresh();});
  refresh();
})();
