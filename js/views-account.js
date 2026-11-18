/* =========================================================
   Views — 로그인 / 회원가입 / 계정 · 친구 공유
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast } = UI;
  const V = window.Views;
  const A = Store.Auth, F = Store.Friends;

  /* ---------------- 로그인 / 회원가입 창 ---------------- */
  function authModal(mode = 'login') {
    const body = `
      <div class="auth-tabs" role="tablist">
        <button type="button" class="btn sm" data-mode="login">로그인</button>
        <button type="button" class="btn sm" data-mode="signup">회원가입</button>
      </div>
      <div class="field"><span class="lbl">아이디</span><input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="영문 소문자·숫자·_ 3~20자" required></div>
      <div class="field"><span class="lbl">password</span><input name="password" type="password" minlength="6" autocomplete="current-password" required></div>
      <div class="field signup-only"><span class="lbl">password 확인</span><input name="password2" type="password" autocomplete="new-password"></div>
      <div class="field signup-only"><span class="lbl">nickname</span><input name="nickname" maxlength="20" placeholder="친구에게 보일 이름"></div>
      <p class="muted auth-note" style="font-size:13px"></p>`;
    let cur = mode;
    const { form } = modal({
      title: '계정',
      body,
      submit: '확인',
      onOpen(f) {
        const set = (m) => {
          cur = m;
          f.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('solid', b.dataset.mode === m));
          f.querySelectorAll('.signup-only').forEach((x) => { x.style.display = m === 'signup' ? '' : 'none'; });
          f.querySelector('[name=password]').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
          f.querySelector('.modal-head h3').textContent = m === 'signup' ? '회원가입' : '로그인';
          f.querySelector('button[type=submit]').textContent = m === 'signup' ? '가입하기' : '로그인';
          f.querySelector('.auth-note').textContent = m === 'signup'
            ? '처음 가입하면 지금 이 브라우저에 있는 데이터가 내 계정으로 옮겨집니다.'
            : '로그인하면 어느 기기에서든 같은 데이터를 볼 수 있습니다.';
        };
        f.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => set(b.dataset.mode)));
        set(cur);
      },
      async onSubmit(d, f) {
        const id = d.username.trim().toLowerCase(), pw = d.password;
        if (!id || !pw) { toast('아이디와 비밀번호를 입력하세요'); return false; }
        if (cur === 'signup' && !A.USERNAME_RE.test(id)) { toast('아이디는 영문 소문자·숫자·_ 3~20자로 입력하세요'); return false; }
        if (pw.length < 6) { toast('비밀번호는 6자 이상이어야 합니다'); return false; }
        if (cur === 'signup' && pw !== d.password2) { toast('비밀번호 확인이 일치하지 않습니다'); return false; }
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          if (cur === 'signup') {
            await A.signUp(id, pw, d.nickname.trim());
            const real = A.profile && A.profile.username;
            toast(real && real !== id
              ? `친구 추가용 아이디는 @${real} 입니다 (로그인은 ${id})`
              : `환영합니다, ${A.profile ? A.profile.nickname : ''}!`);
          } else {
            await A.signIn(id, pw);
            toast(`${A.profile ? A.profile.nickname : ''}님, 로그인되었습니다`);
          }
        } catch (e) {
          toast(e.message); btn.disabled = false; return false;
        }
      },
    });
    return form;
  }
  V.authModal = authModal;

  /* ---------------- 계정 · 친구 화면 ---------------- */
  const head = (tech, title, actions = '') => `
    <div class="page-head">
      <div>
        <div class="eyebrow"><span class="lbl">account</span><span class="lbl">friends & sharing</span></div>
        <h1 class="page-title"><span class="tech">${tech}</span>${title}</h1>
      </div>
      <div class="page-actions">${actions}</div>
    </div>`;

  const person = (p, right = '') => `
    <div class="friend-row">
      <span class="avatar">${esc(UI.initials(p.nickname || p.username))}</span>
      <span class="friend-name"><b>${esc(p.nickname || p.username)}</b><span class="mono muted">@${esc(p.username)}</span></span>
      <span class="row" style="gap:6px;flex:0 0 auto">${right}</span>
    </div>`;

  V.account = (el) => {
    if (!A.configured) {
      el.innerHTML = head('LOCAL', 'Account') + UI.empty('Offline', 'Supabase 설정(js/config.js)이 비어 있어 로그인을 쓸 수 없습니다.');
      return;
    }
    if (!A.ready) {
      el.innerHTML = head('WAIT', 'Account') + UI.empty('Loading', '서버에 연결하는 중입니다…');
      return;
    }
    if (!A.user) {
      el.innerHTML = head('GUEST', 'Account') + UI.empty('Hello',
        '로그인하면 데이터가 계정에 저장되어 어느 기기에서든 이어서 쓸 수 있고,<br>친구를 추가하면 서로의 밴드·곡·합주·페스티벌을 <b>하나의 계정처럼</b> 함께 관리합니다.',
        '<button class="btn solid" id="li">로그인</button> <button class="btn" id="su">회원가입</button>');
      el.querySelector('#li').onclick = () => authModal('login');
      el.querySelector('#su').onclick = () => authModal('signup');
      return;
    }

    const p = A.profile;
    const draw = (c) => {
      const incoming = c.requests.filter((r) => r.direction === 'in');
      const outgoing = c.requests.filter((r) => r.direction === 'out');
      el.innerHTML = head('HELLO', esc(p.nickname || p.username), '<button class="btn" id="logout">로그아웃</button>') + `
        <div class="split">
          <section class="section">
            <div class="section-head"><h3>Friends</h3><span class="count">${c.friends.length}</span></div>
            <p class="muted" style="margin-bottom:12px;font-size:14px">친구끼리는 밴드·곡·세트리스트·합주·페스티벌 등 <b>모든 데이터를 함께 보고 수정</b>합니다. 한 명이 바꾸면 다른 친구 화면에도 바로 반영됩니다.</p>
            ${c.friends.map((f) => person(f)).join('') || '<p class="muted" style="padding:12px 0">아직 친구가 없습니다. 오른쪽에서 아이디로 친구를 추가해 보세요.</p>'}
            ${c.friends.length ? `<div style="margin-top:16px"><button class="btn ghost sm" id="leave">공유 그만두기 (친구 끊기)</button></div>` : ''}
          </section>
          <section class="section">
            <div class="section-head"><h3>Add Friend</h3></div>
            <form class="row" id="addF" style="margin-bottom:18px">
              <input class="input" name="username" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="친구 아이디" style="flex:1 1 200px" required>
              <button class="btn sm solid">요청 보내기</button>
            </form>
            <div class="section-head"><h3>받은 요청</h3><span class="count">${incoming.length}</span></div>
            ${incoming.map((r) => person(r, `<button class="btn sm lime" data-acc="${r.id}">수락</button><button class="btn sm ghost" data-dec="${r.id}">거절</button>`)).join('') || '<p class="muted" style="padding:8px 0 16px">받은 요청이 없습니다.</p>'}
            <div class="section-head" style="margin-top:12px"><h3>보낸 요청</h3><span class="count">${outgoing.length}</span></div>
            ${outgoing.map((r) => person(r, `<span class="lbl">대기 중</span><button class="btn sm ghost" data-cancel="${r.id}">취소</button>`)).join('') || '<p class="muted" style="padding:8px 0">보낸 요청이 없습니다.</p>'}
          </section>
        </div>
        <section class="section" style="margin-top:32px">
          <div class="section-head"><h3>My Profile</h3></div>
          <form class="row" id="nick" style="max-width:520px">
            <input class="input" name="nickname" value="${esc(p.nickname || '')}" maxlength="20" placeholder="닉네임" style="flex:1 1 200px" required>
            <button class="btn sm solid">닉네임 저장</button>
          </form>
          <p class="mono muted" style="margin-top:10px;font-size:12px">아이디 @${esc(p.username)} — 친구가 이 아이디로 나를 추가할 수 있습니다</p>
        </section>`;

      const busy = async (btn, fn) => {
        if (btn) btn.disabled = true;
        try { await fn(); } catch (e) { toast(e.message); if (btn) btn.disabled = false; }
      };
      el.querySelector('#logout').onclick = (e) => busy(e.target, async () => { await A.signOut(); toast('로그아웃되었습니다'); });
      el.querySelector('#addF').onsubmit = (e) => {
        e.preventDefault();
        const fid = e.target.username.value.trim();
        if (!fid) return;
        busy(e.target.querySelector('button'), async () => {
          const r = await F.request(fid);
          toast(r === 'accepted' ? '상대도 요청을 보낸 상태라 바로 친구가 되었습니다' : '친구 요청을 보냈습니다');
        });
      };
      el.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => UI.modal({
        title: '친구 요청 수락',
        body: '<p>수락하면 <b>내 데이터와 친구의 데이터가 하나로 합쳐지고</b>, 이후 모든 데이터를 함께 사용합니다.<br>(내 기존 친구가 있다면 그 친구들도 함께 합류합니다)</p>',
        submit: '수락',
        onSubmit: () => busy(b, async () => { await F.respond(b.dataset.acc, true); toast('친구가 되었습니다 — 이제 데이터를 함께 씁니다'); }),
      }));
      el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => busy(b, async () => { await F.respond(b.dataset.dec, false); toast('요청을 거절했습니다'); }));
      el.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => busy(b, async () => { await F.cancel(b.dataset.cancel); toast('요청을 취소했습니다'); }));
      const lv = el.querySelector('#leave');
      if (lv) lv.onclick = () => UI.modal({
        title: '공유 그만두기',
        body: '<p>친구들과의 데이터 공유를 그만둡니다.<br>지금 데이터의 <b>복사본</b>을 가지고 나만의 계정으로 분리되며, 친구들은 기존 데이터를 계속 함께 씁니다.</p>',
        submit: '그만두기',
        onSubmit: () => busy(lv, async () => { await F.leave(); toast('공유를 그만두었습니다'); }),
      });
      el.querySelector('#nick').onsubmit = (e) => {
        e.preventDefault();
        const v = e.target.nickname.value.trim();
        if (!v) return;
        busy(e.target.querySelector('button'), async () => { await A.setNickname(v); toast('닉네임을 저장했습니다'); });
      };
    };

    draw(F.cache);
    F.refresh().then((c) => { if (location.hash.startsWith('#/account') && el.isConnected) draw(c); }).catch((e) => console.warn(e));
  };
})();
