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

  /* ---------- persistence ----------
     로그아웃 상태: KEY(이 브라우저 전용 데이터)
     로그인 상태  : KEY.ws.<workspace> 에 캐시 + Supabase 의 app_state 와 동기화 */
  const cacheKey = () => (profile ? `${KEY}.ws.${profile.workspace_id}` : KEY);
  function readLocal(k) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v && v.version === 1 ? v : null; } catch (e) { return null; }
  }
  function load() { db = readLocal(KEY) || seed(); }
  function writeLocal() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(db)); }
    catch (e) { window.UI && UI.toast('브라우저 저장 공간이 부족합니다 (사진 용량을 줄여주세요)'); }
  }
  function persist() {
    writeLocal();
    if (sb && profile) { clearTimeout(syncTimer); syncTimer = setTimeout(pushRemote, 800); }
    listeners.forEach((fn) => fn());
  }

  /* ---------- Supabase: 회원 · 친구 공유 ---------- */
  const clientId = uid() + uid();
  let user = null, profile = null, wsChannel = null, reqChannel = null, pushing = null;
  let authListeners = [], remoteListeners = [];
  const emitAuth = () => authListeners.forEach((fn) => fn());
  const emitRemote = () => { remoteListeners.forEach((fn) => fn()); listeners.forEach((fn) => fn()); };
  const configured = () => { const c = window.BM_CONFIG || {}; return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY); };

  async function initRemote() {
    if (!configured()) return false;
    const c = window.BM_CONFIG;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    if (data.session) await attach(data.session.user);
    sb.auth.onAuthStateChange((event, session) => {
      // 콜백 안에서 바로 supabase 호출을 하면 잠김이 생길 수 있어 다음 틱으로 미룸
      setTimeout(async () => {
        if (event === 'SIGNED_OUT') detach();
        else if (session && (!user || user.id !== session.user.id)) await attach(session.user);
      }, 0);
    });
    emitAuth();
    return true;
  }

  /** 로그인한 회원의 workspace 데이터를 불러오고 실시간 구독 */
  async function attach(u) {
    user = u;
    const { data: prof, error } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
    if (error || !prof) {
      console.warn('profile not found', error);
      if (window.UI) UI.toast('프로필을 불러오지 못했습니다. supabase/schema.sql 을 실행했는지 확인하세요');
      user = null; emitAuth(); return;
    }
    const guestData = profile ? null : db; // 처음 로그인할 때 이 브라우저 데이터를 새 계정의 시작 데이터로 사용
    profile = prof;
    const { data: row, error: e2 } = await sb.from('app_state').select('data').eq('id', prof.workspace_id).maybeSingle();
    if (e2) {
      // 서버 데이터를 못 읽었을 때는 덮어쓰지 않고 캐시로 보여주기만 함
      console.warn(e2);
      db = readLocal(cacheKey()) || guestData || db;
      if (window.UI) UI.toast('서버 데이터를 불러오지 못했습니다');
    } else if (row && row.data && row.data.version === 1) db = row.data;
    else { db = readLocal(cacheKey()) || guestData || readLocal(KEY) || seed(); await pushRemote(); }
    writeLocal();
    subscribe();
    emitAuth(); emitRemote();
  }

  function detach() {
    clearTimeout(syncTimer); syncTimer = null;
    if (wsChannel) { sb.removeChannel(wsChannel); wsChannel = null; }
    if (reqChannel) { sb.removeChannel(reqChannel); reqChannel = null; }
    user = null; profile = null;
    friendCache = { friends: [], requests: [] };
    db = readLocal(KEY) || seed();
    emitAuth(); emitRemote();
  }

  function subscribe() {
    if (wsChannel) sb.removeChannel(wsChannel);
    if (reqChannel) sb.removeChannel(reqChannel);
    const ws = profile.workspace_id;
    wsChannel = sb.channel('ws-' + ws)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state', filter: `id=eq.${ws}` }, (p) => {
        if (p.new && p.new.client_id === clientId) return; // 내가 저장한 것
        pullRemote();
      })
      .subscribe();
    reqChannel = sb.channel('req-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `to_user=eq.${user.id}` }, () => refreshFriends())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests', filter: `from_user=eq.${user.id}` }, () => refreshFriends())
      // 내 그룹이 다른 그룹에 합쳐지면 내 workspace_id 가 바뀜
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` }, (p) => {
        if (p.new && profile && p.new.workspace_id !== profile.workspace_id) reattach();
      })
      .subscribe();
  }

  /** 친구가 바꾼 데이터 가져오기 (내가 저장 대기 중이면 내 변경을 우선) */
  async function pullRemote() {
    if (!profile || syncTimer) return;
    // 친구가 나를 다른 workspace 로 옮겼을 수 있으니 프로필도 확인
    const { data: prof } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (prof && prof.workspace_id !== profile.workspace_id) { profile = null; return attach(user); }
    const { data: row } = await sb.from('app_state').select('data').eq('id', profile.workspace_id).maybeSingle();
    if (syncTimer || !row || !row.data || row.data.version !== 1) return;
    db = row.data; writeLocal(); emitRemote();
  }

  async function pushRemote() {
    syncTimer = null;
    if (!sb || !profile) return;
    pushing = sb.from('app_state').upsert({ id: profile.workspace_id, data: db, updated_at: new Date().toISOString(), client_id: clientId });
    const { error } = await pushing;
    pushing = null;
    if (error) { console.warn('Supabase sync failed', error); window.UI && UI.toast('서버 저장 실패 — 잠시 후 다시 시도합니다'); }
  }
  /** 대기 중인 저장을 즉시 보냄 */
  async function flush() {
    if (syncTimer) { clearTimeout(syncTimer); await pushRemote(); }
    else if (pushing) await pushing;
  }

  /* 로그인은 아이디로 합니다. Supabase Auth 가 이메일 형식을 요구하므로
     내부적으로만 "아이디@LOGIN_DOMAIN" 으로 바꿔 넘기고, 메일은 쓰지 않습니다. */
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  const normId = (v) => String(v || '').trim().toLowerCase();
  const toLogin = (id) => `${id}@${(window.BM_CONFIG && window.BM_CONFIG.LOGIN_DOMAIN) || 'bandmanager.app'}`;
  const checkId = (id) => { if (!USERNAME_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·_ 3~20자로 입력하세요'); };

  const authErr = (e) => {
    const m = (e && e.message) || String(e);
    if (/Invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 올바르지 않습니다';
    if (/not confirmed/i.test(m)) return '가입 승인이 필요한 상태입니다. Supabase에서 Confirm email 설정을 꺼주세요';
    if (/already registered|already exists/i.test(m)) return '이미 사용 중인 아이디입니다';
    if (/Password should be|weak/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
    if (/rate limit/i.test(m)) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요';
    if (/email/i.test(m)) return '가입할 수 없는 아이디입니다 (' + m + ')';
    return m;
  };
  const rpcErr = (e) => ((e && e.message) || String(e)).replace(/^.*?ERROR:\s*/, '');

  const Auth = {
    get configured() { return configured(); },
    get ready() { return !!sb; },
    get user() { return user; },
    get profile() { return profile; },
    onChange(fn) { authListeners.push(fn); },
    USERNAME_RE,
    async signUp(username, password, nickname) {
      const id = normId(username); checkId(id);
      const { data, error } = await sb.auth.signUp({ email: toLogin(id), password, options: { data: { username: id, nickname } } });
      if (error) throw new Error(authErr(error));
      // 이미 있는 아이디면 Supabase 가 오류 대신 빈 identities 를 돌려줌
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('이미 사용 중인 아이디입니다');
      if (!data.session) throw new Error('가입은 됐지만 바로 로그인할 수 없습니다. Supabase에서 Confirm email 설정을 꺼주세요');
      await attach(data.session.user);
    },
    async signIn(username, password) {
      const id = normId(username);
      if (!id) throw new Error('아이디를 입력하세요');
      const { data, error } = await sb.auth.signInWithPassword({ email: toLogin(id), password });
      if (error) throw new Error(authErr(error));
      if (!user || user.id !== data.user.id) await attach(data.user);
    },
    async signOut() {
      await flush();
      await sb.auth.signOut();
      detach();
    },
    async setNickname(nickname) {
      const { error } = await sb.from('profiles').update({ nickname }).eq('id', user.id);
      if (error) throw new Error(rpcErr(error));
      profile.nickname = nickname; emitAuth();
    },
  };

  /* ---------- 친구 ---------- */
  let friendCache = { friends: [], requests: [] };
  let friendListeners = [];
  async function refreshFriends() {
    if (!profile) { friendCache = { friends: [], requests: [] }; return friendCache; }
    const [f, r] = await Promise.all([
      sb.from('profiles').select('id,username,nickname').eq('workspace_id', profile.workspace_id).neq('id', user.id).order('nickname'),
      sb.rpc('list_friend_requests'),
    ]);
    if (f.error) console.warn(f.error);
    if (r.error) console.warn(r.error);
    const next = { friends: f.data || [], requests: r.data || [] };
    const changed = JSON.stringify(next) !== JSON.stringify(friendCache);
    friendCache = next;
    if (changed) friendListeners.forEach((fn) => fn(friendCache)); // 바뀐 경우만 알림 (화면 무한 갱신 방지)
    return friendCache;
  }
  /** 친구 관계가 바뀌어 workspace 가 달라졌을 수 있으므로 다시 붙음 */
  async function reattach() {
    const { data: prof } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (prof && prof.workspace_id !== profile.workspace_id) { profile = null; await attach(user); }
    else await pullRemote();
    await refreshFriends();
  }
  const Friends = {
    get cache() { return friendCache; },
    onChange(fn) { friendListeners.push(fn); },
    refresh: refreshFriends,
    async request(username) {
      const id = normId(username);
      if (!id) throw new Error('친구 아이디를 입력하세요');
      await flush();
      const { data, error } = await sb.rpc('send_friend_request', { target_username: id });
      if (error) throw new Error(rpcErr(error));
      if (data === 'accepted') await reattach(); else await refreshFriends();
      return data;
    },
    async respond(id, accept) {
      await flush();
      const { error } = await sb.rpc('respond_friend_request', { req_id: id, accept });
      if (error) throw new Error(rpcErr(error));
      if (accept) await reattach(); else await refreshFriends();
    },
    async cancel(id) {
      const { error } = await sb.rpc('cancel_friend_request', { req_id: id });
      if (error) throw new Error(rpcErr(error));
      await refreshFriends();
    },
    async leave() {
      await flush();
      const { error } = await sb.rpc('leave_shared_workspace');
      if (error) throw new Error(rpcErr(error));
      await reattach();
    },
  };

  load();

  return {
    uid, iso, dayOffset,
    get db() { return db; },
    save: persist,
    onChange(fn) { listeners.push(fn); },
    /** 친구 변경 등 서버에서 데이터가 새로 들어왔을 때 */
    onRemote(fn) { remoteListeners.push(fn); },
    reset() { db = seed(); persist(); },
    initRemote,
    Auth, Friends,

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
