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
    UI.confirm('모든 데이터를 지우고 데모 데이터로 되돌릴까요?', () => { Store.reset(); location.hash = '#/home'; render(); UI.toast('데모 데이터로 초기화했습니다'); });
  });

  lastRoute = parse().name;
  render();
  Store.initRemote().then((ok) => { if (ok) { render(); UI.toast('Supabase와 동기화되었습니다'); } }).catch((e) => console.warn(e));

  return { render };
})();
