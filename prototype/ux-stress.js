(() => {
  const scaleModes = [
    {label:'12 agents', detail:'Small company', density:'Comfortable'},
    {label:'120 agents', detail:'Growing organization', density:'Compact'},
    {label:'1,200 agents', detail:'Large organization', density:'Dense'}
  ];
  let scaleIndex = 1;
  let decorating = false;

  const commands = [
    {label:'Open Human Attention', hint:'3 approvals · 2 blockers', route:'approvals', icon:'⚠'},
    {label:'Go to Project Phoenix', hint:'Verified progress 72%', route:'project', icon:'▣'},
    {label:'Open PHX-1402', hint:'Authentication API · In Review', route:'task-detail', icon:'☑'},
    {label:'Open Backend Agent', hint:'72% utilization · 96.5% success', route:'agent-detail', icon:'◉'},
    {label:'Find stale artifacts', hint:'1 breaking consumer', route:'artifacts', icon:'◇'},
    {label:'Open Decision Registry', hint:'2 approval pending', route:'decisions', icon:'◆'},
    {label:'Open Event correlation', hint:'corr_phx_auth', route:'event-detail', icon:'⚡'},
    {label:'Open Schedule & Cron', hint:'Next run 10:30', route:'schedule', icon:'◷'}
  ];

  const attentionItems = [
    {rank:1, severity:'Critical', color:'red', title:'Protected staging deployment', detail:'Human approval blocks the critical path', meta:'CTO Agent · 8m · blast radius: auth integration', route:'approvals-detail'},
    {rank:2, severity:'High', color:'red', title:'API gateway hard blocker', detail:'PHX-1401 blocks PHX-1402 completion', meta:'Critical path · age 47m', route:'task-detail'},
    {rank:3, severity:'High', color:'amber', title:'Frontend consumes stale API Spec v3', detail:'Authoritative version is v4', meta:'Breaking change · 1 consumer stale', route:'artifact-detail'},
    {rank:4, severity:'Medium', color:'amber', title:'PHX-1402 budget extension', detail:'+$4 requested before next run', meta:'Backend Agent · policy review', route:'approvals'},
    {rank:5, severity:'Medium', color:'purple', title:'Repeated schedule failure', detail:'API Sync failed twice in 7 days', meta:'Automation reliability 96.3%', route:'schedule-detail'}
  ];

  function navigate(route){
    location.hash = route;
    closeAll();
  }

  function createLayer(){
    if(document.querySelector('#aop-stress-layer')) return;
    const root = document.createElement('div');
    root.id = 'aop-stress-layer';
    root.innerHTML = `
      <div class="cmd-backdrop stress-hidden" data-close-stress></div>
      <section class="command-palette stress-hidden" aria-label="Command palette">
        <div class="palette-head">
          <span>⌕</span>
          <input id="palette-input" placeholder="Search organization, task, agent, artifact, decision or command…" />
          <kbd>ESC</kbd>
        </div>
        <div class="palette-scope"><b>Scope</b><span>Acme Labs</span><span>›</span><span>Project Phoenix</span><span class="scope-note">${scaleModes[scaleIndex].label}</span></div>
        <div id="palette-results" class="palette-results"></div>
        <div class="palette-foot"><span>↑↓ Navigate</span><span>↵ Open</span><span>⌘K Toggle</span></div>
      </section>
      <aside class="attention-drawer stress-hidden" aria-label="Human attention">
        <div class="drawer-head"><div><span class="eyebrow">EXECUTIVE EXCEPTIONS</span><h2>Human Attention</h2></div><button data-close-stress>×</button></div>
        <div class="attention-summary"><strong>7</strong><div><b>items need attention</b><small>Ranked from authoritative state, policy and impact</small></div></div>
        <div class="attention-rule">Priority = severity + blast radius + authority + critical path + age + recurrence</div>
        <div class="attention-list">${attentionItems.map(x=>`
          <article class="attention-item" data-stress-route="${x.route}">
            <div class="rank">${x.rank}</div>
            <div class="grow"><div class="attention-item-head"><b>${x.title}</b><span class="badge b-${x.color}">${x.severity}</span></div><p>${x.detail}</p><small>${x.meta}</small></div>
          </article>`).join('')}</div>
        <div class="drawer-foot">Successful routine work is intentionally compressed out of this queue.</div>
      </aside>
      <div class="context-popover stress-hidden">
        <span class="eyebrow">CURRENT OPERATING CONTEXT</span>
        <div class="context-tree">
          <button data-stress-route="dashboard"><b>Acme Labs</b><small>Organization · 4 programs</small></button>
          <span>└</span><button data-stress-route="project"><b>Project Phoenix</b><small>Project · 72% verified</small></button>
          <span>└</span><button><b>Engineering</b><small>Team · 42 agents at scale</small></button>
        </div>
        <div class="context-actions"><button class="mini-action">Switch organization</button><button class="mini-action">All projects</button></div>
      </div>`;
    document.body.appendChild(root);

    root.addEventListener('click', e => {
      const route = e.target.closest('[data-stress-route]')?.dataset.stressRoute;
      if(route) navigate(route);
      if(e.target.closest('[data-close-stress]')) closeAll();
    });

    const input = root.querySelector('#palette-input');
    input.addEventListener('input', () => renderCommands(input.value));
    input.addEventListener('keydown', e => {
      if(e.key === 'Enter'){
        const first = root.querySelector('.palette-command');
        if(first) navigate(first.dataset.stressRoute);
      }
    });
    renderCommands('');
  }

  function renderCommands(query){
    const q = query.toLowerCase().trim();
    const results = commands.filter(c => `${c.label} ${c.hint}`.toLowerCase().includes(q));
    const target = document.querySelector('#palette-results');
    if(!target) return;
    target.innerHTML = results.length ? results.map(c => `
      <button class="palette-command" data-stress-route="${c.route}"><span class="command-icon">${c.icon}</span><span class="grow"><b>${c.label}</b><small>${c.hint}</small></span><kbd>↵</kbd></button>`).join('') : `<div class="palette-empty">No matching object or command in this prototype fixture.</div>`;
  }

  function openPalette(){
    createLayer(); closeAll();
    document.querySelector('.cmd-backdrop')?.classList.remove('stress-hidden');
    document.querySelector('.command-palette')?.classList.remove('stress-hidden');
    const input = document.querySelector('#palette-input');
    if(input){ input.value=''; renderCommands(''); setTimeout(()=>input.focus(),0); }
  }

  function openAttention(){
    createLayer(); closeAll();
    document.querySelector('.cmd-backdrop')?.classList.remove('stress-hidden');
    document.querySelector('.attention-drawer')?.classList.remove('stress-hidden');
  }

  function toggleContext(){
    createLayer();
    const pop = document.querySelector('.context-popover');
    if(!pop) return;
    pop.classList.toggle('stress-hidden');
  }

  function closeAll(){
    document.querySelectorAll('#aop-stress-layer .cmd-backdrop,#aop-stress-layer .command-palette,#aop-stress-layer .attention-drawer,#aop-stress-layer .context-popover').forEach(el=>el.classList.add('stress-hidden'));
  }

  function nextScale(){
    scaleIndex = (scaleIndex + 1) % scaleModes.length;
    const mode = scaleModes[scaleIndex];
    document.documentElement.dataset.scale = String(scaleIndex);
    document.querySelectorAll('.scale-switch').forEach(btn => {
      btn.innerHTML = `<span>Scale</span><b>${mode.label}</b><small>${mode.density}</small>`;
      btn.title = `${mode.detail} · click to cycle scale fixture`;
    });
    const note = document.querySelector('.scope-note');
    if(note) note.textContent = mode.label;
    decoratePageScale(mode);
  }

  function decoratePageScale(mode){
    const pageHead = document.querySelector('.page-head');
    let bar = document.querySelector('.scale-fixture-bar');
    const route = location.hash.replace('#','') || 'dashboard';
    const highVolume = ['tasks','agents','artifacts','decisions','events','schedule'].includes(route);
    if(highVolume && pageHead && !bar){
      bar = document.createElement('div');
      bar.className='scale-fixture-bar';
      pageHead.insertAdjacentElement('afterend',bar);
    }
    if(bar){
      bar.innerHTML = `<div><span class="eyebrow">SCALE FIXTURE</span><b>${mode.label}</b><small>${mode.detail}</small></div><div class="saved-view"><button class="active">My Attention</button><button>Critical</button><button>All</button></div><div class="density"><span>Density</span><b>${mode.density}</b></div><div class="virtualized-note">Server aggregation · cursor pagination · virtualized rows in production</div>`;
    }
  }

  function decorateTopbar(){
    const top = document.querySelector('.topbar');
    if(!top) return;
    const crumb = top.querySelector('.crumb');
    if(crumb && !crumb.dataset.stressDecorated){
      const current = crumb.querySelector('b')?.textContent || 'Current';
      crumb.innerHTML = `<span class="crumb-link" data-stress-route="dashboard">Acme Labs</span><span class="crumb-sep">/</span><span class="crumb-link" data-stress-route="project">Phoenix</span><span class="crumb-sep">/</span><b>${current}</b>`;
      crumb.dataset.stressDecorated='1';
    }

    if(!top.querySelector('.context-switch-btn')){
      const btn=document.createElement('button');
      btn.className='context-switch-btn';
      btn.innerHTML='<span>Context</span><b>Acme Labs › Phoenix</b><span>⌄</span>';
      btn.addEventListener('click',toggleContext);
      top.querySelector('.search')?.insertAdjacentElement('beforebegin',btn);
    }

    const search = top.querySelector('.search');
    if(search && !search.dataset.stressDecorated){
      search.innerHTML='<span>⌕</span><span class="grow">Search or run a command…</span><kbd>⌘K</kbd>';
      search.classList.add('command-trigger');
      search.dataset.stressDecorated='1';
      search.addEventListener('click',openPalette);
    }

    const oldAttention = top.querySelector('.attention');
    if(oldAttention && !oldAttention.dataset.stressDecorated){
      oldAttention.dataset.stressDecorated='1';
      oldAttention.title='Open ranked Human Attention';
      oldAttention.addEventListener('click', e=>{e.preventDefault(); e.stopPropagation(); openAttention();});
    }

    if(!top.querySelector('.scale-switch')){
      const btn=document.createElement('button');
      btn.className='scale-switch';
      const mode=scaleModes[scaleIndex];
      btn.innerHTML=`<span>Scale</span><b>${mode.label}</b><small>${mode.density}</small>`;
      btn.addEventListener('click',nextScale);
      top.querySelector('.attention')?.insertAdjacentElement('beforebegin',btn);
    }
  }

  function decoratePage(){
    if(decorating) return;
    decorating=true;
    try{
      createLayer();
      decorateTopbar();
      decoratePageScale(scaleModes[scaleIndex]);
      document.querySelectorAll('.detail-layout aside.grid').forEach(rail=>{
        if(!rail.querySelector('.context-return')){
          const card=document.createElement('section');
          card.className='card section context-return';
          card.innerHTML='<h3>Drill-up Context</h3><button data-stress-route="project" class="context-return-btn">← Project Phoenix</button><button data-stress-route="dashboard" class="context-return-btn">↑ Executive Dashboard</button>';
          rail.prepend(card);
        }
      });
      document.querySelectorAll('[data-stress-route]').forEach(el=>{
        if(!el.dataset.stressBound){ el.dataset.stressBound='1'; el.addEventListener('click',()=>navigate(el.dataset.stressRoute)); }
      });
    } finally { decorating=false; }
  }

  document.addEventListener('keydown', e=>{
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){e.preventDefault();openPalette();}
    if(e.key==='Escape') closeAll();
  });

  const observer=new MutationObserver(()=>queueMicrotask(decoratePage));
  const start=()=>{createLayer();observer.observe(document.querySelector('#app'),{childList:true,subtree:true});decoratePage();};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
