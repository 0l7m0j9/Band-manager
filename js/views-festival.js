/* =========================================================
   Views — Festival Maker / Lineup / Timetable / Poster / Stage Designer / Personal
   ========================================================= */
(() => {
  const { esc, hm, parseHm, dateKo, dateEn, addDays, modal, toast, confirm } = UI;
  const V = window.Views;
  const db = () => Store.db;
  const go = (h) => { location.hash = h; };
  const PX = 2; // 1분 = 2px

  const ORIGIN = { mine: 'MY BAND', real: 'REAL', virtual: 'VIRTUAL' };
  const actOf = (f, id) => f.acts.find((a) => a.id === id);
  const stageOf = (f, id) => f.stages.find((s) => s.id === id);
  const co = (f, s) => (s.changeover === null || s.changeover === undefined || s.changeover === '' ? Number(f.changeover) || 0 : Number(s.changeover));
  const dayLabel = (f, i) => `DAY ${i + 1} · ${dateEn(addDays(f.startDate, i))}`;

  /** 충돌 검사 */
  function conflicts(f, day) {
    const ids = new Set(), msgs = [];
    const slots = f.slots.filter((s) => s.day === day);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i], b = slots[j];
        const [x, y] = a.start <= b.start ? [a, b] : [b, a];
        if (a.stageId === b.stageId) {
          const xEnd = x.start + x.dur;
          if (xEnd > y.start) {
            ids.add(a.id); ids.add(b.id);
            msgs.push(`<b>${esc(stageOf(f, a.stageId)?.name)}</b> — ${esc(actOf(f, x.actId)?.name)}와 ${esc(actOf(f, y.actId)?.name)}의 공연 시간이 ${xEnd - y.start}분 겹칩니다`);
          } else if (xEnd + co(f, x) > y.start) {
            ids.add(a.id); ids.add(b.id);
            msgs.push(`<b>${esc(stageOf(f, a.stageId)?.name)}</b> — ${esc(actOf(f, x.actId)?.name)} 이후 장비 교체 시간(${co(f, x)}분)이 부족합니다 (${y.start - xEnd}분)`);
          }
        } else if (a.actId === b.actId && x.start + x.dur > y.start) {
          ids.add(a.id); ids.add(b.id);
          msgs.push(`${esc(actOf(f, a.actId)?.name)}이(가) 두 무대에 동시에 배치되어 있습니다`);
        }
      }
    }
    slots.forEach((s) => {
      if (s.start + s.dur > f.dayEnd * 60 || s.start < f.dayStart * 60) {
        ids.add(s.id); msgs.push(`${esc(actOf(f, s.actId)?.name)} 공연이 운영 시간(${hm(f.dayStart * 60)}–${hm(f.dayEnd * 60)})을 벗어납니다`);
      }
    });
    return { ids, msgs };
  }
  V.conflicts = conflicts;

  /* ---------- festival form ---------- */
  function festForm(fest) {
    const f = fest || { name: '', startDate: Store.dayOffset(30), days: 1, venue: '', theme: '', bg: '#f2541b', accent: '#7f5cff', dayStart: 12, dayEnd: 24, changeover: 15 };
    modal({
      title: fest ? '페스티벌 정보 수정' : '새 페스티벌 만들기',
      body: `
        <div class="field"><span class="lbl">festival name *</span><input name="name" value="${esc(f.name)}" required maxlength="30" placeholder="예: Ripple Fest"></div>
        <div class="row">
          <div class="field"><span class="lbl">start date</span><input type="date" name="startDate" value="${f.startDate}"></div>
          <div class="field"><span class="lbl">days</span><input type="number" name="days" min="1" max="5" value="${f.days}"></div>
        </div>
        <div class="field"><span class="lbl">venue</span><input name="venue" value="${esc(f.venue)}" placeholder="장소"></div>
        <div class="field"><span class="lbl">theme / tagline</span><input name="theme" value="${esc(f.theme)}" placeholder="테마"></div>
        <div class="row">
          <div class="field"><span class="lbl">opens (h)</span><input type="number" name="dayStart" min="0" max="23" value="${f.dayStart}"></div>
          <div class="field"><span class="lbl">closes (h)</span><input type="number" name="dayEnd" min="1" max="30" value="${f.dayEnd}"></div>
          <div class="field"><span class="lbl">changeover (min)</span><input type="number" name="changeover" min="0" step="5" value="${f.changeover}"></div>
        </div>
        <div class="row">
          <div class="field" style="flex:0 0 auto"><span class="lbl">poster bg</span><input type="color" name="bg" value="${f.bg}"></div>
          <div class="field" style="flex:0 0 auto"><span class="lbl">accent</span><input type="color" name="accent" value="${f.accent}"></div>
        </div>`,
      onSubmit(d) {
        if (!d.name.trim()) { toast('페스티벌 이름을 입력하세요'); return false; }
        const ds = Math.max(0, Math.min(23, Number(d.dayStart))), de = Math.max(ds + 1, Math.min(30, Number(d.dayEnd)));
        const patch = { name: d.name.trim(), startDate: d.startDate || Store.dayOffset(30), days: Math.max(1, Math.min(5, Number(d.days) || 1)), venue: d.venue.trim(), theme: d.theme.trim(), bg: d.bg, accent: d.accent, dayStart: ds, dayEnd: de, changeover: Math.max(0, Number(d.changeover) || 0) };
        if (fest) {
          Object.assign(fest, patch);
          fest.slots = fest.slots.filter((s) => s.day < fest.days);
        } else {
          const nf = { id: Store.uid(), ...patch, stages: [{ id: Store.uid(), name: 'Main Stage', color: '#f2541b' }], acts: [], slots: [], favorites: [], layouts: {} };
          db().festivals.push(nf); db().activeFestivalId = nf.id;
          Store.save(); go(`#/festival/${nf.id}/lineup`); return;
        }
        Store.save(); App.render();
      },
    });
  }

  /* ================= FESTIVAL LIST ================= */
  V.festivals = (el) => {
    const d = db();
    el.innerHTML = V.pageHead(['festival maker', `${d.festivals.length} festivals`], 'FESTIVAL', 'Maker', '<button class="btn solid" id="nf">+ 새 페스티벌</button>') + `
      <div class="fest-grid">
        ${d.festivals.map((f) => {
          const heads = f.acts.filter((a) => a.headliner).map((a) => a.name);
          return `<a class="fest-card" href="#/festival/${f.id}" style="--fc:${esc(f.bg)};--fa:${esc(f.accent)}">
            <div class="meta"><span>${dateEn(f.startDate)}${f.days > 1 ? ' – ' + dateEn(addDays(f.startDate, f.days - 1)) : ''}</span><span>${esc(f.venue)}</span></div>
            <span class="fname">${esc(f.name)}</span>
            <div style="font-weight:800;font-size:15px;line-height:1.3">${heads.map(esc).join(' · ') || '&nbsp;'}</div>
            <div class="meta" style="margin-top:8px"><span>${f.stages.length} STAGES</span><span>${f.acts.length} ACTS</span></div>
          </a>`;
        }).join('')}
        <a class="fest-card add" id="nf2">+ New Festival</a>
      </div>`;
    el.querySelector('#nf').onclick = el.querySelector('#nf2').onclick = () => festForm();
  };

  /* ================= FESTIVAL DETAIL (tabs) ================= */
  V.festival = (el, [id, tab = 'overview', ...rest]) => {
    const f = id === 'active' ? Store.festival() : db().festivals.find((x) => x.id === id);
    if (!f) { el.innerHTML = UI.empty('Oops', '페스티벌을 찾을 수 없습니다.', '<a class="btn solid" href="#/festivals">목록으로</a>'); return; }
    if (db().activeFestivalId !== f.id) { db().activeFestivalId = f.id; Store.save(); }
    const tabs = [['overview', 'Overview'], ['lineup', 'Lineup'], ['timetable', 'Timetable'], ['poster', 'Poster'], ['stage', 'Stage Designer']];
    el.innerHTML = `
      <div class="page-head">
        <div>
          <div class="eyebrow"><span class="lbl">${dateEn(f.startDate)}${f.days > 1 ? ' – ' + dateEn(addDays(f.startDate, f.days - 1)) : ''}</span><span class="lbl">${esc(f.venue)}</span></div>
          <h1 class="page-title"><span class="tech">FESTIVAL</span><span class="wave" style="font-size:1.25em;line-height:.8;display:inline-block;color:${esc(f.accent)}">${esc(f.name)}</span></h1>
        </div>
        <div class="page-actions"><a class="btn" href="#/personal">Personal →</a><a class="btn ghost" href="#/festivals">All festivals</a></div>
      </div>
      <nav class="tabs">${tabs.map(([k, v]) => `<a href="#/festival/${f.id}/${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</nav>
      <div id="tab"></div>`;
    const t = el.querySelector('#tab');
    ({ overview, lineup, timetable, poster, stage }[tab] || overview)(t, f, rest);
  };

  /* ---------- Overview: info + stages ---------- */
  function overview(el, f) {
    const total = f.slots.reduce((a, s) => a + s.dur, 0);
    el.innerHTML = `
      <div class="split">
        <section class="section">
          <div class="section-head"><h3>Info</h3><button class="btn sm" id="edit">수정</button></div>
          <table class="tbl"><tbody>
            <tr><td class="lbl">name</td><td><b>${esc(f.name)}</b></td></tr>
            <tr><td class="lbl">dates</td><td>${dateKo(f.startDate, { year: 'numeric' })} 부터 ${f.days}일</td></tr>
            <tr><td class="lbl">venue</td><td>${esc(f.venue) || '—'}</td></tr>
            <tr><td class="lbl">theme</td><td>${esc(f.theme) || '—'}</td></tr>
            <tr><td class="lbl">hours</td><td class="mono">${hm(f.dayStart * 60)} – ${hm(f.dayEnd * 60)}</td></tr>
            <tr><td class="lbl">changeover</td><td class="mono">${f.changeover} min (기본 장비 교체 시간)</td></tr>
            <tr><td class="lbl">colors</td><td><span class="chip" style="background:${esc(f.bg)}">bg</span> <span class="chip" style="background:${esc(f.accent)};color:#fff">accent</span></td></tr>
          </tbody></table>
          <div class="stats" style="border:1px solid var(--line);margin-top:20px">
            <div class="stat"><span class="lbl">stages</span><b class="num">${f.stages.length}</b></div>
            <div class="stat"><span class="lbl">acts</span><b class="num">${f.acts.length}</b></div>
            <div class="stat"><span class="lbl">slots</span><b class="num">${f.slots.length}</b></div>
            <div class="stat"><span class="lbl">music hrs</span><b class="num">${(total / 60).toFixed(1)}</b></div>
          </div>
          <button class="btn ghost" id="delF" style="margin-top:20px">페스티벌 삭제</button>
        </section>
        <section class="section">
          <div class="section-head"><h3>Stages</h3><button class="btn sm solid" id="addSt">+ 무대</button></div>
          ${f.stages.map((s) => `
            <div class="stage-pill" data-st="${s.id}">
              <input type="color" value="${esc(s.color)}" data-c aria-label="무대 색상" style="width:32px;height:26px">
              <input class="inline-input" value="${esc(s.name)}" data-n style="font-weight:800;font-size:18px">
              <span class="lbl" style="white-space:nowrap">${f.slots.filter((x) => x.stageId === s.id).length} slots</span>
              <a class="btn sm ghost" href="#/festival/${f.id}/stage/${s.id}">장비</a>
              <button class="btn icon ghost" data-rm>✕</button>
            </div>`).join('')}
          <p class="lbl" style="margin-top:12px">next → <a href="#/festival/${f.id}/lineup">add acts to the lineup</a></p>
        </section>
      </div>`;
    el.querySelector('#edit').onclick = () => festForm(f);
    el.querySelector('#delF').onclick = () => confirm(`「${esc(f.name)}」 페스티벌을 삭제할까요?`, () => {
      Store.remove('festivals', f.id); db().activeFestivalId = db().festivals[0]?.id || null; Store.save(); go('#/festivals');
    });
    el.querySelector('#addSt').onclick = () => {
      const palette = ['#f2541b', '#7f5cff', '#d6ff3a', '#3d9a2b', '#141210', '#6fd3ff'];
      f.stages.push({ id: Store.uid(), name: `Stage ${f.stages.length + 1}`, color: palette[f.stages.length % palette.length] });
      Store.save(); App.render();
    };
    el.querySelectorAll('[data-st]').forEach((row) => {
      const s = stageOf(f, row.dataset.st);
      row.querySelector('[data-n]').onchange = (e) => { s.name = e.target.value.trim() || s.name; Store.save(); };
      row.querySelector('[data-c]').onchange = (e) => { s.color = e.target.value; Store.save(); };
      row.querySelector('[data-rm]').onclick = () => {
        if (f.stages.length === 1) { toast('무대는 최소 1개 필요합니다'); return; }
        confirm(`${esc(s.name)} 무대와 배치된 공연 ${f.slots.filter((x) => x.stageId === s.id).length}개를 삭제할까요?`, () => {
          f.stages = f.stages.filter((x) => x.id !== s.id);
          f.slots = f.slots.filter((x) => x.stageId !== s.id);
          Object.keys(f.layouts).forEach((k) => k.startsWith(s.id) && delete f.layouts[k]);
          Store.save(); App.render();
        });
      };
    });
  }

  /* ---------- Lineup ---------- */
  function actForm(f, act) {
    const a = act || { name: '', genre: '', origin: 'virtual', headliner: false };
    modal({
      title: act ? '출연진 수정' : '출연진 추가',
      body: `
        <div class="field"><span class="lbl">band / artist *</span><input name="name" value="${esc(a.name)}" required></div>
        <div class="row">
          <div class="field"><span class="lbl">genre</span><input name="genre" value="${esc(a.genre)}"></div>
          <div class="field"><span class="lbl">type</span><select name="origin">${Object.entries(ORIGIN).filter(([k]) => k !== 'mine' || a.origin === 'mine').map(([k, v]) => `<option value="${k}" ${k === a.origin ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <label class="row" style="gap:8px;font-weight:700"><input type="checkbox" name="headliner" ${a.headliner ? 'checked' : ''}> ★ 헤드라이너</label>`,
      onSubmit(d) {
        if (!d.name.trim()) { toast('이름을 입력하세요'); return false; }
        const patch = { name: d.name.trim(), genre: d.genre.trim(), origin: d.origin, headliner: !!d.headliner };
        if (act) Object.assign(act, patch); else f.acts.push({ id: Store.uid(), ...patch });
        Store.save(); App.render();
      },
    });
  }

  function lineup(el, f) {
    const sorted = [...f.acts].sort((a, b) => (b.headliner - a.headliner) || a.name.localeCompare(b.name));
    el.innerHTML = `
      <div class="row" style="margin-bottom:16px;justify-content:space-between">
        <p class="lbl">${f.acts.filter((a) => a.headliner).length} headliners · ${f.acts.length} acts</p>
        <div class="row"><button class="btn" id="imp">내 밴드 불러오기</button><button class="btn solid" id="add">+ 출연진</button></div>
      </div>
      ${f.acts.length ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th style="width:44px">head</th><th>name</th><th>genre</th><th>type</th><th>slots</th><th></th></tr></thead>
        <tbody>${sorted.map((a) => {
          const sl = f.slots.filter((s) => s.actId === a.id);
          return `<tr data-a="${a.id}">
            <td><button class="star ${a.headliner ? 'on' : ''}" data-h title="헤드라이너 지정">★</button></td>
            <td><b style="font-size:${a.headliner ? 22 : 16}px">${esc(a.name)}</b></td>
            <td>${esc(a.genre)}</td>
            <td><span class="chip ${a.origin === 'mine' ? 'lime' : a.origin === 'real' ? 'ink' : ''}">${ORIGIN[a.origin]}</span></td>
            <td class="mono" style="font-size:12px">${sl.map((s) => `D${s.day + 1} ${hm(s.start)} ${esc(stageOf(f, s.stageId)?.name || '')}`).join('<br>') || '<span class="muted">미배치</span>'}</td>
            <td class="r" style="white-space:nowrap"><button class="btn icon sm ghost" data-e>✎</button><button class="btn icon sm ghost" data-rm>✕</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>
        <p class="lbl" style="margin-top:12px">next → <a href="#/festival/${f.id}/timetable">build the timetable</a></p>`
      : UI.empty('Lineup', '출연할 밴드를 추가하세요. 실제 밴드, 가상의 밴드, 내 밴드 모두 가능합니다.')}`;
    el.querySelector('#add').onclick = () => actForm(f);
    el.querySelector('#imp').onclick = () => {
      let n = 0;
      db().bands.forEach((b) => {
        if (!f.acts.some((a) => a.bandId === b.id)) { f.acts.push({ id: Store.uid(), name: b.name, genre: b.genre, origin: 'mine', bandId: b.id, headliner: false }); n++; }
      });
      Store.save(); App.render(); toast(n ? `내 밴드 ${n}팀을 추가했습니다` : '이미 모두 등록되어 있습니다');
    };
    el.querySelectorAll('[data-a]').forEach((row) => {
      const a = actOf(f, row.dataset.a);
      row.querySelector('[data-h]').onclick = () => { a.headliner = !a.headliner; Store.save(); App.render(); };
      row.querySelector('[data-e]').onclick = () => actForm(f, a);
      row.querySelector('[data-rm]').onclick = () => confirm(`${esc(a.name)}을(를) 라인업에서 삭제할까요?`, () => {
        f.acts = f.acts.filter((x) => x.id !== a.id);
        f.slots = f.slots.filter((s) => s.actId !== a.id);
        f.favorites = f.favorites.filter((x) => x !== a.id);
        Store.save(); App.render();
      });
    });
  }

  /* ---------- Timetable ---------- */
  let ttDay = 0;
  function slotForm(f, slot, preset = {}) {
    const s = slot || { actId: f.acts[0]?.id, stageId: f.stages[0].id, day: ttDay, start: f.dayStart * 60 + 60, dur: 45, changeover: null, ...preset };
    modal({
      title: slot ? '공연 시간 수정' : '공연 배치',
      body: `
        <div class="field"><span class="lbl">act</span><select name="actId">${f.acts.map((a) => `<option value="${a.id}" ${a.id === s.actId ? 'selected' : ''}>${a.headliner ? '★ ' : ''}${esc(a.name)}</option>`).join('')}</select></div>
        <div class="row">
          <div class="field"><span class="lbl">stage</span><select name="stageId">${f.stages.map((x) => `<option value="${x.id}" ${x.id === s.stageId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="field"><span class="lbl">day</span><select name="day">${Array.from({ length: f.days }, (_, i) => `<option value="${i}" ${i === s.day ? 'selected' : ''}>${dayLabel(f, i)}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div class="field"><span class="lbl">start</span><input type="time" name="start" step="300" value="${hm(s.start)}"></div>
          <div class="field"><span class="lbl">length (min)</span><input type="number" name="dur" min="5" step="5" value="${s.dur}"></div>
          <div class="field"><span class="lbl">changeover after</span><input type="number" name="changeover" min="0" step="5" value="${s.changeover ?? ''}" placeholder="기본 ${f.changeover}"></div>
        </div>
        ${slot ? `<a class="btn sm ghost" href="#/festival/${f.id}/stage/${s.stageId}/${s.actId}">이 공연의 무대 구성 보기 →</a>` : ''}`,
      extra: slot ? '<button type="button" class="btn ghost left" id="delSlot">배치 해제</button>' : '',
      onOpen(form, close) {
        const d = form.querySelector('#delSlot');
        if (d) d.onclick = () => { f.slots = f.slots.filter((x) => x.id !== slot.id); Store.save(); close(); App.render(); };
        form.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
      },
      onSubmit(d) {
        let start = parseHm(d.start);
        if (start < f.dayStart * 60 && f.dayEnd > 24) start += 24 * 60; // 자정 넘어가는 공연
        const patch = { actId: d.actId, stageId: d.stageId, day: Number(d.day), start, dur: Math.max(5, Number(d.dur) || 45), changeover: d.changeover === '' ? null : Math.max(0, Number(d.changeover)) };
        if (slot) Object.assign(slot, patch); else f.slots.push({ id: Store.uid(), ...patch });
        ttDay = patch.day;
        Store.save(); App.render();
      },
    });
  }

  function timetable(el, f) {
    if (ttDay >= f.days) ttDay = 0;
    const day = ttDay;
    const { ids, msgs } = conflicts(f, day);
    const dayMin = f.dayStart * 60, dayMax = f.dayEnd * 60;
    const H = (dayMax - dayMin) * PX;
    const daySlots = f.slots.filter((s) => s.day === day);
    const usage = (aid) => f.slots.filter((s) => s.actId === aid).length;
    el.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:16px">
        <nav class="tabs" style="margin:0">${Array.from({ length: f.days }, (_, i) => `<a href="#" data-day="${i}" class="${i === day ? 'on' : ''}">${dayLabel(f, i)}</a>`).join('')}</nav>
        <div class="row"><label class="row lbl" style="gap:6px">changeover <input class="input num" type="number" id="co" min="0" step="5" value="${f.changeover}" style="width:60px"> min</label>
        <button class="btn solid" id="addSlot" ${f.acts.length ? '' : 'disabled'}>+ 공연 배치</button></div>
      </div>
      <div class="conflict-box ${msgs.length ? '' : 'ok'}">
        ${msgs.length ? `<b>⚠ 충돌 ${msgs.length}건</b><ul style="margin:6px 0 0;padding-left:18px">${msgs.map((m) => `<li>${m}</li>`).join('')}</ul>` : `<b>✓ 충돌 없음</b> <span style="font-size:13px">— ${daySlots.length}개 공연, 모든 무대의 장비 교체 시간이 확보되었습니다.</span>`}
      </div>
      <div class="tt-layout">
        <aside class="tt-side">
          <div class="section-head"><h3>Lineup</h3><span class="count">drag →</span></div>
          ${f.acts.map((a) => `<div class="act-chip ${usage(a.id) ? 'scheduled' : ''}" draggable="true" data-act="${a.id}"><span>${a.headliner ? '★ ' : ''}${esc(a.name)}</span>${usage(a.id) ? `<span class="chip">${usage(a.id)}</span>` : ''}</div>`).join('') || `<p class="muted">출연진이 없습니다. <a href="#/festival/${f.id}/lineup">추가하기</a></p>`}
          <p class="lbl" style="margin-top:12px;line-height:1.6">drag block = move<br>drag bottom edge = resize<br>click = edit · 5 min snap<br>hatched = changeover</p>
        </aside>
        <div class="tt-scroll">
          <div class="tt-grid" style="grid-template-columns:56px repeat(${f.stages.length}, minmax(180px, 1fr));--hour:${60 * PX}px">
            <div class="tt-head corner">${day + 1}</div>
            ${f.stages.map((s) => `<div class="tt-head"><span style="display:inline-block;flex:none;background:${esc(s.color)};width:12px;height:12px;border-radius:50%;border:1px solid #fff"></span>${esc(s.name)}</div>`).join('')}
            <div class="tt-times" style="height:${H}px;position:sticky">
              ${Array.from({ length: f.dayEnd - f.dayStart + 1 }, (_, i) => `<div class="tt-time" style="top:${i * 60 * PX}px">${hm((f.dayStart + i) * 60)}</div>`).join('')}
            </div>
            ${f.stages.map((st) => `<div class="tt-col" data-stage="${st.id}" style="height:${H}px">
              ${daySlots.filter((s) => s.stageId === st.id).map((s) => {
                const a = actOf(f, s.actId); if (!a) return '';
                const c = co(f, s);
                return `${c ? `<div class="changeover" style="top:${(s.start + s.dur - dayMin) * PX}px;height:${c * PX}px">${c}′ change</div>` : ''}
                  <div class="slot ${a.headliner ? 'head' : ''} ${ids.has(s.id) ? 'conflict' : ''}" data-slot="${s.id}" style="top:${(s.start - dayMin) * PX}px;height:${s.dur * PX}px;--sc:${esc(st.color)};${st.color === '#141210' ? 'color:var(--paper)' : ''}">
                    <div class="sn">${esc(a.name)}</div><div class="st">${hm(s.start)}–${hm(s.start + s.dur)} · ${s.dur}′</div>
                    <div class="rs" title="길이 조절"></div>
                  </div>`;
              }).join('')}
            </div>`).join('')}
          </div>
        </div>
      </div>`;

    el.querySelectorAll('[data-day]').forEach((a) => a.onclick = (e) => { e.preventDefault(); ttDay = Number(a.dataset.day); App.render(); });
    el.querySelector('#co').onchange = (e) => { f.changeover = Math.max(0, Number(e.target.value) || 0); Store.save(); App.render(); };
    el.querySelector('#addSlot').onclick = () => slotForm(f);

    const scroller = el.querySelector('.tt-scroll');
    const cols = [...el.querySelectorAll('.tt-col')];
    const snap = (m) => Math.round(m / 5) * 5;

    // 라인업 → 무대 (HTML5 DnD)
    el.querySelectorAll('.act-chip').forEach((c) => {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/act', c.dataset.act); e.dataTransfer.effectAllowed = 'copy'; });
      c.addEventListener('click', () => slotForm(f, null, { actId: c.dataset.act }));
    });
    cols.forEach((col) => {
      col.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/act')) { e.preventDefault(); col.classList.add('drop-hot'); } });
      col.addEventListener('dragleave', () => col.classList.remove('drop-hot'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('drop-hot');
        const actId = e.dataTransfer.getData('text/act'); if (!actId) return;
        const y = e.clientY - col.getBoundingClientRect().top;
        const dur = 45;
        const start = Math.min(dayMax - dur, Math.max(dayMin, snap(dayMin + y / PX)));
        f.slots.push({ id: Store.uid(), actId, stageId: col.dataset.stage, day, start, dur, changeover: null });
        Store.save(); App.render();
      });
    });

    // 블록 이동 / 리사이즈 (Pointer events)
    el.querySelectorAll('.slot').forEach((node) => {
      node.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const slot = f.slots.find((x) => x.id === node.dataset.slot);
        const resize = e.target.classList.contains('rs');
        const sx = e.clientX, sy = e.clientY, sTop = scroller.scrollTop;
        const orig = { start: slot.start, dur: slot.dur, stageId: slot.stageId };
        let moved = false, next = { ...orig };
        node.setPointerCapture(e.pointerId);
        node.classList.add('moving');
        const label = node.querySelector('.st');
        const onMove = (ev) => {
          const dy = ev.clientY - sy + (scroller.scrollTop - sTop);
          if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
          moved = true;
          const dm = snap(dy / PX);
          if (resize) {
            next.dur = Math.max(10, Math.min(dayMax - orig.start, orig.dur + dm));
            node.style.height = next.dur * PX + 'px';
          } else {
            next.start = Math.min(dayMax - orig.dur, Math.max(dayMin, orig.start + dm));
            node.style.top = (next.start - dayMin) * PX + 'px';
            const col = cols.find((c) => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right; });
            if (col) {
              next.stageId = col.dataset.stage;
              const home = node.parentElement.getBoundingClientRect().left;
              node.style.transform = `translateX(${col.getBoundingClientRect().left - home}px)`;
            }
          }
          label.textContent = `${hm(next.start)}–${hm(next.start + next.dur)} · ${next.dur}′`;
        };
        const onUp = () => {
          node.removeEventListener('pointermove', onMove);
          node.removeEventListener('pointerup', onUp);
          node.removeEventListener('pointercancel', onUp);
          node.classList.remove('moving');
          if (!moved) { slotForm(f, slot); return; }
          Object.assign(slot, next);
          Store.save(); App.render();
        };
        node.addEventListener('pointermove', onMove);
        node.addEventListener('pointerup', onUp);
        node.addEventListener('pointercancel', onUp);
      });
    });

    // 첫 공연 위치로 스크롤
    const first = daySlots.reduce((m, s) => Math.min(m, s.start), Infinity);
    if (isFinite(first)) scroller.scrollTop = Math.max(0, (first - dayMin - 30) * PX);
  }
  V.timetableTab = timetable;

  /* ---------- Poster (Canvas) ---------- */
  let posterTpl = 'ripple';
  async function poster(el, f) {
    el.innerHTML = `
      <div class="poster-layout">
        <aside>
          <div class="section-head"><h3>Template</h3></div>
          <div class="tpl-pick">
            <button data-tpl="ripple" class="${posterTpl === 'ripple' ? 'on' : ''}" style="background:${esc(f.bg)};color:${esc(f.accent)}"><span class="wave-sm" style="font-size:30px;color:inherit">Ripple</span></button>
            <button data-tpl="grid" class="${posterTpl === 'grid' ? 'on' : ''}" style="background:#3d9a2b;color:#141210;font-size:22px;letter-spacing:-.03em">Grid</button>
          </div>
          <div class="row">
            <label class="field" style="flex:0 0 auto"><span class="lbl">background</span><input type="color" id="pbg" value="${esc(f.bg)}"></label>
            <label class="field" style="flex:0 0 auto"><span class="lbl">accent</span><input type="color" id="pac" value="${esc(f.accent)}"></label>
          </div>
          <p class="muted" style="font-size:13px;margin-bottom:14px">라인업 · 헤드라이너 · 날짜 · 장소가 자동으로 배치됩니다. 헤드라이너는 Lineup 탭에서 ★로 지정하세요.</p>
          <div class="row"><button class="btn solid" id="dl">PNG 저장</button><button class="btn" id="share">공유</button></div>
        </aside>
        <div><canvas class="poster-canvas" id="pc" width="1080" height="1350" aria-label="페스티벌 포스터"></canvas></div>
      </div>`;
    const canvas = el.querySelector('#pc');
    el.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => { posterTpl = b.dataset.tpl; App.render(); });
    el.querySelector('#pbg').onchange = (e) => { f.bg = e.target.value; Store.save(); App.render(); };
    el.querySelector('#pac').onchange = (e) => { f.accent = e.target.value; Store.save(); App.render(); };
    el.querySelector('#dl').onclick = () => UI.download(canvas.toDataURL('image/png'), `${f.name}-poster.png`);
    el.querySelector('#share').onclick = () => UI.shareCanvas(canvas, `${f.name}-poster.png`, `${f.name} @ ${f.venue}`);
    try {
      await Promise.all(['400 80px "Instrument Serif"', '400 40px Michroma', '800 40px Pretendard', '500 30px Pretendard', '400 20px "Space Mono"'].map((x) => document.fonts.load(x)));
    } catch (e) { /* fallback fonts */ }
    drawPoster(canvas, f, posterTpl);
  }

  function grain(ctx, w, h, alpha = .1) {
    const n = document.createElement('canvas'); n.width = n.height = 160;
    const nc = n.getContext('2d'), img = nc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 * alpha * Math.random(); }
    nc.putImageData(img, 0, 0);
    ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(0, 0, w, h);
  }
  function fitFont(ctx, text, family, weight, maxW, maxSize) {
    let size = maxSize;
    do { ctx.font = `${weight} ${size}px ${family}`; size -= 4; } while (ctx.measureText(text).width > maxW && size > 12);
    return size + 4;
  }
  /** 물결 왜곡 텍스트 */
  function rippleText(ctx, text, cx, cy, size, color, maxW) {
    const s = fitFont(ctx, text, '"Instrument Serif", serif', 400, maxW, size);
    const off = document.createElement('canvas');
    off.width = Math.ceil(maxW + 120); off.height = Math.ceil(s * 1.4);
    const o = off.getContext('2d');
    o.font = `400 ${s}px "Instrument Serif", serif`; o.fillStyle = color; o.textAlign = 'center'; o.textBaseline = 'middle';
    o.fillText(text, off.width / 2, off.height / 2);
    const amp = s * .045;
    for (let y = 0; y < off.height; y++) {
      const dx = Math.sin(y / (s * .09)) * amp + Math.sin(y / (s * .023) + 1.3) * amp * .35;
      ctx.drawImage(off, 0, y, off.width, 1, cx - off.width / 2 + dx, cy - off.height / 2 + y, off.width, 1);
    }
  }
  function wrapCenter(ctx, words, cx, y, maxW, lineH, sep = '  ·  ') {
    let line = '';
    const lines = [];
    words.forEach((w) => {
      const t = line ? line + sep + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lineH));
    return y + lines.length * lineH;
  }

  function drawPoster(canvas, f, tpl) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, M = 70;
    const startD = new Date(f.startDate + 'T00:00:00');
    const endIso = addDays(f.startDate, f.days - 1);
    const mon = startD.toLocaleString('en', { month: 'short' }).toUpperCase();
    const dateLine = f.days > 1 ? `${startD.getDate()} / ${new Date(endIso + 'T00:00:00').getDate()} ${mon}  ${startD.getFullYear()}` : `${startD.getDate()} ${mon}  ${startD.getFullYear()}`;
    const byDay = Array.from({ length: f.days }, (_, d) => {
      const ids = [...new Set(f.slots.filter((s) => s.day === d).sort((a, b) => b.start - a.start).map((s) => s.actId))];
      return ids.map((id) => actOf(f, id)).filter(Boolean).sort((a, b) => b.headliner - a.headliner);
    });
    const unscheduled = f.acts.filter((a) => !f.slots.some((s) => s.actId === a.id));
    if (unscheduled.length) {
      if (byDay.every((d) => !d.length)) byDay[0] = [...f.acts].sort((a, b) => b.headliner - a.headliner);
    }
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    if (tpl === 'ripple') {
      ctx.fillStyle = f.bg; ctx.fillRect(0, 0, W, H);
      grain(ctx, W, H, .12);
      const fg = '#fff8f2';
      ctx.fillStyle = fg; ctx.font = '500 30px Pretendard'; ctx.textAlign = 'left';
      ctx.fillText(dateLine, M, M + 20);
      ctx.fillText(`H ${hm(f.dayStart * 60)}`, M, M + 60);
      ctx.textAlign = 'right';
      ctx.fillText((f.venue || '').toUpperCase(), W - M, M + 20);
      ctx.fillText((f.theme || '').toUpperCase().slice(0, 34), W - M, M + 60);
      // title
      ctx.textAlign = 'center';
      fitFont(ctx, 'MUSIC FESTIVAL', 'Michroma', 400, W - M * 4, 56);
      ctx.fillStyle = fg; ctx.fillText('MUSIC FESTIVAL', W / 2, 270);
      rippleText(ctx, f.name, W / 2, 410, 230, f.accent, W - M * 2);
      // lineup
      let y = 620;
      byDay.forEach((acts, d) => {
        if (!acts.length) return;
        ctx.font = '500 30px Pretendard'; ctx.fillStyle = fg;
        ctx.fillText(f.days > 1 ? dateEn(addDays(f.startDate, d)) : 'LINE UP', W / 2, y); y += 56;
        const heads = acts.filter((a) => a.headliner).map((a) => a.name.toUpperCase());
        const rest = acts.filter((a) => !a.headliner).map((a) => a.name.toUpperCase());
        if (heads.length) { ctx.font = '800 64px Pretendard'; y = wrapCenter(ctx, heads, W / 2, y, W - M * 2, 72); }
        ctx.font = '800 38px Pretendard';
        y = wrapCenter(ctx, rest, W / 2, y + 6, W - M * 2.5, 50);
        y += 40;
      });
      // footer
      ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(M, H - 150); ctx.lineTo(W - M, H - 150); ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '400 18px "Space Mono"'; ctx.fillStyle = fg;
      ctx.fillText('STAGES', M, H - 112);
      ctx.font = '600 26px Pretendard';
      ctx.fillText(f.stages.map((s) => s.name.toUpperCase()).join('  /  ').slice(0, 60), M, H - 76);
      ctx.textAlign = 'right'; ctx.font = '800 30px Pretendard';
      ctx.fillText('FREE ENTRY', W - M, H - 108);
      ctx.font = '500 34px Pretendard';
      ctx.fillText(f.name.toLowerCase().replace(/\s+/g, '') + '.fest', W - M, H - 66);
    } else {
      // MUTEK-like grid template
      const bg = '#3d9a2b', ink = '#141210', lime = '#d6ff3a';
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      grain(ctx, W, H, .08);
      ctx.fillStyle = lime; ctx.fillRect(0, 0, W, 54);
      ctx.fillStyle = ink; ctx.font = '700 20px Pretendard'; ctx.textAlign = 'left';
      for (let x = -20; x < W; x += 170) ctx.fillText('get ticket   ↗', x, 35);
      ctx.font = '400 30px Michroma'; ctx.fillText(f.name.toUpperCase().slice(0, 22), M, 130);
      ctx.font = '500 18px Pretendard';
      ctx.fillText('international festival of', W - 330, 112); ctx.fillText('independent music & bands', W - 330, 136);
      // big repeated headliner
      const head = (f.acts.find((a) => a.headliner) || f.acts[0] || { name: f.name }).name;
      ctx.font = '600 210px Pretendard';
      const hw = ctx.measureText(head).width + 260;
      const rowY = [400, 620];
      rowY.forEach((ry, r) => {
        let x = r ? -hw * .45 : -40;
        while (x < W) {
          ctx.fillStyle = ink; ctx.fillText(head, x, ry);
          ctx.fillStyle = f.accent; ctx.fillRect(x + hw - 230, ry - 140, 190, 120);
          ctx.fillStyle = ink; ctx.font = '400 16px "Space Mono"'; ctx.fillText('LIVE', x + hw - 290, ry - 150); ctx.font = '600 210px Pretendard';
          x += hw;
        }
      });
      // lineup columns by day
      const colW = (W - M * 2 - 40 * (f.days - 1)) / Math.max(1, Math.min(f.days, 3));
      byDay.slice(0, 3).forEach((acts, d) => {
        const x = M + d * (colW + 40);
        let y = 760;
        ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + colW, y); ctx.stroke();
        ctx.fillStyle = ink; ctx.textAlign = 'left';
        ctx.font = '700 24px Pretendard'; ctx.fillText(`Day ${d + 1}`, x, y + 40);
        ctx.font = '500 22px Pretendard'; ctx.fillText(dateKo(addDays(f.startDate, d), { year: 'numeric' }), x, y + 72);
        y += 120;
        acts.slice(0, 9).forEach((a) => {
          const s = fitFont(ctx, a.name, 'Pretendard', a.headliner ? 800 : 600, colW, a.headliner ? 44 : 32);
          ctx.fillText(a.name, x, y); y += s + 12;
        });
      });
      ctx.font = '500 22px Pretendard'; ctx.textAlign = 'left';
      ctx.fillText(`${f.venue}  ·  ${hm(f.dayStart * 60)} — ${hm(f.dayEnd * 60)}`, M, H - 60);
      ctx.textAlign = 'right'; ctx.fillText(`${f.stages.length} stages / ${f.acts.length} acts`, W - M, H - 60);
    }
  }

  /* ---------- Stage Designer ---------- */
  const GEAR = { drum: 'Drums', gamp: 'Gtr Amp', bamp: 'Bass Amp', mic: 'Mic', key: 'Keys', mon: 'Monitor', pa: 'PA', di: 'DI' };
  const DEFAULT_LAYOUT = () => [
    { type: 'drum', x: 50, y: 30 }, { type: 'gamp', x: 25, y: 32 }, { type: 'bamp', x: 75, y: 32 },
    { type: 'mic', x: 50, y: 66 }, { type: 'mic', x: 30, y: 62 }, { type: 'mon', x: 50, y: 80 }, { type: 'mon', x: 30, y: 78 },
    { type: 'pa', x: 4, y: 70 }, { type: 'pa', x: 96, y: 70 },
  ].map((g) => ({ id: Store.uid(), rot: 0, ...g }));

  function stage(el, f, [stageId, actId] = []) {
    const st = stageOf(f, stageId) || f.stages[0];
    const actsHere = [...new Set(f.slots.filter((s) => s.stageId === st.id).map((s) => s.actId))].map((id) => actOf(f, id)).filter(Boolean);
    const act = actId && actOf(f, actId);
    const key = act ? `${st.id}:${act.id}` : st.id;
    const hasOwn = !!f.layouts[key];
    let items = f.layouts[key] || (act && f.layouts[st.id]) || null;
    items = items ? items.map((x) => ({ ...x })) : DEFAULT_LAYOUT();
    let sel = null;

    el.innerHTML = `
      <div class="sd-layout">
        <aside>
          <div class="field"><span class="lbl">stage</span><select class="input" id="stSel">${f.stages.map((s) => `<option value="${s.id}" ${s.id === st.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><span class="lbl">show</span><select class="input" id="actSel"><option value="">기본 무대 구성</option>${actsHere.map((a) => `<option value="${a.id}" ${act && a.id === act.id ? 'selected' : ''}>${esc(a.name)}${f.layouts[`${st.id}:${a.id}`] ? ' ●' : ''}</option>`).join('')}</select></div>
          <p class="muted" style="font-size:12px;margin:-6px 0 14px">${act ? (hasOwn ? '이 공연 전용 구성입니다.' : '기본 구성을 보여주는 중 — 편집하면 이 공연 전용으로 저장됩니다.') : '● = 공연별 전용 구성이 있음'}</p>
          <div class="section-head"><h3>Gear</h3><span class="count">click to add</span></div>
          ${Object.entries(GEAR).map(([k, v]) => `<button class="gear-btn" data-g="${k}">＋ ${v}</button>`).join('')}
          <div class="row" style="margin-top:14px">
            <button class="btn sm" id="rot" disabled>↻ 회전</button>
            <button class="btn sm" id="del" disabled>삭제</button>
          </div>
          <div class="row" style="margin-top:8px">
            <button class="btn sm ghost" id="reset">${act && hasOwn ? '기본 구성으로 되돌리기' : '초기화'}</button>
          </div>
        </aside>
        <div>
          <div class="stage-box" id="box" tabindex="0" aria-label="무대 배치도"></div>
          <p class="lbl" style="margin-top:8px">drag to place · double-click to rotate · delete key removes · auto-saved</p>
          <div class="section" style="margin-top:20px">
            <div class="section-head"><h3>Gear List</h3><span class="count" id="gc"></span></div>
            <div id="glist" class="row" style="gap:6px"></div>
          </div>
        </div>
      </div>`;
    const box = el.querySelector('#box');
    const save = () => { f.layouts[key] = items.map((x) => ({ ...x })); Store.save(); };
    const paint = () => {
      box.innerHTML = items.map((g) => `<div class="gear g-${g.type} ${g.id === sel ? 'sel' : ''}" data-id="${g.id}" style="left:${g.x}%;top:${g.y}%;--rot:${g.rot || 0}deg">${g.type === 'mic' ? 'M' : g.type === 'di' ? 'DI' : GEAR[g.type]}</div>`).join('');
      el.querySelector('#rot').disabled = el.querySelector('#del').disabled = !sel;
      const counts = {};
      items.forEach((g) => counts[g.type] = (counts[g.type] || 0) + 1);
      el.querySelector('#gc').textContent = `${items.length} items`;
      el.querySelector('#glist').innerHTML = Object.entries(counts).map(([k, n]) => `<span class="chip">${GEAR[k]} × ${n}</span>`).join('');
    };
    paint();

    el.querySelector('#stSel').onchange = (e) => go(`#/festival/${f.id}/stage/${e.target.value}`);
    el.querySelector('#actSel').onchange = (e) => go(`#/festival/${f.id}/stage/${st.id}${e.target.value ? '/' + e.target.value : ''}`);
    el.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
      const g = { id: Store.uid(), type: b.dataset.g, x: 50 + (Math.random() * 10 - 5), y: 50 + (Math.random() * 10 - 5), rot: 0 };
      items.push(g); sel = g.id; save(); paint();
    });
    const rotate = () => { const g = items.find((x) => x.id === sel); if (g) { g.rot = ((g.rot || 0) + 45) % 360; save(); paint(); } };
    const remove = () => { items = items.filter((x) => x.id !== sel); sel = null; save(); paint(); };
    el.querySelector('#rot').onclick = rotate;
    el.querySelector('#del').onclick = remove;
    el.querySelector('#reset').onclick = () => {
      if (act && hasOwn) { delete f.layouts[key]; Store.save(); App.render(); return; }
      items = DEFAULT_LAYOUT(); sel = null; save(); paint();
    };
    box.addEventListener('keydown', (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(); } if (e.key === 'r' && sel) rotate(); });
    box.addEventListener('dblclick', (e) => { const n = e.target.closest('.gear'); if (n) { sel = n.dataset.id; rotate(); } });
    box.addEventListener('pointerdown', (e) => {
      const n = e.target.closest('.gear');
      if (!n) { sel = null; paint(); return; }
      e.preventDefault(); box.focus();
      sel = n.dataset.id;
      const g = items.find((x) => x.id === sel);
      el.querySelectorAll('.gear').forEach((x) => x.classList.toggle('sel', x.dataset.id === sel));
      el.querySelector('#rot').disabled = el.querySelector('#del').disabled = false;
      const r = box.getBoundingClientRect();
      n.setPointerCapture(e.pointerId);
      const move = (ev) => {
        g.x = Math.max(2, Math.min(98, ((ev.clientX - r.left) / r.width) * 100));
        g.y = Math.max(3, Math.min(90, ((ev.clientY - r.top) / r.height) * 100));
        n.style.left = g.x + '%'; n.style.top = g.y + '%';
      };
      const up = () => { n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); save(); };
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
    });
  }

  /* ================= TIMETABLE shortcut ================= */
  V.timetable = (el) => {
    const f = Store.festival();
    if (!f) { el.innerHTML = V.pageHead(['timetable'], 'TIME', 'Table') + UI.empty('Festival', '먼저 페스티벌을 만들어주세요.', '<a class="btn solid" href="#/festivals">페스티벌 만들기</a>'); return; }
    go(`#/festival/${f.id}/timetable`);
  };

  /* ================= PERSONAL FESTIVAL ================= */
  let pDay = 0;
  V.personal = (el) => {
    const d = db();
    const f = Store.festival();
    if (!f) { el.innerHTML = V.pageHead(['personal festival'], 'MY', 'Festival') + UI.empty('Festival', '관람할 페스티벌이 없습니다.', '<a class="btn solid" href="#/festivals">페스티벌 만들기</a>'); return; }
    if (pDay >= f.days) pDay = 0;
    const fav = new Set(f.favorites);
    const all = f.slots.filter((s) => s.day === pDay).sort((a, b) => a.start - b.start);
    const mine = all.filter((s) => fav.has(s.actId));
    const clash = new Set();
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
      if (mine[j].start < mine[i].start + mine[i].dur) { clash.add(mine[i].id); clash.add(mine[j].id); }
    }
    const totalMine = f.slots.filter((s) => fav.has(s.actId));

    el.innerHTML = V.pageHead(['personal festival', 'audience mode'], 'MY', 'Festival', `
        <select class="input" id="fSel" style="width:auto">${d.festivals.map((x) => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) + `
      <div class="row" style="justify-content:space-between;margin-bottom:20px">
        <nav class="tabs" style="margin:0">${Array.from({ length: f.days }, (_, i) => `<a href="#" data-day="${i}" class="${i === pDay ? 'on' : ''}">${dayLabel(f, i)}</a>`).join('')}</nav>
        <span class="lbl">${fav.size} favorites · ${totalMine.length} shows</span>
      </div>
      <div class="split">
        <section class="section">
          <div class="section-head"><h3>All Shows</h3><span class="count">★ to add</span></div>
          ${all.map((s) => {
            const a = actOf(f, s.actId), st = stageOf(f, s.stageId);
            return `<div class="fav-row">
              <button class="star ${fav.has(a.id) ? 'on' : ''}" data-fav="${a.id}" aria-label="즐겨찾기">★</button>
              <span class="mono num" style="font-size:13px">${hm(s.start)}–${hm(s.start + s.dur)}</span>
              <span><b style="font-size:17px">${esc(a.name)}</b> <span class="muted" style="font-size:12px">${esc(a.genre)}</span></span>
              <span class="chip" style="background:${esc(st?.color)};${st?.color === '#141210' ? 'color:var(--paper)' : ''}">${esc(st?.name)}</span>
            </div>`;
          }).join('') || '<p class="muted">이 날은 아직 배치된 공연이 없습니다.</p>'}
          ${f.acts.filter((a) => !f.slots.some((s) => s.actId === a.id)).length ? `<p class="lbl" style="margin-top:14px">시간 미정: ${f.acts.filter((a) => !f.slots.some((s) => s.actId === a.id)).map((a) => esc(a.name)).join(', ')}</p>` : ''}
        </section>
        <section class="section">
          <div class="section-head"><h3>My Timetable</h3><div class="row"><button class="btn sm" id="copy">텍스트 복사</button><button class="btn sm solid" id="shareImg">이미지 공유</button></div></div>
          ${clash.size ? `<div class="conflict-box"><b>⚠ 시간이 겹치는 공연이 있어요</b> — 보라색으로 표시된 공연 중 하나를 선택하세요.</div>` : mine.length ? '<div class="conflict-box ok"><b>✓ 모든 공연을 볼 수 있어요</b></div>' : ''}
          ${mine.length ? `<div class="my-tl">${mine.map((s, i) => {
            const a = actOf(f, s.actId), st = stageOf(f, s.stageId);
            const prev = mine[i - 1];
            const gap = prev ? s.start - (prev.start + prev.dur) : null;
            return `${gap !== null && gap > 0 ? `<div class="gap">↓ ${gap}분 여유${prev.stageId !== s.stageId ? ' · 무대 이동' : ''}</div>` : ''}
              <div class="it ${clash.has(s.id) ? 'clash' : ''}">
                <span class="lbl">${hm(s.start)} – ${hm(s.start + s.dur)} · ${esc(st?.name)}</span>
                <div style="font-size:22px;font-weight:800">${a.headliner ? '★ ' : ''}${esc(a.name)}</div>
              </div>`;
          }).join('')}</div>` : UI.empty('Pick', '왼쪽에서 보고 싶은 밴드에 ★를 눌러보세요.')}
          <canvas id="myCanvas" width="1080" height="1350" hidden></canvas>
        </section>
      </div>`;

    el.querySelector('#fSel').onchange = (e) => { d.activeFestivalId = e.target.value; pDay = 0; Store.save(); App.render(); };
    el.querySelectorAll('[data-day]').forEach((a) => a.onclick = (e) => { e.preventDefault(); pDay = Number(a.dataset.day); App.render(); });
    el.querySelectorAll('[data-fav]').forEach((b) => b.onclick = () => {
      const id = b.dataset.fav;
      f.favorites = fav.has(id) ? f.favorites.filter((x) => x !== id) : [...f.favorites, id];
      Store.save(); App.render();
    });
    const textPlan = () => {
      const lines = [`🎪 ${f.name} — My Timetable`];
      for (let dd = 0; dd < f.days; dd++) {
        const ss = f.slots.filter((s) => s.day === dd && fav.has(s.actId)).sort((a, b) => a.start - b.start);
        if (!ss.length) continue;
        lines.push('', dayLabel(f, dd));
        ss.forEach((s) => lines.push(`${hm(s.start)}-${hm(s.start + s.dur)}  ${actOf(f, s.actId).name} @ ${stageOf(f, s.stageId)?.name}`));
      }
      return lines.join('\n');
    };
    el.querySelector('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(textPlan()); toast('시간표를 복사했습니다'); }
      catch (e) { modal({ title: '내 시간표', body: `<textarea class="input" style="width:100%;min-height:240px;border:1px solid var(--ink)">${esc(textPlan())}</textarea>` }); }
    };
    el.querySelector('#shareImg').onclick = async () => {
      if (!totalMine.length) { toast('먼저 즐겨찾기를 추가하세요'); return; }
      const c = el.querySelector('#myCanvas');
      try { await Promise.all(['400 80px "Instrument Serif"', '800 40px Pretendard', '400 20px "Space Mono"'].map((x) => document.fonts.load(x))); } catch (e) { /* */ }
      drawMyPlan(c, f, fav);
      UI.shareCanvas(c, `${f.name}-my-timetable.png`, `${f.name} 내 관람 시간표`);
    };
  };

  function drawMyPlan(c, f, fav) {
    const ctx = c.getContext('2d'), W = c.width, H = c.height, M = 70;
    ctx.fillStyle = f.bg; ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, .12);
    ctx.fillStyle = '#d6ff3a'; ctx.fillRect(0, 0, W, 50);
    ctx.fillStyle = '#141210'; ctx.font = '700 20px Pretendard'; ctx.textAlign = 'left';
    for (let x = 0; x < W; x += 230) ctx.fillText('MY TIMETABLE  ↗', x + 10, 33);
    rippleText(ctx, f.name, W / 2, 170, 170, f.accent, W - M * 2);
    let y = 330;
    for (let d = 0; d < f.days; d++) {
      const ss = f.slots.filter((s) => s.day === d && fav.has(s.actId)).sort((a, b) => a.start - b.start);
      if (!ss.length) continue;
      ctx.fillStyle = '#fff8f2'; ctx.font = '400 22px "Space Mono"'; ctx.textAlign = 'left';
      ctx.fillText(dayLabel(f, d), M, y); y += 20;
      ss.forEach((s) => {
        if (y > H - 120) return;
        ctx.strokeStyle = '#141210'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
        ctx.fillStyle = '#141210'; ctx.font = '400 24px "Space Mono"';
        ctx.fillText(`${hm(s.start)}–${hm(s.start + s.dur)}`, M, y + 50);
        ctx.font = '800 42px Pretendard';
        const name = actOf(f, s.actId).name;
        fitFont(ctx, name, 'Pretendard', 800, W - M * 2 - 470, 46);
        ctx.fillText(name, M + 230, y + 54);
        ctx.font = '500 22px Pretendard'; ctx.textAlign = 'right';
        ctx.fillText(stageOf(f, s.stageId)?.name || '', W - M, y + 50); ctx.textAlign = 'left';
        y += 80;
      });
      y += 50;
    }
    ctx.fillStyle = '#fff8f2'; ctx.font = '500 24px Pretendard'; ctx.textAlign = 'left';
    ctx.fillText(`${f.venue}`, M, H - 60);
    ctx.textAlign = 'right'; ctx.fillText('made with BAND MANAGER', W - M, H - 60);
  }
})();
