/* =========================================================
   Views — Rooms (연습실 예약)
   단장: 자기 밴드 이름으로 예약 신청 → 관리자 승인
   관리자: 승인/거절, 모든 밴드 일정 추가·삭제, 연습실 목록 관리
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast, dateKo } = UI;
  const V = window.Views;
  const z = (n) => String(n).padStart(2, '0');
  const STATUS = { pending: '승인 대기', approved: '확정', rejected: '거절' };
  const PRESETS = [['방과후', '16:30', '18:30'], ['저녁', '18:30', '20:30'], ['야간', '20:00', '22:00'], ['주말 오전', '10:00', '12:00']];
  const monday = (iso) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return Store.iso(d); };

  let week = null, roomFilter = 'all';

  const bandName = (id) => (Store.Bands.list.find((b) => b.id === id) || {}).name || '(삭제된 밴드)';
  const roomName = (id) => (Store.Rooms.list.find((r) => r.id === id) || {}).name || '연습실';
  const overlaps = (r, list) => list.find((x) => x.id !== r.id && x.status === 'approved' && x.room_id === r.room_id && x.date === r.date && x.start_time < r.end_time && r.start_time < x.end_time);

  /** 예약 신청(단장) / 일정 추가(관리자) */
  function reserveForm(preset = {}) {
    const admin = Store.Group.isAdmin;
    const bands = admin ? Store.Bands.list : Store.Bands.leaderBands();
    const rooms = Store.Rooms.list;
    if (!rooms.length) { toast(admin ? '먼저 연습실을 추가하세요' : '등록된 연습실이 없습니다. 관리자에게 문의하세요'); return; }
    if (!bands.length) { toast('예약할 수 있는 밴드가 없습니다'); return; }
    modal({
      title: admin ? '연습실 일정 추가' : '연습실 예약 신청',
      body: `
        ${admin ? '<p class="muted" style="font-size:13px;margin-bottom:12px">관리자가 추가한 일정은 바로 확정됩니다.</p>' : '<p class="muted" style="font-size:13px;margin-bottom:12px">관리자가 승인하면 확정되어 밴드원 캘린더에 표시됩니다.</p>'}
        <div class="row">
          <div class="field"><span class="lbl">밴드</span><select name="band">${bands.map((b) => `<option value="${b.id}" ${b.id === preset.bandId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
          <div class="field"><span class="lbl">연습실</span><select name="room">${rooms.map((r) => `<option value="${r.id}" ${r.id === preset.roomId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        </div>
        <div class="time-box">
          <div class="row">
            <div class="field" style="flex:1.3 1 150px"><span class="lbl">날짜</span><input type="date" name="date" value="${esc(preset.date || Store.iso(new Date()))}" min="${Store.iso(new Date())}"></div>
            <div class="field"><span class="lbl">시작</span><input type="time" name="start" step="600" value="${esc(preset.start || '16:30')}"></div>
            <div class="field"><span class="lbl">종료</span><input type="time" name="end" step="600" value="${esc(preset.end || '18:30')}"></div>
          </div>
          <div class="row" style="gap:6px">${PRESETS.map(([n, s, e]) => `<button type="button" class="btn sm" data-p="${s}-${e}">${n}</button>`).join('')}</div>
          <p class="muted" id="clash" style="font-size:13px;margin-top:8px"></p>
        </div>
        <div class="field"><span class="lbl">메모</span><input name="note" maxlength="100" placeholder="예: 공연 전 런스루"></div>`,
      submit: admin ? '추가' : '신청',
      onOpen(f) {
        const check = () => {
          const r = { id: '', room_id: f.room.value, date: f.date.value, start_time: f.start.value, end_time: f.end.value };
          const c = r.start_time && r.end_time && r.end_time > r.start_time ? overlaps(r, Store.Rooms.reservations) : null;
          f.querySelector('#clash').innerHTML = !(r.end_time > r.start_time) ? '⚠ 종료가 시작보다 늦어야 합니다'
            : c ? `⚠ 이미 확정된 예약과 겹칩니다: <b>${esc(bandName(c.band_id))}</b> ${esc(c.start_time)}–${esc(c.end_time)}` : '';
        };
        ['room', 'date', 'start', 'end'].forEach((k) => f[k].addEventListener('input', check));
        f.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { [f.start.value, f.end.value] = b.dataset.p.split('-'); check(); });
        check();
      },
      async onSubmit(d) {
        if (!d.date || !d.start || !d.end || d.end <= d.start) { toast('날짜와 시간을 확인하세요'); return false; }
        const r = { roomId: d.room, bandId: d.band, date: d.date, start: d.start, end: d.end, note: d.note.trim() };
        if (overlaps({ id: '', room_id: r.roomId, date: r.date, start_time: r.start, end_time: r.end }, Store.Rooms.reservations)) { toast('이미 확정된 예약과 겹칩니다'); return false; }
        try { await Store.Rooms.reserve(r, admin); toast(admin ? '일정을 추가했습니다' : '예약을 신청했습니다 · 관리자 승인을 기다려 주세요'); }
        catch (e) { toast(e.message); return false; }
      },
    });
  }

  function resvRow(r, { admin, mine }) {
    const me = Store.Auth.user.id;
    const canCancel = r.status === 'pending' && r.requested_by === me;
    const clash = r.status === 'pending' ? overlaps(r, Store.Rooms.reservations) : null;
    return `<div class="resv st-${r.status} ${mine ? 'mine' : ''}">
      <span class="resv-time num">${esc(r.start_time)}–${esc(r.end_time)}</span>
      <span class="resv-t"><b>${esc(bandName(r.band_id))}</b><small>${esc(roomName(r.room_id))}${r.note ? ' · ' + esc(r.note) : ''}${clash ? ` · <span style="color:var(--violet)">확정 예약과 겹침</span>` : ''}</small></span>
      <span class="chip ${r.status === 'approved' ? 'ink' : r.status === 'rejected' ? 'violet' : 'lime'}">${STATUS[r.status]}</span>
      <span class="row" style="gap:4px;flex:0 0 auto">
        ${admin && r.status === 'pending' ? `<button class="btn sm solid" data-ok="${r.id}">승인</button><button class="btn sm ghost" data-no="${r.id}">거절</button>` : ''}
        ${admin ? `<button class="btn icon sm ghost" data-del="${r.id}" title="삭제">✕</button>` : canCancel ? `<button class="btn sm ghost" data-del="${r.id}">취소</button>` : ''}
      </span>
    </div>`;
  }

  /* ================= ROOMS ================= */
  V.rooms = (el) => {
    const admin = Store.Group.isAdmin;
    const leaderIds = new Set(Store.Bands.leaderBands().map((b) => b.id));
    const today = Store.iso(new Date());
    if (!week) week = monday(today);
    const rooms = Store.Rooms.list;
    const all = Store.Rooms.reservations.filter((r) => roomFilter === 'all' || r.room_id === roomFilter);
    const days = Array.from({ length: 7 }, (_, i) => UI.addDays(week, i));
    const visible = (r) => r.status !== 'rejected' || admin || leaderIds.has(r.band_id);
    const pending = Store.Rooms.reservations.filter((r) => r.status === 'pending').sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    const myReq = Store.Rooms.reservations.filter((r) => leaderIds.has(r.band_id) && r.date >= today).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));

    el.innerHTML = V.pageHead(['rooms', esc((Store.Group.current || {}).name || '')], 'ROOMS', admin ? 'Practice Rooms' : 'Booking',
      `<button class="btn solid" id="add">${admin ? '+ 일정 추가' : '+ 예약 신청'}</button>`) + `
      ${admin && pending.length ? `<section class="section">
        <div class="section-head"><h3>승인 대기</h3><span class="count">${pending.length}</span></div>
        ${pending.map((r) => `<div class="lbl muted" style="margin-top:8px">${dateKo(r.date)}</div>${resvRow(r, { admin, mine: false })}`).join('')}
      </section>` : ''}
      ${!admin && myReq.length ? `<section class="section">
        <div class="section-head"><h3>내 밴드 예약</h3><span class="count">${myReq.length}</span></div>
        ${myReq.map((r) => `<div class="lbl muted" style="margin-top:8px">${dateKo(r.date)}</div>${resvRow(r, { admin, mine: true })}`).join('')}
      </section>` : ''}
      <section class="section">
        <div class="row" style="justify-content:space-between;margin-bottom:14px">
          <div class="row" style="gap:6px">
            <button class="btn icon" id="pw" aria-label="이전 주">‹</button>
            <b class="num">${dateKo(days[0])} – ${dateKo(days[6])}</b>
            <button class="btn icon" id="nw" aria-label="다음 주">›</button>
            <button class="btn sm ghost" id="tw">이번 주</button>
          </div>
          ${rooms.length > 1 ? `<nav class="tabs" style="margin:0"><a href="#" data-room="all" class="${roomFilter === 'all' ? 'on' : ''}">전체</a>${rooms.map((r) => `<a href="#" data-room="${r.id}" class="${roomFilter === r.id ? 'on' : ''}">${esc(r.name)}</a>`).join('')}</nav>` : ''}
        </div>
        <div class="week">
          ${days.map((d) => {
            const list = all.filter((r) => r.date === d && visible(r)).sort((a, b) => a.start_time.localeCompare(b.start_time));
            return `<div class="week-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}">
              <div class="week-h"><b>${dateKo(d)}</b>${d >= today ? `<button class="btn icon sm ghost" data-addd="${d}" title="이 날 예약">＋</button>` : ''}</div>
              ${list.map((r) => resvRow(r, { admin, mine: leaderIds.has(r.band_id) })).join('') || '<p class="muted" style="font-size:13px;padding:6px 0">비어 있음</p>'}
            </div>`;
          }).join('')}
        </div>
      </section>
      ${admin ? `<section class="section">
        <div class="section-head"><h3>연습실 목록</h3><span class="count">${rooms.length}</span></div>
        ${rooms.map((r) => `<div class="stage-pill" data-rm="${r.id}">
          <input class="inline-input" value="${esc(r.name)}" data-rn style="font-weight:700;font-size:16px">
          <span class="lbl muted" style="white-space:nowrap">${Store.Rooms.reservations.filter((x) => x.room_id === r.id && x.status === 'approved' && x.date >= today).length} 예정</span>
          <button class="btn icon ghost" data-rd>✕</button>
        </div>`).join('')}
        <form class="row" id="rf" style="margin-top:10px"><input class="input" name="name" maxlength="30" placeholder="새 연습실 이름 (예: 합주실 B)" style="flex:1 1 200px"><button class="btn sm solid">추가</button></form>
      </section>` : ''}`;

    const canBook = admin || leaderIds.size > 0;
    el.querySelector('#add').onclick = () => (canBook ? reserveForm({ roomId: roomFilter !== 'all' ? roomFilter : undefined }) : toast('단장만 예약할 수 있습니다'));
    el.querySelectorAll('[data-addd]').forEach((b) => b.onclick = () => reserveForm({ date: b.dataset.addd, roomId: roomFilter !== 'all' ? roomFilter : undefined }));
    el.querySelector('#pw').onclick = () => { week = UI.addDays(week, -7); App.render(); };
    el.querySelector('#nw').onclick = () => { week = UI.addDays(week, 7); App.render(); };
    el.querySelector('#tw').onclick = () => { week = monday(today); App.render(); };
    el.querySelectorAll('[data-room]').forEach((a) => a.onclick = (e) => { e.preventDefault(); roomFilter = a.dataset.room; App.render(); });
    const act = async (btn, fn, msg) => { btn.disabled = true; try { await fn(); toast(msg); } catch (e) { toast(e.message); btn.disabled = false; } };
    el.querySelectorAll('[data-ok]').forEach((b) => b.onclick = () => act(b, () => Store.Rooms.decide(b.dataset.ok, 'approved'), '승인했습니다'));
    el.querySelectorAll('[data-no]').forEach((b) => b.onclick = () => act(b, () => Store.Rooms.decide(b.dataset.no, 'rejected'), '거절했습니다'));
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => UI.confirm('이 예약을 삭제할까요?', () => Store.Rooms.remove(b.dataset.del).then(() => toast('삭제했습니다'), (e) => toast(e.message))));
    if (admin) {
      el.querySelectorAll('[data-rm]').forEach((row) => {
        const id = row.dataset.rm;
        row.querySelector('[data-rn]').onchange = (e) => { const v = e.target.value.trim(); if (v) Store.Rooms.renameRoom(id, v).catch((er) => toast(er.message)); };
        row.querySelector('[data-rd]').onclick = () => UI.confirm('이 연습실과 모든 예약을 삭제할까요?', () => Store.Rooms.removeRoom(id).then(() => toast('삭제했습니다'), (er) => toast(er.message)));
      });
      el.querySelector('#rf').onsubmit = async (e) => {
        e.preventDefault();
        const v = e.target.name.value.trim(); if (!v) return;
        try { await Store.Rooms.addRoom(v); toast('연습실을 추가했습니다'); } catch (er) { toast(er.message); }
      };
    }
  };
})();
