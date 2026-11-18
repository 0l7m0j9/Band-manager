/* =========================================================
   Views — Home (모든 계급 공통)
   게시판 · 작은 캘린더 · D-day · 관리자가 공개한 페스티벌(포스터·라인업·시간표·무대·셋리스트)
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, dateKo, dateEn, hm, dur, toast } = UI;
  const V = window.Views;
  const ROLE = { admin: '관리자', leader: '단장', member: '부원' };
  const z = (n) => String(n).padStart(2, '0');

  /** D-day 목록: 오늘 이후 일정 중 가까운 것 */
  function ddays() {
    const today = Store.iso(new Date());
    const seen = new Set();
    return V.calItems()
      .filter((x) => x.date >= today)
      .filter((x) => { // 여러 날짜 페스티벌은 첫날만
        if (!x.id.startsWith('f:')) return true;
        const k = x.id.split(':')[1]; if (seen.has(k)) return false; seen.add(k); return true;
      })
      .slice(0, 8);
  }
  const dLabel = (iso) => {
    const a = new Date(Store.iso(new Date()) + 'T00:00:00'), b = new Date(iso + 'T00:00:00');
    const n = Math.round((b - a) / 86400000);
    return n === 0 ? 'D-DAY' : `D-${n}`;
  };

  /* ---------- 공개된 페스티벌 (보기 전용) ---------- */
  const FEAT = [['poster', 'Poster'], ['lineup', 'Lineup'], ['timetable', 'Timetable'], ['stage', 'Stage'], ['setlists', 'Setlists'], ['info', 'Info']];
  const festTab = {};
  function pubFestival(f) {
    const d = f.data, p = f.published;
    const tabs = FEAT.filter(([k]) => p[k]);
    const cur = tabs.some(([k]) => k === festTab[f.id]) ? festTab[f.id] : (tabs[0] || [])[0];
    const end = UI.addDays(d.startDate, (d.days || 1) - 1);
    return `<article class="pub-fest" data-f="${f.id}">
      <div class="pub-head">
        <div><span class="lbl muted">festival</span><h3>${esc(d.name)}</h3>
          <p class="muted">${dateEn(d.startDate)}${d.days > 1 ? ' – ' + dateEn(end) : ''}${d.venue ? ' · ' + esc(d.venue) : ''}</p></div>
        <span class="chip">${dLabel(d.startDate).replace('D--', 'D+')}</span>
      </div>
      <nav class="tabs">${tabs.map(([k, v]) => `<a href="#" data-pt="${k}" class="${k === cur ? 'on' : ''}">${v}</a>`).join('')}</nav>
      <div class="pub-body">${renderFeat(f, cur)}</div>
    </article>`;
  }
  const actOf = (d, id) => (d.acts || []).find((a) => a.id === id);
  const stageOf = (d, id) => (d.stages || []).find((s) => s.id === id);
  function renderFeat(f, k) {
    const d = f.data;
    if (k === 'poster') return `<canvas class="poster-canvas pub-poster" width="1080" height="1350" aria-label="${esc(d.name)} 포스터"></canvas>`;
    if (k === 'info') return `<table class="tbl"><tbody>
        <tr><td class="lbl">dates</td><td>${dateKo(d.startDate, { year: 'numeric' })}부터 ${d.days}일</td></tr>
        <tr><td class="lbl">venue</td><td>${esc(d.venue || '—')}</td></tr>
        <tr><td class="lbl">theme</td><td>${esc(d.theme || '—')}</td></tr>
        <tr><td class="lbl">hours</td><td class="num">${hm(d.dayStart * 60)} – ${hm(d.dayEnd * 60)}</td></tr>
        <tr><td class="lbl">stages</td><td>${(d.stages || []).map((s) => esc(s.name)).join(' · ') || '—'}</td></tr></tbody></table>`;
    if (k === 'lineup') {
      const acts = [...(d.acts || [])].sort((a, b) => (b.headliner - a.headliner) || a.name.localeCompare(b.name));
      return `<div class="pub-lineup">${acts.map((a) => `<span class="${a.headliner ? 'head' : ''}">${a.headliner ? '★ ' : ''}${esc(a.name)}</span>`).join('')}</div>`;
    }
    if (k === 'timetable') {
      return Array.from({ length: d.days || 1 }, (_, day) => {
        const slots = (d.slots || []).filter((s) => s.day === day).sort((a, b) => a.start - b.start);
        if (!slots.length) return '';
        return `<div class="lbl" style="margin:14px 0 6px">DAY ${day + 1} · ${dateEn(UI.addDays(d.startDate, day))}</div>
          ${slots.map((s) => { const a = actOf(d, s.actId), st = stageOf(d, s.stageId); return a ? `<div class="pub-slot">
            <span class="num">${hm(s.start)}–${hm(s.start + s.dur)}</span>
            <b>${a.headliner ? '★ ' : ''}${esc(a.name)}</b>
            <span class="pub-stage"><i style="background:${esc(st ? st.color : '#111')}"></i>${esc(st ? st.name : '')}</span>
          </div>` : ''; }).join('')}`;
      }).join('') || '<p class="muted">시간표가 아직 없습니다.</p>';
    }
    if (k === 'stage') {
      const L = d.layouts || {};
      const stages = (d.stages || []).filter((s) => L[s.id]);
      return stages.map((s) => `<div class="lbl" style="margin:14px 0 6px">${esc(s.name)}</div>
        <div class="stage-box">${L[s.id].map((g) => `<div class="gear g-${esc(g.type)}" style="left:${g.x}%;top:${g.y}%;--rot:${g.rot || 0}deg">${g.type === 'mic' ? 'M' : g.type === 'di' ? 'DI' : esc(g.type.toUpperCase())}</div>`).join('')}</div>`).join('')
        || '<p class="muted">공개된 무대 배치가 없습니다.</p>';
    }
    if (k === 'setlists') {
      const S = d.setlists || {};
      const ids = Object.keys(S).filter((id) => actOf(d, id));
      return ids.map((id) => {
        const sl = S[id];
        return `<div class="pub-setlist"><div class="row" style="justify-content:space-between"><b>${esc(actOf(d, id).name)}</b><span class="muted num">${(sl.items || []).length}곡 · ${dur(sl.total || 0)}</span></div>
          <ol>${(sl.items || []).map((it) => `<li><span>${esc(it.title)}</span><span class="muted">${esc(it.artist || '')}</span><span class="num muted">${dur(it.duration)}</span></li>`).join('')}</ol></div>`;
      }).join('') || '<p class="muted">공개된 셋리스트가 없습니다.</p>';
    }
    return '';
  }
  async function drawPosters(root) {
    const cs = root.querySelectorAll('canvas.pub-poster');
    if (!cs.length) return;
    await Poster.fonts();
    cs.forEach((c) => {
      const f = Store.Festivals.published.find((x) => x.id === c.closest('[data-f]').dataset.f);
      if (f && c.isConnected) Poster.draw(c, { ...f.data, id: f.id }, f.data.poster || Poster.preset('ripple', f.data));
    });
  }

  /* ================= HOME ================= */
  let miniYM = null;
  V.home = (el) => {
    const p = Store.Auth.profile || {}, G = Store.Group;
    const role = G.role;
    const posts = Store.Posts.list;
    const today = Store.iso(new Date());
    if (!miniYM) miniYM = today.slice(0, 7);
    const [y, m] = miniYM.split('-').map(Number);
    const all = V.calItems();
    const dd = ddays();
    const pubs = Store.Festivals.published;
    const myBands = Store.Bands.list.filter((b) => b.myStatus === 'approved');
    el.innerHTML = `
      <section class="home-hello">
        <div>
          <span class="lbl muted">${esc((G.current || {}).name || '')} · ${ROLE[role]}</span>
          <h1>안녕하세요, ${esc(p.name || '')}님</h1>
          <p class="muted">${myBands.length ? `${myBands.map((b) => esc(b.name)).join(' · ')}` : '아직 참여한 밴드가 없어요 — <a href="#/bands">밴드 둘러보기</a>'}</p>
        </div>
      </section>
      <div class="home-grid">
        <section class="section home-board">
          <div class="section-head"><h3>Board</h3>${G.isAdmin ? '<a class="btn sm" href="#/board">글쓰기</a>' : `<span class="count">${posts.length}</span>`}</div>
          ${posts.slice(0, 6).map((po) => `<button type="button" class="post-row ${po.images && po.images[0] ? '' : 'noimg'}" data-post="${po.id}">
              ${po.images && po.images[0] ? `<img src="${esc(po.images[0])}" alt="">` : ''}
              <span class="post-t"><b>${po.pinned ? '<span class="chip ink" style="margin-right:6px">공지</span>' : ''}${esc(po.title)}</b><small>${esc(String(po.body || '').slice(0, 80))}</small></span>
              <span class="muted num" style="font-size:12px">${esc(String(po.created_at).slice(5, 10).replace('-', '.'))}</span>
            </button>`).join('') || '<p class="muted" style="padding:10px 0">게시글이 없습니다.</p>'}
        </section>
        <aside class="home-side">
          <section class="section">
            <div class="section-head"><h3>${new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' })}</h3>
              <span class="row" style="gap:4px"><button class="btn icon sm" id="mp" aria-label="이전 달">‹</button><button class="btn icon sm" id="mn" aria-label="다음 달">›</button><a class="btn sm" href="#/calendar">Calendar</a></span></div>
            ${V.monthGrid(y, m - 1, null, all, { small: true })}
          </section>
          <section class="section">
            <div class="section-head"><h3>D-day</h3><span class="count">upcoming</span></div>
            ${dd.map((x) => `<button type="button" class="dd-row" data-dd="${esc(x.id)}">
              <span class="dd-n ${x.date === today ? 'today' : ''}">${dLabel(x.date)}</span>
              <span class="dd-t"><b>${esc(x.title)}</b><small>${dateKo(x.date)}${x.start ? ' · ' + esc(x.start) : ''}</small></span>
              <i class="dd-k k-${x.kind}" title="${V.calKind[x.kind]}"></i>
            </button>`).join('') || '<p class="muted" style="padding:6px 0">다가오는 일정이 없습니다.</p>'}
          </section>
        </aside>
      </div>
      ${pubs.length ? `<section class="section" style="margin-top:12px">
        <div class="section-head"><h3>Festival</h3><span class="count">관리자가 공개한 내용</span></div>
        <div class="pub-list">${pubs.map(pubFestival).join('')}</div>
      </section>` : ''}`;

    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); miniYM = `${d.getFullYear()}-${z(d.getMonth() + 1)}`; App.render(); };
    el.querySelector('#mp').onclick = () => shift(-1);
    el.querySelector('#mn').onclick = () => shift(1);
    el.querySelectorAll('.mc-day').forEach((b) => b.onclick = () => {
      const list = all.filter((x) => x.date === b.dataset.d);
      if (!list.length) { location.hash = '#/calendar'; return; }
      if (list.length === 1) { V.openCalItem(list[0]); return; }
      UI.modal({ title: dateKo(b.dataset.d, { year: 'numeric' }), body: list.map((x) => `<button type="button" class="dd-row" data-dd="${esc(x.id)}"><span class="dd-n">${x.start ? esc(x.start) : '종일'}</span><span class="dd-t"><b>${esc(x.title)}</b><small>${V.calKind[x.kind]}${x.sub ? ' · ' + esc(x.sub) : ''}</small></span><i class="dd-k k-${x.kind}"></i></button>`).join(''),
        onOpen(f, close) { f.querySelectorAll('[data-dd]').forEach((r) => r.onclick = () => { close(); V.openCalItem(list.find((x) => x.id === r.dataset.dd)); }); } });
    });
    el.querySelectorAll('[data-dd]').forEach((b) => b.onclick = () => { const it = all.find((x) => x.id === b.dataset.dd); if (it) V.openCalItem(it); });
    el.querySelectorAll('[data-post]').forEach((b) => b.onclick = () => V.postModal(posts.find((x) => x.id === b.dataset.post)));
    el.querySelectorAll('[data-pt]').forEach((a) => a.onclick = (e) => {
      e.preventDefault();
      const art = a.closest('[data-f]');
      festTab[art.dataset.f] = a.dataset.pt;
      art.querySelectorAll('[data-pt]').forEach((x) => x.classList.toggle('on', x === a));
      art.querySelector('.pub-body').innerHTML = renderFeat(pubs.find((x) => x.id === art.dataset.f), a.dataset.pt);
      drawPosters(art);
    });
    drawPosters(el);
  };
})();
