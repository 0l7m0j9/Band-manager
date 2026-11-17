/* =========================================================
   Store — localStorage 저장 + (선택) Supabase 동기화
   ========================================================= */
const Store = (() => {
  const KEY = 'bandmanager.v1';
  const uid = () => Math.random().toString(36).slice(2, 10);
  let db = null;
  let listeners = [];
  let sb = null, syncTimer = null;

  const iso = (d) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

  /* ---------- demo seed ---------- */
  function seed() {
    const b1 = uid(), b2 = uid();
    const m = { vo: uid(), gt: uid(), ba: uid(), dr: uid(), ke: uid() };
    const s = Array.from({ length: 9 }, uid);
    const st = [uid(), uid(), uid()];
    const a = Array.from({ length: 12 }, uid);
    const fest = uid();
    return {
      version: 1,
      activeBandId: b1,
      activeFestivalId: fest,
      bands: [
        {
          id: b1, name: 'Ripple Effect', genre: 'Indie Rock', color: '#7f5cff', logo: '', founded: '2024-03-01',
          bio: '파동처럼 번지는 기타 사운드를 지향하는 4인조 인디 록 밴드.',
          members: [
            { id: m.vo, name: '한서윤', instrument: 'Vocal', position: '리더' },
            { id: m.gt, name: '박도현', instrument: 'Guitar', position: '편곡' },
            { id: m.ba, name: '이지호', instrument: 'Bass', position: '총무' },
            { id: m.dr, name: '최민재', instrument: 'Drums', position: '멤버' },
          ],
          log: [
            { id: uid(), date: dayOffset(-40), text: '밴드 결성 1주년 기념 합주' },
            { id: uid(), date: dayOffset(-12), text: '신곡 「Low Tide」 편곡 완료' },
          ],
        },
        {
          id: b2, name: 'Nocturne Error', genre: 'Synth Pop', color: '#141210', logo: '', founded: '2025-01-10',
          bio: '신스와 드럼머신 기반의 듀오 프로젝트.',
          members: [
            { id: m.ke, name: '윤하람', instrument: 'Keyboard', position: '리더' },
            { id: uid(), name: '정우', instrument: 'Electronics', position: '멤버' },
          ],
          log: [],
        },
      ],
      songs: [
        { id: s[0], bandId: b1, title: 'Low Tide', artist: 'Ripple Effect', duration: 252, bpm: 92, difficulty: 3, mood: 'calm', progress: 80 },
        { id: s[1], bandId: b1, title: 'Static Bloom', artist: 'Ripple Effect', duration: 214, bpm: 128, difficulty: 4, mood: 'hype', progress: 55 },
        { id: s[2], bandId: b1, title: 'Orange Hour', artist: 'Ripple Effect', duration: 236, bpm: 110, difficulty: 2, mood: 'groove', progress: 100 },
        { id: s[3], bandId: b1, title: 'Wonderwall', artist: 'Oasis', duration: 258, bpm: 87, difficulty: 2, mood: 'ballad', progress: 90 },
        { id: s[4], bandId: b1, title: 'Seven Nation Army', artist: 'The White Stripes', duration: 232, bpm: 124, difficulty: 2, mood: 'groove', progress: 100 },
        { id: s[5], bandId: b1, title: 'Echo Chamber', artist: 'Ripple Effect', duration: 301, bpm: 140, difficulty: 5, mood: 'hype', progress: 30 },
        { id: s[6], bandId: b1, title: '한여름밤의 꿀', artist: '산울림 (cover)', duration: 198, bpm: 100, difficulty: 3, mood: 'groove', progress: 45 },
        { id: s[7], bandId: b1, title: 'Afterglow', artist: 'Ripple Effect', duration: 275, bpm: 72, difficulty: 3, mood: 'ballad', progress: 65 },
        { id: uid(), bandId: b1, title: 'Mr. Brightside', artist: 'The Killers', duration: 222, bpm: 148, difficulty: 3, mood: 'hype', progress: 0, status: 'candidate', votes: [m.gt, m.dr, m.vo], proposedBy: m.gt, reason: '앵콜용 — 떼창 가능' },
        { id: uid(), bandId: b1, title: 'Wi Ing Wi Ing', artist: 'HYUKOH', duration: 246, bpm: 96, difficulty: 3, mood: 'groove', progress: 0, status: 'candidate', votes: [m.vo], proposedBy: m.vo, reason: '중반 분위기 전환용' },
        { id: s[8], bandId: b2, title: 'Neon Sleep', artist: 'Nocturne Error', duration: 240, bpm: 118, difficulty: 3, mood: 'groove', progress: 70 },
      ],
      setlists: [
        {
          id: uid(), bandId: b1, name: '가을 클럽 공연', limit: 30, transition: 30,
          items: [s[2], s[1], s[0], s[4], s[7], s[5]].map((id, i) => ({ id: uid(), songId: id, mc: i === 0 || i === 3 ? 60 : 0 })),
        },
      ],
      rehearsals: [
        { id: uid(), bandId: b1, date: dayOffset(-6), start: '19:00', end: '22:00', place: '홍대 사운드랩 B룸', notes: 'Echo Chamber 브릿지 템포 맞추기', attendance: { [m.vo]: 'yes', [m.gt]: 'yes', [m.ba]: 'yes', [m.dr]: 'no' } },
        { id: uid(), bandId: b1, date: dayOffset(2), start: '19:00', end: '22:00', place: '홍대 사운드랩 B룸', notes: '세트리스트 런스루', attendance: { [m.vo]: 'yes', [m.gt]: 'maybe', [m.ba]: 'yes', [m.dr]: 'yes' } },
        { id: uid(), bandId: b1, date: dayOffset(9), start: '14:00', end: '17:00', place: '합정 그루브스튜디오', notes: '', attendance: {} },
      ],
      tasks: [
        { id: uid(), bandId: b1, memberId: m.gt, songId: s[5], text: '솔로 파트 140bpm 메트로놈 연습', done: false },
        { id: uid(), bandId: b1, memberId: m.dr, songId: s[1], text: '하이햇 16비트 필인 정리', done: true },
        { id: uid(), bandId: b1, memberId: m.vo, songId: s[0], text: '2절 가사 확정', done: false },
        { id: uid(), bandId: b1, memberId: m.ba, songId: null, text: '이펙터 보드 케이블 교체', done: false },
      ],
      gigs: [
        { id: uid(), bandId: b1, date: dayOffset(-30), title: '첫 단독 클럽 공연', venue: '클럽 FF', notes: '관객 80명, 앵콜 1곡', photos: [] },
      ],
      festivals: [
        {
          id: fest, name: 'Ripple Fest', startDate: dayOffset(30), days: 2, venue: '난지 한강공원', theme: '파동처럼 번지는 소리',
          bg: '#f2541b', accent: '#7f5cff', dayStart: 12, dayEnd: 24, changeover: 15,
          stages: [
            { id: st[0], name: 'Main Stage', color: '#f2541b' },
            { id: st[1], name: 'Wave Stage', color: '#7f5cff' },
            { id: st[2], name: 'Club Tent', color: '#d6ff3a' },
          ],
          acts: [
            { id: a[0], name: 'Ripple Effect', genre: 'Indie Rock', origin: 'mine', bandId: b1, headliner: false },
            { id: a[1], name: 'Nocturne Error', genre: 'Synth Pop', origin: 'mine', bandId: b2, headliner: false },
            { id: a[2], name: 'The Static Moons', genre: 'Shoegaze', origin: 'virtual', headliner: true },
            { id: a[3], name: 'Marina Glass', genre: 'Dream Pop', origin: 'virtual', headliner: false },
            { id: a[4], name: '새벽세시', genre: 'Post Rock', origin: 'virtual', headliner: false },
            { id: a[5], name: 'Velvet Circuit', genre: 'Electronic', origin: 'virtual', headliner: true },
            { id: a[6], name: 'Paper Tigers', genre: 'Garage', origin: 'virtual', headliner: false },
            { id: a[7], name: 'Lumen', genre: 'Jazz Fusion', origin: 'virtual', headliner: false },
            { id: a[8], name: 'Hollow Bloom', genre: 'Alt Rock', origin: 'virtual', headliner: false },
            { id: a[9], name: 'Tidal Kids', genre: 'Pop Punk', origin: 'virtual', headliner: false },
            { id: a[10], name: 'Glass Animals', genre: 'Indie Pop', origin: 'real', headliner: false },
            { id: a[11], name: 'Orbit 9', genre: 'Techno', origin: 'virtual', headliner: false },
          ],
          slots: [
            { id: uid(), actId: a[9], stageId: st[0], day: 0, start: 14 * 60, dur: 40, changeover: null },
            { id: uid(), actId: a[0], stageId: st[0], day: 0, start: 15 * 60, dur: 45, changeover: null },
            { id: uid(), actId: a[8], stageId: st[0], day: 0, start: 16 * 60 + 10, dur: 50, changeover: null },
            { id: uid(), actId: a[2], stageId: st[0], day: 0, start: 20 * 60, dur: 90, changeover: null },
            { id: uid(), actId: a[3], stageId: st[1], day: 0, start: 15 * 60 + 30, dur: 45, changeover: null },
            { id: uid(), actId: a[4], stageId: st[1], day: 0, start: 17 * 60, dur: 60, changeover: null },
            { id: uid(), actId: a[1], stageId: st[2], day: 0, start: 16 * 60, dur: 40, changeover: null },
            { id: uid(), actId: a[11], stageId: st[2], day: 0, start: 21 * 60, dur: 120, changeover: null },
            { id: uid(), actId: a[6], stageId: st[0], day: 1, start: 15 * 60, dur: 45, changeover: null },
            { id: uid(), actId: a[10], stageId: st[0], day: 1, start: 18 * 60, dur: 70, changeover: null },
            { id: uid(), actId: a[5], stageId: st[0], day: 1, start: 20 * 60 + 30, dur: 90, changeover: null },
            { id: uid(), actId: a[7], stageId: st[1], day: 1, start: 16 * 60, dur: 50, changeover: null },
          ],
          favorites: [a[0], a[2], a[4], a[5]],
          layouts: {},
        },
      ],
    };
  }

  /* ---------- persistence ---------- */
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || db.version !== 1) db = seed();
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { window.UI && UI.toast('브라우저 저장 공간이 부족합니다 (사진 용량을 줄여주세요)'); }
    if (sb) { clearTimeout(syncTimer); syncTimer = setTimeout(pushRemote, 800); }
    listeners.forEach((fn) => fn());
  }

  /* ---------- Supabase (optional) ---------- */
  async function initRemote() {
    const c = window.BM_CONFIG || {};
    if (!c.SUPABASE_URL || !c.SUPABASE_ANON_KEY) return false;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data, error } = await sb.from('app_state').select('data').eq('id', c.WORKSPACE_ID).maybeSingle();
    if (error) { console.warn(error); return false; }
    if (data && data.data && data.data.version === 1) {
      db = data.data;
      localStorage.setItem(KEY, JSON.stringify(db));
    } else {
      await pushRemote();
    }
    return true;
  }
  async function pushRemote() {
    if (!sb) return;
    const c = window.BM_CONFIG;
    const { error } = await sb.from('app_state').upsert({ id: c.WORKSPACE_ID, data: db, updated_at: new Date().toISOString() });
    if (error) console.warn('Supabase sync failed', error);
  }

  load();

  return {
    uid, iso, dayOffset,
    get db() { return db; },
    save: persist,
    onChange(fn) { listeners.push(fn); },
    reset() { db = seed(); persist(); },
    initRemote,

    // helpers
    band(id = db.activeBandId) { return db.bands.find((b) => b.id === id) || db.bands[0] || null; },
    setActiveBand(id) { db.activeBandId = id; persist(); },
    /** 확정된 곡 (세트리스트·진행도에 사용) */
    songsOf(bandId) { return db.songs.filter((s) => s.bandId === bandId && s.status !== 'candidate'); },
    /** 후보곡 (투표 중) */
    candidatesOf(bandId) { return db.songs.filter((s) => s.bandId === bandId && s.status === 'candidate'); },
    song(id) { return db.songs.find((s) => s.id === id); },
    festival(id = db.activeFestivalId) { return db.festivals.find((f) => f.id === id) || db.festivals[0] || null; },
    remove(col, id) { db[col] = db[col].filter((x) => x.id !== id); persist(); },
  };
})();
