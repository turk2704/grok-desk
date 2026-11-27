/* Grok Bot · Terminal — iPhone-first home view (PAPER only, read-only). */
(function (global) {
  const $ = (s, el = document) => el.querySelector(s);
  const TZ = 'Europe/Brussels';
  const RANGES = { '1H': 3600e3, '4H': 4 * 3600e3, '1D': 86400e3, '1W': 7 * 86400e3, 'ALL': Infinity };
  const BOTS = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Brain', executor: 'Executor', risk: 'Risk', copy: 'Copy', desk: 'Desk' };
  const T = { range: 'ALL', ctx: null, eq: null, dex: {}, dexTried: {}, busy: false, nowKey: null };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = v => (v == null || isNaN(Number(v))) ? null : Number(v);
  function money(n, signed = false) {
    const v = Number(n) || 0;
    const a = Math.abs(v).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!signed) return '$' + a;
    return (v > 0 ? '+$' : v < 0 ? '-$' : '$') + a;
  }
  const pct = n => (n >= 0 ? '+' : '') + Number(n).toFixed(1) + '%';
  function compact(n) {
    const v = Number(n);
    if (!v) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  }
  const tms = s => { const t = Date.parse(s); return isNaN(t) ? null : t; };
  const hhmm = s => new Date(s).toLocaleTimeString('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  function when(s) {
    const d = new Date(s);
    const day = d.toLocaleDateString('nl-BE', { timeZone: TZ, day: 'numeric', month: 'short' });
    const today = new Date().toLocaleDateString('nl-BE', { timeZone: TZ, day: 'numeric', month: 'short' });
    return (day === today ? '' : day + ' ') + hhmm(s);
  }
  function safeLink(u) {
    try { const x = new URL(String(u)); return (x.protocol === 'https:' && x.hostname === 'fomo.family' && x.searchParams.get('r') === 'turk2706') ? x.href : null; }
    catch (_) { return null; }
  }
  const tone = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';

  async function getJSON(name) {
    const r = await fetch(T.ctx.dataUrl(name), { cache: 'no-store' });
    if (!r.ok) throw new Error(name + ' ' + r.status);
    return r.json();
  }

  // DexScreener: icon, pair, price, supply (public API, no key)
  async function dexInfo(mints) {
    const need = [...new Set(mints.filter(m => m && !T.dex[m] && !T.dexTried[m]))].slice(0, 30);
    if (!need.length) return;
    need.forEach(m => T.dexTried[m] = true);
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + need.join(','));
      if (!r.ok) return;
      const pairs = await r.json();
      for (const p of pairs || []) {
        const m = p.baseToken && p.baseToken.address;
        if (!m) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        const cur = T.dex[m];
        if (cur && cur.liq >= liq) continue;
        const price = num(p.priceUsd), mc = num(p.marketCap) || num(p.fdv);
        T.dex[m] = {
          icon: p.info && p.info.imageUrl, pair: p.pairAddress, symbol: p.baseToken.symbol,
          price, mcap: mc, supply: (price && mc) ? mc / price : null, liq,
          ch5: p.priceChange && p.priceChange.m5, ch1: p.priceChange && p.priceChange.h1,
        };
      }
    } catch (_) { /* offline: no icons */ }
  }

  function icon(mint, sym, kind) {
    const d = T.dex[mint];
    const letter = esc((sym || '?').replace(/^\$/, '').slice(0, 1).toUpperCase());
    const badge = kind ? `<span class="t-ico-badge ${kind}"></span>` : '';
    if (d && d.icon) return `<span class="t-ico"><img src="${esc(d.icon)}" alt="" loading="lazy" onerror="this.remove()"/><b>${letter}</b>${badge}</span>`;
    return `<span class="t-ico"><b>${letter}</b>${badge}</span>`;
  }

  // ---------- equity ----------
  function tradesList(eq, risk) {
    if (eq && eq.trades) return eq.trades.slice();
    return ((risk && (risk.rows || risk.decisions)) || []).map(p => ({
      mint: p.mint, symbol: p.symbol, closed_at: p.closed_at, opened_at: p.opened_at, pnl_usd: p.pnl_usd,
      size_usd: p.size_usd, entry_price: p.entry_price, exit_reason: p.exit_reason, coin_url: p.coin_url,
      pnl_pct: p.size_usd ? p.pnl_usd / p.size_usd * 100 : null, stop_pct: p.stop_pct, source: p.source,
    })).filter(t => t.closed_at);
  }

  function drawEquity(trades) {
    const cv = $('#tEquity');
    if (!cv) return;
    const r = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 358, h = cv.clientHeight || 190;
    cv.width = Math.round(w * r); cv.height = Math.round(h * r);
    const ctx = cv.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const all = trades.filter(t => tms(t.closed_at)).sort((a, b) => tms(a.closed_at) - tms(b.closed_at));
    const now = Date.now();
    const span = RANGES[T.range];
    const t0 = span === Infinity ? (all.length ? tms(all[0].opened_at || all[0].closed_at) || tms(all[0].closed_at) - 3600e3 : now - 86400e3) : now - span;
    let cum = 0, base = 0;
    const pts = [];
    for (const t of all) {
      const ts = tms(t.closed_at);
      cum += Number(t.pnl_usd) || 0;
      if (ts < t0) { base = cum; continue; }
      pts.push({ t: ts, v: cum, tr: t });
    }
    const series = [{ t: t0, v: base }, ...pts, { t: now, v: pts.length ? pts[pts.length - 1].v : base }];
    const rangePnl = series[series.length - 1].v - base;
    const rp = $('#tRangePnl');
    rp.textContent = (pts.length ? pts.length + ' trades · ' : 'geen trades · ') + money(rangePnl, true);
    rp.className = 'muted ' + tone(rangePnl);

    const vals = series.map(p => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.18 || 2; lo -= pad; hi += pad;
    const L = 6, R = 6, TOP = 22, BOT = 18;
    const X = t => L + (t - t0) / Math.max(now - t0, 1) * (w - L - R);
    const Y = v => TOP + (hi - v) / (hi - lo) * (h - TOP - BOT);
    const up = series[series.length - 1].v >= base;
    const col = up ? '#30d158' : '#ff453a';
    // zero line
    ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(235,235,245,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(base)); ctx.lineTo(w, Y(base)); ctx.stroke(); ctx.setLineDash([]);
    // step line (realized PnL only changes on a close)
    const path = () => {
      ctx.beginPath();
      series.forEach((p, i) => {
        if (!i) { ctx.moveTo(X(p.t), Y(p.v)); return; }
        ctx.lineTo(X(p.t), Y(series[i - 1].v)); ctx.lineTo(X(p.t), Y(p.v));
      });
    };
    const g = ctx.createLinearGradient(0, TOP, 0, h);
    g.addColorStop(0, up ? 'rgba(48,209,88,.28)' : 'rgba(255,69,58,.24)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    path(); ctx.lineTo(X(now), h); ctx.lineTo(X(t0), h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    path(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    // markers
    const labelSet = new Set([...pts].sort((a, b) => Math.abs(b.tr.pnl_usd) - Math.abs(a.tr.pnl_usd)).slice(0, pts.length <= 5 ? 5 : 3));
    ctx.font = '600 10px -apple-system, sans-serif';
    const boxes = [];
    for (const p of pts) {
      const win = Number(p.tr.pnl_usd) > 0;
      const c = win ? '#30d158' : '#ff453a';
      const x = X(p.t), y = Y(p.v);
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#050505'; ctx.stroke();
      if (!labelSet.has(p)) continue;
      const sym = (p.tr.symbol || (p.tr.mint || '').slice(0, 4)).slice(0, 8);
      const txt = win ? `${sym} ${money(p.tr.pnl_usd, true)}` : `${sym} stop ${money(p.tr.pnl_usd, true)}`;
      const tw = ctx.measureText(txt).width + 10;
      let bx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2);
      let by = win ? y - 22 : y + 8;
      if (by < 2) by = y + 8; if (by + 15 > h) by = y - 22;
      if (boxes.some(b => bx < b.x + b.w && bx + tw > b.x && by < b.y + 15 && by + 15 > b.y)) continue;
      boxes.push({ x: bx, y: by, w: tw });
      ctx.fillStyle = win ? 'rgba(48,209,88,.16)' : 'rgba(255,69,58,.16)';
      roundRect(ctx, bx, by, tw, 15, 7); ctx.fill();
      ctx.fillStyle = c; ctx.fillText(txt, bx + 5, by + 11);
    }
    if (!pts.length) {
      ctx.fillStyle = 'rgba(235,235,245,.5)'; ctx.font = '12px -apple-system, sans-serif';
      ctx.fillText('Geen gesloten trades in dit bereik', 12, TOP + 4);
    }
    // time axis
    ctx.fillStyle = 'rgba(235,235,245,.38)'; ctx.font = '10px -apple-system, sans-serif';
    ctx.fillText(span === Infinity ? when(new Date(t0).toISOString()) : hhmm(t0), L, h - 4);
    const nowTxt = 'nu ' + hhmm(now); ctx.fillText(nowTxt, w - R - ctx.measureText(nowTxt).width, h - 4);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- Nu bezig ----------
  function chartFrame(mint) {
    const d = T.dex[mint];
    if (!d || !d.pair) return `<div class="t-frame t-frame-empty">Koersgrafiek laden…</div>`;
    const src = `https://dexscreener.com/solana/${encodeURIComponent(d.pair)}?embed=1&theme=dark&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&chartStyle=1&interval=1`;
    return `<iframe class="t-frame" src="${src}" title="koers" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
  }

  function renderNow(st, eq) {
    const exec = (st.agents || []).find(a => a.name === 'executor') || {};
    const risk = (st.agents || []).find(a => a.name === 'risk') || {};
    const dip = (eq && eq.dip_pct) || (exec.sizing && exec.sizing.dip_pct) || 15;
    const openEq = (eq && eq.open) || [];
    const opens = (st.open_positions || []).map(p => Object.assign({}, openEq.find(o => o.mint === p.mint) || {}, p));
    const live = opens.filter(p => !p.stale);
    const desk = live.filter(p => (p.source || 'desk') === 'desk');
    const watching = ((eq && eq.watching) || []).concat((exec.watching || []).map(w => typeof w === 'string' ? { mint: w } : w))
      .filter((w, i, a) => w.mint && a.findIndex(x => x.mint === w.mint) === i);
    let item = null, status = '', kind = '';
    if (desk.length || live.length) {
      item = (desk[0] || live[0]);
      const pnl = num(item.unrealized_usd);
      kind = 'open';
      status = item.tp_partial_done ? `verkocht 50% · rest met ${risk.trail_pct || 40}% trailing stop` : `gekocht · stop -${item.stop_pct || risk.stop_pct || 25}%`;
      if (pnl != null) status += ` · nu ${money(pnl, true)}${item.pnl_pct != null ? ' (' + pct(item.pnl_pct) + ')' : ''}`;
    } else if (watching.length) {
      item = watching[0]; kind = 'watch';
      status = `wacht op dip -${dip}% · max ${(exec.sizing && exec.sizing.dip_wait_min) || 30} min` + (item.score ? ` · score ${Math.round(item.score)}` : '');
    }
    const body = $('#tNowBody');
    if (!item) {
      const stale = opens.filter(p => p.stale);
      const scan = (st.agents || []).find(a => a.name === 'scanner') || {};
      const extra = stale.length ? `<div class="t-now-note">Oude copy-positie ${esc(stale[0].symbol || '')}: koers niet meer beschikbaar.</div>` : '';
      const key = 'idle' + stale.length;
      if (T.nowKey !== key) {
        body.innerHTML = `<div class="t-now-idle"><div class="t-pulse"></div><div><div class="t-now-title">Zoekt munten</div>
          <div class="t-now-status">${scan.pools ? scan.pools.toLocaleString('nl-BE') + ' pools bekeken · ' : ''}nog geen dip om te kopen</div></div></div>${extra}`;
        T.nowKey = key;
      }
      $('#tNowAge').textContent = '';
      return;
    }
    const sym = item.symbol || (T.dex[item.mint] && T.dex[item.mint].symbol) || item.mint.slice(0, 6);
    const link = safeLink(item.coin_url);
    const d = T.dex[item.mint] || {};
    const key = kind + item.mint + (d.pair || '');
    const head = `<div class="t-now-top">${icon(item.mint, sym)}
        <div class="t-now-main"><div class="t-now-title">${esc(sym)} <span class="t-tag ${kind}">${kind === 'open' ? 'open' : 'kijkt'}</span></div>
        <div class="t-now-status" id="tNowStatus">${esc(status)}</div></div>
        ${link ? `<a class="t-fomo" href="${esc(link)}" target="_blank" rel="noopener">FOMO</a>` : ''}</div>
      <div class="t-now-stats" id="tNowStats"></div>`;
    if (T.nowKey !== key) {
      body.innerHTML = head + chartFrame(item.mint);
      T.nowKey = key;
    } else {
      $('#tNowStatus').textContent = status;
    }
    const stats = [];
    if (kind === 'open') {
      stats.push(['Inzet', money(item.size_usd)]);
      if (item.entry_price && d.supply) stats.push(['MC bij koop', compact(item.entry_price * d.supply)]);
    }
    if (d.mcap) stats.push(['MC nu', compact(d.mcap)]);
    if (d.ch5 != null) stats.push(['5m', pct(d.ch5)]);
    $('#tNowStats').innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    const since = item.opened_at || item.ts;
    $('#tNowAge').textContent = since ? 'sinds ' + hhmm(since) : '';
  }

  // ---------- activity ----------
  function reasonText(row, tr) {
    let sub = String(row.subtitle || '');
    for (let i = 0; i < 2; i++) sub = sub.replace(/^(Scanner|Auditor|Analyst|Executor|Risk|Copy|Desk)( \([^)]*\))? · /, '');
    if (row.kind === 'bought') return tr && tr.score ? `dip-aankoop · score ${Math.round(tr.score)}` : 'dip-aankoop';
    if (row.kind === 'stopped') {
      const sp = Number((tr && tr.stop_pct) || (sub.match(/-(\d+)%/) || [])[1] || 0);
      return sp >= 10 ? `stop -${sp}%` : 'stop geraakt';
    }
    if (row.kind === 'sold') {
      if (/partial/i.test(sub)) return 'winst genomen 2× · 50% verkocht';
      if (/take profit/i.test(sub)) return 'winst genomen';
      if (/trailing/i.test(sub)) return 'trailing stop (winst)';
      if (/timeout/i.test(sub)) return 'timeout 3u';
      if (/dev/i.test(sub)) return 'dev dumpt';
      if (/no price/i.test(sub)) return 'geen koers meer';
      if (/pulled/i.test(sub)) return 'liquiditeit weg';
      return sub;
    }
    return sub.replace(/^Skipped:? ?/i, '').replace(/no dip/i, 'geen dip').replace(/crash/i, 'crash') || 'overgeslagen';
  }

  function findTrade(trades, openList, row) {
    const ts = tms(row.ts);
    const pool = trades.concat(openList || []).filter(t => t.mint === row.mint);
    const key = row.kind === 'bought' ? 'opened_at' : 'closed_at';
    let best = null, bd = 15 * 60e3;
    for (const t of pool) { const d = Math.abs((tms(t[key]) || 0) - ts); if (d < bd) { bd = d; best = t; } }
    return best;
  }

  function renderFeed(act, trades, eq) {
    const rows = ((act && act.rows) || []).filter(r => r.title !== 'PAPER reset' || true).slice(0, 25);
    const el = $('#tFeed');
    if (!rows.length) { el.innerHTML = '<div class="feed-empty">Nog geen activiteit</div>'; return; }
    el.innerHTML = rows.map(r => {
      if (r.title === 'PAPER reset') {
        return `<div class="t-act reset"><span class="t-ico"><b>↺</b></span><div class="t-act-main"><div class="t-act-title">PAPER reset naar $200</div>
          <div class="t-act-sub">Desk · ${esc(r.value || '')}</div></div><div class="t-act-side"><div class="t-act-time">${when(r.ts)}</div></div></div>`;
      }
      const tr = r.mint ? findTrade(trades, eq && eq.open, r) : null;
      const sym = (tr && tr.symbol) || (T.dex[r.mint] && T.dex[r.mint].symbol) || String(r.title || '').replace(/^(Bought|Sold|Stopped|Rejected|Skipped|Half sold) /, '');
      const verb = { bought: 'Gekocht', sold: /Half/.test(r.title) ? 'Half verkocht' : 'Verkocht', stopped: 'Gestopt', rejected: 'Overgeslagen' }[r.kind] || r.kind;
      const kind = { bought: 'buy', sold: 'sell', stopped: 'stop', rejected: 'skip' }[r.kind] || 'skip';
      const bot = BOTS[r.agent] || r.agent;
      let money1 = '', pct1 = '';
      if (r.kind === 'bought') money1 = tr ? money(tr.size_usd) : String(r.value || '').split(' · ')[0];
      else if (r.kind === 'sold' || r.kind === 'stopped') {
        const m = String(r.value || '').match(/[-+]?\$[\d.,]+/);
        if (tr && !/Half/.test(r.title)) { money1 = money(tr.pnl_usd, true); if (tr.pnl_pct != null) pct1 = pct(tr.pnl_pct); }
        else if (m) { money1 = m[0]; const p = String(r.value || '').match(/[-+]?[\d.]+%/); if (p) pct1 = p[0]; }
      }
      const d = T.dex[r.mint];
      const mc = tr && tr.entry_price && d && d.supply ? 'MC bij koop ' + compact(tr.entry_price * d.supply) : '';
      const link = safeLink((tr && tr.coin_url) || r.coin_url) || (r.mint ? null : null);
      const tag = link ? 'a' : 'div';
      const href = link ? ` href="${esc(link)}" target="_blank" rel="noopener"` : '';
      const val = money1 ? `<div class="t-act-val ${kind === 'stop' ? 'neg' : (money1.startsWith('+') ? 'pos' : money1.startsWith('-') ? 'neg' : '')}">${esc(money1)}${pct1 ? ' <small>' + esc(pct1) + '</small>' : ''}</div>` : '';
      return `<${tag} class="t-act ${kind}"${href}>${icon(r.mint, sym, kind)}
        <div class="t-act-main"><div class="t-act-title">${esc(verb)} ${esc(sym)}</div>
          <div class="t-act-sub"><span class="t-bot">${esc(bot)}</span> · ${esc(reasonText(r, tr))}${mc ? ' · ' + esc(mc) : ''}</div></div>
        <div class="t-act-side">${val}<div class="t-act-time">${when(r.ts)}</div></div></${tag}>`;
    }).join('');
  }


  function reasonLive(r) {
    const x = String(r.exit_reason || '');
    const map = {
      stop: 'stop', tp: 'winst genomen', take_profit: 'winst genomen',
      cash_in_0800: 'sluiting 08:00', flatten: 'sluiting 08:00',
      trader_sell: 'trader verkocht', 'PAPER gesloten': 'PAPER gesloten',
      'dryrun beëindigd': 'dryrun beëindigd',
    };
    return map[x] || x || 'gesloten';
  }

  function renderLive(st) {
    const live = st && st.live;
    const badge = $('#tLiveBadge');
    const body = $('#tLiveBody');
    if (!badge || !body) return;
    const ready = live && (live.limits || live.today || live.wallet || (live.mode && live.mode !== 'off') || live.enabled);
    if (!live || (!ready && live.mode === 'off' && live.enabled === false && !live.limits)) {
      badge.textContent = 'UIT';
      badge.className = 't-live-badge off';
      body.innerHTML = '<div class="feed-empty t-live-wait">Wacht op eerste update van de server...</div>';
      return;
    }
    const mode = (live.mode === 'live' || live.mode === 'dryrun') ? live.mode : 'off';
    badge.textContent = mode === 'dryrun' ? 'DRYRUN' : mode === 'live' ? 'LIVE' : 'UIT';
    badge.className = 't-live-badge ' + mode;
    const lim = live.limits || {};
    const today = live.today || {};
    const total = live.total || {};
    const wallet = live.wallet || {};
    const spent = today.spent_usd;
    const cap = lim.max_daily_spend_usd;
    const spentLine = (spent != null && cap != null)
      ? `${money(spent)} / ${money(cap)} ingezet`
      : (spent != null ? `${money(spent)} ingezet` : '—');
    const wins = total.wins, losses = total.losses, trades = total.trades;
    const wl = (wins != null && losses != null)
      ? `${wins}W / ${losses}L` + (trades != null ? ` · ${trades} trades` : '')
      : (trades != null ? `${trades} trades` : '—');
    const openN = live.open_count != null ? live.open_count : (live.open_positions || []).length;
    const maxOpen = lim.max_open;
    const openLine = maxOpen != null ? `${openN} / ${maxOpen}` : String(openN);
    const sol = wallet.sol, usd = wallet.usd;
    const solLine = sol != null ? Number(sol).toLocaleString('nl-BE', { maximumFractionDigits: 4 }) + ' SOL' : '—';
    const usdLine = usd != null ? money(usd) : '—';
    const ticket = lim.ticket_usd;
    const ticketLine = ticket != null ? money(ticket) : '—';
    const kpis = `
      <div class="t-live-kpis">
        <div class="t-live-kpi"><div class="k">Vandaag</div>
          <div class="v ${tone(today.pnl_usd)}">${today.pnl_usd == null ? '—' : money(today.pnl_usd, true)}</div>
          <div class="s">${esc(spentLine)}</div></div>
        <div class="t-live-kpi"><div class="k">Totaal</div>
          <div class="v ${tone(total.pnl_usd)}">${total.pnl_usd == null ? '—' : money(total.pnl_usd, true)}</div>
          <div class="s">${esc(wl)}</div></div>
        <div class="t-live-kpi"><div class="k">Open</div>
          <div class="v">${esc(openLine)}</div>
          <div class="s">ticket ${esc(ticketLine)}</div></div>
        <div class="t-live-kpi"><div class="k">Wallet</div>
          <div class="v">${esc(solLine)}</div>
          <div class="s">${esc(usdLine)}</div></div>
      </div>`;

    function rowOpen(p) {
      const sym = p.symbol || (p.mint ? p.mint.slice(0, 6) : '—');
      const link = safeLink(p.coin_url);
      const tag = link ? 'a' : 'div';
      const href = link ? ` href="${esc(link)}" target="_blank" rel="noopener"` : '';
      const lane = p.lane ? '<span class="t-tag lane">microcap</span>' : '';
      return `<${tag} class="t-act"${href}>${icon(p.mint, sym)}
        <div class="t-act-main"><div class="t-act-title">${esc(sym)}${lane}</div>
          <div class="t-act-sub">inzet ${esc(money(p.cost_usd))}${p.dry ? ' · dryrun' : ''}</div></div>
        <div class="t-act-side"><div class="t-act-time">${p.opened_at ? when(p.opened_at) : ''}</div></div></${tag}>`;
    }
    function rowClosed(p) {
      const sym = p.symbol || (p.mint ? p.mint.slice(0, 6) : '—');
      const link = safeLink(p.coin_url);
      const tag = link ? 'a' : 'div';
      const href = link ? ` href="${esc(link)}" target="_blank" rel="noopener"` : '';
      const lane = p.lane ? '<span class="t-tag lane">microcap</span>' : '';
      const pnl = p.pnl_usd;
      const pct1 = p.pnl_pct != null ? pct(p.pnl_pct) : '';
      const val = pnl == null ? '' : `<div class="t-act-val ${tone(pnl)}">${esc(money(pnl, true))}${pct1 ? ' <small>' + esc(pct1) + '</small>' : ''}</div>`;
      return `<${tag} class="t-act"${href}>${icon(p.mint, sym, pnl < 0 ? 'stop' : 'sell')}
        <div class="t-act-main"><div class="t-act-title">${esc(sym)}${lane}</div>
          <div class="t-act-sub">inzet ${esc(money(p.cost_usd))} · ${esc(reasonLive(p))}</div></div>
        <div class="t-act-side">${val}<div class="t-act-time">${p.closed_at ? when(p.closed_at) : ''}</div></div></${tag}>`;
    }
    const opens = live.open_positions || [];
    const closed = live.recent_closed || [];
    let lists = '';
    lists += '<div class="t-live-sub">Open posities</div>';
    lists += opens.length
      ? `<div class="t-live-list">${opens.map(rowOpen).join('')}</div>`
      : '<div class="feed-empty">Geen open posities</div>';
    lists += '<div class="t-live-sub">Recente trades</div>';
    lists += closed.length
      ? `<div class="t-live-list">${closed.map(rowClosed).join('')}</div>`
      : '<div class="feed-empty">Nog geen trades</div>';
    body.innerHTML = kpis + lists;
  }

  // ---------- header + balance ----------
  function renderTop(st) {
    const mode = String(st.mode || 'PAPER').toUpperCase();
    const pill = $('#paperPill');
    pill.textContent = mode; pill.classList.remove('hidden');
    $('#tMode').textContent = mode;
    const opens = (st.open_positions || []).length;
    $('#tOpen').textContent = opens + ' open';
    $('#tBalance').textContent = money(st.balance != null ? st.balance : st.equity);
    const tot = Number(st.pnl_total_usd) || 0;
    const tt = $('#tTotal');
    tt.textContent = `${money(tot, true)} (${pct(st.total_pct || 0)})`; tt.className = 't-total ' + tone(tot);
    const m = Number(st.multiplier) || 1;
    const mc = $('#tMult'); mc.textContent = m.toFixed(2) + '×'; mc.className = 't-chip ' + (m >= 1 ? 'pos' : 'neg');
    const td = Number(st.pnl_today_usd) || 0;
    const tc = $('#tToday'); tc.textContent = `vandaag ${money(td, true)}`; tc.className = 't-chip ' + tone(td);
  }

  function clock() {
    const el = $('#tClock');
    if (el) el.textContent = new Date().toLocaleTimeString('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }
  setInterval(clock, 10e3); clock();

  async function refresh(ctx) {
    T.ctx = ctx;
    if (!ctx.planB || T.busy) return;
    T.busy = true;
    try {
      const [st, act, eq, risk] = await Promise.all([
        getJSON('state.json'),
        getJSON('activity.json').catch(() => null),
        getJSON('equity.json').catch(() => null),
        getJSON('agents/risk.json').catch(() => null),
      ]);
      T.eq = eq;
      const trades = tradesList(eq, risk);
      T.trades = trades;
      renderTop(st);
      renderLive(st);
      drawEquity(trades);
      renderNow(st, eq);
      renderFeed(act, trades, eq);
      const exec = (st.agents || []).find(a => a.name === 'executor') || {};
      const live = st.live || {};
      const mints = [...(st.open_positions || []).map(p => p.mint), ...((eq && eq.watching) || []).map(w => w.mint),
        ...(exec.watching || []).map(w => typeof w === 'string' ? w : w.mint),
        ...((act && act.rows) || []).slice(0, 25).map(r => r.mint),
        ...(live.open_positions || []).map(p => p.mint),
        ...(live.recent_closed || []).map(p => p.mint)];
      const before = Object.keys(T.dex).length;
      await dexInfo(mints);
      if (Object.keys(T.dex).length !== before) { renderNow(st, eq); renderFeed(act, trades, eq); renderLive(st); }
    } catch (e) {
      if (ctx.onError) ctx.onError('Desk data niet bereikbaar · opnieuw proberen');
    } finally { T.busy = false; }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('#tRanges button');
    if (!b) return;
    T.range = b.dataset.r;
    document.querySelectorAll('#tRanges button').forEach(x => x.classList.toggle('on', x === b));
    if (T.trades) drawEquity(T.trades);
  });
  window.addEventListener('resize', () => { if (T.trades) drawEquity(T.trades); });

  global.DeskTerminal = { refresh };
})(window);
