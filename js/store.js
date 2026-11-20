/* =========================================================
   Store v2 — 그룹 · 계급(관리자 > 단장 > 부원) · Supabase

   서버 구조 (supabase/schema.sql 의 v2)
     groups / group_members(role)      그룹과 관리자
     bands / band_members(role,status)  밴드 목록·단장·가입 승인
     band_docs                          밴드 내용 JSON (곡·세트리스트·합주·과제·공연 기록)
     festivals (+ published)            페스티벌 JSON (관리자만), 부원은 published_festivals()
     events / rooms / reservations / posts

   화면 코드(views-*.js)는 예전처럼 Store.db 하나만 보고 수정합니다.
   Store.db 는 읽을 수 있는 밴드 문서·페스티벌 문서를 합쳐 만든 것이고,
   Store.save() 하면 바뀐 문서만 골라 각자 서버에 저장합니다 (rev 로 충돌 감지 → 합치기).
   ========================================================= */
const Store = (() => {
  const KEY = 'bandmanager.v1';          // 예전(v1) 브라우저 저장 키 — 가져오기용으로만 읽음
  const GROUP_KEY = 'bandmanager.group'; // 마지막으로 본 그룹

  /** 새 id (uuid v4) */
  const uid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const iso = (d) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const note = (msg) => window.UI && UI.toast(msg);
  const errMsg = (e) => ((e && e.message) || String(e)).replace(/^.*?ERROR:\s*/, '');

  /* ---------- 데이터 정리 ----------
     다른 사람이 쓴 데이터도 화면에 안전하게 들어가도록 id·숫자·날짜·색·이미지 주소를 정리 */
  const NUM = {
    duration: [0, 36000], bpm: [0, 400], difficulty: [1, 5], progress: [0, 100], limit: [0, 10000], transition: [0, 3600], mc: [0, 3600],
    days: [1, 5], dayStart: [0, 23], dayEnd: [1, 30], changeover: [0, 600], dur: [5, 1440], day: [0, 4], x: [0, 100], y: [0, 100], rot: [0, 359],
  };
  const MOOD_KEYS = ['calm', 'groove', 'hype', 'ballad'];
  const URL_RE = /^(data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"'<>`\\]+)$/;
  const toNum = (v, [lo, hi]) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
  function clean(v, k) {
    if (Array.isArray(v)) { const a = v.map((x) => clean(x, k)); return k === 'photos' || k === 'images' ? a.filter(Boolean) : a; }
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((kk) => { o[kk] = clean(v[kk], kk); }); return o; }
    if (v === undefined) return v;
    if (k === 'id' || /Id$/.test(k)) return v === null ? v : String(v).replace(/[^\w-]/g, '');
    if (k === 'start' || k === 'end') return typeof v === 'string' ? (/^\d{2}:\d{2}$/.test(v) ? v : '00:00') : toNum(v, [0, 3000]);
    if (k in NUM) {
      if (v === null || v === '' || v === undefined) return k === 'changeover' ? null : NUM[k][0];
      const n = toNum(v, NUM[k]);
      return k === 'difficulty' ? Math.round(n) : n;
    }
    switch (k) {
      case 'mood': return MOOD_KEYS.includes(v) ? v : 'groove';
      case 'status': return v === 'candidate' ? v : undefined;
      case 'origin': return ['mine', 'real', 'virtual'].includes(v) ? v : 'virtual';
      case 'type': return v === null ? v : String(v).replace(/\W/g, '');
      case 'color': case 'bg': case 'accent': case 'fg': case 'accent2': return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#141210';
      case 'date': case 'founded': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
      case 'startDate': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : iso(new Date());
      case 'logo': case 'artwork': case 'previewUrl': case 'photos': case 'images': return typeof v === 'string' && URL_RE.test(v) ? v : '';
      default: return v;
    }
  }
  const sanitize = (d) => clean(d, '');
  const safeUrl = (v) => (typeof v === 'string' && URL_RE.test(v) ? v : '');
  const safeColor = (v, d = '#111111') => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

  /* ---------- 3-way merge (문서 하나 안에서) ----------
     base(마지막으로 서버와 맞춘 내용) 대비 내가 바꾼 것만 remote(서버 최신) 위에 덮어씀.
     배열은 id 단위: 내가 바꾼 항목은 내 것, 지운 항목은 삭제, 만든 항목은 추가, 나머지는 서버 것 */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const idList = (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && x.id);
  function mergeList(b, l, r) {
    const bm = new Map(b.map((x) => [x.id, x])), lm = new Map(l.map((x) => [x.id, x]));
    const out = [], seen = new Set();
    r.forEach((x) => {
      seen.add(x.id);
      if (!lm.has(x.id)) { if (!bm.has(x.id)) out.push(x); return; }
      const mine = lm.get(x.id);
      out.push(same(mine, bm.get(x.id)) ? x : mine);
    });
    l.forEach((x) => { if (!seen.has(x.id) && !bm.has(x.id)) out.push(x); });
    return out;
  }
  function merge3(base, local, remote) {
    const out = { ...remote };
    new Set([...Object.keys(local), ...Object.keys(remote)]).forEach((k) => {
      const b = base ? base[k] : undefined, l = local[k], r = remote[k];
      if (idList(l) && idList(r)) out[k] = mergeList(idList(b) ? b : [], l, r);
      else out[k] = l !== undefined && !same(l, b) ? l : r;
    });
    return out;
  }

  /* ---------- 상태 ---------- */
  let sb = null, user = null, profile = null, myPhone = '', remoteFailed = false, loading = false;
  let groups = [];         // [{ id, name, role }]  내가 속한 그룹
  let allGroups = [];      // 가입용 전체 그룹 목록
  let gid = null;          // 현재 그룹
  let roster = [];         // group_roster()
  let bandsMeta = [];      // bands 행
  let bandMembers = [];    // band_members 행 (보이는 것만)
  let posts = [], events = [], rooms = [], reservations = [], pubFests = [];
  const docs = new Map();  // 'band:<id>' | 'fest:<id>' → { kind, id, data, rev, baseStr, lastStr, dirty, failCount, timer, retry, published }
  let db = emptyDb();
  let listeners = [], authListeners = [], remoteListeners = [];
  let channel = null;
  const clientId = uid();

  function emptyDb() {
    return { version: 1, activeBandId: null, activeFestivalId: null, bands: [], songs: [], setlists: [], rehearsals: [], tasks: [], gigs: [], festivals: [] };
  }
  const emitAuth = () => authListeners.forEach((fn) => fn());
  const emitRemote = () => { remoteListeners.forEach((fn) => fn()); listeners.forEach((fn) => fn()); };
  const configured = () => { const c = window.BM_CONFIG || {}; return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY); };

  /* ---------- 권한 ---------- */
  const myGroup = () => groups.find((g) => g.id === gid) || null;
  const isAdmin = () => !!(myGroup() && myGroup().role === 'admin');
  const myMembership = (bandId) => bandMembers.find((m) => m.band_id === bandId && user && m.user_id === user.id) || null;
  const isLeaderOf = (bandId) => { const m = myMembership(bandId); return !!(m && m.status === 'approved' && m.role === 'leader'); };
  const canEditBand = (bandId) => isAdmin() || isLeaderOf(bandId);
  const canReadBand = (bandId) => isAdmin() || !!(myMembership(bandId) && myMembership(bandId).status === 'approved');
  const leaderBandIds = () => bandsMeta.filter((b) => isLeaderOf(b.id)).map((b) => b.id);
  /** 상단 메뉴용 계급: 관리자 > 단장 > 부원 */
  const role = () => (isAdmin() ? 'admin' : leaderBandIds().length ? 'leader' : 'member');

  /* ---------- 문서 ↔ Store.db ---------- */
  const COLS = ['songs', 'setlists', 'rehearsals', 'tasks', 'gigs'];
  const personName = (uidv) => { const r = roster.find((x) => x.user_id === uidv); return r ? r.name : '(탈퇴한 회원)'; };
  /** 화면용 밴드 객체 (예전 구조와 같은 모양): 멤버는 승인된 밴드원 */
  function bandObj(meta, data) {
    const b = (data && data.band) || {};
    const members = bandMembers
      .filter((m) => m.band_id === meta.id && m.status === 'approved')
      .map((m) => {
        const r = roster.find((x) => x.user_id === m.user_id);
        return { id: m.user_id, name: personName(m.user_id), instrument: m.part || (r && r.instruments && r.instruments.join(', ')) || '', position: m.position || (m.role === 'leader' ? '단장' : '부원'), role: m.role };
      })
      .sort((a, b2) => (a.role === b2.role ? a.name.localeCompare(b2.name) : a.role === 'leader' ? -1 : 1));
    return {
      id: meta.id, name: meta.name, genre: meta.genre, bio: meta.bio, color: safeColor(meta.color), logo: safeUrl(meta.logo),
      founded: b.founded || String(meta.created_at || '').slice(0, 10), log: Array.isArray(b.log) ? b.log : [], members,
    };
  }
  /** docs → Store.db */
  function assemble() {
    const d = emptyDb();
    d.activeBandId = db.activeBandId; d.activeFestivalId = db.activeFestivalId;
    bandsMeta.forEach((meta) => {
      const doc = docs.get('band:' + meta.id);
      if (!doc) return;
      d.bands.push(bandObj(meta, doc.data));
      COLS.forEach((c) => (Array.isArray(doc.data[c]) ? doc.data[c] : []).forEach((x) => d[c].push({ ...x, bandId: meta.id })));
    });
    for (const doc of docs.values()) if (doc.kind === 'fest') d.festivals.push({ ...doc.data, id: doc.id });
    d.festivals.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    db = sanitize(d);
  }
  /** Store.db → 문서 하나의 저장용 내용 */
  function extract(doc) {
    if (doc.kind === 'band') {
      const b = db.bands.find((x) => x.id === doc.id);
      if (!b) return null; // 화면 데이터에 없는 밴드는 건드리지 않음 (빈 내용으로 덮어쓰기 방지)
      const out = { band: { founded: b.founded, log: b.log } };
      COLS.forEach((c) => { out[c] = db[c].filter((x) => x.bandId === doc.id).map(({ bandId, ...rest }) => rest); });
      return out;
    }
    const f = db.festivals.find((x) => x.id === doc.id);
    if (!f) return null;
    const { id, ...rest } = f;
    return rest;
  }

  /* ---------- 저장 ---------- */
  let metaTimer = null;
  function persist() {
    if (!sb || !profile || !gid) { listeners.forEach((fn) => fn()); return; }
    // 페스티벌 추가/삭제 감지 (관리자)
    if (isAdmin()) {
      db.festivals.forEach((f) => { if (!docs.has('fest:' + f.id)) createFestivalDoc(f); });
      [...docs.values()].filter((d) => d.kind === 'fest' && !db.festivals.some((f) => f.id === d.id)).forEach((d) => deleteFestivalDoc(d.id));
    }
    for (const doc of docs.values()) {
      if (doc.kind === 'band' && !canEditBand(doc.id)) continue; // 읽기 전용
      if (doc.kind === 'fest' && !isAdmin()) continue;
      if (doc.creating) continue; // 만드는 중 — 끝나면 createFestivalDoc 이 이어서 저장
      const data = extract(doc);
      if (!data) continue;
      const str = JSON.stringify(data);
      if (str === doc.lastStr) continue;
      doc.lastStr = str; doc.data = data; doc.dirty = true;
      clearTimeout(doc.timer); doc.timer = setTimeout(() => pushDoc(doc), 800);
    }
    // 밴드 이름·장르·색·로고·소개 → bands 표
    clearTimeout(metaTimer); metaTimer = setTimeout(pushBandMeta, 800);
    listeners.forEach((fn) => fn());
  }
  async function pushBandMeta() {
    for (const b of db.bands) {
      const meta = bandsMeta.find((m) => m.id === b.id);
      if (!meta || !canEditBand(b.id)) continue;
      const patch = {};
      ['name', 'genre', 'bio', 'color', 'logo'].forEach((k) => { if ((b[k] || '') !== (meta[k] || '')) patch[k] = b[k] || ''; });
      if (!Object.keys(patch).length) continue;
      const { error } = await sb.from('bands').update(patch).eq('id', b.id);
      if (error) { console.warn(error); note('밴드 정보 저장 실패: ' + errMsg(error)); } else Object.assign(meta, patch);
    }
  }

  const docTable = (doc) => (doc.kind === 'band' ? { t: 'band_docs', k: 'band_id' } : { t: 'festivals', k: 'id' });
  /** rev 가 내가 아는 것과 같을 때만 저장. 다르면 서버 최신본과 합친 뒤 다시 저장 */
  async function pushDoc(doc) {
    clearTimeout(doc.timer); doc.timer = null;
    if (doc.pushing) { doc.again = true; return; }
    if (!doc.dirty || !sb) return;
    doc.pushing = true;
    const { t, k } = docTable(doc);
    try {
      for (let i = 0; i < 5; i++) {
        const snap = JSON.stringify(doc.data);
        const res = await sb.from(t).update({ data: JSON.parse(snap), rev: doc.rev + 1, updated_at: new Date().toISOString(), client_id: clientId })
          .eq(k, doc.id).eq('rev', doc.rev).select('rev');
        if (res.error) throw res.error;
        if (res.data && res.data.length) {
          doc.rev = res.data[0].rev; doc.baseStr = snap; doc.failCount = 0;
          doc.dirty = JSON.stringify(doc.data) !== snap;
          break;
        }
        // 충돌 → 최신본과 합치기
        const { data: row, error } = await sb.from(t).select('data,rev').eq(k, doc.id).maybeSingle();
        if (error) throw error;
        if (!row) { docs.delete((doc.kind === 'band' ? 'band:' : 'fest:') + doc.id); assemble(); emitRemote(); return; }
        applyMerge(doc, row);
      }
    } catch (e) {
      console.warn('save failed', e);
      doc.failCount = (doc.failCount || 0) + 1;
      if (doc.failCount === 1) note('서버 저장 실패 — 연결되면 자동으로 다시 저장합니다');
      clearTimeout(doc.retry); doc.retry = setTimeout(() => pushDoc(doc), Math.min(60000, 2000 * 2 ** Math.min(doc.failCount - 1, 5)));
    } finally {
      doc.pushing = false;
      if (doc.again) { doc.again = false; if (doc.dirty) pushDoc(doc); }
    }
  }
  function applyMerge(doc, row) {
    const server = sanitize(row.data || {});
    syncAllFromDb();
    doc.data = merge3(doc.baseStr ? JSON.parse(doc.baseStr) : null, doc.data, server);
    doc.baseStr = JSON.stringify(server); doc.rev = row.rev;
    doc.lastStr = JSON.stringify(doc.data);
    assemble(); emitRemote();
  }
  /** 화면에서 바꿨지만 아직 문서에 안 옮긴 내용을 문서로 (합치기·다시 만들기 전에) */
  function syncAllFromDb() {
    for (const doc of docs.values()) {
      if ((doc.kind === 'band' && !canEditBand(doc.id)) || (doc.kind === 'fest' && !isAdmin())) continue;
      const data = extract(doc);
      if (!data) continue;
      const str = JSON.stringify(data);
      if (str !== doc.lastStr) { doc.data = data; doc.lastStr = str; doc.dirty = true; }
    }
  }
  async function createFestivalDoc(f) {
    const { id, ...data } = f;
    const doc = { kind: 'fest', id, data, rev: 0, baseStr: JSON.stringify(data), lastStr: JSON.stringify(data), dirty: false, published: {}, creating: true };
    docs.set('fest:' + id, doc);
    const { error } = await sb.from('festivals').insert({ id, group_id: gid, data, published: {}, client_id: clientId });
    doc.creating = false;
    if (error) { note('페스티벌 저장 실패: ' + errMsg(error)); docs.delete('fest:' + id); return; }
    // 만드는 동안 더 바뀐 내용이 있으면 이어서 저장
    const now = extract(doc);
    if (now && JSON.stringify(now) !== doc.baseStr) { doc.data = now; doc.lastStr = JSON.stringify(now); doc.dirty = true; pushDoc(doc); }
  }
  async function deleteFestivalDoc(id) {
    docs.delete('fest:' + id);
    const { error } = await sb.from('festivals').delete().eq('id', id);
    if (error) note('페스티벌 삭제 실패: ' + errMsg(error));
  }
  async function flush() {
    syncAllFromDb();
    await Promise.all([...docs.values()].filter((d) => d.dirty).map((d) => pushDoc(d)));
  }

  /* ---------- 불러오기 ---------- */
  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }
  async function loadProfile() {
    profile = await q(sb.from('profiles').select('id,username,nickname,full_name,instruments').eq('id', user.id).maybeSingle());
    const priv = await sb.from('profile_private').select('phone').eq('user_id', user.id).maybeSingle();
    myPhone = (priv.data && priv.data.phone) || '';
    const gm = await q(sb.from('group_members').select('group_id, role, groups(name)').eq('user_id', user.id));
    groups = (gm || []).map((r) => ({ id: r.group_id, role: r.role, name: (r.groups && r.groups.name) || '그룹' }));
    allGroups = await q(sb.from('groups').select('id,name').order('name'));
    let saved = null;
    try { saved = localStorage.getItem(GROUP_KEY); } catch (e) { /* */ }
    gid = groups.some((g) => g.id === saved) ? saved : groups[0] ? groups[0].id : null;
  }

  /** 현재 그룹의 데이터 전부 */
  async function loadGroup() {
    if (!gid) return;
    loading = true;
    try {
      const [r, b, p, e, rm, rs, pf] = await Promise.all([
        q(sb.rpc('group_roster', { p_group: gid })),
        q(sb.from('bands').select('*').eq('group_id', gid).order('name')),
        q(sb.from('posts').select('*').eq('group_id', gid).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(60)),
        q(sb.from('events').select('*').eq('group_id', gid)),
        q(sb.from('rooms').select('*').eq('group_id', gid).order('sort').order('name')),
        q(sb.from('reservations').select('*').eq('group_id', gid).gte('date', dayOffset(-120)).order('date').order('start_time')),
        q(sb.rpc('published_festivals', { p_group: gid })),
      ]);
      roster = r || []; bandsMeta = b || []; posts = sanitize(p || []); events = e || []; rooms = rm || []; reservations = rs || [];
      pubFests = (pf || []).map((x) => ({ id: x.id, published: x.published || {}, data: sanitize(x.data || {}) }));
      const ids = bandsMeta.map((x) => x.id);
      bandMembers = ids.length ? await q(sb.from('band_members').select('*').in('band_id', ids)) : [];
      await loadDocs();
    } finally { loading = false; }
  }
  /** 읽을 수 있는 밴드 문서(내 밴드, 관리자는 전부) + 페스티벌(관리자) */
  async function loadDocs() {
    syncAllFromDb();
    const readable = bandsMeta.map((b) => b.id).filter(canReadBand);
    const rows = readable.length ? await q(sb.from('band_docs').select('band_id,data,rev').in('band_id', readable)) : [];
    const fest = isAdmin() ? await q(sb.from('festivals').select('id,data,rev,published').eq('group_id', gid)) : [];
    const seen = new Set();
    const take = (kind, id, row, published) => {
      const key = kind + ':' + id;
      seen.add(key);
      const cur = docs.get(key);
      if (cur && cur.rev === row.rev) { if (published) cur.published = published; return; }
      if (cur && (cur.dirty || cur.pushing)) { applyMergeQuiet(cur, row); if (published) cur.published = published; return; }
      const data = sanitize(row.data || {});
      const s = JSON.stringify(data);
      docs.set(key, { kind, id, data, rev: row.rev, baseStr: s, lastStr: s, dirty: false, published: published || {} });
    };
    rows.forEach((row) => take('band', row.band_id, row));
    fest.forEach((row) => take('fest', row.id, row, row.published || {}));
    // 더 이상 못 보는 문서는 빼되, 지금 만드는 중인 페스티벌은 남김
    [...docs.entries()].forEach(([key, d]) => { if (!seen.has(key) && !d.creating) docs.delete(key); });
    assemble();
  }
  function applyMergeQuiet(doc, row) {
    const server = sanitize(row.data || {});
    doc.data = merge3(doc.baseStr ? JSON.parse(doc.baseStr) : null, doc.data, server);
    doc.baseStr = JSON.stringify(server); doc.rev = row.rev; doc.lastStr = JSON.stringify(doc.data); doc.dirty = true;
    pushDoc(doc);
  }

  /* ---------- 실시간 ---------- */
  const pending = new Set();
  let refreshTimer = null;
  function refreshSoon(kind) {
    pending.add(kind);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(runRefresh, 300);
  }
  async function runRefresh() {
    const kinds = new Set(pending); pending.clear();
    if (!gid || !sb) return;
    try {
      if (kinds.has('roster') || kinds.has('me')) {
        if (kinds.has('me')) { await loadProfile(); emitAuth(); }
        roster = await q(sb.rpc('group_roster', { p_group: gid }));
      }
      if (kinds.has('bands') || kinds.has('members')) {
        bandsMeta = await q(sb.from('bands').select('*').eq('group_id', gid).order('name'));
        const ids = bandsMeta.map((x) => x.id);
        bandMembers = ids.length ? await q(sb.from('band_members').select('*').in('band_id', ids)) : [];
      }
      if (kinds.has('bands') || kinds.has('members') || kinds.has('docs') || kinds.has('me')) await loadDocs();
      if (kinds.has('posts')) posts = sanitize(await q(sb.from('posts').select('*').eq('group_id', gid).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(60)));
      if (kinds.has('events')) events = await q(sb.from('events').select('*').eq('group_id', gid));
      if (kinds.has('rooms')) rooms = await q(sb.from('rooms').select('*').eq('group_id', gid).order('sort').order('name'));
      if (kinds.has('resv')) reservations = await q(sb.from('reservations').select('*').eq('group_id', gid).gte('date', dayOffset(-120)).order('date').order('start_time'));
      if (kinds.has('pub') || kinds.has('docs')) {
        const pf = await q(sb.rpc('published_festivals', { p_group: gid }));
        pubFests = (pf || []).map((x) => ({ id: x.id, published: x.published || {}, data: sanitize(x.data || {}) }));
      }
      if (!kinds.has('bands') && !kinds.has('members') && !kinds.has('docs') && !kinds.has('me')) assemble();
      emitRemote();
    } catch (e) { console.warn('refresh failed', e); }
  }
  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!gid) return;
    const on = (table, kind, filter) => channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (p) => {
      if (p.new && p.new.client_id === clientId) return; // 내가 저장한 것
      refreshSoon(kind);
    });
    channel = sb.channel('g-' + gid + '-' + clientId.slice(0, 6));
    on('group_members', 'me', `group_id=eq.${gid}`);
    on('bands', 'bands', `group_id=eq.${gid}`);
    on('band_members', 'members');
    on('band_docs', 'docs');
    on('festivals', 'docs', `group_id=eq.${gid}`);
    on('events', 'events', `group_id=eq.${gid}`);
    on('rooms', 'rooms', `group_id=eq.${gid}`);
    on('reservations', 'resv', `group_id=eq.${gid}`);
    on('posts', 'posts', `group_id=eq.${gid}`);
    channel.subscribe();
  }
  window.addEventListener('online', () => { for (const d of docs.values()) if (d.dirty) pushDoc(d); });

  /* ---------- 로그인 ---------- */
  async function initRemote() {
    if (!configured()) return false;
    const c = window.BM_CONFIG;
    try {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
      });
    } catch (e) { remoteFailed = true; emitAuth(); throw new Error('supabase load failed'); }
    sb = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    if (data.session) await attach(data.session.user);
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(async () => {
        if (event === 'SIGNED_OUT') detach();
        else if (session && (!user || user.id !== session.user.id)) await attach(session.user);
      }, 0);
    });
    emitAuth();
    return true;
  }
  let loadError = '';
  async function attach(u) {
    user = u; loadError = '';
    try {
      await loadProfile();
      if (!profile) throw new Error('프로필이 없습니다');
      docs.clear(); db = emptyDb();
      await loadGroup();
      subscribe();
    } catch (e) {
      console.warn(e);
      loadError = errMsg(e); // 화면에 원인과 다시 시도 버튼을 보여줌 (불러오는 중에 멈추지 않게)
    }
    emitAuth(); emitRemote();
  }
  function detach() {
    if (channel && sb) sb.removeChannel(channel);
    channel = null; user = null; profile = null; groups = []; gid = null;
    roster = []; bandsMeta = []; bandMembers = []; posts = []; events = []; rooms = []; reservations = []; pubFests = [];
    docs.clear(); db = emptyDb();
    emitAuth(); emitRemote();
  }

  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  const normId = (v) => String(v || '').trim().toLowerCase();
  const toLogin = (id) => `${id}@${(window.BM_CONFIG && window.BM_CONFIG.LOGIN_DOMAIN) || 'bandmanager.app'}`;
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

  const Auth = {
    get configured() { return configured(); },
    get ready() { return !!sb; },
    get failed() { return remoteFailed; },
    get restoring() { return false; },
    /** 로그인 후 불러오기 실패 원인 (없으면 '') */
    get loadError() { return loadError; },
    async retry() { if (user) await attach(user); },
    get user() { return user; },
    get profile() { return profile ? { ...profile, phone: myPhone, name: profile.full_name || profile.nickname || profile.username } : null; },
    /** 가입 정보(이름·그룹)가 아직 없음 → 정보 입력 화면 */
    get needsOnboarding() { return !!(user && profile && (!profile.full_name || !groups.length)); },
    onChange(fn) { authListeners.push(fn); },
    USERNAME_RE,
    async signUp(username, password, info) {
      const id = normId(username);
      if (!USERNAME_RE.test(id)) throw new Error('아이디는 영문 소문자·숫자·_ 3~20자로 입력하세요');
      const { data, error } = await sb.auth.signUp({ email: toLogin(id), password, options: { data: { username: id, nickname: info.name } } });
      if (error) throw new Error(authErr(error));
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('이미 사용 중인 아이디입니다');
      if (!data.session) throw new Error('가입은 됐지만 바로 로그인할 수 없습니다. Supabase에서 Confirm email 설정을 꺼주세요');
      user = data.session.user;
      const { error: e2 } = await sb.rpc('complete_profile', { p_name: info.name, p_instruments: info.instruments, p_phone: info.phone, p_group: info.groupId });
      if (e2) throw new Error(errMsg(e2));
      await attach(data.session.user);
    },
    async signIn(username, password) {
      const id = normId(username);
      if (!id) throw new Error('아이디를 입력하세요');
      const { data, error } = await sb.auth.signInWithPassword({ email: id.includes('@') ? id : toLogin(id), password });
      if (error) throw new Error(authErr(error));
      if (!user || user.id !== data.user.id) await attach(data.user);
    },
    async signOut() { await flush(); await sb.auth.signOut(); detach(); },
    /** 이름·악기·전화번호 저장 (+ 그룹 가입) */
    async saveProfile(info) {
      const { error } = await sb.rpc('complete_profile', { p_name: info.name, p_instruments: info.instruments, p_phone: info.phone, p_group: info.groupId || null });
      if (error) throw new Error(errMsg(error));
      await loadProfile();
      if (info.groupId) { gid = info.groupId; try { localStorage.setItem(GROUP_KEY, gid); } catch (e) { /* */ } }
      docs.clear(); await loadGroup(); subscribe();
      emitAuth(); emitRemote();
    },
  };

  /* ---------- 그룹 ---------- */
  const Group = {
    get list() { return groups; },
    get all() { return allGroups; },
    get current() { return myGroup(); },
    get id() { return gid; },
    get isAdmin() { return isAdmin(); },
    get role() { return role(); },
    get roster() { return roster; },
    get loading() { return loading; },
    /** 가입용 전체 그룹 목록 (로그인 전에도) */
    async loadAll() {
      if (!sb) return allGroups;
      const { data, error } = await sb.from('groups').select('id,name').order('name');
      if (!error) allGroups = data || [];
      return allGroups;
    },
    async select(id) {
      if (!groups.some((g) => g.id === id) || id === gid) return;
      await flush();
      gid = id; try { localStorage.setItem(GROUP_KEY, id); } catch (e) { /* */ }
      docs.clear(); db = emptyDb();
      await loadGroup(); subscribe(); emitAuth(); emitRemote();
    },
    async join(id) {
      const { error } = await sb.rpc('join_group', { p_group: id });
      if (error) throw new Error(errMsg(error));
      await loadProfile(); await Group.select(id); emitAuth();
    },
    async setAdmin(userId, on) {
      const { error } = await sb.rpc('set_group_admin', { p_group: gid, p_user: userId, p_admin: on });
      if (error) throw new Error(errMsg(error));
      await reload('me');
    },
    /** 관리자: 회원 악기 정보 수정 */
    async setInstruments(userId, instruments) {
      const { error } = await sb.rpc('admin_set_instruments', { p_group: gid, p_user: userId, p_instruments: instruments });
      if (error) throw new Error(errMsg(error));
      await reload('roster');
      if (user && userId === user.id) { await loadProfile(); emitAuth(); }
    },
    /** 관리자: 그룹에서 내보내기 */
    async removeMember(userId) {
      const { error } = await sb.rpc('remove_group_member', { p_group: gid, p_user: userId });
      if (error) throw new Error(errMsg(error));
      pending.add('members'); await reload('roster');
    },
    person: (id) => roster.find((r) => r.user_id === id) || null,
    personName,
    refresh: (kind = 'all') => { ['roster', 'bands', 'posts', 'events', 'rooms', 'resv', 'pub'].forEach((k) => (kind === 'all' || kind === k) && refreshSoon(k)); },
  };

  /* ---------- 밴드 ---------- */
  const Bands = {
    /** 그룹의 모든 밴드 목록(이름·장르 등) + 내 소속 상태 */
    get list() {
      return bandsMeta.map((b) => {
        const mine = myMembership(b.id);
        const approved = bandMembers.filter((m) => m.band_id === b.id && m.status === 'approved');
        return {
          ...b, color: safeColor(b.color), logo: safeUrl(b.logo),
          memberCount: approved.length,
          leaders: approved.filter((m) => m.role === 'leader').map((m) => personName(m.user_id)),
          myStatus: mine ? mine.status : null, myRole: mine ? mine.role : null,
          canRead: canReadBand(b.id), canEdit: canEditBand(b.id),
        };
      });
    },
    members: (bandId) => bandMembers.filter((m) => m.band_id === bandId).map((m) => ({ ...m, name: personName(m.user_id), instruments: (Group.person(m.user_id) || {}).instruments || [] })),
    canEdit: canEditBand,
    canRead: canReadBand,
    isLeader: isLeaderOf,
    leaderBands: () => bandsMeta.filter((b) => isLeaderOf(b.id)),
    async create(meta) {
      const { data, error } = await sb.rpc('create_band', { p_group: gid, p_name: meta.name, p_genre: meta.genre || '', p_color: meta.color || '#111111', p_bio: meta.bio || '' });
      if (error) throw new Error(errMsg(error));
      if (meta.logo) await sb.from('bands').update({ logo: meta.logo }).eq('id', data);
      bandsMeta = await q(sb.from('bands').select('*').eq('group_id', gid).order('name'));
      bandMembers = await q(sb.from('band_members').select('*').in('band_id', bandsMeta.map((x) => x.id)));
      await loadDocs(); emitRemote();
      return data;
    },
    async requestJoin(bandId, part) { const { error } = await sb.rpc('request_band_join', { p_band: bandId, p_part: part || '' }); if (error) throw new Error(errMsg(error)); refreshSoon('members'); },
    async cancelRequest(bandId) { const { error } = await sb.rpc('cancel_band_request', { p_band: bandId }); if (error) throw new Error(errMsg(error)); refreshSoon('members'); },
    async respond(bandId, userId, accept) { const { error } = await sb.rpc('respond_band_join', { p_band: bandId, p_user: userId, p_accept: accept }); if (error) throw new Error(errMsg(error)); refreshSoon('members'); },
    async setMember(bandId, userId, { role: r, part, position }) {
      const { error } = await sb.rpc('set_band_member', { p_band: bandId, p_user: userId, p_role: r, p_part: part || '', p_position: position || '' });
      if (error) throw new Error(errMsg(error)); refreshSoon('members');
    },
    async removeMember(bandId, userId) { const { error } = await sb.rpc('remove_band_member', { p_band: bandId, p_user: userId }); if (error) throw new Error(errMsg(error)); await reload('members'); },
    /** 관리자: 회원을 밴드에 바로 넣기 / 역할 바꾸기 */
    async adminSet(bandId, userId, r) { const { error } = await sb.rpc('admin_set_band_member', { p_band: bandId, p_user: userId, p_role: r }); if (error) throw new Error(errMsg(error)); await reload('members'); },
    async remove(bandId) {
      const { error } = await sb.from('bands').delete().eq('id', bandId);
      if (error) throw new Error(errMsg(error));
      docs.delete('band:' + bandId);
      bandsMeta = bandsMeta.filter((b) => b.id !== bandId);
      if (db.activeBandId === bandId) db.activeBandId = null;
      assemble(); emitRemote();
    },
  };

  /* ---------- 일정 · 연습실 · 게시판 · 페스티벌 공개 ---------- */
  const reload = async (kind) => { pending.add(kind); clearTimeout(refreshTimer); await runRefresh(); };
  const must = async (p) => { const { error } = await p; if (error) throw new Error(errMsg(error)); };
  const Events = {
    get list() { return events; },
    async add(ev) {
      await must(sb.from('events').insert({ group_id: gid, scope: ev.scope, owner: user.id, title: ev.title, date: ev.date, start_time: ev.start || null, end_time: ev.end || null, note: ev.note || '' }));
      await reload('events');
    },
    async update(id, ev) {
      await must(sb.from('events').update({ title: ev.title, date: ev.date, start_time: ev.start || null, end_time: ev.end || null, note: ev.note || '' }).eq('id', id));
      await reload('events');
    },
    async remove(id) { await must(sb.from('events').delete().eq('id', id)); await reload('events'); },
  };
  const Rooms = {
    get list() { return rooms; },
    get reservations() { return reservations; },
    async addRoom(name) { await must(sb.from('rooms').insert({ group_id: gid, name, sort: rooms.length })); await reload('rooms'); },
    async renameRoom(id, name) { await must(sb.from('rooms').update({ name }).eq('id', id)); await reload('rooms'); },
    async removeRoom(id) { await must(sb.from('rooms').delete().eq('id', id)); await reload('rooms'); await reload('resv'); },
    /** 단장: 승인 대기로 신청 / 관리자: 바로 확정 */
    async reserve(r, direct = false) {
      await must(sb.from('reservations').insert({
        group_id: gid, room_id: r.roomId, band_id: r.bandId, date: r.date, start_time: r.start, end_time: r.end, note: r.note || '',
        status: direct ? 'approved' : 'pending', requested_by: user.id, decided_by: direct ? user.id : null,
      }));
      await reload('resv');
    },
    async decide(id, status) { await must(sb.from('reservations').update({ status, decided_by: user.id }).eq('id', id)); await reload('resv'); },
    async remove(id) { await must(sb.from('reservations').delete().eq('id', id)); await reload('resv'); },
  };
  const Posts = {
    get list() { return posts; },
    async add(p) { await must(sb.from('posts').insert({ group_id: gid, author: user.id, title: p.title, body: p.body || '', images: p.images || [], pinned: !!p.pinned })); await reload('posts'); },
    async update(id, p) { await must(sb.from('posts').update({ title: p.title, body: p.body || '', images: p.images || [], pinned: !!p.pinned }).eq('id', id)); await reload('posts'); },
    async remove(id) { await must(sb.from('posts').delete().eq('id', id)); await reload('posts'); },
  };
  const Festivals = {
    /** 부원도 볼 수 있는 공개 페스티벌 (관리자 포함 모두) */
    get published() { return pubFests; },
    publishedOf: (id) => { const d = docs.get('fest:' + id); return (d && d.published) || {}; },
    async setPublished(id, key, on) {
      const d = docs.get('fest:' + id);
      if (!d) return;
      const next = { ...(d.published || {}), [key]: !!on };
      await must(sb.from('festivals').update({ published: next }).eq('id', id));
      d.published = next;
      await reload('pub');
    },
  };

  /* ---------- 예전(v1) 데이터 가져오기 ----------
     예전 버전의 계정 데이터(app_state)와 이 브라우저에 남은 데이터는 지우지 않고 그대로 두고,
     필요할 때 골라서 새 구조(밴드·페스티벌)로 복사합니다. */
  const Legacy = {
    async sources() {
      const out = [];
      if (sb && user) {
        try {
          const { data: p } = await sb.from('profiles').select('workspace_id').eq('id', user.id).maybeSingle();
          if (p && p.workspace_id) {
            const { data: row } = await sb.from('app_state').select('data').eq('id', p.workspace_id).maybeSingle();
            if (row && row.data && row.data.version === 1) out.push({ label: '예전 계정 데이터 (서버)', data: sanitize(row.data) });
          }
        } catch (e) { console.warn(e); }
      }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!(k === KEY || (k.startsWith(KEY + '.ws.') && !k.endsWith('.meta')))) continue;
          const v = JSON.parse(localStorage.getItem(k));
          if (v && v.version === 1) out.push({ label: k === KEY ? '이 브라우저의 예전 데이터' : '이 브라우저의 예전 계정 캐시', data: sanitize(v) });
        }
      } catch (e) { /* */ }
      return out;
    },
    /** 예전 밴드 하나를 새 밴드로 (내가 단장) */
    async importBand(src, oldBandId) {
      const ob = src.bands.find((b) => b.id === oldBandId);
      if (!ob) throw new Error('밴드를 찾을 수 없습니다');
      const newId = await Bands.create({ name: ob.name, genre: ob.genre, color: ob.color, bio: ob.bio, logo: ob.logo });
      const map = new Map();
      const nid = (old) => { if (!map.has(old)) map.set(old, uid()); return map.get(old); };
      const mem = new Map((ob.members || []).map((m) => [m.id, m.name]));
      const pick = (c) => (src[c] || []).filter((x) => x.bandId === oldBandId);
      const songs = pick('songs').map((s) => ({ ...s, id: nid(s.id), votes: [], proposedBy: '' }));
      const data = {
        band: { founded: ob.founded || iso(new Date()), log: (ob.log || []).map((l) => ({ ...l, id: uid() })) },
        songs,
        setlists: pick('setlists').map((sl) => ({ ...sl, id: uid(), items: (sl.items || []).filter((i) => map.has(i.songId)).map((i) => ({ ...i, id: uid(), songId: map.get(i.songId) })) })),
        rehearsals: pick('rehearsals').map((r) => ({ ...r, id: uid(), attendance: {} })),
        tasks: pick('tasks').map((t) => ({ ...t, id: uid(), memberId: null, songId: t.songId && map.has(t.songId) ? map.get(t.songId) : null, text: mem.has(t.memberId) ? `[${mem.get(t.memberId)}] ${t.text}` : t.text })),
        gigs: pick('gigs').map((g) => ({ ...g, id: uid() })),
      };
      const doc = docs.get('band:' + newId);
      if (doc) {
        COLS.forEach((c) => { db[c] = db[c].filter((x) => x.bandId !== newId).concat(data[c].map((x) => ({ ...x, bandId: newId }))); });
        const b = db.bands.find((x) => x.id === newId);
        if (b) { b.founded = data.band.founded; b.log = data.band.log; }
        persist();
        await flush();
      }
      return newId;
    },
    /** 예전 페스티벌 하나를 새 페스티벌로 (관리자) */
    importFestival(src, oldFestId) {
      const of = src.festivals.find((f) => f.id === oldFestId);
      if (!of) throw new Error('페스티벌을 찾을 수 없습니다');
      const f = JSON.parse(JSON.stringify(of));
      f.id = uid();
      f.acts = (f.acts || []).map((a) => (a.origin === 'mine' ? { ...a, origin: 'real', bandId: undefined } : a));
      f.favorites = [];
      db.festivals.push(f);
      persist();
      return f.id;
    },
  };

  return {
    uid, iso, dayOffset, sanitize,
    get db() { return db; },
    save: persist,
    flush,
    onChange(fn) { listeners.push(fn); },
    onRemote(fn) { remoteListeners.push(fn); },
    initRemote,
    Auth, Group, Bands, Events, Rooms, Posts, Festivals, Legacy, AI: null,

    // 예전 화면 코드가 쓰는 도우미
    band(id = db.activeBandId) { return db.bands.find((b) => b.id === id) || null; },
    setActiveBand(id) { db.activeBandId = id; },
    songsOf(bandId) { return db.songs.filter((s) => s.bandId === bandId && s.status !== 'candidate'); },
    candidatesOf(bandId) { return db.songs.filter((s) => s.bandId === bandId && s.status === 'candidate'); },
    song(id) { return db.songs.find((s) => s.id === id); },
    festival(id = db.activeFestivalId) { return db.festivals.find((f) => f.id === id) || db.festivals[0] || null; },
    remove(col, id) { db[col] = db[col].filter((x) => x.id !== id); persist(); },
    get sb() { return sb; },
  };
})();

