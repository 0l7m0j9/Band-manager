/* =========================================================
   Views — 로그인 / 회원가입 / 가입 정보 / 계정 · 그룹 회원 관리 / 예전 데이터 가져오기
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast, INSTRUMENTS } = UI;
  const V = window.Views;
  const A = Store.Auth, G = Store.Group;

  const head = (tech, title, actions = '', eyebrow = ['account']) => `
    <div class="page-head">
      <div>
        <div class="eyebrow">${eyebrow.map((e) => `<span class="lbl">${e}</span>`).join('')}</div>
        <h1 class="page-title"><span class="tech">${tech}</span>${title}</h1>
      </div>
      <div class="page-actions">${actions}</div>
    </div>`;

  /* ---------- 가입 정보 입력칸 (회원가입·첫 입장·내 정보 수정 공통) ---------- */
  function profileFields(p = {}, { group = true, groups = [] } = {}) {
    const mine = p.instruments || [];
    const extra = mine.filter((i) => !INSTRUMENTS.includes(i));
    return `
      <div class="field"><span class="lbl">이름 *</span><input name="pname" maxlength="30" value="${esc(p.name || '')}" placeholder="실명" autocomplete="name"></div>
      <div class="field"><span class="lbl">악기 (여러 개 선택)</span>
        <div class="pick-grid">${INSTRUMENTS.map((i) => `<label class="pick"><input type="checkbox" name="inst" value="${i}" ${mine.includes(i) ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>
        <input name="instExtra" maxlength="60" value="${esc(extra.join(', '))}" placeholder="그 밖의 악기 (쉼표로 구분)" style="margin-top:8px">
      </div>
      <div class="field"><span class="lbl">전화번호</span><input name="phone" type="tel" inputmode="tel" maxlength="20" value="${esc(p.phone || '')}" placeholder="010-0000-0000" autocomplete="tel">
        <span class="muted" style="font-size:12px">관리자와 본인만 볼 수 있습니다</span></div>
      ${group ? `<div class="field"><span class="lbl">그룹 *</span><select name="group">${groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('') || '<option value="">불러오는 중…</option>'}</select></div>` : ''}`;
  }
  function readProfile(f, { group = true } = {}) {
    const inst = [...f.querySelectorAll('input[name=inst]:checked')].map((x) => x.value)
      .concat(f.instExtra.value.split(',').map((s) => s.trim()).filter(Boolean));
    const info = { name: f.pname.value.trim(), instruments: [...new Set(inst)], phone: f.phone.value.trim(), groupId: group ? f.group.value : null };
    if (!info.name) throw new Error('이름을 입력하세요');
    if (info.phone && !/^[0-9+\- ]{7,20}$/.test(info.phone)) throw new Error('전화번호 형식이 올바르지 않습니다');
    if (group && !info.groupId) throw new Error('그룹을 선택하세요');
    return info;
  }

  /* ---------------- 로그인 / 회원가입 창 ---------------- */
  function authModal(mode = 'login') {
    let cur = mode;
    const body = `
      <div class="auth-tabs" role="tablist">
        <button type="button" class="btn sm" data-mode="login">로그인</button>
        <button type="button" class="btn sm" data-mode="signup">회원가입</button>
      </div>
      <div class="field"><span class="lbl">아이디</span><input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="80" placeholder="영문 소문자·숫자·_ 3~20자" required></div>
      <div class="field"><span class="lbl">비밀번호</span><input name="password" type="password" minlength="6" autocomplete="current-password" required></div>
      <div class="signup-only">
        <div class="field"><span class="lbl">비밀번호 확인</span><input name="password2" type="password" autocomplete="new-password"></div>
        <div class="signup-profile"></div>
      </div>
      <p class="muted auth-note" style="font-size:13px"></p>`;
    modal({
      title: '계정', body, submit: '확인',
      async onOpen(f) {
        const set = (m) => {
          cur = m;
          f.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('solid', b.dataset.mode === m));
          f.querySelector('.signup-only').style.display = m === 'signup' ? '' : 'none';
          f.querySelector('[name=password]').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
          f.querySelector('.modal-head h3').textContent = m === 'signup' ? '회원가입' : '로그인';
          f.querySelector('button[type=submit]').textContent = m === 'signup' ? '가입하기' : '로그인';
          f.querySelector('.auth-note').textContent = m === 'signup'
            ? '가입하면 그룹에 바로 참여하고, 밴드는 단장의 승인을 받아 참여합니다.'
            : '예전에 이메일로 가입했다면 이메일 주소로 로그인하세요.';
        };
        f.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => set(b.dataset.mode)));
        f.querySelector('.signup-profile').innerHTML = profileFields({}, { groups: G.all });
        set(cur);
        const groups = await G.loadAll();
        const sel = f.querySelector('select[name=group]');
        if (sel) sel.innerHTML = groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
      },
      async onSubmit(d, f) {
        const id = d.username.trim().toLowerCase(), pw = d.password;
        if (!id || !pw) { toast('아이디와 비밀번호를 입력하세요'); return false; }
        if (pw.length < 6) { toast('비밀번호는 6자 이상이어야 합니다'); return false; }
        let info = null;
        if (cur === 'signup') {
          if (id.includes('@')) { toast('회원가입은 이메일이 아닌 아이디로 합니다'); return false; }
          if (!A.USERNAME_RE.test(id)) { toast('아이디는 영문 소문자·숫자·_ 3~20자로 입력하세요'); return false; }
          if (pw !== d.password2) { toast('비밀번호 확인이 일치하지 않습니다'); return false; }
          try { info = readProfile(f); } catch (e) { toast(e.message); return false; }
        }
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          if (cur === 'signup') { await A.signUp(id, pw, info); toast(`환영합니다, ${info.name}님!`); }
          else { await A.signIn(id, pw); toast(`${(A.profile || {}).name || ''}님, 로그인되었습니다`); }
          location.hash = '#/home';
        } catch (e) { toast(e.message); btn.disabled = false; return false; }
      },
    });
  }
  V.authModal = authModal;

  /* ---------------- 로그인 전 첫 화면 ---------------- */
  V.landing = (el) => {
    el.innerHTML = `
      <section class="hero">
        <div class="hero-title">
          <span class="tech">THE BAND</span>
          <span class="wave">Manager</span>
        </div>
        <p class="hero-sub">우리 학교 밴드의 곡·세트리스트·합주·연습실·공연을 한 곳에서.</p>
        <div class="row" style="justify-content:center;margin-top:28px">
          ${A.failed ? '<button class="btn solid" id="retry">다시 연결</button>'
            : A.ready ? '<button class="btn solid" id="li">로그인</button><button class="btn" id="su">회원가입</button>'
            : '<span class="muted">서버에 연결하는 중…</span>'}
        </div>
      </section>`;
    const on = (s, fn) => { const x = el.querySelector(s); if (x) x.onclick = fn; };
    on('#li', () => authModal('login'));
    on('#su', () => authModal('signup'));
    on('#retry', () => location.reload());
  };

  /* ---------------- 첫 입장: 가입 정보 + 그룹 ---------------- */
  V.welcome = (el) => {
    const p = A.profile || {};
    const needGroup = !G.list.length;
    el.innerHTML = head('WELCOME', '가입 정보', '', ['account', 'profile']) + `
      <form class="section" id="wf" style="max-width:560px">
        <p class="muted" style="margin-bottom:18px">밴드 활동에 필요한 정보를 입력해 주세요. 나중에 Account에서 바꿀 수 있습니다.</p>
        ${profileFields({ ...p, name: p.full_name || '' }, { group: needGroup, groups: G.all })}
        <div class="row" style="margin-top:8px"><button class="btn solid">시작하기</button><button type="button" class="btn ghost" id="lo">로그아웃</button></div>
      </form>`;
    const f = el.querySelector('#wf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      let info; try { info = readProfile(f, { group: needGroup }); } catch (er) { toast(er.message); return; }
      const btn = f.querySelector('button.solid'); btn.disabled = true;
      try { await A.saveProfile(info); toast('환영합니다!'); location.hash = '#/home'; } catch (er) { toast(er.message); btn.disabled = false; }
    };
    el.querySelector('#lo').onclick = () => A.signOut();
    if (needGroup && !G.all.length) G.loadAll().then(() => { if (el.isConnected) V.welcome(el); });
  };

  /* ---------------- 계정 화면 ---------------- */
  V.account = (el) => {
    const p = A.profile;
    const admin = G.isAdmin, me = A.user.id;
    const joinable = G.all.filter((g) => !G.list.some((x) => x.id === g.id));
    const roster = G.roster;
    el.innerHTML = head('HELLO', esc(p.name), '<button class="btn" id="logout">로그아웃</button>', ['account', '@' + esc(p.username)]) + `
      <div class="split">
        <section class="section">
          <div class="section-head"><h3>My Profile</h3></div>
          <form id="pf">
            ${profileFields(p, { group: false })}
            <button class="btn solid">저장</button>
          </form>
        </section>
        <section class="section">
          <div class="section-head"><h3>Groups</h3><span class="count">${G.list.length}</span></div>
          ${G.list.map((g) => `<div class="friend-row">
            <span class="avatar">${esc(UI.initials(g.name))}</span>
            <span class="friend-name"><b>${esc(g.name)}</b><span class="muted" style="font-size:12px">${g.role === 'admin' ? '관리자' : '회원'}</span></span>
            ${g.id === G.id ? '<span class="chip ink">현재</span>' : `<button class="btn sm" data-sw="${g.id}">이 그룹 보기</button>`}
          </div>`).join('')}
          ${joinable.length ? `<form class="row" id="jf" style="margin-top:12px"><select class="input" name="g" style="flex:1 1 180px">${joinable.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select><button class="btn sm">그룹 참여</button></form>` : ''}
          <div class="section-head" style="margin-top:28px"><h3>Old Data</h3></div>
          <p class="muted" style="font-size:13px;margin-bottom:10px">예전 버전에서 쓰던 밴드·페스티벌은 지우지 않고 보관되어 있습니다. 필요할 때 골라서 새 밴드로 가져올 수 있습니다.</p>
          <button class="btn" id="imp">예전 데이터 가져오기</button>
        </section>
      </div>
      ${admin ? `<section class="section" style="margin-top:12px">
        <div class="section-head"><h3>${esc(G.current.name)} 회원</h3><span class="count">${roster.length}명 · 관리자만 보임</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>이름</th><th>아이디</th><th class="hide-sm">악기</th><th>전화번호</th><th>권한</th><th></th></tr></thead>
          <tbody>${roster.map((r) => `<tr>
            <td><b>${esc(r.name)}</b></td>
            <td class="muted">@${esc(r.username)}</td>
            <td class="hide-sm">${esc((r.instruments || []).join(', ') || '—')}</td>
            <td class="num">${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</td>
            <td>${r.role === 'admin' ? '<span class="chip ink">관리자</span>' : '<span class="chip">회원</span>'}</td>
            <td class="r">${r.user_id === me ? '' : `<button class="btn sm ${r.role === 'admin' ? 'ghost' : ''}" data-adm="${r.user_id}" data-on="${r.role === 'admin' ? 0 : 1}">${r.role === 'admin' ? '관리자 해제' : '공동 관리자로'}</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}`;

    el.querySelector('#logout').onclick = async (e) => { e.target.disabled = true; await A.signOut(); toast('로그아웃되었습니다'); location.hash = '#/home'; };
    const pf = el.querySelector('#pf');
    pf.onsubmit = async (e) => {
      e.preventDefault();
      let info; try { info = readProfile(pf, { group: false }); } catch (er) { toast(er.message); return; }
      const btn = pf.querySelector('button.solid'); btn.disabled = true;
      try { await A.saveProfile(info); toast('저장했습니다'); } catch (er) { toast(er.message); btn.disabled = false; }
    };
    el.querySelectorAll('[data-sw]').forEach((b) => b.onclick = async () => { b.disabled = true; await G.select(b.dataset.sw); toast('그룹을 바꿨습니다'); location.hash = '#/home'; });
    const jf = el.querySelector('#jf');
    if (jf) jf.onsubmit = async (e) => { e.preventDefault(); try { await G.join(jf.g.value); toast('그룹에 참여했습니다'); location.hash = '#/home'; } catch (er) { toast(er.message); } };
    el.querySelector('#imp').onclick = () => legacyImport();
    el.querySelectorAll('[data-adm]').forEach((b) => b.onclick = () => {
      const on = b.dataset.on === '1', r = roster.find((x) => x.user_id === b.dataset.adm);
      UI.confirm(on ? `<b>${esc(r.name)}</b> 님을 공동 관리자로 지정할까요?<br><span class="muted">그룹의 모든 권한(밴드·페스티벌·연습실·게시판 관리)을 갖게 됩니다.</span>` : `<b>${esc(r.name)}</b> 님의 관리자 권한을 해제할까요?`, async () => {
        try { await G.setAdmin(r.user_id, on); toast(on ? '공동 관리자로 지정했습니다' : '관리자 권한을 해제했습니다'); } catch (er) { toast(er.message); }
      }, on ? '지정' : '해제');
    });
  };

  /* ---------------- 예전 데이터 가져오기 ---------------- */
  async function legacyImport() {
    const { form, close } = modal({ title: '예전 데이터 가져오기', body: '<p class="search-msg">예전 데이터를 찾는 중…</p>', wide: true });
    const box = form.querySelector('.modal-body');
    let sources = [];
    try { sources = await Store.Legacy.sources(); } catch (e) { box.innerHTML = `<p>불러오지 못했습니다: ${esc(e.message)}</p>`; return; }
    if (!form.isConnected) return;
    if (!sources.length) { box.innerHTML = '<p class="muted">가져올 예전 데이터가 없습니다.</p>'; return; }
    const admin = G.isAdmin;
    box.innerHTML = `<p class="muted" style="font-size:13px;margin-bottom:14px">원본은 그대로 남고, 고른 항목만 <b>${esc(G.current.name)}</b>에 복사됩니다. 밴드를 가져오면 내가 단장이 됩니다.${admin ? '' : ' 페스티벌은 관리자만 가져올 수 있습니다.'}</p>` +
      sources.map((s, si) => `
        <div class="section-head" style="margin-top:14px"><h3 style="font-size:16px">${esc(s.label)}</h3></div>
        ${(s.data.bands || []).map((b) => `<div class="friend-row">
          ${UI.logo(b, 'sm')}
          <span class="friend-name"><b>${esc(b.name)}</b><span class="muted" style="font-size:12px">밴드 · 곡 ${(s.data.songs || []).filter((x) => x.bandId === b.id).length} · 세트리스트 ${(s.data.setlists || []).filter((x) => x.bandId === b.id).length} · 합주 ${(s.data.rehearsals || []).filter((x) => x.bandId === b.id).length}</span></span>
          <button type="button" class="btn sm" data-ib="${si}:${b.id}">가져오기</button>
        </div>`).join('')}
        ${admin ? (s.data.festivals || []).map((f) => `<div class="friend-row">
          <span class="avatar">F</span>
          <span class="friend-name"><b>${esc(f.name)}</b><span class="muted" style="font-size:12px">페스티벌 · ${esc(f.startDate)} · 출연 ${(f.acts || []).length}팀</span></span>
          <button type="button" class="btn sm" data-if="${si}:${f.id}">가져오기</button>
        </div>`).join('') : ''}`).join('');
    box.querySelectorAll('[data-ib]').forEach((b) => b.onclick = async () => {
      const [si, id] = b.dataset.ib.split(':');
      b.disabled = true; b.textContent = '가져오는 중…';
      try { const nid = await Store.Legacy.importBand(sources[Number(si)].data, id); toast('밴드를 가져왔습니다'); close(); location.hash = `#/band/${nid}`; }
      catch (e) { toast(e.message); b.disabled = false; b.textContent = '가져오기'; }
    });
    box.querySelectorAll('[data-if]').forEach((b) => b.onclick = () => {
      const [si, id] = b.dataset.if.split(':');
      try { const nid = Store.Legacy.importFestival(sources[Number(si)].data, id); toast('페스티벌을 가져왔습니다'); close(); location.hash = `#/festival/${nid}`; }
      catch (e) { toast(e.message); }
    });
  }
  V.legacyImport = legacyImport;
})();
