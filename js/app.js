/* =========================================================
   App — hash router + shell
   ========================================================= */
const App = (() => {
  const view = document.getElementById('view');
  const routes = {
    home: Views.home,
    bands: Views.bands,
    studio: Views.studio,
    setlist: Views.setlist,
    rehearsal: Views.rehearsal,
    progress: Views.progress,
    festivals: Views.festivals,
    festival: Views.festival,
    timetable: Views.timetable,
    personal: Views.personal,
    account: Views.account,
  };

  function parse() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').filter(Boolean);
    return { name: parts[0], params: parts.slice(1) };
  }

  function shell() {
    const d = Store.db;
    const sel = document.getElementById('activeBand');
    sel.innerHTML = d.bands.length
      ? d.bands.map((b) => `<option value="${b.id}" ${b.id === d.activeBandId ? 'selected' : ''}>${UI.esc(b.name)}</option>`).join('')
      : '<option>— 밴드 없음 —</option>';
    sel.disabled = !d.bands.length;

    // ticker
    const band = Store.band(), fest = Store.festival();
    const today = Store.iso(new Date());
    const next = band && d.rehearsals.filter((r) => r.bandId === band.id && r.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const items = [
      band ? `${band.name} — ${band.members.length} members` : 'create your band',
      next ? `next rehearsal ${UI.dateKo(next.date)} ${next.start}` : 'schedule a rehearsal',
      'build your setlist',
      fest ? `${fest.name} · ${UI.dateEn(fest.startDate)} · ${fest.venue}` : 'make your own festival',
      'plan your timetable',
    ];
    const html = items.map((t) => `<span>${UI.esc(t)}</span>`).join('');
    document.getElementById('ticker').innerHTML = html + html + html + html;
    account();
  }

  /** 헤더 계정 버튼 + 하단 저장 위치 표시 */
  function account() {
    const A = Store.Auth, btn = document.getElementById('accountBtn'), info = document.getElementById('saveInfo');
    btn.hidden = !A.configured;
    if (!A.configured) return;
    if (!A.user) {
      btn.innerHTML = '<span class="lbl">guest</span><b>로그인</b>';
      info.textContent = 'data saved in this browser';
      return;
    }
    const p = A.profile || {}, c = Store.Friends.cache;
    const pending = c.requests.filter((r) => r.direction === 'in').length;
    btn.innerHTML = `<span class="lbl">${c.friends.length ? `${c.friends.length} friend${c.friends.length > 1 ? 's' : ''}` : 'account'}</span><b>${UI.esc(p.nickname || 'me')}</b>${pending ? `<i class="badge">${pending}</i>` : ''}`;
    info.textContent = c.friends.length ? `synced · shared with ${c.friends.length} friend${c.friends.length > 1 ? 's' : ''}` : 'synced to your account';
  }

  function render() {
    const { name, params } = parse();
    const fn = routes[name] || routes.home;
    const key = name === 'festival' ? (params[1] === 'timetable' ? 'timetable' : 'festivals') : (routes[name] ? name : 'home');
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === key));
    shell();
    try {
      fn(view, params);
    } catch (e) {
      console.error(e);
      view.innerHTML = UI.empty('Oops', '화면을 그리는 중 오류가 발생했습니다. 데모 데이터를 초기화해 보세요.');
    }
  }

  let lastRoute = '';
  window.addEventListener('hashchange', () => {
    const r = parse().name;
    render();
    if (r !== lastRoute) window.scrollTo(0, 0);
    lastRoute = r;
  });
  document.getElementById('activeBand').addEventListener('change', (e) => { Store.setActiveBand(e.target.value); render(); });
  document.getElementById('resetData').addEventListener('click', (e) => {
    e.preventDefault();
    const shared = Store.Auth.user && Store.Friends.cache.friends.length;
    UI.confirm(shared ? '모든 데이터를 지우고 데모 데이터로 되돌릴까요?<br><b>친구들과 공유 중인 데이터도 함께 지워집니다.</b>' : '모든 데이터를 지우고 데모 데이터로 되돌릴까요?', () => { Store.reset(); location.hash = '#/home'; render(); UI.toast('데모 데이터로 초기화했습니다'); });
  });

  lastRoute = parse().name;
  render();
  // 서버 데이터가 바뀌면(로그인·로그아웃·친구 변경·친구의 수정) 다시 그림. 입력 중인 창이 열려 있으면 닫힐 때까지 미룸
  let pendingRender = false;
  const safeRender = () => {
    if (document.querySelector('#modal-root .modal')) { pendingRender = true; return; }
    pendingRender = false; render();
  };
  new MutationObserver(() => { if (pendingRender && !document.querySelector('#modal-root .modal')) safeRender(); })
    .observe(document.getElementById('modal-root'), { childList: true });
  Store.onRemote(safeRender);
  Store.Auth.onChange(() => { account(); if (Store.Auth.user) Store.Friends.refresh().catch(() => {}); if (parse().name === 'account') safeRender(); });
  Store.Friends.onChange(() => { account(); if (parse().name === 'account') safeRender(); });

  Store.initRemote().catch((e) => { console.warn(e); UI.toast('서버에 연결하지 못했습니다 — 이 브라우저에만 저장됩니다'); });

  return { render };
})();