/* ---------- AI (Supabase Edge Function 'poster-ai' → Gemini 무료 또는 Claude) ---------- */
Store.AI = {
  get available() { return !!(Store.sb && Store.Auth.user); },
  async posterConcepts(payload) {
    if (!Store.sb || !Store.Auth.user) throw new Error('로그인하면 AI 디자인을 쓸 수 있습니다');
    const { data, error } = await Store.sb.functions.invoke('poster-ai', { body: payload });
    if (error) {
      let msg = error.message || 'AI 호출 실패', status = 0, appMsg = false;
      try {
        status = (error.context && error.context.status) || 0;
        const j = await error.context.json();
        if (j && j.error) { msg = j.error; appMsg = true; }
      } catch (e) { /* */ }
      if (!appMsg && (status === 404 || /Failed to send|not found/i.test(msg))) msg = 'AI 시안 기능이 아직 설정되지 않았습니다 — ✦ 분위기 시안(무료)을 이용하세요';
      else if (!appMsg) msg = 'AI 서버 오류로 시안을 만들지 못했습니다. ✦ 분위기 시안(무료)을 이용하세요';
      throw new Error(msg);
    }
    if (!data || !Array.isArray(data.concepts)) throw new Error('AI 응답 형식이 올바르지 않습니다');
    return { concepts: data.concepts, provider: typeof data.provider === 'string' ? data.provider.slice(0, 20) : 'AI' };
  },
};
