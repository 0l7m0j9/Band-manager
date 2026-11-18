/* =========================================================
   UI helpers
   ========================================================= */
const UI = (() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const z = (n) => String(n).padStart(2, '0');

  /** 초 → m:ss */
  const dur = (sec) => {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${z(m)}:${z(s)}` : `${m}:${z(s)}`;
  };
  /** "3:45" 또는 "225" → 초 */
  const parseDur = (v) => {
    v = String(v || '').trim();
    if (v.includes(':')) { const [m, s] = v.split(':').map(Number); return (m || 0) * 60 + (s || 0); }
    return Number(v) || 0;
  };
  /** 분(자정 기준) → HH:MM */
  const hm = (min) => { min = Math.round(min); return `${z(Math.floor(min / 60) % 24)}:${z(min % 60)}`; };
  const parseHm = (v) => { const [h, m] = String(v || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const dateKo = (iso, opt = {}) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', ...opt });
  };
  const dateEn = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' }).toUpperCase()}`;
  };
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return Store.iso(d); };
  const initials = (name) => {
    const w = String(name || '?').trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  };

  const MOODS = { calm: 'Calm', groove: 'Groove', hype: 'Hype', ballad: 'Ballad' };
  const INSTRUMENTS = ['Vocal', 'Guitar', 'Bass', 'Drums', 'Keyboard', 'Synth', 'Electronics', 'Brass', 'Strings', 'Percussion', 'Chorus', 'Etc'];

  const logo = (band, cls = '') => {
    if (!band) return '';
    const bg = band.color || '#141210';
    return `<span class="logo ${cls}" style="background:${esc(bg)}">${band.logo ? `<img src="${esc(band.logo)}" alt="">` : esc(initials(band.name))}</span>`;
  };
  const diff = (n) => { n = Math.max(0, Math.min(5, Math.round(Number(n)) || 0)); return '●'.repeat(n) + '○'.repeat(5 - n); };

  /* ---------- toast ---------- */
  let tt;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------- modal ---------- */
  function modal({ title, body, submit = '저장', onSubmit, onOpen, extra = '', wide = false }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-back">
        <form class="modal" ${wide ? 'style="width:min(760px,100%)"' : ''} novalidate>
          <div class="modal-head"><h3>${title}</h3><button type="button" class="btn icon" data-close aria-label="닫기">✕</button></div>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">${extra}<button type="button" class="btn" data-close>취소</button>${onSubmit ? `<button class="btn solid" type="submit">${submit}</button>` : ''}</div>
        </form>
      </div>`;
    const back = root.firstElementChild, form = back.querySelector('form');
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (onSubmit && (await onSubmit(data, form)) !== false) close();
    });
    onOpen && onOpen(form, close);
    // 터치 기기에서는 창이 열리자마자 키보드가 올라오지 않도록 자동 포커스를 하지 않음
    const touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    const first = !touch && form.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
    first && setTimeout(() => first.focus(), 30);
    return { form, close };
  }

  function confirm(msg, onYes) {
    modal({ title: '확인', body: `<p>${msg}</p>`, submit: '삭제', onSubmit: () => { onYes(); } });
  }

  /** 이미지 파일 → 리사이즈된 dataURL */
  function readImage(file, max = 640) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', .82));
        };
        img.onerror = rej; img.src = r.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }

  function download(dataUrl, name) {
    const a = document.createElement('a'); a.href = dataUrl; a.download = name; a.click();
  }
  async function shareCanvas(canvas, name, text) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    download(canvas.toDataURL('image/png'), name);
    toast('이미지를 다운로드했습니다');
  }

  /** 가로로 스크롤되는 메뉴/탭에서 선택된 항목이 보이도록 가운데로 (페이지 세로 스크롤은 건드리지 않음) */
  function centerActive(scroller, item) {
    if (!scroller || !item || scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect(), r = item.getBoundingClientRect();
    scroller.scrollLeft += (r.left + r.width / 2) - (s.left + s.width / 2);
  }

  const empty = (word, msg, action = '') => `<div class="empty"><span class="wave">${word}</span><p>${msg}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;

  return { esc, dur, parseDur, hm, parseHm, dateKo, dateEn, addDays, initials, MOODS, INSTRUMENTS, logo, diff, toast, modal, confirm, readImage, download, shareCanvas, empty, centerActive };
})();
