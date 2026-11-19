/* =========================================================
   Views — Members (관리자): 그룹 참여자 명단
   검색·필터 · 악기별 인원 · 소속 밴드 · 연락처
   회원 관리: 공동 관리자 지정/해제 · 밴드에 바로 넣기/빼기 · 단장 지정 · 그룹에서 내보내기
   스프레드시트(구글 시트 · xlsx)로 내보내기 → sheet-export.js
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast, confirm } = UI;
  const V = window.Views;
  const FILTERS = [['all', '전체'], ['admin', '관리자'], ['leader', '단장'], ['noband', '밴드 없음']];
  let filter = 'all', search = '', inst = '';

  /** 회원별 소속 밴드 { user_id: [{ band, role, status }] } */
  function bandsByUser() {
    const map = {};
    Store.Bands.list.forEach((b) => Store.Bands.members(b.id).forEach((m) => {
      (map[m.user_id] = map[m.user_id] || []).push({ band: b, role: m.role, status: m.status });
    }));
    return map;
  }
  const joined = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

  /** 회원 관리 창 */
  function manage(r, myBands) {
    const me = Store.Auth.user.id;
    const isMe = r.user_id === me;
    const inBands = myBands.filter((x) => x.status === 'approved');
    const pendingB = myBands.filter((x) => x.status === 'pending');
    const others = Store.Bands.list.filter((b) => !myBands.some((x) => x.band.id === b.id && x.status === 'approved'));
    modal({
      title: r.name, wide: true,
      body: `
        <div class="mem-detail">
          <span class="avatar lg">${esc(UI.initials(r.name))}</span>
          <div>
            <b style="font-size:20px">${esc(r.name)}</b> ${r.role === 'admin' ? '<span class="chip ink">관리자</span>' : ''}
            <p class="muted" style="font-size:13px">@${esc(r.username)} · ${joined(r.joined_at)} 가입</p>
            <p style="margin-top:6px">${(r.instruments || []).map((i) => `<span class="chip">${esc(i)}</span>`).join(' ') || '<span class="muted">악기 정보 없음</span>'}</p>
            <p style="margin-top:6px">${r.phone ? `📞 <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '<span class="muted">전화번호 없음</span>'}</p>
          </div>
        </div>

        <div class="section-head" style="margin-top:20px"><h3 style="font-size:16px">소속 밴드</h3><span class="count">${inBands.length}</span></div>
        ${inBands.map((x) => `<div class="friend-row">
          ${UI.logo(x.band, 'sm')}
          <span class="friend-name"><b>${esc(x.band.name)}</b><span class="muted" style="font-size:12px">${x.role === 'leader' ? '단장' : '부원'}</span></span>
          <span class="row" style="gap:4px;flex:0 0 auto">
            <button type="button" class="btn sm" data-role="${x.band.id}" data-to="${x.role === 'leader' ? 'member' : 'leader'}">${x.role === 'leader' ? '부원으로' : '단장으로'}</button>
            <button type="button" class="btn sm ghost" data-out="${x.band.id}">빼기</button>
          </span>
        </div>`).join('') || '<p class="muted" style="padding:6px 0">소속 밴드가 없습니다.</p>'}
        ${pendingB.length ? `<p class="muted" style="font-size:12px;margin-top:6px">가입 신청 중: ${pendingB.map((x) => esc(x.band.name)).join(', ')}</p>` : ''}
        ${others.length ? `<div class="row" style="margin-top:12px">
          <select class="input" id="addBand" style="flex:1 1 160px">${others.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
          <select class="input" id="addRole" style="flex:0 0 100px"><option value="member">부원</option><option value="leader">단장</option></select>
          <button type="button" class="btn sm solid" id="addGo">밴드에 넣기</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:4px">가입 신청·승인 없이 바로 밴드원이 됩니다.</p>` : ''}

        <div class="section-head" style="margin-top:20px"><h3 style="font-size:16px">권한</h3></div>
        <div class="row">
          ${isMe ? '<span class="muted">본인 권한은 다른 관리자가 바꿀 수 있습니다.</span>'
            : `<button type="button" class="btn ${r.role === 'admin' ? '' : 'solid'}" id="adm">${r.role === 'admin' ? '관리자 해제' : '공동 관리자로 지정'}</button>
               <button type="button" class="btn ghost" id="kick">그룹에서 내보내기</button>`}
        </div>`,
      onOpen(f, close) {
        const run = async (btn, fn, msg) => {
          btn.disabled = true;
          try { await fn(); toast(msg); close(); setTimeout(() => manage(Store.Group.roster.find((x) => x.user_id === r.user_id) || r, bandsByUser()[r.user_id] || []), 50); }
          catch (e) { toast(e.message); btn.disabled = false; }
        };
        f.querySelectorAll('[data-role]').forEach((b) => b.onclick = () => run(b, () => Store.Bands.adminSet(b.dataset.role, r.user_id, b.dataset.to), b.dataset.to === 'leader' ? '단장으로 지정했습니다' : '부원으로 바꿨습니다'));
        f.querySelectorAll('[data-out]').forEach((b) => b.onclick = () => run(b, () => Store.Bands.removeMember(b.dataset.out, r.user_id), '밴드에서 뺐습니다'));
        const ag = f.querySelector('#addGo');
        if (ag) ag.onclick = () => run(ag, () => Store.Bands.adminSet(f.querySelector('#addBand').value, r.user_id, f.querySelector('#addRole').value), '밴드에 넣었습니다');
        const adm = f.querySelector('#adm');
        if (adm) adm.onclick = () => {
          const on = r.role !== 'admin';
          close();
          confirm(on ? `<b>${esc(r.name)}</b> 님을 공동 관리자로 지정할까요?<br><span class="muted">밴드·페스티벌·연습실·게시판·회원 관리 등 그룹의 모든 권한을 갖게 됩니다.</span>`
            : `<b>${esc(r.name)}</b> 님의 관리자 권한을 해제할까요?`, async () => {
            try { await Store.Group.setAdmin(r.user_id, on); toast(on ? '공동 관리자로 지정했습니다' : '관리자 권한을 해제했습니다'); } catch (e) { toast(e.message); }
          }, on ? '지정' : '해제');
        };
        const kick = f.querySelector('#kick');
        if (kick) kick.onclick = () => {
          close();
          confirm(`<b>${esc(r.name)}</b> 님을 그룹에서 내보낼까요?<br><span class="muted">이 그룹의 밴드 소속과 개인 일정도 함께 정리됩니다. 다시 가입하면 들어올 수 있습니다.${inBands.some((x) => x.role === 'leader') ? '<br>⚠ 단장인 밴드가 있습니다 — 내보낸 뒤 새 단장을 지정하세요.' : ''}</span>`, async () => {
            try { await Store.Group.removeMember(r.user_id); toast('그룹에서 내보냈습니다'); } catch (e) { toast(e.message); }
          }, '내보내기');
        };
      },
    });
  }

  /* ================= MEMBERS (관리자) ================= */
  V.members = (el) => {
    const G = Store.Group;
    const roster = G.roster;
    const byUser = bandsByUser();
    const isLeader = (r) => (byUser[r.user_id] || []).some((x) => x.status === 'approved' && x.role === 'leader');
    const hasBand = (r) => (byUser[r.user_id] || []).some((x) => x.status === 'approved');
    // 악기별 인원
    const instCount = {};
    roster.forEach((r) => (r.instruments || []).forEach((i) => { instCount[i] = (instCount[i] || 0) + 1; }));
    const instList = Object.entries(instCount).sort((a, b) => b[1] - a[1]);
    const s = search.trim().toLowerCase();
    const shown = roster.filter((r) => {
      if (filter === 'admin' && r.role !== 'admin') return false;
      if (filter === 'leader' && !isLeader(r)) return false;
      if (filter === 'noband' && hasBand(r)) return false;
      if (inst && !(r.instruments || []).includes(inst)) return false;
      if (s && !`${r.name} ${r.username} ${(r.instruments || []).join(' ')} ${(byUser[r.user_id] || []).map((x) => x.band.name).join(' ')}`.toLowerCase().includes(s)) return false;
      return true;
    });
    const count = { all: roster.length, admin: roster.filter((r) => r.role === 'admin').length, leader: roster.filter(isLeader).length, noband: roster.filter((r) => !hasBand(r)).length };

    el.innerHTML = V.pageHead(['members', esc((G.current || {}).name || '')], 'MEMBERS', 'Members', '<button class="btn" id="csv">스프레드시트로 내보내기</button>') + `
      <div class="stats" style="border-top:1px solid var(--line);margin-bottom:24px">
        <div class="stat"><span class="lbl">members</span><b class="num">${count.all}</b></div>
        <div class="stat"><span class="lbl">admins</span><b class="num">${count.admin}</b></div>
        <div class="stat"><span class="lbl">band leaders</span><b class="num">${count.leader}</b></div>
        <div class="stat"><span class="lbl">no band yet</span><b class="num">${count.noband}</b></div>
      </div>
      ${instList.length ? `<div class="inst-sum">${instList.map(([i, n]) => `<button type="button" class="pick-chip ${inst === i ? 'on' : ''}" data-inst="${esc(i)}">${esc(i)} <b>${n}</b></button>`).join('')}</div>` : ''}
      <div class="mem-tools">
        <input class="input" id="q" type="search" placeholder="이름 · 아이디 · 악기 · 밴드로 검색" value="${esc(search)}" style="flex:1 1 220px">
        <nav class="tabs" style="margin:0">${FILTERS.map(([k, v]) => `<a href="#" data-f="${k}" class="${filter === k ? 'on' : ''}">${v} ${count[k]}</a>`).join('')}</nav>
      </div>
      <div class="mem-list">
        ${shown.map((r) => {
          const bs = (byUser[r.user_id] || []).filter((x) => x.status === 'approved');
          return `<button type="button" class="mem-row" data-u="${r.user_id}">
            <span class="avatar">${esc(UI.initials(r.name))}</span>
            <span class="mem-main"><b>${esc(r.name)}${r.role === 'admin' ? ' <span class="chip ink">관리자</span>' : ''}${isLeader(r) ? ' <span class="chip">단장</span>' : ''}</b>
              <small>@${esc(r.username)} · ${esc((r.instruments || []).join(', ') || '악기 없음')}</small></span>
            <span class="mem-bands hide-sm">${bs.map((x) => `<span class="chip ${x.role === 'leader' ? 'lime' : ''}">${x.role === 'leader' ? '★ ' : ''}${esc(x.band.name)}</span>`).join(' ') || '<span class="muted" style="font-size:12px">밴드 없음</span>'}</span>
            <span class="mem-phone num hide-sm">${esc(r.phone || '—')}</span>
            <span class="mem-go" aria-hidden="true">›</span>
          </button>`;
        }).join('') || '<p class="muted" style="padding:16px 0">조건에 맞는 회원이 없습니다.</p>'}
      </div>`;

    el.querySelector('#csv').onclick = () => SheetExport.open({ members: shown });
    const q = el.querySelector('#q');
    q.oninput = () => { search = q.value; const pos = q.selectionStart; App.render(); const nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); } };
    el.querySelectorAll('[data-f]').forEach((a) => a.onclick = (e) => { e.preventDefault(); filter = a.dataset.f; App.render(); });
    el.querySelectorAll('[data-inst]').forEach((b) => b.onclick = () => { inst = inst === b.dataset.inst ? '' : b.dataset.inst; App.render(); });
    el.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => manage(roster.find((r) => r.user_id === b.dataset.u), byUser[b.dataset.u] || []));
  };
})();
