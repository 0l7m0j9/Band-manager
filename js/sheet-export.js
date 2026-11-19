/* =========================================================
   스프레드시트 내보내기 (관리자)
   - 표 만들기: 회원 · 밴드 · 밴드원 · 곡 · 세트리스트 · 합주 · 연습실 예약 · 그룹 일정
   - .xlsx 파일 하나(표마다 탭) → 구글 드라이브에 올리면 구글 시트로 열림
   - 복사 → 새 구글 시트(sheets.new)에 붙여넣기
   외부 라이브러리 없이 직접 xlsx(zip) 를 만듭니다.
   ========================================================= */
window.SheetExport = (() => {
  /* ---------- 데이터 → 표 ---------- */
  const ymd = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const hm = (v) => (typeof v === 'number' ? UI.hm(v) : (v || ''));
  const MOODS = UI.MOODS || {};

  function bandsByUser() {
    const map = {};
    Store.Bands.list.forEach((b) => Store.Bands.members(b.id).forEach((m) => {
      (map[m.user_id] = map[m.user_id] || []).push({ band: b, role: m.role, status: m.status });
    }));
    return map;
  }

  /** 만들 수 있는 표 목록. rows() 는 [머리줄, ...줄] */
  function sheets(opts = {}) {
    const db = Store.db || {};
    const bands = Store.Bands.list;
    const bandName = (id) => (bands.find((b) => b.id === id) || {}).name || '';
    const roomName = (id) => (Store.Rooms.list.find((r) => r.id === id) || {}).name || '';
    const person = (id) => { const r = Store.Group.roster.find((x) => x.user_id === id); return r ? r.name : ''; };
    const songsById = new Map((db.songs || []).map((s) => [s.id, s]));
    const STATUS = { pending: '대기', approved: '승인', rejected: '거절' };
    return [
      { key: 'members', name: '회원', rows() {
        const byUser = bandsByUser();
        const list = opts.members || Store.Group.roster;
        return [['이름', '아이디', '권한', '악기', '전화번호', '소속 밴드', '단장인 밴드', '가입일'],
          ...list.map((r) => {
            const bs = (byUser[r.user_id] || []).filter((x) => x.status === 'approved');
            return [r.name, r.username, r.role === 'admin' ? '관리자' : '회원', (r.instruments || []).join(', '), r.phone || '',
              bs.map((x) => x.band.name).join(', '), bs.filter((x) => x.role === 'leader').map((x) => x.band.name).join(', '), ymd(r.joined_at)];
          })];
      } },
      { key: 'bands', name: '밴드', rows: () => [['밴드', '장르', '단장', '인원', '소개', '만든 날'],
        ...bands.map((b) => [b.name, b.genre || '', (b.leaders || []).join(', '), b.memberCount || 0, b.bio || '', ymd(b.created_at)])] },
      { key: 'bandMembers', name: '밴드원', rows: () => [['밴드', '이름', '역할', '파트', '포지션', '악기', '상태'],
        ...bands.flatMap((b) => Store.Bands.members(b.id).map((m) => [b.name, m.name, m.role === 'leader' ? '단장' : '부원', m.part || '', m.position || '', (m.instruments || []).join(', '), m.status === 'approved' ? '활동' : '가입 신청'] ))] },
      { key: 'songs', name: '곡', rows: () => [['밴드', '곡', '아티스트', '길이', 'BPM', '난이도', '분위기', '진행도(%)', '상태'],
        ...(db.songs || []).map((s) => [bandName(s.bandId), s.title, s.artist || '', UI.dur(s.duration), s.bpm || '', s.difficulty || '', MOODS[s.mood] || s.mood || '', s.progress || 0, s.status === 'candidate' ? '후보곡' : '확정'])] },
      { key: 'setlists', name: '세트리스트', rows: () => [['밴드', '세트리스트', '순서', '곡', '아티스트', '길이', '멘트(초)'],
        ...(db.setlists || []).flatMap((sl) => (sl.items || []).map((it, i) => {
          const s = songsById.get(it.songId) || {};
          return [bandName(sl.bandId), sl.name, i + 1, s.title || '(삭제된 곡)', s.artist || '', s.duration ? UI.dur(s.duration) : '', Number(it.mc) || 0];
        }))] },
      { key: 'rehearsals', name: '합주', rows: () => [['밴드', '날짜', '시작', '끝', '장소', '메모'],
        ...(db.rehearsals || []).slice().sort((a, b) => String(a.date).localeCompare(b.date)).map((r) => [bandName(r.bandId), r.date, hm(r.start), hm(r.end), r.place || '', r.notes || ''])] },
      { key: 'reservations', name: '연습실 예약', rows: () => [['날짜', '시작', '끝', '연습실', '밴드', '상태', '신청자', '메모'],
        ...Store.Rooms.reservations.map((r) => [r.date, r.start_time, r.end_time, roomName(r.room_id), bandName(r.band_id), STATUS[r.status] || r.status, person(r.requested_by), r.note || ''])] },
      { key: 'events', name: '그룹 일정', rows: () => [['날짜', '시작', '끝', '제목', '메모'],
        ...Store.Events.list.filter((e) => e.scope === 'group').sort((a, b) => String(a.date).localeCompare(b.date)).map((e) => [e.date, e.start_time || '종일', e.end_time || '', e.title, e.note || ''])] },
    ];
  }

  /* ---------- 붙여넣기용 텍스트(TSV) ---------- */
  const cellText = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  const toTsv = (rows) => rows.map((r) => r.map(cellText).join('\t')).join('\n');
  async function copy(rows) {
    const text = toTsv(rows);
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* 무시 */ }
      ta.remove(); return ok;
    }
  }

  /* ---------- xlsx 만들기 (zip, 압축 없음) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    files.forEach(({ name, data }) => {
      const nb = enc.encode(name), db = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(db);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, db);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true); c.setUint16(28, nb.length, true);
      c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + db.length;
    });
    const csize = central.reduce((a, x) => a + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const xml = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const safeSheetName = (n, used) => { let b = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet'; let s = b, k = 2; while (used.has(s)) s = `${b.slice(0, 28)} ${k++}`; used.add(s); return s; };

  function sheetXml(rows) {
    const widths = (rows[0] || []).map((_, ci) => Math.min(48, Math.max(6, ...rows.map((r) => [...cellText(r[ci])].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + 2))));
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = col(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xml(v == null ? '' : v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`;
  }

  function xlsx(tabs) {
    const used = new Set();
    const named = tabs.map((t) => ({ ...t, sheet: safeSheetName(t.name, used) }));
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((t, i) => `<sheet name="${xml(t.sheet)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF141210"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
      ...named.map((t, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(t.rows) })),
    ];
    return zip(files);
  }

  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = () => `${(Store.Group.current || {}).name || 'group'}-${Store.iso(new Date())}`;

  /* ---------- 내보내기 창 ---------- */
  function open(opts = {}) {
    const list = sheets(opts);
    const built = new Map(list.map((s) => [s.key, s.rows()]));
    const pre = new Set(opts.only || ['members', 'bands', 'bandMembers', 'reservations', 'events']);
    UI.modal({
      title: '스프레드시트로 내보내기',
      body: `
        <p class="muted" style="font-size:13px;margin-bottom:12px">
          <b>방법 1 · 파일</b> — 고른 표를 탭으로 나눈 <b>.xlsx</b> 파일 하나로 받습니다. 구글 드라이브에 올리고 열면 구글 시트가 됩니다.<br>
          <b>방법 2 · 붙여넣기</b> — 표 옆 <b>복사</b>를 누르고 <b>새 구글 시트</b>에서 A1 칸을 눌러 붙여넣기(Ctrl+V / 길게 눌러 붙여넣기) 하세요.
        </p>
        ${opts.members ? `<p class="muted" style="font-size:12px;margin-bottom:8px">회원 표는 지금 Members 화면의 검색·필터 결과(${opts.members.length}명) 기준입니다.</p>` : ''}
        <div class="xs-list">
          ${list.map((s) => `<div class="xs-row">
            <label><input type="checkbox" data-pick="${s.key}" ${pre.has(s.key) ? 'checked' : ''}> <b>${UI.esc(s.name)}</b>
              <span class="muted num" style="font-size:12px">${built.get(s.key).length - 1}줄</span></label>
            <button type="button" class="btn sm" data-copy="${s.key}">복사</button>
          </div>`).join('')}
        </div>
        <div class="row" style="gap:6px;margin-top:14px;flex-wrap:wrap">
          <button type="button" class="btn solid" id="xsDown">.xlsx 받기</button>
          <a class="btn" href="https://sheets.new" target="_blank" rel="noopener">새 구글 시트 열기 ↗</a>
          <a class="btn ghost" href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener">구글 드라이브 ↗</a>
        </div>`,
      onOpen(f) {
        f.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
          const s = list.find((x) => x.key === b.dataset.copy);
          const ok = await copy(built.get(s.key));
          UI.toast(ok ? `「${s.name}」 표를 복사했습니다 · 구글 시트 A1 칸에 붙여넣으세요` : '복사하지 못했습니다. .xlsx 받기를 써 주세요');
          if (ok) { b.textContent = '복사됨 ✓'; setTimeout(() => { b.textContent = '복사'; }, 1800); }
        });
        f.querySelector('#xsDown').onclick = () => {
          const picked = list.filter((s) => f.querySelector(`[data-pick="${s.key}"]`).checked);
          if (!picked.length) { UI.toast('내보낼 표를 하나 이상 고르세요'); return; }
          save(xlsx(picked.map((s) => ({ name: s.name, rows: built.get(s.key) }))), `${baseName()}.xlsx`);
          UI.toast(`표 ${picked.length}개를 .xlsx 로 받았습니다`);
        };
      },
    });
  }

  return { open, sheets, xlsx, toTsv };
})();
