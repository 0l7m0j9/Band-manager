/* =========================================================
   App — 해시 라우터 + 계급별 메뉴
     부원 : Home · Bands · Calendar
     단장 : + Rooms
     관리자: Home · Bands · Calendar · Rooms · Festival · Board
   ========================================================= */
const App = (() => {
  const view = document.getElementById('view');
  const V = window.Views;
  const A = Store.Auth, G = Store.Group;
  const ROLE = { admin: '관리자', leader: '단장', member: '부원' };
  const NAV = {
    member: [['home', 'Home'], ['bands', 'Bands'], ['calendar', 'Calendar']],
    leader: [['home', 'Home'], ['bands', 'Bands'], ['calendar', 'Calendar'], ['rooms', 'Rooms']],
    admin: [['home', 'Home'], ['bands', 'Bands'], ['calendar', 'Calendar'], ['rooms', 'Rooms'], ['festivals', 'Festival'], ['board', 'Board'], ['members', 'Members']],
  };
  const BAND_TABS = [['studio', 'Studio'], ['setlist', 'Setlist'], ['rehearsal', 'Rehearsal'], ['progress', 'Progress']];
  const ADMIN_ONLY = new Set(['festivals', 'festival', 'timetable', 'personal', 'board', 'members']);

  function parse() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').filter(Boolean);
    return { name: parts[0], params: parts.slice(1) };
  }

  /* ---------- 상단 ---------- */
  function badges() {
    const out = { bands: 0, rooms: 0 };
    if (!A.user) return out;
    Store.Bands.list.forEach((b) => { if (b.canEdit) out.bands += Store.Bands.members(b.id).filter((m) => m.status === 'pending').length; });
    if (G.isAdmin) out.rooms = Store.Rooms.reservations.filter((r) => r.status === 'pending').length;
    return out;
  }
  function shell(key) {
    const nav = document.getElementById('nav');
    const logged = !!(A.user && !A.needsOnboarding && G.current);
    const items = logged ? NAV[G.role] : [];
    const bd = badges();
    nav.innerHTML = items.map(([k, v]) => `<a href="#/${k}" data-r="${k}" class="${k === key ? 'on' : ''}">${v}${bd[k] ? `<i class="nbadge">${bd[k]}</i>` : ''}</a>`).join('');
    UI.centerActive(nav, nav.querySelector('a.on'));
    // 그룹 선택 (2개 이상일 때)
    const gs = document.getElementById('groupSwitch'), sel = document.getElementById('groupSel');
    gs.hidden = !(logged && G.list.length > 1);
    if (!gs.hidden) sel.innerHTML = G.list.map((g) => `<option value="${g.id}" ${g.id === G.id ? 'selected' : ''}>${UI.esc(g.name)}</option>`).join('');
    // 계정 버튼
    const btn = document.getElementById('accountBtn'), info = document.getElementById('saveInfo');
    btn.hidden = !A.configured;
    if (!A.user) {
      btn.innerHTML = '<span class="lbl">guest</span><b>로그인</b>';
      info.textContent = A.failed ? '서버에 연결하지 못했습니다' : '';
    } else {
      const p = A.profile || {};
      btn.innerHTML = `<span class="lbl">${G.current ? ROLE[G.role] : 'account'}</span><b>${UI.esc(p.name || 'me')}</b>`;
      info.textContent = G.current ? `${G.current.name} · ${ROLE[G.role]}` : '';
    }
    // 티커
    const t = document.getElementById('ticker');
    const today = Store.iso(new Date());
    const next = logged ? V.calItems().filter((x) => x.date >= today).slice(0, 4).map((x) => `${UI.dateKo(x.date)} ${x.title}`) : [];
    const words = next.length ? next : ['band manager', 'setlist', 'rehearsal', 'festival', 'calendar'];
    const html = words.map((w) => `<span>${UI.esc(w)}</span>`).join('');
    t.innerHTML = html + html + html + html;
  }

  /* ---------- 밴드 상세: 위쪽 밴드 바 + 탭 ---------- */
  function bandRoute(id, tab) {
    const meta = Store.Bands.list.find((b) => b.id === id);
    if (!meta) { view.innerHTML = UI.empty('Band', '밴드를 찾을 수 없습니다.', '<a class="btn solid" href="#/bands">밴드 목록</a>'); return; }
    if (!meta.canRead) {
      view.innerHTML = V.pageHead(['band'], 'BAND', UI.esc(meta.name)) + UI.empty('Join', meta.myStatus === 'pending' ? '가입 신청을 보냈습니다. 단장이 승인하면 볼 수 있습니다.' : '밴드원만 볼 수 있습니다. Bands에서 가입을 신청하세요.', '<a class="btn solid" href="#/bands">Bands로</a>');
      return;
    }
    Store.setActiveBand(id);
    const band = Store.band(id);
    if (!band) { view.innerHTML = UI.empty('Loading', '밴드 내용을 불러오는 중입니다…'); return; }
    const edit = Store.Bands.canEdit(id);
    const fn = { studio: V.studio, setlist: V.setlist, rehearsal: V.rehearsal, progress: V.progress }[tab] || V.studio;
    view.innerHTML = `
      <div class="band-bar">
        <a class="back" href="#/bands" aria-label="밴드 목록">‹</a>
        ${UI.logo(band, 'sm')}
        <b class="bb-name">${UI.esc(band.name)}</b>
        ${edit ? `<span class="chip ink">${G.isAdmin && !Store.Bands.isLeader(id) ? '관리자' : '단장'}</span>` : '<span class="chip">보기 전용</span>'}
        <nav class="tabs">${BAND_TABS.map(([k, v]) => `<a href="#/band/${id}/${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</nav>
      </div>
      <div id="bandview"></div>`;
    const bv = view.querySelector('#bandview');
    const r = fn(bv);
    if (!edit) UI.readOnly(bv);
    return r;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    let { name, params } = parse();
    const fail = (e) => { console.error(e); view.innerHTML = UI.empty('Oops', '화면을 그리는 중 오류가 발생했습니다. 새로고침해 보세요.'); };
    let key = name;
    try {
      if (!A.configured) { shell(''); view.innerHTML = UI.empty('Setup', 'js/config.js 에 Supabase 설정이 필요합니다.'); return; }
      if (!A.user) { shell(''); V.landing(view); return; }
      if (A.loadError) {
        shell('');
        const schemaHint = /column|relation|does not exist|function|schema cache|프로필이 없습니다/i.test(A.loadError);
        view.innerHTML = UI.empty('Error', `데이터를 불러오지 못했습니다.<br><code style="font-size:12px">${UI.esc(A.loadError)}</code>` +
          (schemaHint ? '<br><br>Supabase SQL Editor에서 <b>supabase/schema.sql</b> 전체를 실행했는지 확인하세요.' : ''),
          '<button class="btn solid" id="retry">다시 시도</button> <button class="btn" id="lo">로그아웃</button>');
        view.querySelector('#retry').onclick = async (e) => { e.target.disabled = true; await A.retry(); };
        view.querySelector('#lo').onclick = () => A.signOut();
        return;
      }
      if (!A.profile) { shell(''); view.innerHTML = UI.empty('Loading', '불러오는 중…'); return; }
      if (A.needsOnboarding) { shell(''); V.welcome(view); return; }
      if (!G.current) { shell(''); view.innerHTML = UI.empty('Loading', '불러오는 중…'); return; }
      const role = G.role;
      // 예전 주소(현재 밴드 기준) → 밴드 상세 주소로
      if (['studio', 'setlist', 'rehearsal', 'progress'].includes(name)) {
        const b = Store.db.activeBandId;
        location.replace(b ? `#/band/${b}/${name}` : '#/bands'); return;
      }
      if ((ADMIN_ONLY.has(name) && role !== 'admin') || (name === 'rooms' && role === 'member')) {
        UI.toast('권한이 없는 메뉴입니다'); location.replace('#/home'); return;
      }
      if (name === 'band') key = 'bands';
      if (name === 'festival' || name === 'timetable') key = 'festivals';
      const routes = {
        home: V.home, bands: V.bands, calendar: V.calendar, rooms: V.rooms, board: V.board, account: V.account, members: V.members,
        festivals: V.festivals, festival: V.festival, timetable: V.timetable,
      };
      if (name !== 'band' && !routes[name]) { name = 'home'; key = 'home'; }
      shell(key);
      const r = name === 'band' ? bandRoute(params[0], params[1] || 'studio') : routes[name](view, params);
      if (r && typeof r.catch === 'function') r.catch(fail);
      view.querySelectorAll('.tabs').forEach((t) => UI.centerActive(t, t.querySelector('.on')));
    } catch (e) { fail(e); }
  }

  let lastRoute = '';
  window.addEventListener('hashchange', () => {
    const r = location.hash.split('/').slice(0, 3).join('/');
    render();
    if (r !== lastRoute) window.scrollTo(0, 0);
    lastRoute = r;
  });
  document.getElementById('groupSel').addEventListener('change', async (e) => {
    await G.select(e.target.value); UI.toast('그룹을 바꿨습니다'); location.hash = '#/home';
  });

  lastRoute = location.hash.split('/').slice(0, 3).join('/');
  render();
  // 서버 데이터가 바뀌면 다시 그림. 입력 중인 창이 열려 있으면 닫힐 때까지 미룸
  let pendingRender = false;
  const safeRender = () => {
    if (document.querySelector('#modal-root .modal')) { pendingRender = true; return; }
    pendingRender = false; render();
  };
  new MutationObserver(() => { if (pendingRender && !document.querySelector('#modal-root .modal')) safeRender(); })
    .observe(document.getElementById('modal-root'), { childList: true });
  Store.onRemote(safeRender);
  Store.Auth.onChange(safeRender);

  Store.initRemote().catch((e) => { console.warn(e); UI.toast('서버에 연결하지 못했습니다'); safeRender(); });

  return { render };
})();
