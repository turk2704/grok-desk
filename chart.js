/* Hand-drawn canvas charts — no chart library. */
(function (global) {
  function dpr(canvas) {
    const r = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(w * r);
    canvas.height = Math.round(h * r);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx, w, h };
  }

  function lineChart(canvas, points, marks, opts) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!points || points.length < 1) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.6);
      ctx.lineTo(w, h * 0.6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(235,235,245,0.6)';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('Waiting for the first trade', 12, h * 0.6 - 10);
      return;
    }
    const vals = points.map(p => p.v);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.1 || 1;
    const y0 = min - pad, y1 = max + pad;
    const x = i => (i / Math.max(points.length - 1, 1)) * (w - 8) + 4;
    const y = v => h - ((v - y0) / (y1 - y0)) * (h - 16) - 8;
    // gradient fill
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,211,90,0.28)');
    g.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.v)) : ctx.moveTo(x(i), y(p.v)));
    ctx.lineTo(x(points.length - 1), h);
    ctx.lineTo(x(0), h);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    // start dashed
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(235,235,245,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, y(points[0].v));
    ctx.lineTo(w, y(points[0].v));
    ctx.stroke();
    ctx.setLineDash([]);
    // line
    ctx.strokeStyle = '#00d35a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(x(i), y(p.v)) : ctx.moveTo(x(i), y(p.v)));
    ctx.stroke();
    // marks
    if (marks) {
      let row = 0;
      marks.slice(0, 8).forEach((m, i) => {
        const idx = Math.min(points.length - 1, Math.floor(points.length * (0.2 + i * 0.1)));
        const px = x(idx), py = y(points[idx].v) - 12 - row * 14;
        ctx.fillStyle = m.kind === 'bought' ? '#0a84ff' : (m.kind === 'stopped' ? '#ff453a' : '#00d35a');
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(m.title || m.value || '', px, py);
        row = (row + 1) % 3;
      });
    }
  }

  function candles(canvas, bars, exitLine) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!bars || !bars.length) {
      ctx.fillStyle = 'rgba(235,235,245,0.4)';
      ctx.fillText('No candles yet', 12, h / 2);
      return;
    }
    const highs = bars.map(b => b.h), lows = bars.map(b => b.l);
    let min = Math.min(...lows), max = Math.max(...highs);
    if (exitLine != null) { min = Math.min(min, exitLine); max = Math.max(max, exitLine); }
    const pad = (max - min) * 0.08 || 1;
    min -= pad; max += pad;
    const y = v => h - ((v - min) / (max - min)) * (h - 20) - 10;
    const bw = Math.max(2, (w / bars.length) * 0.6);
    bars.forEach((b, i) => {
      const cx = (i + 0.5) * (w / bars.length);
      const up = b.c >= b.o;
      ctx.strokeStyle = ctx.fillStyle = up ? '#00d35a' : '#ff453a';
      ctx.beginPath();
      ctx.moveTo(cx, y(b.h));
      ctx.lineTo(cx, y(b.l));
      ctx.stroke();
      const top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
      ctx.fillRect(cx - bw / 2, top, bw, Math.max(1, bot - top));
    });
    if (exitLine != null) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ff9f0a';
      ctx.beginPath();
      ctx.moveTo(0, y(exitLine));
      ctx.lineTo(w, y(exitLine));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9f0a';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('Risk trailing stop', 8, y(exitLine) - 4);
    }
  }

  function scoreRing(canvas, score, threshold) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;
    ctx.strokeStyle = '#2c2c2e';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const pct = Math.max(0, Math.min(100, score || 0)) / 100;
    ctx.strokeStyle = (score || 0) >= (threshold || 70) ? '#00d35a' : '#ffd60a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '600 22px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(score ?? '—'), cx, cy);
  }

  global.DeskCharts = { lineChart, candles, scoreRing };
})(window);
