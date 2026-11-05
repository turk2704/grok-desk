(() => {
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const state = {
    token: null,
    dataPath: null,
    planB: false,
    base: '', // '' for same-origin; for Pages project sites relative fetches work from index
    tab: 'home',
    offline: false,
    retry: 5,
    pollMs: 15000,
  };

  function loadAuth() {
    const hash = location.hash || '';
    const md = hash.match(/[#&]d=([^&]+)/);
    const mt = hash.match(/[#&]t=([^&]+)/);
    if (md) {
      state.dataPath = decodeURIComponent(md[1]);
      localStorage.setItem('desk_data_path', state.dataPath);
      state.planB = true;
    } else {
      const saved = localStorage.getItem('desk_data_path');
      if (saved) { state.dataPath = saved; state.planB = true; }
    }
    if (mt) {
      state.token = decodeURIComponent(mt[1]);
      localStorage.setItem('desk_token', state.token);
    } else {
      state.token = localStorage.getItem('desk_token');
    }
    if (md || mt) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    // Project Pages live under /<repo>/ — derive base from pathname
    const parts = location.pathname.split('/').filter(Boolean);
    // if path ends with index.html or is repo root, base is up to last dir before file
    if (parts.length && !parts[parts.length - 1].includes('.')) {
      state.base = '/' + parts.join('/') + '/';
    } else if (parts.length >= 1) {
      state.base = '/' + parts.slice(0, -1).join('/') + (parts.length > 1 ? '/' : '');
      if (state.base === '/') state.base = '';
      // github.io/user/repo/index.html -> /repo/
      if (location.hostname.endsWith('github.io') && parts.length >= 1) {
        state.base = '/' + parts[0] + '/';
      }
    }
  }

  function dataUrl(name) {
    // Plan B: ONLY under /d/{DATA_PATH}/
    return `${state.base}d/${encodeURIComponent(state.dataPath)}/${name}`;
  }

  async function api(path, opts={}) {
    if (state.planB) {
      // map /api/... to static JSON
      let name = null;
      if (path === '/api/state') name = 'state.json';
      else if (path.startsWith('/api/chart')) name = 'chart.json';
      else if (path === '/api/activity') name = 'activity.json';
      else if (path === '/api/account') name = 'account.json';
      else if (path === '/api/settings') name = 'settings.json';
      else if (path.startsWith('/api/coin/')) name = 'coin/' + path.split('/').pop() + '.json';
      else if (path.startsWith('/api/audit/')) name = 'audit/' + path.split('/').pop() + '.json';
      else if (path.match(/^\/api\/agents\/[^/]+\/decisions/)) {
        const a = path.split('/')[3];
        name = 'agents/' + a + '.json';
      } else if (opts.method && opts.method !== 'GET') {
        throw new Error('Plan B is read-only — change settings via Telegram');
      } else {
        throw new Error('unsupported in plan B: ' + path);
      }
      const r = await fetch(dataUrl(name), { cache: 'no-store' });
      if (r.status === 404) throw new Error('404');
      if (!r.ok) throw new Error('http ' + r.status);
      state.offline = false;
      $('#err').classList.add('hidden');
      return r.json();
    }
    if (!state.token) throw new Error('no token');
    const headers = Object.assign({'X-App-Token': state.token}, opts.headers || {});
    if (opts.body && typeof opts.body === 'object') {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    if (r.status === 401) throw new Error('401');
    if (!r.ok) throw new Error('http ' + r.status);
    state.offline = false;
    $('#err').classList.add('hidden');
    return r.json();
  }

  function showErr(msg) {
    state.offline = true;
    const el = $('#err');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function fmtMoney(n) {
    return '$' + (Number(n)||0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  }

  function setTab(name) {
    state.tab = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === name || (name==='home' && s.id==='home')));
    if (!['auditorScreen','coinScreen'].includes(name)) {
      $('#auditorScreen').classList.remove('active');
      $('#coinScreen').classList.remove('active');
      $$('.screen').forEach(s => s.classList.toggle('active', s.id === name));
    }
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  }

  function agentCardHTML(a) {
    const colors = {scanner:'#64d2ff', auditor:'#fff', analyst:'#ffd60a', executor:'#00d35a', risk:'#ff6b9a'};
    let body = '';
    if (a.name === 'scanner') {
      body = `<div class="muted">${a.pools||0} pools</div>` +
        (a.feed||[]).slice(0,5).map(f => {
          const killed = f.verdict === 'kill';
          return `<div class="feed-row ${killed?'killed':''}"><span>${(f.mint||'').slice(0,6)} · liq $${Math.round(f.liquidity_usd||0)}</span>`+
            `<span class="${killed?'reason':''}">${killed? (f.reason||''): '→ auditor'}</span></div>`;
        }).join('') || `<div class="muted">Listening for graduations</div>`;
    } else if (a.name === 'auditor') {
      body = `<div class="muted">${a.taken||0} taken apart · ${a.rejected||0} rejected</div>`;
    } else if (a.name === 'analyst') {
      body = `<div class="muted">Scoring</div><canvas class="ring" width="120" height="120" data-score="${a.score??''}"></canvas>`;
    } else if (a.name === 'executor') {
      body = `<div class="muted">${a.trades||0} trades · ${a.stack_pct}% of stack</div>`;
    } else if (a.name === 'risk') {
      body = `<div class="muted">${a.open? 'Guarding' : (a.last_exit==='trail'?'Trailed out': a.last_exit==='stop'?'Stopped':'Guarding')}</div>
        <div><span class="pill" style="color:#ff453a;background:rgba(255,69,58,.15)">stop -${a.stop_pct}%</span>
        <span class="pill" style="color:#00d35a;background:rgba(0,211,90,.15)">trail ${a.trail_pct}%</span></div>`;
    }
    return `<div class="agent-card" style="border-top:3px solid ${colors[a.name]||'#fff'}">
      <h3>${a.name[0].toUpperCase()+a.name.slice(1)}</h3>${body}</div>`;
  }

  async function refreshHome() {
    try {
      const st = await api('/api/state');
      $('#balance').textContent = fmtMoney(st.balance);
      $('#todayPct').textContent = (st.today_pct>=0?'+':'') + st.today_pct.toFixed(2) + '%';
      $('#todayPct').style.color = st.today_pct>=0 ? 'var(--green)' : 'var(--red)';
      $('#mult').textContent = st.multiplier.toFixed(2) + '×';
      $('#paperPill').classList.toggle('hidden', st.mode !== 'PAPER');
      $('#agentsRunning').textContent = st.agents.filter(a=>!a.paused).length;
      $('#agentCarousel').innerHTML = st.agents.map(agentCardHTML).join('') || '<div class="muted">Listening for graduations</div>';
      $$('#agentCarousel canvas.ring').forEach(c => {
        const sc = c.dataset.score === '' ? null : Number(c.dataset.score);
        DeskCharts.scoreRing(c, sc, 70);
      });
      const ch = await api('/api/chart?range=LIVE');
      DeskCharts.lineChart($('#homeChart'), ch.points, ch.marks);
      const act = await api('/api/activity');
      const rows = act.rows || [];
      $('#homeActivity').innerHTML = rows.slice(0,5).map(rowHTML).join('') || '<div class="muted">Nothing yet tonight</div>';
    } catch (e) {
      showErr(`Desk offline · retrying in ${state.retry}s`);
    }
  }

  function rowHTML(r) {
    return `<div class="row" data-mint="${r.mint||''}" data-kind="${r.kind}" data-agent="${r.agent}">
      <div class="left"><div class="title">${r.title||''}</div><div class="sub">${r.subtitle||''}</div></div>
      <div class="val">${r.value||''}</div></div>`;
  }

  async function refreshAgents() {
    const st = await api('/api/state');
    const wrap = $('#agentsList');
    wrap.innerHTML = '';
    for (const a of st.agents) {
      let dec = {decisions:[]};
      try { dec = await api(`/api/agents/${a.name}/decisions`); } catch(e) {}
      const el = document.createElement('div');
      el.className = 'full-card';
      const switchHtml = state.planB
        ? `<span class="muted">Telegram to pause</span>`
        : `<button class="switch ${a.paused?'':'on'}" data-agent="${a.name}"></button>`;
      el.innerHTML = `<div class="top"><div><span class="status-dot ${a.paused?'off':''}"></span> <strong>${a.name}</strong></div>
        ${switchHtml}</div>
        <div class="muted">today · see decisions below</div>
        <div class="list">${(dec.decisions||[]).slice(0,5).map(d => {
          const mint = d.mint || '';
          const url = d.coin_url || '#';
          return `<div class="row"><div class="left"><div class="title">${mint.slice(0,8)}…</div>
            <div class="sub">${d.verdict||d.reason||d.status||d.exit_reason||''}</div></div>
            <a class="link" href="${url}" target="_blank" rel="noopener">FOMO</a></div>`;
        }).join('') || '<div class="muted">No decisions yet</div>'}</div>`;
      wrap.appendChild(el);
    }
    if (!state.planB) {
      $$('.switch', wrap).forEach(sw => sw.onclick = async () => {
        const name = sw.dataset.agent;
        const on = sw.classList.contains('on');
        try {
          if (on) await api(`/api/agents/${name}/pause`, {method:'POST'});
          else await api(`/api/agents/${name}/resume`, {method:'POST'});
          refreshAgents();
        } catch(e){ alert(e.message); }
      });
    }
  }

  async function refreshActivity() {
    const act = await api('/api/activity');
    $('#activityList').innerHTML = (act.rows||[]).map(rowHTML).join('') || '<div class="muted">Nothing yet tonight</div>';
  }

  async function refreshAccount() {
    const acc = await api('/api/account');
    const set = await api('/api/settings');
    $('#modePaper').classList.toggle('on', acc.mode==='PAPER');
    $('#modeLive').classList.toggle('on', acc.mode==='LIVE');
    $('#stackInput').value = acc.stack;
    $('#stackInput').disabled = !!state.planB;
    $('#modePaper').disabled = !!state.planB;
    $('#modeLive').disabled = !!state.planB;
    $('#profileLink').href = acc.profile_url;
    $('#tgStatus').textContent = acc.telegram ? 'connected' : 'not connected';
    if (state.planB) {
      let note = $('#planBNote');
      if (!note) {
        note = document.createElement('div');
        note.id = 'planBNote';
        note.className = 'muted';
        note.style.padding = '8px 0';
        $('#account .card').appendChild(note);
      }
      note.textContent = 'Plan B · Account is read-only. Change settings / mode / pause via Telegram. No web push on Pages.';
      $('#enablePush')?.classList.add('hidden');
    }
    const list = $('#settingsList');
    list.innerHTML = '';
    const settings = set.settings || {};
    Object.keys(settings).sort().forEach(k => {
      if (k === 'desk.rpc_url') return;
      const div = document.createElement('div');
      div.className = 'setting';
      const ro = state.planB ? 'readonly' : '';
      div.innerHTML = `<label>${k}<input data-key="${k}" value="${settings[k]}" ${ro}/></label>`;
      list.appendChild(div);
    });
    if (!state.planB) {
      $$('input[data-key]', list).forEach(inp => {
        inp.onchange = async () => {
          let v = inp.value;
          if (v === 'true' || v === 'false') v = (v==='true');
          else if (!isNaN(Number(v)) && v.trim()!=='') v = Number(v);
          const res = await api('/api/settings', {method:'POST', body:{key:inp.dataset.key, value:v}});
          if (res.warning) alert(res.warning);
        };
      });
    }
  }

  async function openAudit(mint) {
    setTab('auditorScreen');
    $('#auditorScreen').classList.add('active');
    const data = await api('/api/audit/'+mint);
    $('#auditTitle').textContent = mint.slice(0,8)+'…';
    $('#auditFomo').href = data.coin_url;
    const discs = $('#auditDiscs');
    discs.innerHTML = '';
    const layers = data.layers || [];
    for (let i=1;i<=8;i++) {
      const L = layers.find(x => x.layer===i) || {pass:null, value_text:'not checked', name:'Layer '+i};
      const d = document.createElement('div');
      d.className = 'disc ' + (L.pass===1||L.pass===true?'ok': L.pass===0||L.pass===false?'bad': 'grey');
      d.innerHTML = `<span>${L.name||('Layer '+i)}</span><span>${L.value_text||L.value||''}</span>`;
      discs.appendChild(d);
    }
    if (!layers.length) discs.innerHTML = '<div class="muted">No coin taken apart yet</div>';
  }

  async function openCoin(mint) {
    setTab('coinScreen');
    $('#coinScreen').classList.add('active');
    const data = await api('/api/coin/'+mint);
    const c = data.coin || {};
    $('#coinName').textContent = c.symbol || c.name || mint.slice(0,6);
    $('#coinMeta').textContent = `${c.symbol||''} · Solana`;
    $('#coinPrice').textContent = data.price != null ? Number(data.price).toPrecision(4) : '—';
    $('#coinPaper').classList.toggle('hidden', false);
    let exitLine = null;
    const pos = data.position;
    if (pos && !pos.closed_at) {
      exitLine = pos.trail_active ? pos.peak_price * (1 - (data.trail_pct||12)/100) : pos.stop_price;
      $('#posCard').classList.remove('hidden');
      $('#posCard').innerHTML = `<div class="row"><span>Your position</span><span>${fmtMoney(pos.size_usd)} in</span></div>
        <div class="row"><span>Stop</span><span>${Number(pos.stop_price).toPrecision(4)}</span></div>
        <div class="row"><span>Trail</span><span>${pos.trail_active?'on':'off'}</span></div>`;
      $('#coinFomo').textContent = 'Sell on FOMO';
    } else {
      $('#posCard').classList.add('hidden');
      $('#coinFomo').textContent = 'Buy on FOMO';
    }
    $('#coinFomo').href = data.coin_url;
    DeskCharts.candles($('#coinChart'), data.candles, exitLine);
    $('#coinStats').innerHTML = `
      <div><div class="k">Holders</div><div class="v">${data.holders ?? 'n/a'}</div></div>
      <div><div class="k">Shield</div><div class="v">audit</div></div>`;
  }

  function wire() {
    $$('.tabbar button').forEach(b => b.onclick = () => { setTab(b.dataset.tab); refresh(); });
    $('#avatar').onclick = () => { setTab('account'); refreshAccount(); };
    $('#seeAll').onclick = () => { setTab('activity'); refreshActivity(); };
    document.body.addEventListener('click', (e) => {
      const row = e.target.closest('.row[data-mint]');
      if (!row) return;
      const mint = row.dataset.mint;
      if (!mint) return;
      if (row.dataset.kind === 'rejected' && row.dataset.agent === 'auditor') openAudit(mint);
      else openCoin(mint);
    });
    $$('[data-back]').forEach(b => b.onclick = () => setTab('home'));
    $('#modePaper').onclick = async () => {
      if (state.planB) { alert('Plan B: switch mode via Telegram'); return; }
      await api('/api/mode/PAPER', {method:'POST', body:{}}); refreshAccount();
    };
    $('#modeLive').onclick = async () => {
      if (state.planB) { alert('Plan B: switch mode via Telegram'); return; }
      const conf = prompt('Type LIVE to confirm');
      if (conf !== 'LIVE') return;
      try { await api('/api/mode/LIVE', {method:'POST', body:{confirm:'LIVE'}}); refreshAccount(); }
      catch(e){ alert(e.message); }
    };
    $('#stackInput').onchange = async () => {
      if (state.planB) { alert('Plan B: set stack via Telegram'); return; }
      const res = await api('/api/settings', {method:'POST', body:{key:'desk.paper_start_stack', value:Number($('#stackInput').value)}});
      if (res.warning) alert(res.warning);
    };
    $('#inviteBtn').onclick = async () => {
      const url = (await api('/api/account')).signup_url;
      if (navigator.share) navigator.share({url, title:'FOMO'});
      else { await navigator.clipboard.writeText(url); alert('Link copied'); }
    };
    $('#testPush').onclick = async () => {
      alert('Ask Telegram for a PAPER test push (Plan B has no web push).');
    };
  }

  function connectSSE() {
    if (state.planB || !state.token) return;
    const es = new EventSource('/api/stream?token=' + encodeURIComponent(state.token));
    ['scan','audit_layer','verdict','signal','fill','exit','balance'].forEach(ev => {
      es.addEventListener(ev, () => refreshHome());
    });
    es.onerror = () => { showErr(`Desk offline · retrying in ${state.retry}s`); es.close(); setTimeout(connectSSE, state.retry*1000); };
  }

  async function refresh() {
    if (state.tab === 'home') await refreshHome();
    if (state.tab === 'agents') await refreshAgents();
    if (state.tab === 'activity') await refreshActivity();
    if (state.tab === 'account') await refreshAccount();
  }

  loadAuth();
  wire();
  if (state.planB) {
    if (!state.dataPath) {
      showErr('Missing data path. Open once as {URL}#d=…');
    } else {
      refresh();
      setInterval(refreshHome, state.pollMs);
    }
  } else if (!state.token) {
    showErr('Missing app token. Open the URL with #t=… once (or Plan B #d=…).');
  } else {
    refresh();
    connectSSE();
    setInterval(refreshHome, 15000);
  }
})();
