/* =========================================================
   Views — Home / My Bands / Studio / Setlist / Rehearsal / Progress
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, dur, parseDur, dateKo, dateEn, logo, diff, MOODS, INSTRUMENTS, modal, toast, confirm } = UI;
  const V = window.Views;
  const db = () => Store.db;
  const go = (hash) => { location.hash = hash; };
  /** 창이 열려 있는 사이 친구 변경으로 데이터가 새로 들어왔을 수 있으므로, 저장할 때 id로 현재 객체를 다시 찾음 */
  const live = (col, obj) => obj && db()[col].find((x) => x.id === obj.id);
  const gone = () => { toast('다른 곳에서 삭제된 항목이라 저장하지 못했습니다'); };

  const pageHead = (eyebrow, tech, title, actions = '') => `
    <div class="page-head">
      <div>
        <div class="eyebrow">${eyebrow.map((e) => `<span class="lbl">${e}</span>`).join('')}</div>
        <h1 class="page-title"><span class="tech">${tech}</span>${title}</h1>
      </div>
      <div class="page-actions">${actions}</div>
    </div>`;

  const needBand = (el) => {
    const band = Store.band();
    if (!band) el.innerHTML = UI.empty('Band', '밴드를 찾을 수 없거나 볼 권한이 없습니다.', '<a class="btn solid" href="#/bands">밴드 목록으로</a>');
    return band;
  };
  /** 이 밴드를 고칠 수 있는지 (단장·관리자) */
  const canEdit = (band) => !!band && Store.Bands.canEdit(band.id);
  V.canEditBand = canEdit;

  /* ---------------- Band form (만들기 / 정보 수정) ---------------- */
  function bandForm(band) {
    const b = band || { name: '', genre: '', bio: '', color: '#111111', logo: '' };
    let logoData = b.logo;
    modal({
      title: band ? '밴드 정보 수정' : '새 밴드 만들기',
      body: `
        ${band ? '' : '<p class="muted" style="font-size:13px;margin-bottom:14px">밴드를 만들면 단장이 되어 곡·세트리스트·합주를 관리하고 가입 신청을 승인할 수 있습니다.</p>'}
        <div class="row" style="align-items:flex-start;gap:18px">
          <label style="cursor:pointer;text-align:center">
            <span id="lp">${logo({ ...b, name: b.name || 'NEW' }, 'lg')}</span>
            <span class="lbl" style="display:block;margin-top:6px">logo upload</span>
            <input type="file" accept="image/*" name="logoFile" hidden>
          </label>
          <div style="flex:1;min-width:200px">
            <div class="field"><span class="lbl">band name *</span><input name="name" required value="${esc(b.name)}" maxlength="40"></div>
            <div class="row">
              <div class="field"><span class="lbl">genre</span><input name="genre" value="${esc(b.genre)}" placeholder="Indie Rock" maxlength="40"></div>
              <div class="field" style="flex:0 0 auto"><span class="lbl">color</span><input type="color" name="color" value="${esc(b.color)}"></div>
            </div>
          </div>
        </div>
        <div class="field"><span class="lbl">introduction</span><textarea name="bio" maxlength="400">${esc(b.bio)}</textarea></div>
        ${logoData ? '<button type="button" class="btn sm" id="rmLogo">로고 이미지 제거</button>' : ''}`,
      submit: band ? '저장' : '만들기',
      onOpen(f) {
        const refresh = () => { f.querySelector('#lp').innerHTML = logo({ name: f.name.value || 'NEW', color: f.color.value, logo: logoData }, 'lg'); };
        f.logoFile.onchange = async () => { if (f.logoFile.files[0]) { logoData = await UI.readImage(f.logoFile.files[0], 320); refresh(); } };
        f.name.oninput = f.color.oninput = refresh;
        const rm = f.querySelector('#rmLogo'); if (rm) rm.onclick = () => { logoData = ''; refresh(); rm.remove(); };
      },
      async onSubmit(d, f) {
        if (!d.name.trim()) { toast('밴드 이름을 입력하세요'); return false; }
        const patch = { name: d.name.trim(), genre: d.genre.trim(), bio: d.bio.trim(), color: d.color, logo: logoData };
        if (band) {
          const cur = live('bands', band); if (!cur) return gone();
          Object.assign(cur, patch); Store.save(); toast('저장했습니다'); App.render();
          return;
        }
        const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const id = await Store.Bands.create(patch);
          toast(`${patch.name} 결성! 단장이 되었습니다`);
          go(`#/band/${id}`);
        } catch (e) { toast(e.message); btn.disabled = false; return false; }
      },
    });
  }
  V.bandForm = bandForm;

  /* ================= BANDS (목록) =================
     위: 내가 속한 밴드(관리자는 전부) / 아래: 그룹의 모든 밴드 → 가입 신청 */
  V.bands = (el) => {
    const G = Store.Group, list = Store.Bands.list, admin = G.isAdmin;
    const mine = list.filter((b) => admin || b.myStatus === 'approved');
    const pendingFor = (b) => (b.canEdit ? Store.Bands.members(b.id).filter((m) => m.status === 'pending').length : 0);
    const roleChip = (b) => (b.myRole === 'leader' && b.myStatus === 'approved' ? '<span class="chip ink">단장</span>'
      : b.myStatus === 'approved' ? '<span class="chip">부원</span>' : admin ? '<span class="chip lime">관리자</span>' : '');
    const card = (b) => `<a class="band-card" href="#/band/${b.id}">
        <div class="row" style="justify-content:space-between;align-items:flex-start">${logo(b)}
          <span class="row" style="gap:6px">${roleChip(b)}${pendingFor(b) ? `<span class="chip violet">신청 ${pendingFor(b)}</span>` : ''}</span>
        </div>
        <h3>${esc(b.name)}</h3>
        <div class="row"><span class="chip">${esc(b.genre || 'Band')}</span><span class="lbl muted">${b.memberCount} members</span></div>
      </a>`;
    const action = (b) => {
      if (b.myStatus === 'approved') return '<span class="chip">참여 중</span>';
      if (b.myStatus === 'pending') return `<span class="chip lime">승인 대기</span><button class="btn sm ghost" data-cancel="${b.id}">취소</button>`;
      return `<button class="btn sm" data-join="${b.id}">가입 신청</button>`;
    };
    el.innerHTML = pageHead([esc((G.current || {}).name || ''), `${list.length} bands`], 'BANDS', admin ? 'All Bands' : 'My Bands',
      `<button class="btn" id="imp">예전 데이터 가져오기</button><button class="btn solid" id="add">+ 새 밴드</button>`) + `
      <div class="band-grid">
        ${mine.map(card).join('')}
        <a class="band-card add" id="add2">+ New Band<span class="lbl muted" style="margin-top:8px">만든 사람이 단장이 됩니다</span></a>
      </div>
      <section class="section" style="margin-top:44px">
        <div class="section-head"><h3>${esc((G.current || {}).name || '')} 밴드</h3><span class="count">가입 신청 → 단장 승인 후 참여</span></div>
        ${list.map((b) => `
          <div class="explore-row">
            ${logo(b, 'sm')}
            <span class="ex-t"><b>${esc(b.name)}</b><small>${esc(b.genre || '—')} · 단장 ${esc(b.leaders.join(', ') || '—')} · ${b.memberCount}명</small></span>
            <span class="row" style="gap:6px;flex:0 0 auto">${action(b)}${admin ? `<button class="btn sm ghost" data-del="${b.id}">삭제</button>` : ''}</span>
          </div>`).join('') || '<p class="muted" style="padding:12px 0">아직 밴드가 없습니다. 첫 밴드를 만들어 보세요.</p>'}
      </section>`;
    el.querySelector('#add').onclick = el.querySelector('#add2').onclick = (e) => { e.preventDefault(); bandForm(); };
    el.querySelector('#imp').onclick = () => V.legacyImport && V.legacyImport();
    const busy = async (btn, fn, msg) => { btn.disabled = true; try { await fn(); if (msg) toast(msg); } catch (e) { toast(e.message); btn.disabled = false; } };
    el.querySelectorAll('[data-join]').forEach((b) => b.onclick = () => {
      const band = list.find((x) => x.id === b.dataset.join);
      const mine = (Store.Auth.profile || {}).instruments || [];
      modal({
        title: `${band.name} 가입 신청`,
        body: `<p class="muted" style="font-size:13px;margin-bottom:12px">단장이 승인하면 밴드의 곡·세트리스트·합주 일정을 볼 수 있습니다.</p>
          <div class="field"><span class="lbl">이 밴드에서 맡을 파트</span><input name="part" list="myInst" maxlength="30" value="${esc(mine[0] || '')}" placeholder="예: Bass"><datalist id="myInst">${[...new Set([...mine, ...INSTRUMENTS])].map((i) => `<option value="${esc(i)}">`).join('')}</datalist></div>`,
        submit: '신청',
        async onSubmit(d) {
          try { await Store.Bands.requestJoin(band.id, d.part.trim()); toast('가입을 신청했습니다 · 단장 승인을 기다려 주세요'); } catch (e) { toast(e.message); return false; }
        },
      });
    });
    el.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => busy(b, () => Store.Bands.cancelRequest(b.dataset.cancel), '신청을 취소했습니다'));
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => deleteBand(list.find((x) => x.id === b.dataset.del)));
  };

  /* ---------------- Band delete (관리자) ---------------- */
  function deleteBand(band, after) {
    if (!band) return;
    confirm(`<b>${esc(band.name)}</b> 밴드를 삭제할까요?<br><span class="muted">곡·세트리스트·합주·과제·공연 기록·연습실 예약과 밴드원 명단이 모두 삭제되며 되돌릴 수 없습니다.</span>`, async () => {
      try { await Store.Bands.remove(band.id); toast(`${band.name} 삭제됨`); after ? after() : App.render(); } catch (e) { toast(e.message); }
    });
  }

  /* ---------------- Songs accordion (Studio) ---------------- */
  let openSong = null;
  function songAccordion(band, songs) {
    const d = db();
    const head = `<div class="section-head"><h3>Songs &amp; Progress</h3><div class="row" style="gap:10px"><span class="count">${songs.length} songs · click to open</span><button class="btn sm solid" id="addSongS">+ 곡 추가</button></div></div>`;
    if (!songs.length) return `<section class="section">${head}${UI.empty('Songs', '이 밴드에 아직 곡이 없습니다.', '<button class="btn solid" id="addSongE">+ 첫 곡 추가</button>')}</section>`;
    const memberOpts = band.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    return `<section class="section">${head}<div class="acc">${songs.map((s, i) => {
      const open = s.id === openSong;
      const tasks = d.tasks.filter((t) => t.songId === s.id);
      const inSets = d.setlists.filter((sl) => sl.bandId === band.id && sl.items.some((it) => it.songId === s.id));
      return `<div class="acc-item ${open ? 'open' : ''}" data-song="${s.id}">
        <button type="button" class="acc-head" aria-expanded="${open}">
          ${s.artwork ? `<img class="acc-art" src="${esc(s.artwork)}" alt="">` : `<span class="mono" style="font-size:12px">${String(i + 1).padStart(2, '0')}</span>`}
          <span class="acc-title"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>
          <span class="prog-bar ${s.progress >= 100 ? 'done' : ''}"><i style="width:${s.progress}%"></i></span>
          <span class="mono num acc-pct">${s.progress}%</span>
          <span class="caret" aria-hidden="true">↓</span>
        </button>
        <div class="acc-body"><div class="acc-inner"><div class="acc-content">
          <div class="info-grid">
            <div><span class="lbl">artist</span><b>${esc(s.artist) || '—'}</b></div>
            <div><span class="lbl">length</span><b class="num">${dur(s.duration)}</b></div>
            <div><span class="lbl">bpm</span><b class="num">${s.bpm}</b></div>
            <div><span class="lbl">difficulty</span><b class="dots">${diff(s.difficulty)}</b></div>
            <div><span class="lbl">mood</span><b><i class="mood-dot mood-${s.mood}"></i>${MOODS[s.mood]}</b></div>
            <div><span class="lbl">in setlists</span><b>${inSets.length ? inSets.map((x) => esc(x.name)).join(', ') : '—'}</b></div>
          </div>
          <div class="field" style="margin:18px 0 10px"><span class="lbl">practice progress · 100% = stage ready</span>
            <div class="prog"><input type="range" min="0" max="100" step="5" value="${s.progress}" data-p aria-label="${esc(s.title)} 진행도"><b class="mono num" data-pv style="min-width:48px;text-align:right">${s.progress}%</b></div>
          </div>
          <div class="lbl" style="margin-bottom:4px">practice tasks · ${tasks.filter((t) => !t.done).length} open</div>
          ${tasks.map((t) => {
            const m = band.members.find((x) => x.id === t.memberId);
            return `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-t="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)} ${m ? `<span class="chip">${esc(m.name)}</span>` : ''}</span><button type="button" class="btn icon ghost sm" data-rt="${t.id}">✕</button></label>`;
          }).join('') || '<p class="muted" style="font-size:13px">이 곡에 대한 연습 과제가 없습니다.</p>'}
          ${band.members.length ? `<form class="row task-add" style="margin-top:10px"><select class="input" name="memberId" style="flex:0 0 130px">${memberOpts}</select><input class="input" name="text" placeholder="과제 추가 (예: 브릿지 코러스 맞추기)" style="flex:1 1 180px"><button class="btn sm">추가</button></form>` : ''}
          <div class="row" style="margin-top:16px"><button type="button" class="btn sm" data-edit>곡 정보 수정</button><a class="btn sm ghost" href="#/setlist">세트리스트에서 사용 →</a></div>
        </div></div></div>
      </div>`;
    }).join('')}</div></section>`;
  }

  function bindSongAccordion(el, band) {
    ['#addSongS', '#addSongE'].forEach((sel) => { const b = el.querySelector(sel); if (b) b.onclick = () => songForm(band); });
    el.querySelectorAll('.acc-item').forEach((item) => {
      const s = Store.song(item.dataset.song);
      const head = item.querySelector('.acc-head');
      head.onclick = () => {
        const open = !item.classList.contains('open');
        el.querySelectorAll('.acc-item.open').forEach((x) => { x.classList.remove('open'); x.querySelector('.acc-head').setAttribute('aria-expanded', 'false'); });
        item.classList.toggle('open', open);
        head.setAttribute('aria-expanded', String(open));
        openSong = open ? s.id : null;
      };
      const r = item.querySelector('[data-p]');
      r.oninput = () => {
        const v = Number(r.value);
        item.querySelector('[data-pv]').textContent = v + '%';
        item.querySelector('.acc-pct').textContent = v + '%';
        const bar = head.querySelector('.prog-bar');
        bar.firstElementChild.style.width = v + '%';
        bar.classList.toggle('done', v >= 100);
      };
      r.onchange = () => { s.progress = Number(r.value); Store.save(); };
      item.querySelectorAll('[data-t]').forEach((c) => c.onchange = () => { db().tasks.find((t) => t.id === c.dataset.t).done = c.checked; Store.save(); App.render(); });
      item.querySelectorAll('[data-rt]').forEach((b) => b.onclick = (e) => { e.preventDefault(); Store.remove('tasks', b.dataset.rt); App.render(); });
      const tf = item.querySelector('.task-add');
      if (tf) tf.onsubmit = (e) => {
        e.preventDefault();
        if (!tf.text.value.trim()) return;
        db().tasks.push({ id: Store.uid(), bandId: band.id, memberId: tf.memberId.value, songId: s.id, text: tf.text.value.trim(), done: false });
        Store.save(); App.render();
      };
      item.querySelector('[data-edit]').onclick = () => songForm(band, s);
    });
  }

  /* ---------------- Candidate songs (Studio) ---------------- */
  let audio = null, playingId = null;
  // Studio 를 벗어나면 미리듣기 정지
  window.addEventListener('hashchange', () => {
    if (audio && !location.hash.startsWith('#/studio')) { audio.pause(); audio = null; playingId = null; }
  });
  function candidateSection(band) {
    const cands = Store.candidatesOf(band.id)
      .map((s) => ({ s, n: (s.votes || []).filter((v) => band.members.some((m) => m.id === v)).length }))
      .sort((a, b) => b.n - a.n);
    const total = band.members.length;
    const head = `<div class="section-head"><h3>Candidates</h3><div class="row" style="gap:10px"><span class="count">${cands.length} 후보 · 멤버 투표 후 확정</span><button class="btn sm" id="addCand">+ 후보곡</button></div></div>`;
    if (!cands.length) return `<section class="section">${head}<p class="muted" style="padding:6px 0 4px">아직 후보곡이 없습니다. 해보고 싶은 곡을 후보로 올리고 멤버들과 투표해 보세요.</p></section>`;
    return `<section class="section">${head}<div class="cands">${cands.map(({ s, n }) => {
      const by = band.members.find((m) => m.id === s.proposedBy);
      const majority = total && n > total / 2;
      return `<div class="cand ${majority ? 'major' : ''}" data-c="${s.id}">
        <button type="button" class="play ${playingId === s.id ? 'on' : ''}" data-play ${s.previewUrl ? '' : 'disabled title="미리듣기 없음 (iTunes 검색으로 추가하면 30초 미리듣기 가능)"'} aria-label="미리듣기">${playingId === s.id ? '❚❚' : '▶'}</button>
        ${s.artwork ? `<img class="acc-art" src="${esc(s.artwork)}" alt="">` : '<span class="acc-art ph"></span>'}
        <span class="cand-t">
          <b>${esc(s.title)}</b>
          <small>${esc(s.artist || '—')} · ${dur(s.duration)} · ${s.bpm} bpm${by ? ` · 제안 ${esc(by.name)}` : ''}</small>
          ${s.reason ? `<em>“${esc(s.reason)}”</em>` : ''}
        </span>
        <span class="votes" role="group" aria-label="투표">${band.members.map((m) => {
          const on = (s.votes || []).includes(m.id);
          return `<button type="button" class="vote ${on ? 'on' : ''}" data-v="${m.id}" title="${esc(m.name)} ${on ? '찬성' : '투표 안 함'}" aria-pressed="${on}">${esc(UI.initials(m.name))}</button>`;
        }).join('')}</span>
        <span class="vote-n"><b class="num">${n}</b><span class="mono">/${total}</span>${majority ? '<span class="chip ink">과반</span>' : ''}</span>
        <span class="cand-act"><button type="button" class="btn sm solid" data-ok>확정</button><button type="button" class="btn icon sm ghost" data-ed title="수정">✎</button><button type="button" class="btn icon sm ghost" data-rm title="삭제">✕</button></span>
      </div>`;
    }).join('')}</div></section>`;
  }

  function bindCandidates(el, band) {
    el.querySelector('#addCand').onclick = () => songForm(band, null, { candidate: true });
    el.querySelectorAll('.cand').forEach((row) => {
      const s = Store.song(row.dataset.c);
      row.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => {
        const v = new Set(s.votes || []);
        v.has(b.dataset.v) ? v.delete(b.dataset.v) : v.add(b.dataset.v);
        s.votes = [...v]; Store.save(); App.render();
      });
      row.querySelector('[data-ok]').onclick = () => {
        s.status = undefined; s.progress = s.progress || 0;
        Store.save(); App.render();
        toast(`「${s.title}」 확정! 세트리스트에서 사용할 수 있어요`);
      };
      row.querySelector('[data-ed]').onclick = () => songForm(band, s);
      row.querySelector('[data-rm]').onclick = () => confirm(`후보곡 「${esc(s.title)}」을(를) 삭제할까요?`, () => {
        if (playingId === s.id && audio) { audio.pause(); playingId = null; }
        Store.remove('songs', s.id); App.render();
      });
      row.querySelector('[data-play]').onclick = (e) => {
        const btn = e.currentTarget;
        const reset = () => document.querySelectorAll('.cand .play.on').forEach((x) => { x.classList.remove('on'); x.textContent = '▶'; });
        if (playingId === s.id) { audio.pause(); playingId = null; reset(); return; }
        if (audio) audio.pause();
        audio = new Audio(s.previewUrl);
        audio.onended = () => { playingId = null; reset(); };
        audio.play().catch(() => { playingId = null; reset(); toast('미리듣기를 재생할 수 없습니다'); });
        playingId = s.id; reset(); btn.classList.add('on'); btn.textContent = '❚❚';
      };
    });
  }

  /* ================= BAND STUDIO ================= */
  V.studio = (el) => {
    const band = needBand(el); if (!band) return;
    const edit = canEdit(band), admin = Store.Group.isAdmin;
    const me = Store.Auth.user ? Store.Auth.user.id : null;
    const songs = Store.songsOf(band.id);
    const gigs = db().gigs.filter((g) => g.bandId === band.id);
    const roster = Store.Bands.members(band.id);
    const approved = roster.filter((m) => m.status === 'approved').sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'leader' ? -1 : 1));
    const pend = roster.filter((m) => m.status === 'pending');
    const amMember = approved.some((m) => m.user_id === me);
    const marqueeItem = `<span class="item">${esc(band.name)}<sup>${esc((band.genre || '').toUpperCase())}</sup>${logo(band)}</span>`;
    el.innerHTML = `
      <div class="name-marquee" aria-label="${esc(band.name)}">
        <div class="line">${marqueeItem.repeat(6)}</div>
      </div>
      <div class="page-head" style="padding-top:20px">
        <div>
          <div class="eyebrow"><span class="lbl">band studio</span><span class="lbl">since ${esc(band.founded || '')}</span></div>
          <p style="font-size:20px;font-weight:600;max-width:640px">${esc(band.bio || (edit ? '소개를 입력해 주세요.' : ''))}</p>
        </div>
        <div class="page-actions">
          ${edit ? '<button class="btn" id="edit">밴드 정보 수정</button>' : ''}
          ${admin ? '<button class="btn ghost" id="del">밴드 삭제</button>' : ''}
          ${amMember ? '<button class="btn ghost" id="leave" data-ro>밴드 탈퇴</button>' : ''}
        </div>
      </div>
      <div class="stats" style="border-top:1px solid var(--line);margin-bottom:32px">
        <div class="stat"><span class="lbl">members</span><b class="num">${approved.length}</b></div>
        <div class="stat"><span class="lbl">songs</span><b class="num">${songs.length}</b></div>
        <div class="stat"><span class="lbl">rehearsals</span><b class="num">${db().rehearsals.filter((r) => r.bandId === band.id).length}</b></div>
        <div class="stat"><span class="lbl">shows</span><b class="num">${gigs.length}</b></div>
      </div>
      ${songAccordion(band, songs)}
      ${candidateSection(band)}
      <div class="split">
        <section class="section">
          <div class="section-head"><h3>Members</h3><span class="count">${approved.length}</span></div>
          ${edit && pend.length ? `<div class="req-box">
            <div class="lbl" style="margin-bottom:6px">가입 신청 ${pend.length}</div>
            ${pend.map((m) => `<div class="friend-row">
              <span class="avatar">${esc(UI.initials(m.name))}</span>
              <span class="friend-name"><b>${esc(m.name)}</b><span class="muted" style="font-size:12px">${esc(m.part || m.instruments.join(', ') || '—')}</span></span>
              <span class="row" style="gap:6px;flex:0 0 auto"><button class="btn sm solid" data-acc="${m.user_id}">승인</button><button class="btn sm ghost" data-dec="${m.user_id}">거절</button></span>
            </div>`).join('')}
          </div>` : ''}
          ${approved.map((m) => `
            <div class="friend-row">
              <span class="avatar">${esc(UI.initials(m.name))}</span>
              <span class="friend-name"><b>${esc(m.name)} ${m.role === 'leader' ? '<span class="chip ink" style="margin-left:4px">단장</span>' : ''}</b><span class="muted" style="font-size:12px">${esc(m.part || m.instruments.join(', ') || '—')}${m.position ? ' · ' + esc(m.position) : ''}</span></span>
              ${edit ? `<button class="btn sm ghost" data-me="${m.user_id}">편집</button>` : ''}
            </div>`).join('') || '<p class="muted" style="padding:16px 0">아직 밴드원이 없습니다.</p>'}
          ${edit ? '<p class="muted" style="font-size:12px;margin-top:10px">밴드원은 Bands 화면에서 가입 신청 → 여기서 승인하면 추가됩니다.</p>' : ''}
        </section>
        <section class="section">
          <div class="section-head"><h3>Activity Log</h3><span class="count">${band.log.length}</span></div>
          ${edit ? `<form class="row" id="logForm" style="margin-bottom:8px">
            <input type="date" class="input" name="date" value="${Store.iso(new Date())}" style="flex:0 0 150px">
            <input class="input" name="text" placeholder="활동 내용 기록 (예: 신곡 데모 녹음)" style="flex:1 1 200px" required>
            <button class="btn sm solid">기록</button>
          </form>` : ''}
          ${[...band.log].sort((a, b) => b.date.localeCompare(a.date)).map((l) => `
            <div class="log-item"><span class="mono" style="font-size:12px">${esc(l.date)}</span><span>${esc(l.text)}</span>${edit ? `<button class="btn icon ghost" data-log="${l.id}">✕</button>` : '<span></span>'}</div>`).join('') || '<p class="muted">기록이 없습니다.</p>'}
        </section>
      </div>`;

    const on = (sel, fn) => { const x = el.querySelector(sel); if (x) x.onclick = fn; };
    on('#edit', () => bandForm(band));
    on('#del', () => deleteBand(band, () => go('#/bands')));
    on('#leave', () => confirm(`<b>${esc(band.name)}</b>에서 탈퇴할까요?`, async () => {
      try { await Store.Bands.removeMember(band.id, me); toast('탈퇴했습니다'); go('#/bands'); } catch (e) { toast(e.message); }
    }));
    bindSongAccordion(el, band);
    bindCandidates(el, band);
    const act = async (btn, fn, msg) => { btn.disabled = true; try { await fn(); toast(msg); } catch (e) { toast(e.message); btn.disabled = false; } };
    el.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => act(b, () => Store.Bands.respond(band.id, b.dataset.acc, true), '승인했습니다'));
    el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => act(b, () => Store.Bands.respond(band.id, b.dataset.dec, false), '거절했습니다'));
    el.querySelectorAll('[data-me]').forEach((b) => b.onclick = () => {
      const m = approved.find((x) => x.user_id === b.dataset.me);
      modal({
        title: `${m.name} · 밴드원 정보`,
        body: `
          <div class="row">
            <div class="field"><span class="lbl">part</span><input name="part" value="${esc(m.part)}" maxlength="30" list="instList" placeholder="${esc(m.instruments.join(', '))}"><datalist id="instList">${INSTRUMENTS.map((i) => `<option value="${i}">`).join('')}</datalist></div>
            <div class="field"><span class="lbl">position</span><input name="position" value="${esc(m.position)}" maxlength="30" placeholder="총무, 편곡…"></div>
          </div>
          <div class="field"><span class="lbl">role</span><select name="role"><option value="member" ${m.role === 'member' ? 'selected' : ''}>부원</option><option value="leader" ${m.role === 'leader' ? 'selected' : ''}>단장 (밴드 정보 수정·가입 승인 가능)</option></select></div>`,
        extra: m.user_id === me ? '' : '<button type="button" class="btn ghost left" id="kick">밴드에서 내보내기</button>',
        onOpen(f, close) {
          const k = f.querySelector('#kick');
          if (k) k.onclick = () => { close(); confirm(`${esc(m.name)} 님을 밴드에서 내보낼까요?`, async () => { try { await Store.Bands.removeMember(band.id, m.user_id); toast('내보냈습니다'); } catch (e) { toast(e.message); } }); };
        },
        async onSubmit(d) {
          try { await Store.Bands.setMember(band.id, m.user_id, { role: d.role, part: d.part.trim(), position: d.position.trim() }); toast('저장했습니다'); } catch (e) { toast(e.message); return false; }
        },
      });
    });
    const lf = el.querySelector('#logForm');
    if (lf) lf.onsubmit = (e) => {
      e.preventDefault();
      const f = e.target; if (!f.text.value.trim()) return;
      const cur = live('bands', band); if (!cur) return gone();
      cur.log.push({ id: Store.uid(), date: f.date.value, text: f.text.value.trim() });
      Store.save(); App.render();
    };
    el.querySelectorAll('[data-log]').forEach((b) => b.onclick = () => { const cur = live('bands', band); if (!cur) return; cur.log = cur.log.filter((l) => l.id !== b.dataset.log); Store.save(); App.render(); });
  };

  /* ================= SETLIST ================= */
  V.setlistTotal = (sl) => {
    const songs = sl.items.map((i) => Store.song(i.songId)).filter(Boolean);
    const play = songs.reduce((a, s) => a + s.duration, 0);
    const mc = sl.items.reduce((a, i) => a + (Number(i.mc) || 0), 0);
    return play + mc + Math.max(0, songs.length - 1) * (Number(sl.transition) || 0);
  };

  /** iTunes Search API (키 불필요, JSONP로 호출 → file://에서도 동작) */
  function itunesSearch(term) {
    return new Promise((res, rej) => {
      const cb = `__itunes${Date.now()}${Math.floor(Math.random() * 1e4)}`;
      const s = document.createElement('script');
      const done = () => { clearTimeout(timer); window[cb] = () => {}; s.remove(); };
      const timer = setTimeout(() => { done(); rej(new Error('timeout')); }, 8000);
      window[cb] = (data) => { done(); res((data && data.results) || []); };
      s.onerror = () => { done(); rej(new Error('network')); };
      s.src = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=12&country=US&callback=${cb}`;
      document.head.appendChild(s);
    });
  }

  function songForm(band, song, opts = {}) {
    const s = song || { title: '', artist: opts.candidate ? '' : band.name, duration: 210, bpm: 120, difficulty: 3, mood: 'groove', progress: 0 };
    const isCand = song ? song.status === 'candidate' : !!opts.candidate;
    let artwork = s.artwork || '', previewUrl = s.previewUrl || '';
    modal({
      title: song ? (isCand ? '후보곡 수정' : '곡 수정') : (isCand ? '후보곡 추가' : '곡 등록'),
      body: `
        <div class="search-box">
          <span class="lbl">search · iTunes</span>
          <div class="search-row">
            <input class="input" id="q" placeholder="곡명 또는 아티스트로 검색" autocomplete="off" value="${song ? esc(`${s.title} ${s.artist}`) : ''}">
            <button type="button" class="btn sm solid" id="qBtn">검색</button>
          </div>
          <div class="search-res" id="qRes" aria-live="polite"></div>
        </div>
        <div class="field"><span class="lbl">title *</span><input name="title" required value="${esc(s.title)}"></div>
        <div class="field"><span class="lbl">artist</span><input name="artist" value="${esc(s.artist)}"></div>
        <div class="row">
          <div class="field"><span class="lbl">length (m:ss)</span><input name="duration" value="${dur(s.duration)}" pattern="\\d+:\\d{2}"></div>
          <div class="field"><span class="lbl">bpm</span><input name="bpm" type="number" min="30" max="300" value="${s.bpm}"></div>
        </div>
        <div class="row">
          <div class="field"><span class="lbl">difficulty</span><select name="difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === s.difficulty ? 'selected' : ''}>${diff(n)} (${n})</option>`).join('')}</select></div>
          <div class="field"><span class="lbl">mood</span><select name="mood">${Object.entries(MOODS).map(([k, v]) => `<option value="${k}" ${k === s.mood ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="cand-box">
          <label class="row" style="gap:8px;font-weight:700;cursor:pointer"><input type="checkbox" name="candidate" ${isCand ? 'checked' : ''}> 후보곡으로 등록 <span class="muted" style="font-weight:400;font-size:13px">— 멤버 투표 후 확정</span></label>
          <div class="row cand-extra" ${isCand ? '' : 'hidden'} style="margin-top:10px">
            <div class="field"><span class="lbl">proposed by</span><select name="proposedBy"><option value="">—</option>${band.members.map((m) => `<option value="${m.id}" ${m.id === s.proposedBy ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
            <div class="field" style="flex:2 1 200px"><span class="lbl">why this song?</span><input name="reason" value="${esc(s.reason || '')}" placeholder="추천 이유"></div>
          </div>
        </div>`,
      extra: song ? '<button type="button" class="btn ghost left" id="delSong">곡 삭제</button>' : '',
      onOpen(f, close) {
        const q = f.querySelector('#q'), box = f.querySelector('#qRes');
        let results = [];
        const run = async () => {
          const term = q.value.trim();
          if (!term) { q.focus(); return; }
          box.innerHTML = '<p class="search-msg">검색 중…</p>';
          try {
            results = (await itunesSearch(term)).filter((r) => r.trackName);
            box.innerHTML = results.length ? results.map((r, i) => `
              <button type="button" class="search-item" data-i="${i}">
                ${r.artworkUrl100 ? `<img src="${esc(r.artworkUrl100)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
                <span class="si-t"><b>${esc(r.trackName)}</b><small>${esc(r.artistName)}${r.collectionName ? ' · ' + esc(r.collectionName) : ''}</small></span>
                <span class="mono num">${r.trackTimeMillis ? dur(r.trackTimeMillis / 1000) : '—'}</span>
              </button>`).join('') : '<p class="search-msg">검색 결과가 없습니다. 직접 입력해 주세요.</p>';
            box.querySelectorAll('.search-item').forEach((b) => b.onclick = () => {
              const r = results[Number(b.dataset.i)];
              f.title.value = r.trackName;
              f.artist.value = r.artistName || '';
              if (r.trackTimeMillis) f.duration.value = dur(r.trackTimeMillis / 1000);
              artwork = r.artworkUrl100 || '';
              previewUrl = r.previewUrl || '';
              box.querySelectorAll('.search-item').forEach((x) => x.classList.toggle('on', x === b));
              toast('곡 정보를 채웠습니다 · BPM은 직접 입력하세요');
              f.bpm.focus(); f.bpm.select();
            });
          } catch (e) {
            box.innerHTML = '<p class="search-msg">검색에 실패했습니다. 인터넷 연결을 확인하거나 직접 입력해 주세요.</p>';
          }
        };
        f.querySelector('#qBtn').onclick = run;
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
        f.candidate.onchange = () => { f.querySelector('.cand-extra').hidden = !f.candidate.checked; };
        f.title.addEventListener('input', () => { artwork = ''; previewUrl = ''; box.querySelectorAll('.search-item.on').forEach((x) => x.classList.remove('on')); });
        const ds = f.querySelector('#delSong');
        if (ds) ds.onclick = () => {
          close();
          confirm(`「${esc(song.title)}」을(를) 라이브러리와 모든 세트리스트에서 삭제할까요?`, () => {
            const d = db();
            d.songs = d.songs.filter((x) => x.id !== song.id);
            d.setlists.forEach((sl) => sl.items = sl.items.filter((i) => i.songId !== song.id));
            d.tasks.forEach((t) => { if (t.songId === song.id) t.songId = null; });
            Store.save(); App.render();
          });
        };
      },
      onSubmit(dt) {
        if (!dt.title.trim()) { toast('곡명을 입력하세요'); return false; }
        const sec = parseDur(dt.duration);
        if (sec <= 0) { toast('재생 시간을 m:ss 형식으로 입력하세요'); return false; }
        const patch = { title: dt.title.trim(), artist: dt.artist.trim(), duration: sec, bpm: Math.max(30, Number(dt.bpm) || 120), difficulty: Number(dt.difficulty), mood: dt.mood, artwork, previewUrl };
        if (dt.candidate) Object.assign(patch, { status: 'candidate', proposedBy: dt.proposedBy || '', reason: (dt.reason || '').trim() });
        if (song) {
          const cur = live('songs', song); if (!cur) return gone();
          const toCand = dt.candidate && cur.status !== 'candidate';
          Object.assign(cur, patch);
          if (!patch.status) delete cur.status;
          if (toCand) {
            // 후보곡은 세트리스트에 쓸 수 없으므로 들어가 있던 세트리스트에서 뺌
            let n = 0;
            db().setlists.forEach((sl) => { const before = sl.items.length; sl.items = sl.items.filter((i) => i.songId !== cur.id); n += before - sl.items.length; });
            if (n) toast(`후보곡으로 바뀌어 세트리스트 ${n}곳에서 뺐습니다`);
          }
        } else db().songs.push({ id: Store.uid(), bandId: band.id, progress: 0, votes: [], ...patch });
        Store.save(); App.render();
        if (dt.candidate && !song) toast('후보곡에 올렸습니다 · Studio에서 투표하세요');
      },
    });
  }

  let activeSetlistId = null;
  V.setlist = (el) => {
    const band = needBand(el); if (!band) return;
    const d = db();
    const songs = Store.songsOf(band.id);
    const lists = d.setlists.filter((s) => s.bandId === band.id);
    let sl = lists.find((s) => s.id === activeSetlistId) || lists[0];
    if (sl) activeSetlistId = sl.id;

    const libHTML = songs.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>title</th><th class="r">time</th><th class="r">bpm</th><th>lv</th><th></th></tr></thead>
        <tbody>${songs.map((s) => `
          <tr class="lib-row" draggable="true" data-song="${s.id}">
            <td><b>${esc(s.title)}</b><br><span class="muted" style="font-size:12px">${esc(s.artist)}</span> <i class="mood-${s.mood}" style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1px solid var(--ink)"></i></td>
            <td class="r num mono">${dur(s.duration)}</td>
            <td class="r num mono">${s.bpm}</td>
            <td class="dots">${diff(s.difficulty)}</td>
            <td class="r" style="white-space:nowrap"><button class="btn icon sm" data-add="${s.id}" title="세트리스트에 추가" ${sl ? '' : 'disabled'}>＋</button> <button class="btn icon sm ghost" data-edit="${s.id}" title="수정">✎</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="lbl" style="margin-top:8px">↳ drag a row into the setlist →</p>`
      : UI.empty('Songs', '곡 라이브러리가 비어 있습니다.');

    let setHTML;
    if (!sl) {
      setHTML = UI.empty('Setlist', '첫 세트리스트를 만들어보세요.', '<button class="btn solid" id="newSl2">+ 세트리스트 만들기</button>');
    } else {
      const total = V.setlistTotal(sl), limit = (Number(sl.limit) || 0) * 60;
      const over = limit && total > limit;
      // 제한 시간 넘는 곡 표시
      // 곡이 지워진 항목은 건너뛰고, 번호·전환 시간도 실제로 남은 곡 기준으로 계산 (setlistTotal 과 같은 규칙)
      const items = sl.items.map((it) => ({ it, s: Store.song(it.songId) })).filter((x) => x.s).map((x, i) => ({ ...x, i }));
      let acc = 0;
      const cutAt = [];
      items.forEach(({ it, s, i }) => {
        acc += (Number(it.mc) || 0) + s.duration + (i > 0 ? Number(sl.transition) || 0 : 0);
        cutAt[i] = limit && acc > limit;
      });
      setHTML = `
        <div class="row" style="margin-bottom:14px">
          <div class="field" style="flex:2 1 180px;margin:0"><span class="lbl">setlist</span>
            <select class="input" id="slPick" data-ro>${lists.map((l) => `<option value="${l.id}" ${l.id === sl.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
          <div class="field" style="flex:1 1 90px;margin:0"><span class="lbl">limit (min)</span><input class="input" type="number" min="0" id="slLimit" value="${sl.limit}"></div>
          <div class="field" style="flex:1 1 90px;margin:0"><span class="lbl">transition (sec)</span><input class="input" type="number" min="0" step="5" id="slTrans" value="${sl.transition}"></div>
        </div>
        <div class="set-summary">
          <div><span class="lbl">total</span><b class="num">${dur(total)}</b></div>
          <div><span class="lbl">limit</span><b class="num">${limit ? dur(limit) : '—'}</b></div>
          <div><span class="lbl">${over ? 'over by' : 'remaining'}</span><b class="num" style="${over ? 'color:var(--violet)' : ''}">${limit ? dur(Math.abs(limit - total)) : '—'}</b></div>
        </div>
        <div class="limit-bar ${over ? 'over' : ''}"><i style="width:${limit ? Math.min(100, (total / limit) * 100) : 0}%"></i></div>
        ${over ? `<p style="font-weight:700;margin:-8px 0 12px">⚠ 제한 시간을 ${dur(total - limit)} 초과합니다. 흐리게 표시된 곡은 시간 안에 들어가지 못합니다.</p>` : ''}
        <ol class="set-list" id="setList">
          ${items.length ? items.map(({ it, s, i }) => `
            ${i > 0 && Number(sl.transition) ? `<li class="gap-row" aria-hidden="true">transition ${sl.transition}s</li>` : ''}
            <li class="set-item ${cutAt[i] ? 'cut' : ''}" draggable="true" data-item="${it.id}">
              <span class="grip">⋮⋮</span>
              <span class="idx">${String(i + 1).padStart(2, '0')}</span>
              <span class="st-title" style="min-width:0"><span class="t">${esc(s.title)}</span><br><span class="a">${esc(s.artist)} · ${MOODS[s.mood]}</span></span>
              <span class="mono num bpm-c" style="font-size:12px">${s.bpm} bpm</span>
              <label class="mc"><span class="lbl">MC</span><input class="inline-input num" type="number" min="0" step="10" inputmode="numeric" data-mc="${it.id}" value="${it.mc || 0}" title="곡 앞 멘트 시간(초)">s</label>
              <span class="mono num st-dur">${dur(s.duration)}</span>
              <span class="mv"><button type="button" data-up="${it.id}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" data-dn="${it.id}" aria-label="아래로" ${i === items.length - 1 ? 'disabled' : ''}>▼</button></span>
              <button class="btn icon ghost" data-rmi="${it.id}" title="빼기">✕</button>
            </li>`).join('') : '<li class="empty-drop">왼쪽 라이브러리에서 곡을 드래그해 넣으세요</li>'}
        </ol>
        ${items.length ? flowViz(items.map((x) => x.s)) : ''}`;
    }

    el.innerHTML = pageHead(['setlist maker', esc(band.name)], 'SETLIST', 'Maker', `
        ${sl ? '<button class="btn" id="autoFit" title="제한 시간에 맞춰 연습 진행도 높은 곡부터 자동 구성">⚡ 자동 구성</button><button class="btn ghost" id="renSl">이름 변경</button><button class="btn ghost" id="delSl">삭제</button>' : ''}
        <button class="btn solid" id="newSl">+ 세트리스트</button>`) + `
      <div class="split">
        <section class="section">
          <div class="section-head"><h3>Song Library</h3><button class="btn sm solid" id="addSong">+ 곡 등록</button></div>
          ${libHTML}
          ${Store.candidatesOf(band.id).length ? `<p class="lbl" style="margin-top:6px">후보곡 ${Store.candidatesOf(band.id).length}개는 <a href="#/studio">Studio</a>에서 확정하면 여기에 나타납니다</p>` : ''}
        </section>
        <section class="section">
          <div class="section-head"><h3>${sl ? esc(sl.name) : 'Setlist'}</h3><span class="count">${sl ? sl.items.length + ' songs' : ''}</span></div>
          ${setHTML}
        </section>
      </div>`;

    /* ---- events ---- */
    const newSl = () => modal({
      title: '새 세트리스트',
      body: `<div class="field"><span class="lbl">name *</span><input name="name" required placeholder="예: 12월 클럽 공연"></div>
        <div class="row"><div class="field"><span class="lbl">time limit (min)</span><input type="number" name="limit" value="30" min="0"></div>
        <div class="field"><span class="lbl">transition (sec)</span><input type="number" name="transition" value="30" min="0" step="5"></div></div>`,
      submit: '만들기',
      onSubmit(dt) {
        if (!dt.name.trim()) { toast('이름을 입력하세요'); return false; }
        const n = { id: Store.uid(), bandId: band.id, name: dt.name.trim(), limit: Number(dt.limit) || 0, transition: Number(dt.transition) || 0, items: [] };
        db().setlists.push(n); activeSetlistId = n.id; Store.save(); App.render();
      },
    });
    el.querySelector('#newSl').onclick = newSl;
    const ns2 = el.querySelector('#newSl2'); if (ns2) ns2.onclick = newSl;
    el.querySelector('#addSong').onclick = () => songForm(band);
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => songForm(band, Store.song(b.dataset.edit)));
    if (!sl) return;

    const addSong = (songId, index = sl.items.length) => {
      sl.items.splice(index, 0, { id: Store.uid(), songId, mc: 0 });
      Store.save(); App.render();
    };
    el.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => addSong(b.dataset.add));
    el.querySelector('#slPick').onchange = (e) => { activeSetlistId = e.target.value; App.render(); };
    el.querySelector('#slLimit').onchange = (e) => { sl.limit = Math.max(0, Number(e.target.value) || 0); Store.save(); App.render(); };
    el.querySelector('#slTrans').onchange = (e) => { sl.transition = Math.max(0, Number(e.target.value) || 0); Store.save(); App.render(); };
    el.querySelectorAll('[data-mc]').forEach((i) => i.onchange = () => { sl.items.find((x) => x.id === i.dataset.mc).mc = Math.max(0, Number(i.value) || 0); Store.save(); App.render(); });
    el.querySelectorAll('[data-rmi]').forEach((b) => b.onclick = () => { sl.items = sl.items.filter((x) => x.id !== b.dataset.rmi); Store.save(); App.render(); });
    // 터치 기기용 순서 변경 (곡이 지워진 항목은 건너뛰고 화면에 보이는 순서 기준으로 바꿈)
    const move = (id, dir) => {
      const vis = sl.items.filter((x) => Store.song(x.songId));
      const k = vis.findIndex((x) => x.id === id), other = vis[k + dir];
      if (k < 0 || !other) return;
      const a = sl.items.indexOf(vis[k]), b = sl.items.indexOf(other);
      [sl.items[a], sl.items[b]] = [sl.items[b], sl.items[a]];
      Store.save(); App.render();
    };
    el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => move(b.dataset.up, -1));
    el.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => move(b.dataset.dn, 1));
    el.querySelector('#delSl').onclick = () => confirm(`「${esc(sl.name)}」 세트리스트를 삭제할까요?`, () => { Store.remove('setlists', sl.id); activeSetlistId = null; App.render(); });
    el.querySelector('#renSl').onclick = () => modal({
      title: '이름 변경', body: `<div class="field"><span class="lbl">name</span><input name="name" value="${esc(sl.name)}"></div>`,
      onSubmit(dt) {
        if (!dt.name.trim()) return;
        const cur = live('setlists', sl); if (!cur) return gone();
        cur.name = dt.name.trim(); Store.save(); App.render();
      },
    });
    el.querySelector('#autoFit').onclick = () => {
      const limit = (Number(sl.limit) || 0) * 60;
      if (!limit) { toast('먼저 제한 시간을 입력하세요'); return; }
      const pool = [...songs].sort((a, b) => b.progress - a.progress || a.difficulty - b.difficulty);
      const pick = []; let t = 0;
      for (const s of pool) {
        const add = s.duration + (pick.length ? Number(sl.transition) || 0 : 0);
        if (t + add <= limit) { pick.push(s); t += add; }
      }
      // 흐름: 에너지 있게 시작 → 중반 잔잔 → 피크로 마무리
      const energy = (s) => s.bpm + (s.mood === 'hype' ? 30 : s.mood === 'groove' ? 10 : s.mood === 'ballad' ? -20 : -10);
      const sorted = [...pick].sort((a, b) => energy(b) - energy(a));
      const opener = sorted.splice(1, 1)[0], closer = sorted.shift();
      const middle = sorted.sort((a, b) => energy(a) - energy(b));
      const order = [opener, ...middle.slice(0, Math.ceil(middle.length / 2)).reverse(), ...middle.slice(Math.ceil(middle.length / 2)), closer].filter(Boolean);
      sl.items = order.map((s) => ({ id: Store.uid(), songId: s.id, mc: 0 }));
      Store.save(); App.render();
      toast(`${order.length}곡 · ${dur(V.setlistTotal(sl))}로 구성했습니다`);
    };

    /* ---- drag & drop ---- */
    const list = el.querySelector('#setList');
    let dragItem = null;
    el.querySelectorAll('.lib-row').forEach((r) => r.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/song', r.dataset.song); e.dataTransfer.effectAllowed = 'copy';
    }));
    list.querySelectorAll('.set-item').forEach((li) => {
      li.addEventListener('dragstart', (e) => { dragItem = li.dataset.item; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/item', dragItem); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragItem = null; });
    });
    const clearMarks = () => list.querySelectorAll('.over-top,.over-bottom').forEach((x) => x.classList.remove('over-top', 'over-bottom'));
    const targetIndex = (e) => {
      const lis = [...list.querySelectorAll('.set-item')];
      for (let i = 0; i < lis.length; i++) {
        const r = lis[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) return { i, li: lis[i], top: true };
      }
      return { i: lis.length, li: lis[lis.length - 1], top: false };
    };
    list.addEventListener('dragover', (e) => {
      e.preventDefault(); list.classList.add('drop-hot'); clearMarks();
      const t = targetIndex(e); if (t.li) t.li.classList.add(t.top ? 'over-top' : 'over-bottom');
    });
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) { list.classList.remove('drop-hot'); clearMarks(); } });
    list.addEventListener('drop', (e) => {
      e.preventDefault(); list.classList.remove('drop-hot'); clearMarks();
      const { i } = targetIndex(e);
      const songId = e.dataTransfer.getData('text/song');
      if (songId) return addSong(songId, i);
      const itemId = e.dataTransfer.getData('text/item');
      if (itemId) {
        const from = sl.items.findIndex((x) => x.id === itemId);
        if (from < 0) return;
        const [moved] = sl.items.splice(from, 1);
        sl.items.splice(from < i ? i - 1 : i, 0, moved);
        Store.save(); App.render();
      }
    });
  };

  function flowViz(songs) {
    const max = Math.max(...songs.map((s) => s.bpm), 160), min = 50;
    const cols = songs.map((s) => `${s.duration}fr`).join(' ');
    return `
      <div class="flow" style="margin-top:20px">
        <div class="row" style="justify-content:space-between;margin-bottom:22px"><span class="lbl" style="color:var(--lime)">show flow · bpm × time</span><span class="lbl">width = song length</span></div>
        <div class="flow-bars" style="grid-template-columns:${cols}">
          ${songs.map((s) => `<div class="flow-bar mood-${s.mood}" style="height:${Math.max(8, ((s.bpm - min) / (max - min)) * 100)}%" title="${esc(s.title)} · ${s.bpm} BPM"><span>${s.bpm}</span></div>`).join('')}
        </div>
        <div class="flow-axis" style="grid-template-columns:${cols}">${songs.map((s, i) => `<div title="${esc(s.title)}">${i + 1}. ${esc(s.title)}</div>`).join('')}</div>
        <div class="legend">${Object.entries(MOODS).map(([k, v]) => `<span><i class="mood-${k}"></i>${v}</span>`).join('')}</div>
      </div>`;
  }

  /* ================= REHEARSAL ================= */
  let calendar = null, calView = 'timeGridWeek';
  const TIME_PRESETS = [['오전', '10:00', '13:00'], ['오후', '14:00', '17:00'], ['저녁', '19:00', '22:00'], ['심야', '22:00', '23:59']];
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  function rehearsalForm(band, reh, preset = {}) {
    const r = reh || { date: Store.iso(new Date()), start: '19:00', end: '22:00', place: '', notes: '', attendance: {}, ...preset };
    const places = [...new Set(db().rehearsals.filter((x) => x.bandId === band.id).map((x) => x.place).filter(Boolean))];
    const att = { ...r.attendance };
    modal({
      title: reh ? '합주 수정' : '합주 등록',
      body: `
        <div class="time-box">
          <div class="row">
            <div class="field" style="flex:1.3 1 150px"><span class="lbl">date *</span><input type="date" name="date" value="${r.date}" required></div>
            <div class="field"><span class="lbl">start *</span><input type="time" name="start" step="600" value="${r.start}" required></div>
            <div class="field"><span class="lbl">end *</span><input type="time" name="end" step="600" value="${r.end}" required></div>
          </div>
          <div class="row" style="gap:6px;justify-content:space-between">
            <span class="row" style="gap:6px">${TIME_PRESETS.map(([n, s, e]) => `<button type="button" class="btn sm" data-preset="${s}-${e}">${n} ${s.slice(0, 2)}–${e === '23:59' ? '24' : e.slice(0, 2)}</button>`).join('')}</span>
            <b class="mono" id="durLbl"></b>
          </div>
        </div>
        <div class="field"><span class="lbl">place / studio</span><input name="place" value="${esc(r.place)}" list="placeList" placeholder="연습실 이름"><datalist id="placeList">${places.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
        <div class="field"><span class="lbl">attendance</span>
          ${band.members.map((m) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)">
            <span><b>${esc(m.name)}</b> <span class="muted">${esc(m.instrument)}</span></span>
            <span class="attend" data-m="${m.id}">${['yes', 'maybe', 'no'].map((k) => `<button type="button" class="${k} ${att[m.id] === k ? 'on' : ''}" data-v="${k}">${{ yes: '참석', maybe: '미정', no: '불참' }[k]}</button>`).join('')}</span>
          </div>`).join('') || '<p class="muted">멤버를 먼저 추가하세요</p>'}
        </div>
        <div class="field"><span class="lbl">memo</span><textarea name="notes">${esc(r.notes)}</textarea></div>`,
      extra: reh ? '<button type="button" class="btn ghost left" id="delReh">삭제</button>' : '',
      onOpen(f, close) {
        const showDur = () => {
          const m = UI.parseHm(f.end.value) - UI.parseHm(f.start.value);
          f.querySelector('#durLbl').textContent = f.start.value && f.end.value ? (m > 0 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : '⚠ 종료가 시작보다 빨라요') : '';
        };
        f.start.addEventListener('input', showDur);
        f.end.addEventListener('input', showDur);
        f.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => {
          [f.start.value, f.end.value] = b.dataset.preset.split('-');
          showDur();
        });
        showDur();
        f.querySelectorAll('.attend').forEach((g) => g.querySelectorAll('button').forEach((b) => b.onclick = () => {
          att[g.dataset.m] = att[g.dataset.m] === b.dataset.v ? undefined : b.dataset.v;
          g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === att[g.dataset.m]));
        }));
        const del = f.querySelector('#delReh');
        if (del) del.onclick = () => { Store.remove('rehearsals', reh.id); close(); App.render(); };
      },
      onSubmit(dt) {
        if (!dt.date || !dt.start || !dt.end) { toast('날짜와 시작·종료 시간을 모두 입력하세요'); return false; }
        if (dt.end <= dt.start) { toast('종료 시간이 시작보다 늦어야 합니다'); return false; }
        Object.keys(att).forEach((k) => att[k] === undefined && delete att[k]);
        const patch = { date: dt.date, start: dt.start, end: dt.end, place: dt.place.trim(), notes: dt.notes.trim(), attendance: att };
        if (reh) { const cur = live('rehearsals', reh); if (!cur) return gone(); Object.assign(cur, patch); } else db().rehearsals.push({ id: Store.uid(), bandId: band.id, ...patch });
        Store.save(); App.render();
      },
    });
  }

  function gigForm(band, gig) {
    const g = gig || { date: Store.iso(new Date()), title: '', venue: '', notes: '', photos: [] };
    let photos = [...g.photos];
    const thumbs = () => photos.map((p, i) => `<div style="position:relative"><img src="${esc(p)}" alt=""><button type="button" class="btn icon sm" data-rp="${i}" style="position:absolute;top:2px;right:2px;background:var(--paper)">✕</button></div>`).join('');
    modal({
      title: gig ? '공연 기록 수정' : '공연 기록 추가',
      body: `
        <div class="field"><span class="lbl">show title *</span><input name="title" value="${esc(g.title)}" required></div>
        <div class="row"><div class="field"><span class="lbl">date</span><input type="date" name="date" value="${g.date}"></div>
        <div class="field"><span class="lbl">venue</span><input name="venue" value="${esc(g.venue)}"></div></div>
        <div class="field"><span class="lbl">notes</span><textarea name="notes">${esc(g.notes)}</textarea></div>
        <div class="field"><span class="lbl">photos</span><input type="file" accept="image/*" multiple id="ph"><div class="photos" id="phs">${thumbs()}</div></div>`,
      extra: gig ? '<button type="button" class="btn ghost left" id="delGig">삭제</button>' : '',
      onOpen(f, close) {
        const box = f.querySelector('#phs');
        const bind = () => box.querySelectorAll('[data-rp]').forEach((b) => b.onclick = () => { photos.splice(Number(b.dataset.rp), 1); box.innerHTML = thumbs(); bind(); });
        bind();
        f.querySelector('#ph').onchange = async (e) => {
          for (const file of e.target.files) photos.push(await UI.readImage(file, 900));
          box.innerHTML = thumbs(); bind();
        };
        const del = f.querySelector('#delGig');
        if (del) del.onclick = () => { Store.remove('gigs', gig.id); close(); App.render(); };
      },
      onSubmit(dt) {
        if (!dt.title.trim()) { toast('공연 이름을 입력하세요'); return false; }
        const patch = { date: dt.date, title: dt.title.trim(), venue: dt.venue.trim(), notes: dt.notes.trim(), photos };
        if (gig) { const cur = live('gigs', gig); if (!cur) return gone(); Object.assign(cur, patch); } else db().gigs.push({ id: Store.uid(), bandId: band.id, ...patch });
        Store.save(); App.render();
      },
    });
  }

  V.rehearsal = (el) => {
    const band = needBand(el); if (!band) return;
    const d = db(), today = Store.iso(new Date());
    const rehs = d.rehearsals.filter((r) => r.bandId === band.id).sort((a, b) => a.date.localeCompare(b.date));
    const gigs = d.gigs.filter((g) => g.bandId === band.id).sort((a, b) => b.date.localeCompare(a.date));
    const upcoming = rehs.filter((r) => r.date >= today);
    const past = rehs.filter((r) => r.date < today);
    const hours = past.reduce((a, r) => a + Math.max(0, UI.parseHm(r.end) - UI.parseHm(r.start)) / 60, 0);
    const memberRate = band.members.map((m) => {
      const marked = past.filter((r) => r.attendance[m.id]);
      const yes = marked.filter((r) => r.attendance[m.id] === 'yes').length;
      return { m, rate: marked.length ? Math.round((yes / marked.length) * 100) : null };
    });
    const placeCount = {};
    rehs.forEach((r) => { if (r.place) placeCount[r.place] = (placeCount[r.place] || 0) + 1; });

    el.innerHTML = pageHead(['band manager', esc(band.name)], 'REHEARSAL', 'Schedule', `
      <button class="btn" id="addGig">+ 공연 기록</button><button class="btn solid" id="addReh">+ 합주 등록</button>`) + `
      <div class="stats" style="border-top:1px solid var(--line);margin-bottom:32px">
        <div class="stat"><span class="lbl">rehearsals done</span><b class="num">${past.length}</b></div>
        <div class="stat"><span class="lbl">hours played</span><b class="num">${hours.toFixed(1)}</b></div>
        <div class="stat"><span class="lbl">upcoming</span><b class="num">${upcoming.length}</b></div>
        <div class="stat"><span class="lbl">shows played</span><b class="num">${gigs.length}</b></div>
      </div>
      <div class="split split-cal">
        <section class="section">
          <div class="cal-wrap"><div id="cal"></div></div>
          <p class="cal-hint">주간 보기에서 <b>시간대를 끌어서 선택</b>하면 그 시간으로 합주가 등록돼요 · 일정 블록을 <b>끌어서 날짜·시간 이동</b>, 아래 끝을 끌어서 길이 조절 · 클릭하면 수정 · <span class="gig-key">흰 블록</span> = 공연</p>
        </section>
        <section>
          <div class="section">
            <div class="section-head"><h3>Upcoming</h3><span class="count">${upcoming.length}</span></div>
            ${upcoming.map((r) => {
              const yes = band.members.filter((m) => r.attendance[m.id] === 'yes').length;
              return `<div class="gig-card" style="cursor:pointer" data-reh="${r.id}">
                <div class="row" style="justify-content:space-between"><b style="font-size:20px">${dateKo(r.date)}</b><span class="chip ${yes === band.members.length ? 'lime' : ''}">${yes}/${band.members.length} 참석</span></div>
                <p>${esc(r.start)}–${esc(r.end)} · ${esc(r.place || '장소 미정')}</p>
                ${r.notes ? `<p class="muted" style="font-size:13px">${esc(r.notes)}</p>` : ''}
              </div>`;
            }).join('') || '<p class="muted">예정된 합주가 없습니다.</p>'}
          </div>
          <div class="section">
            <div class="section-head"><h3>Attendance Rate</h3><span class="count">past</span></div>
            <div class="bars-h">${memberRate.map(({ m, rate }) => `<div class="bh"><span>${esc(m.name)}</span><div class="prog-bar ${rate === 100 ? 'done' : ''}"><i style="width:${rate || 0}%"></i></div><span class="mono num">${rate === null ? '—' : rate + '%'}</span></div>`).join('')}</div>
          </div>
          <div class="section">
            <div class="section-head"><h3>Places</h3><span class="count">${Object.keys(placeCount).length}</span></div>
            ${Object.entries(placeCount).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line-soft)"><span>${esc(p)}</span><span class="mono">${n}회</span></div>`).join('') || '<p class="muted">기록된 장소가 없습니다.</p>'}
          </div>
        </section>
      </div>
      <section class="section">
        <div class="section-head"><h3>Show History</h3><span class="count">${gigs.length}</span></div>
        <div class="grid-2">${gigs.map((g) => `
          <div class="gig-card" data-gig="${g.id}" style="cursor:pointer">
            <span class="lbl">${esc(g.date)} · ${esc(g.venue)}</span>
            <h4>${esc(g.title)}</h4>
            ${g.notes ? `<p>${esc(g.notes)}</p>` : ''}
            ${g.photos.length ? `<div class="photos">${g.photos.map((p) => `<img src="${esc(p)}" alt="">`).join('')}</div>` : ''}
          </div>`).join('') || '<p class="muted">아직 공연 기록이 없습니다.</p>'}</div>
      </section>`;

    const edit = canEdit(band); // 부원은 보기만
    if (edit) {
      el.querySelector('#addReh').onclick = () => rehearsalForm(band);
      el.querySelector('#addGig').onclick = () => gigForm(band);
      el.querySelectorAll('[data-reh]').forEach((c) => c.onclick = () => rehearsalForm(band, rehs.find((r) => r.id === c.dataset.reh)));
      el.querySelectorAll('[data-gig]').forEach((c) => c.onclick = () => gigForm(band, gigs.find((g) => g.id === c.dataset.gig)));
    } else el.querySelectorAll('[data-reh],[data-gig]').forEach((c) => { c.style.cursor = 'default'; });

    const calEl = el.querySelector('#cal');
    const events = [
      ...rehs.map((r) => ({ id: 'r:' + r.id, title: `합주 · ${r.place || '장소 미정'}`, start: `${r.date}T${r.start || '00:00'}`, end: r.end ? `${r.date}T${r.end}` : undefined })),
      ...gigs.map((g) => ({ id: 'g:' + g.id, title: `🎤 ${g.title}`, start: g.date, allDay: true, classNames: ['gig'], editable: false })),
    ];
    // 캘린더에서 끌어서 날짜/시간 변경
    const moveEvent = (info) => {
      const [type, id] = info.event.id.split(':');
      const r = rehs.find((x) => x.id === id);
      const st = info.event.start, en = info.event.end || new Date(st.getTime() + 3 * 3600e3);
      if (type !== 'r' || !r || info.event.allDay || Store.iso(st) !== Store.iso(new Date(en.getTime() - 1))) { info.revert(); toast('합주는 하루 안의 시간으로만 옮길 수 있어요'); return; }
      Object.assign(r, { date: Store.iso(st), start: hhmm(st), end: en.getHours() === 0 && en.getMinutes() === 0 ? '23:59' : hhmm(en) });
      Store.save(); App.render();
      toast(`${UI.dateKo(r.date)} ${r.start}–${r.end}로 변경했습니다`);
    };
    if (window.FullCalendar) {
      const initialDate = calendar ? calendar.getDate() : undefined;
      if (calendar) { try { calendar.destroy(); } catch (e) { /* 이미 DOM에서 빠짐 */ } calendar = null; } // 리스너 누수 방지
      // 폰에서는 7일 주간 보기가 너무 좁아 3일 보기를 기본으로, 버튼은 아래 줄로
      const narrow = window.matchMedia('(max-width: 600px)').matches;
      const weekView = narrow ? 'timeGrid3' : 'timeGridWeek';
      const view0 = calView === 'timeGridWeek' || calView === 'timeGrid3' ? weekView : calView;
      calendar = new FullCalendar.Calendar(calEl, {
        initialView: view0, initialDate, locale: 'ko', height: 'auto', firstDay: 1,
        views: { timeGrid3: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3일' } },
        headerToolbar: narrow
          ? { left: 'prev,next', center: 'title', right: 'today' }
          : { left: 'prev,next today', center: 'title', right: 'timeGridWeek,dayGridMonth,listMonth' },
        footerToolbar: narrow ? { center: 'timeGrid3,dayGridMonth,listMonth' } : false,
        ...(narrow ? { dayHeaderFormat: { weekday: 'short', day: 'numeric' } } : {}),
        selectLongPressDelay: 350, eventLongPressDelay: 350, // 터치: 길게 누르는 시간 단축
        buttonText: { today: '오늘', week: '주', month: '월', list: '목록' },
        allDayText: '공연', slotMinTime: '08:00:00', slotMaxTime: '24:00:00', scrollTime: '17:00:00',
        slotDuration: '00:30:00', snapDuration: '00:10:00', nowIndicator: true, expandRows: true,
        slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
        events, eventDisplay: 'block', displayEventTime: true,
        editable: edit, selectable: edit, selectMirror: true,
        datesSet: (info) => { calView = info.view.type; },
        select: (info) => {
          calendar.unselect();
          if (info.allDay) { rehearsalForm(band, null, { date: info.startStr.slice(0, 10) }); return; }
          const st = info.start;
          let en = info.end;
          if (en - st <= 30 * 60e3) en = new Date(st.getTime() + 3 * 3600e3); // 클릭만 하면 3시간 기본
          const sameDay = Store.iso(st) === Store.iso(new Date(en.getTime() - 1));
          rehearsalForm(band, null, { date: Store.iso(st), start: hhmm(st), end: sameDay && hhmm(en) !== '00:00' ? hhmm(en) : '23:59' });
        },
        eventDrop: moveEvent,
        eventResize: moveEvent,
        eventClick: (info) => {
          if (!edit) return;
          const [type, id] = info.event.id.split(':');
          if (type === 'r') rehearsalForm(band, rehs.find((r) => r.id === id));
          else gigForm(band, gigs.find((g) => g.id === id));
        },
      });
      calendar.render();
    } else {
      calEl.innerHTML = `<p class="muted">캘린더를 불러오지 못했습니다 (오프라인). 오른쪽 목록을 이용하세요.</p>`;
    }
  };

  /* ================= PROGRESS ================= */
  V.progress = (el) => {
    const band = needBand(el); if (!band) return;
    const d = db();
    const songs = Store.songsOf(band.id).sort((a, b) => a.progress - b.progress);
    const tasks = d.tasks.filter((t) => t.bandId === band.id);
    const avg = songs.length ? Math.round(songs.reduce((a, s) => a + s.progress, 0) / songs.length) : 0;
    const ready = songs.filter((s) => s.progress >= 100).length;
    el.innerHTML = pageHead(['band manager', esc(band.name)], 'PRACTICE', 'Progress', `<button class="btn solid" id="addTask">+ 연습 과제</button>`) + `
      <div class="stats" style="border-top:1px solid var(--line);margin-bottom:32px">
        <div class="stat"><span class="lbl">average</span><b class="num">${avg}%</b></div>
        <div class="stat"><span class="lbl">stage ready</span><b class="num">${ready}/${songs.length}</b></div>
        <div class="stat"><span class="lbl">open tasks</span><b class="num">${tasks.filter((t) => !t.done).length}</b></div>
        <div class="stat"><span class="lbl">done tasks</span><b class="num">${tasks.filter((t) => t.done).length}</b></div>
      </div>
      <section class="section">
        <div class="section-head"><h3>Songs</h3><span class="count">drag the slider · 100% = stage ready</span></div>
        ${songs.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>title</th><th class="hide-sm">lv</th><th style="width:45%">progress</th><th class="r">%</th></tr></thead>
          <tbody>${songs.map((s) => `<tr>
            <td><b>${esc(s.title)}</b> <span class="muted" style="font-size:12px">${esc(s.artist)}</span></td>
            <td class="dots hide-sm">${diff(s.difficulty)}</td>
            <td><div class="prog"><input type="range" min="0" max="100" step="5" value="${s.progress}" data-p="${s.id}" aria-label="${esc(s.title)} 진행도"></div></td>
            <td class="r mono num" data-pv="${s.id}">${s.progress}%${s.progress >= 100 ? ' ✓' : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : UI.empty('Songs', 'Setlist 화면에서 곡을 먼저 등록하세요.', '<a class="btn solid" href="#/setlist">곡 등록하러 가기</a>')}
      </section>
      <section class="section">
        <div class="section-head"><h3>Member Tasks</h3><span class="count">${tasks.length}</span></div>
        <div class="grid-${band.members.length >= 3 ? 3 : 2}">
          ${band.members.map((m) => {
            const mt = tasks.filter((t) => t.memberId === m.id);
            return `<div class="member-col">
              <h4><span class="avatar">${esc(UI.initials(m.name))}</span>${esc(m.name)} <span class="chip">${esc(m.instrument)}</span></h4>
              ${mt.map((t) => {
                const s = t.songId && Store.song(t.songId);
                return `<label class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-t="${t.id}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}${s ? ` <span class="chip" style="font-size:10px">${esc(s.title)}</span>` : ''}</span><button type="button" class="btn icon ghost sm" data-rt="${t.id}">✕</button></label>`;
              }).join('') || '<p class="muted" style="font-size:13px">과제 없음</p>'}
              <button class="btn sm ghost" data-at="${m.id}" style="margin-top:6px">+ 과제 추가</button>
            </div>`;
          }).join('')}
        </div>
      </section>`;

    el.querySelectorAll('[data-p]').forEach((r) => {
      r.oninput = () => { el.querySelector(`[data-pv="${r.dataset.p}"]`).textContent = r.value + '%' + (r.value >= 100 ? ' ✓' : ''); };
      r.onchange = () => { Store.song(r.dataset.p).progress = Number(r.value); Store.save(); };
    });
    el.querySelectorAll('[data-t]').forEach((c) => c.onchange = () => { d.tasks.find((t) => t.id === c.dataset.t).done = c.checked; Store.save(); App.render(); });
    el.querySelectorAll('[data-rt]').forEach((b) => b.onclick = (e) => { e.preventDefault(); Store.remove('tasks', b.dataset.rt); App.render(); });
    const taskForm = (memberId) => modal({
      title: '연습 과제 추가',
      body: `
        <div class="field"><span class="lbl">member</span><select name="memberId">${band.members.map((m) => `<option value="${m.id}" ${m.id === memberId ? 'selected' : ''}>${esc(m.name)} (${esc(m.instrument)})</option>`).join('')}</select></div>
        <div class="field"><span class="lbl">song (optional)</span><select name="songId"><option value="">— 없음 —</option>${Store.songsOf(band.id).map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></div>
        <div class="field"><span class="lbl">task *</span><input name="text" required placeholder="예: 후렴 코러스 화음 연습"></div>`,
      submit: '추가',
      onSubmit(dt) {
        if (!dt.text.trim() || !dt.memberId) { toast('과제 내용을 입력하세요'); return false; }
        db().tasks.push({ id: Store.uid(), bandId: band.id, memberId: dt.memberId, songId: dt.songId || null, text: dt.text.trim(), done: false });
        Store.save(); App.render();
      },
    });
    el.querySelector('#addTask').onclick = () => band.members.length ? taskForm() : toast('먼저 멤버를 추가하세요');
    el.querySelectorAll('[data-at]').forEach((b) => b.onclick = () => taskForm(b.dataset.at));
  };

  V.pageHead = pageHead;
})();
