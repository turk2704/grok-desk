(() => {
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const state = {
    token: null,
    dataPath: null,
    planB: false,
    base: '',
    tab: 'home',
    offline: false,
    retry: 5,
    pollMs: 15000,
    signupUrl: 'https://fomo.family/r/savipww',
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
    if (md || mt) history.replaceState(null, '', location.pathname + location.search);

    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length && !parts[parts.length - 1].includes('.')) {
      state.base = '/' + parts.join('/') + '/';
    } else if (parts.length >= 1) {
      state.base = '/' + parts.slice(0, -1).join('/') + (parts.length > 1 ? '/' : '');
      if (state.base === '/') state.base = '';
      if (location.hostname.endsWith('github.io') && parts.length >= 1) {
        state.base = '/' + parts[0] + '/';
      }
    }
  }

  function dataUrl(name) {
    return `${state.base}d/${encodeURIComponent(state.dataPath)}/${name}`;
  }

  async function api(path, opts={}) {
    if (state.planB) {
      let name = null;
      if (path === '/api/state') name = 'state.json';
      else if (path.startsWith('/api/chart')) name = 'chart.json';
      else if (path === '/api/activity') name = 'activity.json';
      else if (path === '/api/copy') name = 'copy.json';
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

  function fmtMoney(n, signed=false) {
    const v = Number(n) || 0;
    const abs = Math.abs(v).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    if (!signed) return '$' + abs;
    return (v > 0 ? '+$' : v < 0 ? '-$' : '$') + abs;
  }

  function fmtPct(n) {
    const v = Number(n) || 0;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function setTone(el, n) {
    el.classList.remove('pos','neg');
    if (n > 0) el.classList.add('pos');
    else if (n < 0) el.classList.add('neg');
  }

  function ageLabel(ageS) {
    if (ageS == null) return 'no hb';
    if (ageS < 5) return 'now';
    if (ageS < 60) return Math.round(ageS) + 's';
    if (ageS < 3600) return Math.round(ageS/60) + 'm';
    return Math.round(ageS/3600) + 'h';
  }

  function computeAge(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.max(0, (Date.now() - t) / 1000);
  }

  function setTab(name) {
    state.tab = name;
    const detail = ['auditorScreen','coinScreen'].includes(name);
    $$('.screen').forEach(s => s.classList.remove('active'));
    if (detail) $(`#${name}`).classList.add('active');
    else $(`#${name}`).classList.add('active');
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  }

  function agentMetaLine(a) {
    if (a.name === 'scanner') return `${a.pools||0} pools`;
    if (a.name === 'auditor') return `${a.taken||0} audited`;
    if (a.name === 'analyst') return a.score != null ? `score ${a.score}` : 'scoring';
    if (a.name === 'executor') return `${a.trades||0} trades`;
    if (a.name === 'risk') return a.open ? `guarding ${a.open}` : (a.last_exit || 'idle');
    if (a.name === 'copy') return a.enabled === false ? 'off' : `${a.open||0} open · ${a.fills_today||0} fills`;
    return '';
  }

  function agentStripHTML(agents) {
    return (agents||[]).map(a => {
      const age = a.heartbeat_age_s != null ? a.heartbeat_age_s : computeAge(a.heartbeat);
      let st = a.status;
      if (!st) {
        if (a.paused) st = 'paused';
        else if (age == null) st = 'unknown';
        else st = age < 120 ? 'live' : 'stale';
      }
      const dot = st === 'live' ? 'live' : st === 'paused' ? 'paused' : st === 'stale' ? 'stale' : '';
      return `<div class="agent-chip" data-agent="${a.name}">
        <div class="name">${a.name}</div>
        <div class="hb"><span class="hb-dot ${dot}"></span>${st} · ${ageLabel(age)}</div>
        <div class="meta">${agentMetaLine(a)}</div>
      </div>`;
    }).join('');
  }

  function feedItemHTML(e) {
    const group = !!(e.group_buy || e.action === 'group_buy' || e.status === 'alert');
    const action = (e.action || '').toLowerCase();
    const badge = group ? 'alert' : action === 'buy' ? 'buy' : action === 'sell' || action === 'flatten' ? 'sell' :
      (e.status === 'skipped' || e.status === 'ignored' ? 'skip' : 'alert');
    const badgeText = group ? 'GROUP' : (action || e.status || '—');
    const coin = e.symbol || e.name || (e.mint ? e.mint.slice(0,6) : '—');
    const trader = e.trader || e.handle || '—';
    const entry = e.entry_usd != null ? e.entry_usd : e.our_size_usd;
    const entryLine = entry != null && Number(entry) > 0
      ? `PAPER $${Number(entry).toFixed(2)}`
      : (e.note || e.status || 'PAPER');
    const pnl = e.pnl_usd;
    const pnlHtml = pnl == null ? '' :
      `<div class="pnl ${pnl>=0?'pos':'neg'}">${fmtMoney(pnl, true)}</div>`;
    // FOMO URL must come from server (links.py). Never invent.
    const fomo = e.coin_url && String(e.coin_url).includes('r=savipww')
      ? `<a class="fomo-mini" href="${e.coin_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">FOMO</a>`
      : '';
    return `<div class="feed-item ${group?'group':''}" data-mint="${e.mint||''}">
      <div>
        <div class="title">${coin}</div>
        <div class="sub">${trader} · ${entryLine}</div>
      </div>
      <div class="side">
        <span class="badge ${badge}">${badgeText}</span>
        ${pnlHtml}
      </div>
      ${fomo}
    </div>`;
  }

  async function refreshHome() {
    try {
      const st = await api('/api/state');
      const today = st.pnl_today_usd != null ? st.pnl_today_usd : (st.equity != null && st.balance != null ? st.equity - (st.night_start||st.balance) : 0);
      const total = st.pnl_total_usd != null ? st.pnl_total_usd : today;
      const unreal = st.unrealized_usd || 0;
      const equity = st.equity != null ? st.equity : st.balance;

      $('#pnlToday').textContent = fmtMoney(today, true);
      setTone($('#pnlToday'), today);
      $('#todayPct').textContent = fmtPct(st.today_pct || 0);
      setTone($('#todayPct'), st.today_pct || 0);
      $('#pnlTotal').textContent = fmtMoney(total, true);
      setTone($('#pnlTotal'), total);
      $('#totalPct').textContent = fmtPct(st.total_pct != null ? st.total_pct : st.today_pct || 0);
      setTone($('#totalPct'), st.total_pct != null ? st.total_pct : st.today_pct || 0);
      $('#pnlUnreal').textContent = fmtMoney(unreal, true);
      setTone($('#pnlUnreal'), unreal);
      const opens = (st.open_positions || []).length;
      $('#openCount').textContent = opens + (opens === 1 ? ' open' : ' open');
      $('#equityLine').textContent = `Equity ${fmtMoney(equity)} · bal ${fmtMoney(st.balance)}`;
      $('#paperPill').classList.toggle('hidden', st.mode !== 'PAPER');

      const agents = st.agents || [];
      const liveN = agents.filter(a => {
        const age = a.heartbeat_age_s != null ? a.heartbeat_age_s : computeAge(a.heartbeat);
        return !a.paused && age != null && age < 120;
      }).length;
      $('#agentsLive').textContent = `${liveN}/${agents.length} live`;
      $('#agentStrip').innerHTML = agentStripHTML(agents);

      let feed = st.copy_feed;
      if (!feed || !feed.length) {
        try {
          const c = await api('/api/copy');
          feed = c.events || [];
        } catch (_) {
          feed = (st.copy && st.copy.events_today) || [];
        }
      }
      $('#homeCopy').innerHTML = (feed||[]).slice(0,8).map(feedItemHTML).join('')
        || '<div class="feed-empty">No copy trades yet tonight</div>';
    } catch (e) {
      showErr(`Desk offline · retrying in ${state.retry}s`);
    }
  }

  async function refreshAgents() {
    try {
      const st = await api('/api/state');
      const wrap = $('#agentsList');
      wrap.innerHTML = '';
      for (const a of (st.agents || [])) {
        let dec = {decisions:[]};
        try { dec = await api(`/api/agents/${a.name}/decisions`); } catch (_) {}
        const age = a.heartbeat_age_s != null ? a.heartbeat_age_s : computeAge(a.heartbeat);
        let stName = a.status || (a.paused ? 'paused' : (age != null && age < 120 ? 'live' : 'stale'));
        const el = document.createElement('div');
        el.className = 'full-card';
        const switchHtml = state.planB
          ? `<span class="pill ${stName}">${stName}</span>`
          : `<button class="switch ${a.paused?'':'on'}" data-agent="${a.name}" aria-label="pause ${a.name}"></button>`;
        const rows = (dec.decisions || []).slice(0,5).map(d => {
          const mint = d.mint || '';
          const url = d.coin_url || '';
          const safe = url && url.includes('r=savipww');
          return `<div class="row" data-mint="${mint}">
            <div><div class="title" style="font-weight:650">${(d.symbol||mint||'').toString().slice(0,12)}</div>
            <div class="muted">${d.verdict||d.reason||d.status||d.action||d.exit_reason||''}</div></div>
            ${safe ? `<a class="link" href="${url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">FOMO</a>` : ''}
          </div>`;
        }).join('') || '<div class="muted" style="padding:8px 0">No decisions yet</div>';
        el.innerHTML = `<div class="top">
          <div><span class="status-dot ${stName==='live'?'':(stName==='stale'?'stale':'off')}"></span>
            <strong style="text-transform:capitalize;margin-left:6px">${a.name}</strong>
            <span class="muted" style="margin-left:8px">${ageLabel(age)}</span>
          </div>${switchHtml}</div>
          <div class="muted" style="margin:8px 0">${agentMetaLine(a)}</div>
          <div class="feed">${rows}</div>`;
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
          } catch (e) { alert(e.message); }
        });
      }
    } catch (e) { showErr(e.message); }
  }

  async function refreshCopy() {
    try {
      let data;
      try { data = await api('/api/copy'); }
      catch (_) {
        const st = await api('/api/state');
        data = { events: st.copy_feed || (st.copy && st.copy.events_today) || [], rules: (st.copy||{}) };
      }
      const rules = data.rules || {};
      $('#copyRules').innerHTML = [
        rules.tp_mult != null ? `<span class="pill">TP ${rules.tp_mult}×</span>` : '',
        rules.sl_pct != null ? `<span class="pill">SL −${rules.sl_pct}%</span>` : '',
        rules.close_all_local ? `<span class="pill">flatten ${rules.close_all_local}</span>` : '',
        rules.delay_s != null ? `<span class="pill">lag ${rules.delay_s}s</span>` : '',
        `<span class="pill paper">PAPER</span>`,
      ].join('');
      const events = data.events || [];
      $('#copyFeed').innerHTML = events.map(feedItemHTML).join('')
        || '<div class="feed-empty">No copy trades yet tonight</div>';
    } catch (e) { showErr(e.message); }
  }

  async function refreshAccount() {
    try {
      const acc = await api('/api/account');
      const set = await api('/api/settings');
      let st = {};
      try { st = await api('/api/state'); } catch (_) {}
      $('#stackVal').textContent = fmtMoney(acc.stack);
      $('#accEquity').textContent = fmtMoney(st.equity != null ? st.equity : acc.balance);
      $('#profileLink').href = acc.profile_url;
      $('#tgStatus').textContent = acc.telegram ? 'connected' : 'not connected';
      if (acc.signup_url) state.signupUrl = acc.signup_url;
      if (state.planB || acc.plan_b) {
        $('#planBNote').textContent = 'Plan B · read-only. Change settings / mode / pause via Telegram. Desk never places orders.';
      }
      const list = $('#settingsList');
      list.innerHTML = '';
      const settings = set.settings || {};
      Object.keys(settings).sort().forEach(k => {
        if (k === 'desk.rpc_url') return;
        const div = document.createElement('div');
        div.className = 'setting';
        const ro = (state.planB || set.readonly) ? 'readonly' : '';
        const val = typeof settings[k] === 'object' ? JSON.stringify(settings[k]) : settings[k];
        div.innerHTML = `<label>${k}<input data-key="${k}" value="${String(val).replace(/"/g,'&quot;')}" ${ro}/></label>`;
        list.appendChild(div);
      });
      if (!(state.planB || set.readonly)) {
        $$('input[data-key]', list).forEach(inp => {
          inp.onchange = async () => {
            let v = inp.value;
            if (v === 'true' || v === 'false') v = (v === 'true');
            else if (!isNaN(Number(v)) && v.trim() !== '') v = Number(v);
            const res = await api('/api/settings', {method:'POST', body:{key:inp.dataset.key, value:v}});
            if (res.warning) alert(res.warning);
          };
        });
      }
    } catch (e) { showErr(e.message); }
  }

  async function openAudit(mint) {
    setTab('auditorScreen');
    const data = await api('/api/audit/' + mint);
    $('#auditTitle').textContent = mint.slice(0,8) + '…';
    if (data.coin_url && data.coin_url.includes('r=savipww')) $('#auditFomo').href = data.coin_url;
    const discs = $('#auditDiscs');
    discs.innerHTML = '';
    const layers = data.layers || [];
    for (let i = 1; i <= 8; i++) {
      const L = layers.find(x => x.layer === i) || {pass:null, value_text:'not checked', name:'Layer '+i};
      const d = document.createElement('div');
      d.className = 'disc ' + (L.pass===1||L.pass===true?'ok': L.pass===0||L.pass===false?'bad': 'grey');
      d.innerHTML = `<span>${L.name||('Layer '+i)}</span><span>${L.value_text||L.value||''}</span>`;
      discs.appendChild(d);
    }
    if (!layers.length) discs.innerHTML = '<div class="muted">No coin taken apart yet</div>';
  }

  async function openCoin(mint) {
    if (!mint || mint.startsWith('Break')) return;
    setTab('coinScreen');
    const data = await api('/api/coin/' + mint);
    const c = data.coin || {};
    $('#coinName').textContent = c.symbol || c.name || mint.slice(0,6);
    $('#coinMeta').textContent = `${c.symbol||''} · Solana · PAPER`;
    $('#coinPrice').textContent = data.price != null ? Number(data.price).toPrecision(4) : '—';
    const pos = data.position;
    let exitLine = null;
    if (pos && !pos.closed_at) {
      exitLine = pos.trail_active ? pos.peak_price * (1 - (data.trail_pct||12)/100) : pos.stop_price;
      $('#posCard').classList.remove('hidden');
      $('#posCard').innerHTML = `<div class="row"><span>PAPER position</span><span>${fmtMoney(pos.size_usd)}</span></div>
        <div class="row"><span>Entry</span><span>${Number(pos.entry_price).toPrecision(4)}</span></div>
        <div class="row"><span>Stop</span><span>${Number(pos.stop_price).toPrecision(4)}</span></div>
        <div class="row"><span>Trail</span><span>${pos.trail_active?'on':'off'}</span></div>`;
      $('#coinFomo').textContent = 'Sell on FOMO';
    } else {
      $('#posCard').classList.add('hidden');
      $('#coinFomo').textContent = 'Buy on FOMO';
    }
    if (data.coin_url && data.coin_url.includes('r=savipww')) {
      $('#coinFomo').href = data.coin_url;
    }
    if (window.DeskCharts) DeskCharts.candles($('#coinChart'), data.candles, exitLine);
    $('#coinStats').innerHTML = `
      <div><div class="k">Holders</div><div class="v">${data.holders ?? 'n/a'}</div></div>
      <div><div class="k">Mode</div><div class="v">PAPER</div></div>`;
  }

  function wire() {
    $$('.tabbar button').forEach(b => b.onclick = () => { setTab(b.dataset.tab); refresh(); });
    $('#seeCopy').onclick = () => { setTab('copy'); refreshCopy(); };
    document.body.addEventListener('click', (e) => {
      const item = e.target.closest('.feed-item[data-mint], .row[data-mint]');
      if (!item) return;
      if (e.target.closest('a')) return;
      const mint = item.dataset.mint;
      if (!mint) return;
      openCoin(mint);
    });
    $$('[data-back]').forEach(b => b.onclick = () => { setTab('home'); refreshHome(); });
    $('#inviteBtn').onclick = async () => {
      let url = state.signupUrl;
      try { url = (await api('/api/account')).signup_url || url; } catch (_) {}
      if (navigator.share) navigator.share({url, title:'FOMO'});
      else { await navigator.clipboard.writeText(url); alert('Link copied'); }
    };
  }

  function connectSSE() {
    if (state.planB || !state.token) return;
    const es = new EventSource('/api/stream?token=' + encodeURIComponent(state.token));
    ['scan','audit_layer','verdict','signal','fill','exit','balance','copy'].forEach(ev => {
      es.addEventListener(ev, () => refreshHome());
    });
    es.onerror = () => {
      showErr(`Desk offline · retrying in ${state.retry}s`);
      es.close();
      setTimeout(connectSSE, state.retry * 1000);
    };
  }

  async function refresh() {
    if (state.tab === 'home') await refreshHome();
    if (state.tab === 'agents') await refreshAgents();
    if (state.tab === 'copy') await refreshCopy();
    if (state.tab === 'account') await refreshAccount();
  }

  loadAuth();
  wire();
  if (state.planB) {
    if (!state.dataPath) showErr('Missing data path. Open once as {URL}#d=…');
    else { refresh(); setInterval(refreshHome, state.pollMs); }
  } else if (!state.token) {
    // Local desk without token still useful for screenshots if we inject later;
    // show guidance.
    showErr('Missing app token. Open the URL with #t=… once (or Plan B #d=…).');
  } else {
    refresh();
    connectSSE();
    setInterval(refreshHome, 15000);
  }
})();
