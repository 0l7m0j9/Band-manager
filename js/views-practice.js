/* =========================================================
   Views — Practice (모든 계급): 내가 연습할 곡
   내가 속한 모든 밴드의 곡을 밴드별로 모아 보여 주고,
   곡을 펼치면 나만의 진도(%)와 메모를 적을 수 있음 (본인만 보임 · song_notes)
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, dur, diff, toast } = UI;
  const V = window.Views;
  const FILTERS = [['all', '전체'], ['todo', '시작 전'], ['doing', '연습 중'], ['done', '완성']];
  let filter = 'all';
  const open = new Set();           // 펼친 곡 'bandId:songId'
  const timers = new Map();         // 메모 자동 저장 대기

  const stage = (p) => (p >= 100 ? 'done' : p > 0 ? 'doing' : 'todo');
  const STAGE = { todo: '시작 전', doing: '연습 중', done: '완성' };
  const when = (ts) => {
    const d = new Date(ts); if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /** 내가 승인된 밴드원인 밴드 + 그 밴드의 확정 곡 */
  function myBands() {
    const db = Store.db || {};
    const today = Store.iso(new Date());
    const me = Store.Auth.user && Store.Auth.user.id;
    return Store.Bands.list.filter((b) => b.myStatus === 'approved').map((b) => {
      const songs = (db.songs || []).filter((s) => s.bandId === b.id && s.status !== 'candidate');
      const sets = (db.setlists || []).filter((sl) => sl.bandId === b.id);
      const next = (db.rehearsals || []).filter((r) => r.bandId === b.id && r.date >= today).sort((x, y) => String(x.date).localeCompare(y.date))[0];
      const mine = Store.Bands.members(b.id).find((m) => m.user_id === me) || {};
      return { b, songs, sets, next, part: mine.part || '', loaded: !!Store.band(b.id) };
    });
  }

  function songRow(x, s) {
    const key = `${x.b.id}:${s.id}`;
    const n = Store.Practice.note(x.b.id, s.id) || { progress: 0, memo: '' };
    const st = stage(n.progress);
    const inSets = x.sets.map((sl) => { const i = (sl.items || []).findIndex((it) => it.songId === s.id); return i < 0 ? '' : `${esc(sl.name)} #${i + 1}`; }).filter(Boolean);
    const isOpen = open.has(key);
    return `<div class="pr-song ${isOpen ? 'open' : ''}" data-key="${esc(key)}">
      <button type="button" class="pr-head" data-toggle aria-expanded="${isOpen}">
        ${s.artwork ? `<img class="pr-art" src="${esc(s.artwork)}" alt="" loading="lazy">` : '<span class="pr-art ph">♪</span>'}
        <span class="pr-title"><b>${esc(s.title)}</b><small>${esc(s.artist || '')}${s.duration ? ' · ' + dur(s.duration) : ''}</small></span>
        <span class="pr-meta">
          ${n.memo ? '<span class="pr-memo-dot" title="메모 있음">✎</span>' : ''}
          <span class="chip pr-st ${st}">${STAGE[st]}</span>
          <span class="pr-bar" aria-hidden="true"><i style="width:${n.progress}%"></i></span>
          <b class="num pr-pct">${n.progress}%</b>
        </span>
        <span class="pr-chev" aria-hidden="true">›</span>
      </button>
      ${isOpen ? `<div class="pr-body">
        <p class="pr-info muted">
          ${s.bpm ? `BPM ${esc(s.bpm)} · ` : ''}난이도 ${diff(s.difficulty)} · 밴드 진행도 ${Number(s.progress) || 0}%
          ${inSets.length ? `<br>세트리스트: ${inSets.join(', ')}` : ''}
        </p>
        ${s.previewUrl ? `<audio controls preload="none" src="${esc(s.previewUrl)}"></audio>` : ''}
        <label class="field"><span class="lbl">my progress <b class="num" data-pv>${n.progress}%</b></span>
          <input type="range" min="0" max="100" step="5" value="${n.progress}" data-prog aria-label="내 진도">
        </label>
        <div class="pr-quick">${[0, 25, 50, 75, 100].map((v) => `<button type="button" class="pick-chip" data-set="${v}">${v === 100 ? '완성' : v + '%'}</button>`).join('')}</div>
        <label class="field"><span class="lbl">memo</span>
          <textarea class="input" rows="4" maxlength="2000" data-memo placeholder="예: 브릿지 코드 Am7→D7 / 2절 후렴 템포 빨라짐 주의 / 솔로 8마디 손가락 번호">${esc(n.memo)}</textarea>
        </label>
        <p class="pr-saved muted" data-saved>${n.updated_at ? `저장됨 · ${when(n.updated_at)}` : '아직 기록 없음 · 적으면 자동 저장'}</p>
      </div>` : ''}
    </div>`;
  }

  V.practice = (el) => {
    const bands = myBands();
    const all = bands.flatMap((x) => x.songs.map((s) => ({ x, s, p: (Store.Practice.note(x.b.id, s.id) || { progress: 0 }).progress })));
    const cnt = { all: all.length, todo: 0, doing: 0, done: 0 };
    all.forEach((a) => { cnt[stage(a.p)]++; });
    const avg = all.length ? Math.round(all.reduce((t, a) => t + a.p, 0) / all.length) : 0;

    el.innerHTML = V.pageHead(['practice', esc((Store.Group.current || {}).name || '')], 'MY SONGS', 'Practice') + (
      !bands.length
        ? UI.empty('No band', '아직 속한 밴드가 없습니다. Bands에서 가입을 신청하거나 새 밴드를 만들어 보세요.', '<a class="btn solid" href="#/bands">Bands로</a>')
        : `
      <div class="stats" style="border-top:1px solid var(--line);margin-bottom:20px">
        <div class="stat"><span class="lbl">songs</span><b class="num">${cnt.all}</b></div>
        <div class="stat"><span class="lbl">practicing</span><b class="num">${cnt.doing}</b></div>
        <div class="stat"><span class="lbl">done</span><b class="num">${cnt.done}</b></div>
        <div class="stat"><span class="lbl">my average</span><b class="num">${avg}%</b></div>
      </div>
      ${Store.Practice.ready ? '' : '<p class="muted" style="font-size:13px;margin-bottom:12px">⚠ 연습 기록 저장 기능이 아직 서버에 없습니다 — 관리자가 supabase/schema.sql 을 다시 실행하면 됩니다.</p>'}
      <nav class="tabs" style="margin-bottom:18px">${FILTERS.map(([k, v]) => `<a href="#" data-f="${k}" class="${filter === k ? 'on' : ''}">${v} ${cnt[k]}</a>`).join('')}</nav>
      ${bands.map((x) => {
        const songs = x.songs.filter((s) => filter === 'all' || stage((Store.Practice.note(x.b.id, s.id) || { progress: 0 }).progress) === filter);
        const bavg = x.songs.length ? Math.round(x.songs.reduce((t, s) => t + ((Store.Practice.note(x.b.id, s.id) || { progress: 0 }).progress), 0) / x.songs.length) : 0;
        return `<section class="pr-band">
          <div class="pr-band-head">
            ${UI.logo(x.b, 'sm')}
            <a class="pr-band-name" href="#/band/${x.b.id}/studio"><b>${esc(x.b.name)}</b>
              <small>${x.part ? esc(x.part) + ' · ' : ''}곡 ${x.songs.length}개 · 내 평균 ${bavg}%${x.next ? ` · 다음 합주 ${UI.dateKo(x.next.date)}` : ''}</small></a>
          </div>
          ${!x.loaded ? '<p class="muted" style="padding:12px 0">곡을 불러오는 중…</p>'
            : songs.length ? songs.map((s) => songRow(x, s)).join('')
            : `<p class="muted" style="padding:12px 0">${x.songs.length ? '이 조건에 맞는 곡이 없습니다.' : '아직 등록된 곡이 없습니다. 단장이 Studio에서 곡을 추가하면 여기에 나옵니다.'}</p>`}
        </section>`;
      }).join('')}`);

    el.querySelectorAll('[data-f]').forEach((a) => a.onclick = (e) => { e.preventDefault(); filter = a.dataset.f; App.render(); });

    el.querySelectorAll('.pr-song').forEach((row) => {
      const key = row.dataset.key;
      const [bandId, songId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      row.querySelector('[data-toggle]').onclick = () => { if (open.has(key)) open.delete(key); else open.add(key); App.render(); };
      if (!row.classList.contains('open')) return;

      const range = row.querySelector('[data-prog]'), memo = row.querySelector('[data-memo]');
      const saved = row.querySelector('[data-saved]'), pv = row.querySelector('[data-pv]');
      // 머리줄(막대·% · 상태)만 바로 바꿈 — 화면 전체를 다시 그리지 않아 메모 입력이 끊기지 않음
      const paintHead = (p) => {
        pv.textContent = p + '%';
        row.querySelector('.pr-bar i').style.width = p + '%';
        row.querySelector('.pr-pct').textContent = p + '%';
        const st = row.querySelector('.pr-st'); st.className = `chip pr-st ${stage(p)}`; st.textContent = STAGE[stage(p)];
      };
      const save = async () => {
        clearTimeout(timers.get(key)); timers.delete(key);
        saved.textContent = '저장 중…';
        try {
          await Store.Practice.save(bandId, songId, { progress: range.value, memo: memo.value });
          const n = Store.Practice.note(bandId, songId);
          saved.textContent = `저장됨 · ${when(n.updated_at)}`;
          const dot = row.querySelector('.pr-memo-dot');
          if (memo.value.trim() && !dot) row.querySelector('.pr-meta').insertAdjacentHTML('afterbegin', '<span class="pr-memo-dot" title="메모 있음">✎</span>');
          if (!memo.value.trim() && dot) dot.remove();
        } catch (er) { saved.textContent = '저장 실패'; toast(er.message); }
      };
      range.oninput = () => paintHead(Number(range.value));
      range.onchange = save;
      row.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { range.value = b.dataset.set; paintHead(Number(range.value)); save(); });
      memo.oninput = () => { saved.textContent = '입력 중…'; clearTimeout(timers.get(key)); timers.set(key, setTimeout(save, 1200)); };
      memo.onblur = () => { if (timers.has(key)) save(); };
    });
  };
})();
