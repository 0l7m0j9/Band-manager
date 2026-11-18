/* =========================================================
   Views — Calendar (그룹 · 밴드 · 개인 일정)
   월 달력에서 날짜를 누르면 그날의 시간표 (아이폰 캘린더처럼)
   색: 개인(짙은 회색) → 밴드 → 그룹(가장 옅은 회색). 수정은 개인 일정만 (관리자는 그룹 일정도)
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast, dateKo } = UI;
  const V = window.Views;
  const KIND = { personal: '개인', band: '밴드', group: '그룹' };
  const z = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

  /** 화면에 보여줄 모든 일정 (내가 볼 수 있는 것) */
  function items() {
    const me = Store.Auth.user ? Store.Auth.user.id : null;
    const out = [];
    Store.Events.list.forEach((e) => {
      if (e.scope === 'personal' && e.owner !== me) return;
      out.push({
        id: 'e:' + e.id, ref: e, kind: e.scope === 'group' ? 'group' : 'personal', title: e.title, date: e.date,
        start: e.start_time || null, end: e.end_time || null, sub: e.note || '',
        editable: e.scope === 'personal' || Store.Group.isAdmin,
      });
    });
    // 내가 속한 밴드의 합주·공연·연습실 예약
    const myBands = Store.Bands.list.filter((b) => b.myStatus === 'approved');
    const ids = new Set(myBands.map((b) => b.id));
    const bname = (id) => (myBands.find((b) => b.id === id) || {}).name || '';
    const db = Store.db;
    db.rehearsals.filter((r) => ids.has(r.bandId)).forEach((r) => out.push({
      id: 'r:' + r.id, kind: 'band', title: `${bname(r.bandId)} 합주`, date: r.date, start: r.start, end: r.end, sub: r.place || '', bandId: r.bandId, link: `#/band/${r.bandId}/rehearsal`,
    }));
    db.gigs.filter((g) => ids.has(g.bandId)).forEach((g) => out.push({
      id: 'g:' + g.id, kind: 'band', title: `${bname(g.bandId)} · ${g.title}`, date: g.date, start: null, end: null, sub: g.venue || '', bandId: g.bandId, link: `#/band/${g.bandId}/rehearsal`,
    }));
    const roomName = (id) => (Store.Rooms.list.find((r) => r.id === id) || {}).name || '연습실';
    Store.Rooms.reservations.filter((r) => r.status === 'approved' && ids.has(r.band_id)).forEach((r) => out.push({
      id: 'v:' + r.id, kind: 'band', title: `${bname(r.band_id)} · ${roomName(r.room_id)}`, date: r.date, start: r.start_time, end: r.end_time, sub: '연습실 예약', bandId: r.band_id, link: '#/rooms',
    }));
    // 공개된 페스티벌 = 그룹 일정
    Store.Festivals.published.forEach((f) => {
      const d = f.data;
      for (let i = 0; i < (d.days || 1); i++) {
        out.push({ id: `f:${f.id}:${i}`, kind: 'group', title: `🎪 ${d.name}${d.days > 1 ? ` (${i + 1}일차)` : ''}`, date: UI.addDays(d.startDate, i), start: null, end: null, sub: d.venue || '', link: '#/home' });
      }
    });
    return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  }
  V.calItems = items;
  V.calKind = KIND;

  /** 월 달력 (작게/크게 공용) */
  function monthGrid(year, month, sel, all, { small = false } = {}) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // 월요일 시작
    const start = new Date(year, month, 1 - offset);
    const today = Store.iso(new Date());
    const byDate = {};
    all.forEach((it) => { (byDate[it.date] = byDate[it.date] || []).push(it); });
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = Store.iso(d), list = byDate[iso] || [];
      const kinds = ['personal', 'band', 'group'].filter((k) => list.some((x) => x.kind === k));
      cells.push(`<button type="button" class="mc-day ${d.getMonth() !== month ? 'out' : ''} ${iso === today ? 'today' : ''} ${iso === sel ? 'sel' : ''}" data-d="${iso}">
        <span class="mc-n">${d.getDate()}</span>
        ${small ? `<span class="mc-dots">${kinds.map((k) => `<i class="k-${k}"></i>`).join('')}</span>`
          : `<span class="mc-evs">${list.slice(0, 3).map((x) => `<span class="mc-ev k-${x.kind}">${esc(x.title)}</span>`).join('')}${list.length > 3 ? `<span class="mc-more">+${list.length - 3}</span>` : ''}</span>
             <span class="mc-dots only-sm">${kinds.map((k) => `<i class="k-${k}"></i>`).join('')}</span>`}
      </button>`);
    }
    if (cells.slice(35).every((c) => c.includes('mc-day out'))) cells.length = 35;
    return `<div class="mc ${small ? 'small' : ''}">
      <div class="mc-head">${['월', '화', '수', '목', '금', '토', '일'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="mc-body">${cells.join('')}</div>
    </div>`;
  }
  V.monthGrid = monthGrid;

  /** 하루 시간표 */
  function dayTimeline(iso, all) {
    const list = all.filter((x) => x.date === iso);
    const allDay = list.filter((x) => !x.start);
    const timed = list.filter((x) => x.start);
    let from = 8 * 60, to = 23 * 60;
    timed.forEach((x) => { from = Math.min(from, Math.floor(toMin(x.start) / 60) * 60); to = Math.max(to, Math.ceil(toMin(x.end || x.start) / 60) * 60); });
    to = Math.min(to, 24 * 60);
    const PX = 0.9; // 1분 = 0.9px
    // 겹치는 일정은 옆으로 나란히
    const lanes = [];
    const placed = timed.map((x) => {
      const s = toMin(x.start), e = Math.max(s + 20, toMin(x.end || x.start) || s + 60);
      let lane = lanes.findIndex((end) => end <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      return { x, s, e, lane };
    });
    const nl = Math.max(1, lanes.length);
    return `
      <div class="day-head"><b>${dateKo(iso, { year: 'numeric' })}</b><span class="muted">${list.length ? `${list.length}개 일정` : '일정 없음'}</span></div>
      ${allDay.length ? `<div class="day-allday">${allDay.map((x) => `<button type="button" class="dt-ev k-${x.kind}" data-ev="${esc(x.id)}"><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('')}</div>` : ''}
      <div class="day-tl" style="height:${(to - from) * PX}px">
        ${Array.from({ length: (to - from) / 60 + 1 }, (_, i) => `<div class="dt-hour" style="top:${i * 60 * PX}px" data-h="${(from / 60) + i}"><span>${z((from / 60 + i) % 24)}:00</span></div>`).join('')}
        ${placed.map(({ x, s, e, lane }) => `<button type="button" class="dt-ev abs k-${x.kind}" data-ev="${esc(x.id)}"
            style="top:${(s - from) * PX}px;height:${Math.max(22, (e - s) * PX)}px;left:calc(52px + (100% - 56px) * ${lane / nl});width:calc((100% - 56px) / ${nl} - 4px)">
            <b>${esc(x.title)}</b><small>${esc(x.start)}${x.end ? '–' + esc(x.end) : ''}${x.sub ? ' · ' + esc(x.sub) : ''}</small></button>`).join('')}
      </div>`;
  }

  /** 일정 추가/수정 창 (개인, 관리자는 그룹도) */
  function eventForm(ev, preset = {}) {
    const admin = Store.Group.isAdmin;
    const e = ev ? { scope: ev.scope, title: ev.title, date: ev.date, start: ev.start_time || '', end: ev.end_time || '', note: ev.note || '' }
      : { scope: 'personal', title: '', date: Store.iso(new Date()), start: '', end: '', note: '', ...preset };
    const allDay = !e.start;
    modal({
      title: ev ? '일정 수정' : '일정 추가',
      body: `
        ${!ev && admin ? `<div class="field"><span class="lbl">종류</span><select name="scope"><option value="personal">개인 일정 (나만 보임)</option><option value="group" ${e.scope === 'group' ? 'selected' : ''}>그룹 일정 (전원에게 보임)</option></select></div>` : ''}
        <div class="field"><span class="lbl">제목 *</span><input name="title" maxlength="60" value="${esc(e.title)}" required></div>
        <div class="row">
          <div class="field"><span class="lbl">날짜</span><input type="date" name="date" value="${esc(e.date)}"></div>
          <label class="row" style="gap:6px;font-weight:600;flex:0 0 auto"><input type="checkbox" name="allday" ${allDay ? 'checked' : ''}> 하루 종일</label>
        </div>
        <div class="row times" ${allDay ? 'hidden' : ''}>
          <div class="field"><span class="lbl">시작</span><input type="time" name="start" step="600" value="${esc(e.start || '19:00')}"></div>
          <div class="field"><span class="lbl">종료</span><input type="time" name="end" step="600" value="${esc(e.end || '21:00')}"></div>
        </div>
        <div class="field"><span class="lbl">메모</span><textarea name="note" maxlength="300">${esc(e.note)}</textarea></div>`,
      extra: ev ? '<button type="button" class="btn ghost left" id="delEv">삭제</button>' : '',
      onOpen(f, close) {
        f.allday.onchange = () => { f.querySelector('.times').hidden = f.allday.checked; };
        const d = f.querySelector('#delEv');
        if (d) d.onclick = () => { close(); UI.confirm(`「${esc(ev.title)}」 일정을 삭제할까요?`, async () => { try { await Store.Events.remove(ev.id); toast('삭제했습니다'); } catch (er) { toast(er.message); } }); };
      },
      async onSubmit(d) {
        if (!d.title.trim()) { toast('제목을 입력하세요'); return false; }
        if (!d.date) { toast('날짜를 고르세요'); return false; }
        const timed = !d.allday;
        if (timed && (!d.start || !d.end || d.end <= d.start)) { toast('종료 시간이 시작보다 늦어야 합니다'); return false; }
        const payload = { scope: d.scope || e.scope, title: d.title.trim(), date: d.date, start: timed ? d.start : null, end: timed ? d.end : null, note: d.note.trim() };
        try {
          if (ev) await Store.Events.update(ev.id, payload); else await Store.Events.add(payload);
          toast(ev ? '저장했습니다' : '일정을 추가했습니다');
          calSel = d.date;
        } catch (er) { toast(er.message); return false; }
      },
    });
  }
  V.eventForm = eventForm;

  /** 일정 누르면: 수정 가능한 건 수정 창, 아니면 정보 */
  function openItem(it) {
    if (it.editable && it.ref) return eventForm(it.ref);
    modal({
      title: `${KIND[it.kind]} 일정`,
      body: `<h3 style="font-size:22px;margin-bottom:6px">${esc(it.title)}</h3>
        <p class="muted">${dateKo(it.date, { year: 'numeric' })}${it.start ? ` · ${esc(it.start)}${it.end ? '–' + esc(it.end) : ''}` : ' · 하루 종일'}</p>
        ${it.sub ? `<p style="margin-top:10px">${esc(it.sub)}</p>` : ''}
        ${it.kind !== 'personal' ? '<p class="muted" style="font-size:12px;margin-top:14px">캘린더에서는 개인 일정만 수정할 수 있습니다.</p>' : ''}`,
      extra: it.link ? `<a class="btn left" href="${it.link}" data-close>자세히 보기</a>` : '',
    });
  }
  V.openCalItem = openItem;

  /* ================= CALENDAR ================= */
  let calSel = null, calYM = null;
  V.calendar = (el) => {
    const today = Store.iso(new Date());
    if (!calSel) calSel = today;
    if (!calYM) calYM = calSel.slice(0, 7);
    const [y, m] = calYM.split('-').map(Number);
    const all = items();
    const title = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    el.innerHTML = V.pageHead(['calendar', esc((Store.Group.current || {}).name || '')], 'CALENDAR', esc(title), `
        <button class="btn icon" id="prev" aria-label="이전 달" data-ro>‹</button>
        <button class="btn" id="today" data-ro>오늘</button>
        <button class="btn icon" id="next" aria-label="다음 달" data-ro>›</button>
        <button class="btn solid" id="add">+ 일정</button>`) + `
      <div class="cal-legend">${Object.entries(KIND).map(([k, v]) => `<span><i class="k-${k}"></i>${v}</span>`).join('')}<span class="muted" style="font-size:12px">개인 일정만 수정할 수 있어요${Store.Group.isAdmin ? ' (관리자: 그룹 일정도)' : ''}</span></div>
      <div class="cal2">
        <div class="cal2-month">${monthGrid(y, m - 1, calSel, all)}</div>
        <div class="cal2-day" id="dayPane">${dayTimeline(calSel, all)}</div>
      </div>`;
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); calYM = `${d.getFullYear()}-${z(d.getMonth() + 1)}`; App.render(); };
    el.querySelector('#prev').onclick = () => shift(-1);
    el.querySelector('#next').onclick = () => shift(1);
    el.querySelector('#today').onclick = () => { calSel = today; calYM = today.slice(0, 7); App.render(); };
    el.querySelector('#add').onclick = () => eventForm(null, { date: calSel });
    el.querySelectorAll('.mc-day').forEach((b) => b.onclick = () => {
      calSel = b.dataset.d;
      if (calSel.slice(0, 7) !== calYM) { calYM = calSel.slice(0, 7); App.render(); return; }
      el.querySelectorAll('.mc-day.sel').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      el.querySelector('#dayPane').innerHTML = dayTimeline(calSel, all);
      bindDay();
      if (window.matchMedia('(max-width: 900px)').matches) el.querySelector('#dayPane').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const bindDay = () => {
      el.querySelectorAll('#dayPane [data-ev]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const it = all.find((x) => x.id === b.dataset.ev); if (it) openItem(it); });
      el.querySelectorAll('#dayPane .dt-hour').forEach((h) => h.onclick = () => {
        const hh = Number(h.dataset.h) % 24;
        eventForm(null, { date: calSel, start: `${z(hh)}:00`, end: `${z(Math.min(23, hh + 1))}:${hh + 1 > 23 ? '59' : '00'}` });
      });
    };
    bindDay();
  };
})();
