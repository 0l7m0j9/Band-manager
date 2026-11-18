/* =========================================================
   Poster — 포스터 디자인 엔진 (Canvas, 1080×1350)
   "디자인 시안(spec)"을 받아 그대로 그립니다. 시안은 직접 고르거나,
   랜덤으로 만들거나, AI(supabase/functions/poster-ai)가 만듭니다.

   spec = { layout, pattern, headlineFont, palette{bg,fg,accent,accent2},
            kicker, tagline, footerNote, headlinerScale, uppercase, grain, seed, name, rationale }
   ========================================================= */
const Poster = (() => {
  const W = 1080, H = 1350, M = 70;
  const LAYOUTS = { ripple: 'Ripple', grid: 'Grid', stack: 'Stack', orbit: 'Orbit', split: 'Split', sunburst: 'Sunburst' };
  const PATTERNS = { none: '없음', waves: '물결', rings: '동심원', stripes: '사선', grid: '격자', dots: '하프톤', rays: '햇살', blobs: '얼룩' };
  const FONTS = { wave: 'Wave serif', tech: 'Tech wide', grotesk: 'Grotesk', mono: 'Mono' };
  const SCALES = { huge: 1.3, large: 1, normal: 0.78 };
  const GRAINS = { none: 0, light: 0.08, heavy: 0.16 };
  const FAMILY = { wave: '"Instrument Serif", Pretendard, serif', tech: 'Michroma, Pretendard, sans-serif', grotesk: 'Pretendard, sans-serif', mono: '"Space Mono", Pretendard, monospace' };
  const WEIGHT = { wave: 400, tech: 400, grotesk: 800, mono: 700 };
  const MONO = '"Space Mono", Pretendard, monospace';

  /* ---------- 색 ---------- */
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const hexOk = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  /** 배경 위에서 더 잘 보이는 글자색 */
  const onColor = (bg, a, b) => (contrast(bg, a) >= contrast(bg, b) ? a : b);

  /** 같은 seed 면 같은 패턴이 나오도록 */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 시안 ---------- */
  const PRESETS = {
    ripple: (f) => ({ pattern: 'none', headlineFont: 'wave', palette: { bg: f.bg || '#f2541b', fg: '#fff8f2', accent: f.accent || '#7f5cff', accent2: '#d6ff3a' }, kicker: 'MUSIC FESTIVAL' }),
    grid: (f) => ({ pattern: 'none', headlineFont: 'grotesk', palette: { bg: '#3d9a2b', fg: '#141210', accent: f.accent || '#7f5cff', accent2: '#d6ff3a' }, kicker: 'GET TICKET ↗' }),
    stack: () => ({ pattern: 'grid', headlineFont: 'grotesk', palette: { bg: '#fff6ec', fg: '#141210', accent: '#f2541b', accent2: '#7f5cff' }, kicker: 'MUSIC & ARTS FESTIVAL' }),
    orbit: () => ({ pattern: 'rings', headlineFont: 'tech', palette: { bg: '#1d1a3a', fg: '#fff6ec', accent: '#ff8a3d', accent2: '#7f5cff' }, kicker: 'LIVE MUSIC FESTIVAL' }),
    split: () => ({ pattern: 'dots', headlineFont: 'tech', palette: { bg: '#141210', fg: '#fff6ec', accent: '#d6ff3a', accent2: '#7f5cff' }, kicker: 'INDEPENDENT MUSIC' }),
    sunburst: () => ({ pattern: 'none', headlineFont: 'wave', palette: { bg: '#ffd23f', fg: '#141210', accent: '#f2541b', accent2: '#ff9f1c' }, kicker: 'SUMMER SOUND FESTIVAL' }),
  };
  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : '');

  /** 어떤 값이 와도(예전 데이터, 친구 데이터, AI 응답) 그릴 수 있는 시안으로 */
  function normalize(spec, f) {
    const sp = spec && typeof spec === 'object' ? spec : {};
    const layout = has(LAYOUTS, sp.layout) ? sp.layout : 'ripple';
    const d = PRESETS[layout](f);
    const pal = sp.palette && typeof sp.palette === 'object' ? sp.palette : {};
    const palette = {};
    ['bg', 'fg', 'accent', 'accent2'].forEach((k) => { palette[k] = hexOk(pal[k]) ? pal[k] : d.palette[k]; });
    return {
      name: str(sp.name, 24), rationale: str(sp.rationale, 160), layout,
      pattern: has(PATTERNS, sp.pattern) ? sp.pattern : d.pattern,
      headlineFont: has(FONTS, sp.headlineFont) ? sp.headlineFont : d.headlineFont,
      palette,
      kicker: typeof sp.kicker === 'string' ? str(sp.kicker, 40) : d.kicker,
      tagline: typeof sp.tagline === 'string' ? str(sp.tagline, 60) : str(f.theme, 60),
      footerNote: str(sp.footerNote, 60),
      headlinerScale: has(SCALES, sp.headlinerScale) ? sp.headlinerScale : 'large',
      uppercase: sp.uppercase !== false,
      grain: has(GRAINS, sp.grain) ? sp.grain : 'light',
      seed: Number.isFinite(Number(sp.seed)) ? Math.abs(Math.floor(Number(sp.seed))) % 100000 : 7,
    };
  }
  const preset = (layout, f) => normalize({ layout, ...PRESETS[has(PRESETS, layout) ? layout : 'ripple'](f), name: LAYOUTS[layout] || 'Ripple' }, f);

  const PALETTES = [
    ['#f2541b', '#fff8f2', '#7f5cff', '#d6ff3a'], ['#141210', '#fff6ec', '#d6ff3a', '#7f5cff'], ['#fff6ec', '#141210', '#f2541b', '#7f5cff'],
    ['#1d1a3a', '#fff6ec', '#ff8a3d', '#6fd3ff'], ['#0f3d3e', '#f4f1de', '#e07a5f', '#f2cc8f'], ['#ffd23f', '#141210', '#ee4266', '#3bceac'],
    ['#2b2d42', '#edf2f4', '#ef233c', '#8d99ae'], ['#e9f5db', '#1b4332', '#ff6b35', '#52b788'], ['#ff5d8f', '#1a1423', '#fff3b0', '#7b2cbf'],
    ['#3d9a2b', '#141210', '#7f5cff', '#d6ff3a'], ['#0b132b', '#f8f9fa', '#5bc0be', '#ff6b6b'], ['#f6e7cb', '#3a2e39', '#d1495b', '#00798c'],
  ];
  const KICKERS = ['MUSIC FESTIVAL', 'LIVE · LOUD · LOCAL', 'SOUND & SUMMER', 'INDEPENDENT MUSIC', 'MUSIC & ARTS FESTIVAL', 'ALL DAY LIVE'];
  /** AI 없이 무작위 조합 */
  function random(f) {
    const r = Math.random, one = (a) => a[Math.floor(r() * a.length)];
    const p = one(PALETTES);
    return normalize({
      name: '랜덤 시안', layout: one(Object.keys(LAYOUTS)), pattern: one(Object.keys(PATTERNS)), headlineFont: one(Object.keys(FONTS)),
      palette: { bg: p[0], fg: p[1], accent: p[2], accent2: p[3] }, kicker: one(KICKERS), tagline: f.theme || '',
      headlinerScale: one(Object.keys(SCALES)), uppercase: r() > 0.3, grain: one(['none', 'light', 'light', 'heavy']), seed: Math.floor(r() * 100000),
    }, f);
  }

  /* ---------- 페스티벌 정보 ---------- */
  function info(f, sp) {
    const up = (t) => (sp.uppercase ? String(t || '').toUpperCase() : String(t || ''));
    const start = new Date(f.startDate + 'T00:00:00');
    const end = new Date(UI.addDays(f.startDate, f.days - 1) + 'T00:00:00');
    const mon = (d) => d.toLocaleString('en', { month: 'short' }).toUpperCase();
    let dateLine = '';
    if (!isNaN(start)) {
      dateLine = f.days > 1
        ? (start.getMonth() === end.getMonth() ? `${start.getDate()}–${end.getDate()} ${mon(start)} ${start.getFullYear()}` : `${start.getDate()} ${mon(start)} – ${end.getDate()} ${mon(end)} ${end.getFullYear()}`)
        : `${start.getDate()} ${mon(start)} ${start.getFullYear()}`;
    }
    const byHead = (a, b) => b.headliner - a.headliner;
    let groups = Array.from({ length: f.days }, (_, d) => {
      const ids = [...new Set(f.slots.filter((s) => s.day === d).sort((a, b) => b.start - a.start).map((s) => s.actId))];
      const acts = ids.map((id) => f.acts.find((a) => a.id === id)).filter(Boolean).sort(byHead);
      return { label: f.days > 1 ? `DAY ${d + 1} · ${UI.dateEn(UI.addDays(f.startDate, d))}` : 'LINE UP', acts };
    }).filter((g) => g.acts.length);
    if (!groups.length && f.acts.length) groups = [{ label: 'LINE UP', acts: [...f.acts].sort(byHead) }]; // 시간표가 비어 있으면 출연진 전체
    const head = f.acts.find((a) => a.headliner) || f.acts[0];
    return {
      up, dateLine, groups,
      hours: `${UI.hm(f.dayStart * 60)} — ${UI.hm(f.dayEnd * 60)}`,
      stages: f.stages.map((s) => up(s.name)).join('  /  '),
      headliner: head ? head.name : f.name,
    };
  }

  /* ---------- 글자 ---------- */
  const font = (ctx, kind, size) => { ctx.font = `${WEIGHT[kind]} ${Math.round(size)}px ${FAMILY[kind]}`; };
  const sans = (ctx, w, size) => { ctx.font = `${w} ${Math.round(size)}px Pretendard, sans-serif`; };
  const mono = (ctx, size) => { ctx.font = `400 ${Math.round(size)}px ${MONO}`; };
  /** 폭에 맞을 때까지 줄임. 최종 크기 반환 */
  function fit(ctx, text, set, maxW, maxSize, min = 10) {
    let s = maxSize; set(s);
    while (s > min && ctx.measureText(text).width > maxW) { s -= 2; set(s); }
    return s;
  }
  const fitFont = (ctx, text, kind, maxW, maxSize) => fit(ctx, text, (s) => font(ctx, kind, s), maxW, maxSize);
  const fitSans = (ctx, text, w, maxW, maxSize) => fit(ctx, text, (s) => sans(ctx, w, s), maxW, maxSize);

  /** 물결 왜곡 글자 (Instrument Serif). cy = 글자 세로 중앙 */
  function wave(ctx, text, x, cy, maxSize, color, maxW, align = 'center') {
    if (!text) return 0;
    const s = fitFont(ctx, text, 'wave', maxW, maxSize);
    const tw = ctx.measureText(text).width, pad = Math.ceil(s * 0.2);
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.ceil(tw + pad * 2)); off.height = Math.max(1, Math.ceil(s * 1.4));
    const o = off.getContext('2d');
    font(o, 'wave', s); o.fillStyle = color; o.textBaseline = 'middle'; o.textAlign = 'left';
    o.fillText(text, pad, off.height / 2);
    const amp = s * 0.045;
    const left = align === 'center' ? x - off.width / 2 : align === 'right' ? x - off.width + pad : x - pad;
    for (let y = 0; y < off.height; y++) {
      const dx = Math.sin(y / (s * 0.09)) * amp + Math.sin(y / (s * 0.023) + 1.3) * amp * 0.35;
      ctx.drawImage(off, 0, y, off.width, 1, left + dx, cy - off.height / 2 + y, off.width, 1);
    }
    return s;
  }
  /** 제목: 시안의 제목 글꼴로. cy = 세로 중앙 */
  function title(ctx, sp, text, x, cy, maxW, maxSize, color, align = 'center') {
    if (!text) return 0;
    if (sp.headlineFont === 'wave') return wave(ctx, text, x, cy, maxSize, color, maxW, align);
    const s = fitFont(ctx, text, sp.headlineFont, maxW, maxSize);
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, cy);
    ctx.textBaseline = 'alphabetic';
    return s;
  }
  const titleText = (f, sp, d) => (sp.headlineFont === 'wave' ? f.name : d.up(f.name));

  /** 단어들을 폭에 맞게 줄바꿈 (textBaseline top 기준). 다음 y 반환.
      stat 을 주면 한 단어만으로도 폭을 넘는 경우 stat.over 를 표시 */
  function flow(ctx, words, x, y, maxW, lineH, align, sep, draw, stat) {
    let line = '';
    const lines = [];
    words.forEach((w) => {
      const t = line ? line + sep + w : w;
      if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    if (stat && lines.some((l) => ctx.measureText(l).width > maxW)) stat.over = true;
    if (draw) {
      ctx.textAlign = align;
      const ax = align === 'center' ? x + maxW / 2 : align === 'right' ? x + maxW : x;
      lines.forEach((l, i) => {
        const lw = ctx.measureText(l).width;
        if (lw <= maxW) { ctx.fillText(l, ax, y + i * lineH); return; }
        // 그래도 넘치는 아주 긴 이름은 가로로만 살짝 눌러서 칸 안에 넣음
        ctx.save(); ctx.translate(ax, y + i * lineH); ctx.scale(maxW / lw, 1); ctx.fillText(l, 0, 0); ctx.restore();
      });
    }
    return y + lines.length * lineH;
  }

  /** 라인업: box 안에 다 들어갈 때까지 글자 크기를 자동으로 줄임 (넘쳐서 하단과 겹치지 않게) */
  function lineup(ctx, d, sp, box, { align = 'center', cols = 1, color, accent } = {}) {
    const hs = SCALES[sp.headlinerScale];
    let columns;
    if (cols > 1 && d.groups.length === 1) {
      const g = d.groups[0], per = Math.ceil(g.acts.length / cols);
      columns = Array.from({ length: cols }, (_, i) => [{ label: i === 0 ? g.label : '', acts: g.acts.slice(i * per, (i + 1) * per) }]).filter((c) => c[0].acts.length);
    } else {
      const n = Math.max(1, Math.min(cols, d.groups.length));
      columns = Array.from({ length: n }, () => []);
      d.groups.forEach((g, i) => columns[i % n].push(g));
    }
    if (!columns.length) return;
    const gap = 40, cw = (box.w - gap * (columns.length - 1)) / columns.length;
    const sep = align === 'center' ? '  ·  ' : '  /  ';
    const run = (k, draw, stat) => {
      let maxH = 0;
      columns.forEach((col, ci) => {
        const x = box.x + ci * (cw + gap);
        let y = box.y;
        col.forEach((g, gi) => {
          if (gi) y += 30 * k;
          if (g.label) {
            ctx.fillStyle = accent; mono(ctx, 22 * k);
            if (draw) { ctx.textAlign = align; ctx.fillText(g.label, align === 'center' ? x + cw / 2 : x, y); }
            y += 40 * k;
          }
          ctx.fillStyle = color;
          const heads = g.acts.filter((a) => a.headliner).map((a) => d.up(a.name));
          const rest = g.acts.filter((a) => !a.headliner).map((a) => d.up(a.name));
          if (heads.length) { sans(ctx, 800, 64 * hs * k); y = flow(ctx, heads, x, y, cw, 74 * hs * k, align, sep, draw, stat) + 6 * k; }
          if (rest.length) { sans(ctx, 700, 36 * k); y = flow(ctx, rest, x, y, cw, 46 * k, align, sep, draw, stat); }
        });
        maxH = Math.max(maxH, y - box.y);
      });
      return maxH;
    };
    ctx.textBaseline = 'top';
    // 높이가 넘치거나, 한 이름이 칸 폭을 넘으면 조금씩 줄임
    const bad = (k) => { const stat = { over: false }; return run(k, false, stat) > box.h || stat.over; };
    let k = 1;
    while (k > 0.36 && bad(k)) k -= 0.04;
    run(k, true);
    ctx.textBaseline = 'alphabetic';
  }

  function hline(ctx, x1, x2, y, color, w = 1.5) {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  }
  /** 하단 정보: 무대 목록 + 안내 문구 + 날짜·장소 */
  function footer(ctx, f, sp, d, x0 = M) {
    const fg = sp.palette.fg, mid = x0 + (W - M - x0) / 2;
    hline(ctx, x0, W - M, H - 150, fg);
    ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    mono(ctx, 18); ctx.fillText('STAGES', x0, H - 112);
    fitSans(ctx, d.stages, 600, mid - x0 - 20, 26); ctx.fillText(d.stages, x0, H - 76);
    ctx.textAlign = 'right';
    if (sp.footerNote) { fitSans(ctx, sp.footerNote, 800, W - M - mid, 30); ctx.fillText(sp.footerNote, W - M, H - 108); }
    const where = [d.dateLine, d.up(f.venue)].filter(Boolean).join('  ·  ');
    fitSans(ctx, where, 500, W - M - mid, 26); ctx.fillText(where, W - M, H - 70);
  }

  /* ---------- 배경 ---------- */
  function grain(ctx, w, h, alpha) {
    const n = document.createElement('canvas'); n.width = n.height = 160;
    const nc = n.getContext('2d'), img = nc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 * alpha * Math.random();
    }
    nc.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, w, h);
  }
  function rays(ctx, cx, cy, n, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i += 2) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 2400, cy + Math.sin(a0) * 2400);
      ctx.lineTo(cx + Math.cos(a1) * 2400, cy + Math.sin(a1) * 2400);
      ctx.closePath(); ctx.fill();
    }
  }
  function pattern(ctx, sp, r) {
    const { fg, accent, accent2 } = sp.palette;
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.strokeStyle = accent2; ctx.fillStyle = accent2; ctx.lineWidth = 3;
    switch (sp.pattern) {
      case 'waves': {
        const amp = 16 + r() * 22, len = 160 + r() * 200, ph = r() * 6;
        for (let y = -40; y < H + 40; y += 44) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 8) { const yy = y + Math.sin((x / len) * Math.PI * 2 + ph + y * 0.01) * amp; if (x) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
          ctx.stroke();
        }
        break;
      }
      case 'rings': {
        const cx = W * (0.2 + r() * 0.6), cy = H * (0.2 + r() * 0.5);
        for (let rr = 40; rr < 1700; rr += 46) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
        break;
      }
      case 'stripes':
        ctx.lineWidth = 18;
        for (let x = -H; x < W + H; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke(); }
        break;
      case 'grid':
        ctx.strokeStyle = fg; ctx.globalAlpha = 0.14; ctx.lineWidth = 1.5;
        for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        break;
      case 'dots': {
        const cx = W * r(), cy = H * r(), far = Math.hypot(W, H);
        for (let y = 15; y < H; y += 30) for (let x = 15; x < W; x += 30) {
          const rad = 12 * (1 - (Math.hypot(x - cx, y - cy) / far) * 1.5);
          if (rad > 0.6) { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); }
        }
        break;
      }
      case 'rays': rays(ctx, W / 2, H * (0.55 + r() * 0.3), 36, accent2); break;
      case 'blobs':
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < 7; i++) {
          const x = W * r(), y = H * r(), rad = 140 + r() * 260;
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, i % 2 ? accent2 : accent); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        break;
      default:
    }
    ctx.restore();
  }

  /* ---------- 레이아웃 ---------- */
  const L = {};

  // 가운데 정렬 + 물결 제목 (The Listeners 포스터 느낌)
  L.ripple = (ctx, f, sp, d) => {
    const { fg, accent } = sp.palette;
    ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic';
    sans(ctx, 500, 30); ctx.textAlign = 'left';
    ctx.fillText(d.dateLine, M, M + 20); ctx.fillText(`H ${d.hours}`, M, M + 60);
    ctx.textAlign = 'right';
    const v = d.up(f.venue); fitSans(ctx, v, 500, W / 2 - M, 30); ctx.fillText(v, W - M, M + 20);
    const cnt = `${f.stages.length} STAGES · ${f.acts.length} ACTS`; fitSans(ctx, cnt, 500, W / 2 - M, 30); ctx.fillText(cnt, W - M, M + 60);
    ctx.textAlign = 'center';
    if (sp.kicker) { const k = d.up(sp.kicker); fitFont(ctx, k, 'tech', W - M * 4, 52); ctx.fillText(k, W / 2, 270); }
    title(ctx, sp, titleText(f, sp, d), W / 2, 410, W - M * 2, 230, accent);
    if (sp.tagline) { ctx.fillStyle = fg; ctx.textAlign = 'center'; fitSans(ctx, sp.tagline, 500, W - M * 3, 32); ctx.fillText(sp.tagline, W / 2, 560); }
    lineup(ctx, d, sp, { x: M, y: 610, w: W - M * 2, h: H - 180 - 610 }, { color: fg, accent: fg });
    footer(ctx, f, sp, d);
  };

  // 헤드라이너 이름 반복 + 날짜별 칼럼 (MUTEK 느낌)
  L.grid = (ctx, f, sp, d) => {
    const { fg, accent, accent2 } = sp.palette;
    ctx.fillStyle = accent2; ctx.fillRect(0, 0, W, 54);
    ctx.fillStyle = onColor(accent2, '#141210', '#ffffff'); sans(ctx, 700, 20); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const kick = (d.up(sp.kicker) || 'GET TICKET ↗') + '        ';
    const kw = Math.max(80, ctx.measureText(kick).width);
    for (let x = 20; x < W; x += kw) ctx.fillText(kick, x, 35);
    ctx.fillStyle = fg;
    const name = d.up(f.name); fitFont(ctx, name, 'tech', W * 0.55, 34); ctx.fillText(name, M, 130);
    if (sp.tagline) { ctx.textAlign = 'right'; fitSans(ctx, sp.tagline, 600, W * 0.36, 22); ctx.fillText(sp.tagline, W - M, 128); }
    const head = d.up(d.headliner);
    const kind = sp.headlineFont;
    font(ctx, kind, 210);
    const hw = ctx.measureText(head).width + 260;
    ctx.textAlign = 'left';
    [400, 620].forEach((ry, r) => {
      let x = r ? -hw * 0.45 : -40;
      while (x < W) {
        ctx.fillStyle = fg; font(ctx, kind, 210); ctx.fillText(head, x, ry);
        ctx.fillStyle = accent; ctx.fillRect(x + hw - 230, ry - 140, 190, 120);
        ctx.fillStyle = fg; mono(ctx, 16); ctx.fillText('LIVE', x + hw - 230, ry - 150);
        x += hw;
      }
    });
    hline(ctx, M, W - M, 720, fg, 2);
    lineup(ctx, d, sp, { x: M, y: 745, w: W - M * 2, h: H - 130 - 745 }, { align: 'left', cols: d.groups.length > 1 ? Math.min(3, d.groups.length) : 2, color: fg, accent: fg });
    ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic'; sans(ctx, 500, 22);
    ctx.textAlign = 'left'; ctx.fillText([d.dateLine, f.venue, d.hours].filter(Boolean).join('  ·  '), M, H - 60);
    ctx.textAlign = 'right'; ctx.fillText(sp.footerNote || `${f.stages.length} stages / ${f.acts.length} acts`, W - M, H - 60);
  };

  // 제목 단어를 쌓아 올린 스위스 스타일 타이포
  L.stack = (ctx, f, sp, d) => {
    const { fg, accent } = sp.palette;
    const maxW = W - M * 2 - 70;
    ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    mono(ctx, 22); ctx.fillText(d.up(sp.kicker), M, M + 16);
    ctx.save(); ctx.translate(W - M + 6, M); ctx.rotate(Math.PI / 2);
    mono(ctx, 22); ctx.textAlign = 'left';
    ctx.fillText([d.dateLine, d.up(f.venue), d.hours].filter(Boolean).join('   —   '), 0, 0);
    ctx.restore();
    const words = titleText(f, sp, d).split(/\s+/).filter(Boolean);
    let y = M + 60;
    let sizes = words.map((w) => fitFont(ctx, w, sp.headlineFont, maxW, 260));
    const room = H * 0.45 - y, total = sizes.reduce((a, s) => a + s * 0.95, 0);
    if (total > room) sizes = sizes.map((s) => s * (room / total));
    words.forEach((w, i) => {
      const s = sizes[i];
      title(ctx, sp, w, M, y + s * 0.5, maxW, s, i === words.length - 1 ? accent : fg, 'left'); // 마지막 단어만 강조색
      y += s * 0.95;
    });
    y += 24; hline(ctx, M, M + maxW, y, fg, 2); y += 24;
    if (sp.tagline) {
      ctx.fillStyle = fg; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      fitSans(ctx, sp.tagline, 600, maxW, 36); ctx.fillText(sp.tagline, M, y);
      ctx.textBaseline = 'alphabetic'; y += 64;
    }
    lineup(ctx, d, sp, { x: M, y, w: maxW, h: H - 180 - y }, { align: 'left', cols: d.groups.length > 1 ? 2 : 1, color: fg, accent });
    footer(ctx, f, sp, d);
  };

  // 큰 원 + 가운데 제목 (레트로)
  L.orbit = (ctx, f, sp, d) => {
    const { bg, fg, accent, accent2 } = sp.palette;
    const cx = W / 2, cy = 470, R = 290;
    ctx.save();
    ctx.strokeStyle = accent2; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, R + 28, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + 56, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    const on = onColor(accent, fg, bg);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (sp.kicker) { const k = d.up(sp.kicker); fitFont(ctx, k, 'tech', W - M * 2, 28); ctx.fillText(k, cx, 82); }
    title(ctx, sp, titleText(f, sp, d), cx, cy - 30, R * 1.8, 190, on);
    ctx.fillStyle = on; ctx.textAlign = 'center';
    if (sp.tagline) { fitSans(ctx, sp.tagline, 600, R * 1.55, 30); ctx.fillText(sp.tagline, cx, cy + 100); }
    mono(ctx, 22); ctx.fillText(d.dateLine, cx, cy + 150);
    const top = cy + R + 90;
    lineup(ctx, d, sp, { x: M, y: top, w: W - M * 2, h: H - 120 - top }, { cols: d.groups.length > 1 ? 2 : 1, color: fg, accent: fg });
    ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic'; sans(ctx, 500, 24);
    ctx.textAlign = 'left'; ctx.fillText([d.up(f.venue), d.hours].filter(Boolean).join('  ·  '), M, H - 60);
    ctx.textAlign = 'right'; if (sp.footerNote) ctx.fillText(sp.footerNote, W - M, H - 60);
  };

  // 왼쪽 색 패널에 세로 제목, 오른쪽에 정보
  L.split = (ctx, f, sp, d) => {
    const { bg, fg, accent } = sp.palette;
    const PW = 400, x0 = PW + 56, w = W - M - x0;
    ctx.fillStyle = accent; ctx.fillRect(0, 0, PW, H);
    const on = onColor(accent, fg, bg);
    ctx.save(); ctx.translate(PW / 2 + 30, H - M); ctx.rotate(-Math.PI / 2);
    title(ctx, sp, titleText(f, sp, d), 0, 0, H - M * 2, 270, on, 'left');
    ctx.restore();
    ctx.save(); ctx.translate(44, H - M); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = on; mono(ctx, 20); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText([d.dateLine, d.hours].filter(Boolean).join('   ·   '), 0, 0);
    ctx.restore();
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    mono(ctx, 22); ctx.fillText(d.up(sp.kicker), x0, M);
    let y = M + 50;
    if (sp.tagline) { sans(ctx, 800, 46); y = flow(ctx, sp.tagline.split(/\s+/), x0, y, w, 54, 'left', ' ', true) + 18; }
    ctx.fillStyle = accent === bg ? fg : onColor(bg, accent, fg);
    fitSans(ctx, d.dateLine, 800, w, 40); ctx.textAlign = 'left'; ctx.fillText(d.dateLine, x0, y); y += 52;
    ctx.fillStyle = fg; mono(ctx, 22); ctx.fillText(d.up(f.venue), x0, y); y += 50;
    ctx.textBaseline = 'alphabetic';
    hline(ctx, x0, W - M, y, fg, 2); y += 28;
    lineup(ctx, d, sp, { x: x0, y, w, h: H - 180 - y }, { align: 'left', color: fg, accent: onColor(bg, accent, fg) });
    footer(ctx, f, sp, d, x0);
  };

  // 지평선의 해 + 햇살 (여름 야외)
  L.sunburst = (ctx, f, sp, d) => {
    const { bg, fg, accent, accent2 } = sp.palette;
    const hy = 640;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
    ctx.globalAlpha = 0.35; rays(ctx, W / 2, hy, 40, accent2); ctx.globalAlpha = 1;
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(W / 2, hy, 250, Math.PI, 0); ctx.fill();
    ctx.restore();
    ctx.fillStyle = bg; ctx.fillRect(0, hy, W, H - hy);
    hline(ctx, 0, W, hy, fg, 4);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (sp.kicker) { const k = d.up(sp.kicker); fitFont(ctx, k, 'tech', W - M * 3, 30); ctx.fillText(k, W / 2, 110); }
    title(ctx, sp, titleText(f, sp, d), W / 2, 260, W - M * 2, 210, fg);
    const on = onColor(accent, fg, bg);
    ctx.fillStyle = on; ctx.textAlign = 'center';
    if (sp.tagline) { fitSans(ctx, sp.tagline, 700, 420, 30); ctx.fillText(sp.tagline, W / 2, hy - 92); }
    mono(ctx, 22); ctx.fillText(d.dateLine, W / 2, hy - 40);
    lineup(ctx, d, sp, { x: M, y: hy + 44, w: W - M * 2, h: H - 180 - hy - 44 }, { color: fg, accent: fg });
    footer(ctx, f, sp, d);
  };

  /* ---------- 그리기 ---------- */
  /** canvas 크기와 관계없이 1080×1350 기준으로 그림 (썸네일도 같은 함수) */
  function draw(canvas, f, spec) {
    const sp = normalize(spec, f), d = info(f, sp);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = sp.palette.bg; ctx.fillRect(0, 0, W, H);
    if (sp.pattern !== 'none') pattern(ctx, sp, rng(sp.seed + 1));
    if (GRAINS[sp.grain]) grain(ctx, W, H, GRAINS[sp.grain]);
    L[sp.layout](ctx, f, sp, d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** 포스터에 쓰는 웹폰트를 미리 불러옴 (안 불러지면 대체 글꼴로 그림) */
  async function fonts() {
    try {
      await Promise.all(['400 80px "Instrument Serif"', '400 40px Michroma', '800 40px Pretendard', '700 40px Pretendard', '500 30px Pretendard', '400 20px "Space Mono"', '700 20px "Space Mono"']
        .map((x) => document.fonts.load(x)));
    } catch (e) { /* 대체 글꼴 */ }
  }

  return { W, H, LAYOUTS, PATTERNS, FONTS, SCALES, GRAINS, normalize, preset, random, draw, fonts, grain, wave, fitFont, contrast };
})();
