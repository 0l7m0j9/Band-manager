/* =========================================================
   Views — Board (게시판). 관리자: 글·사진 올리기/수정/삭제, 회원: 홈에서 읽기
   ========================================================= */
window.Views = window.Views || {};
(() => {
  const { esc, modal, toast } = UI;
  const V = window.Views;
  const MAX_IMG = 4;
  const when = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
  const paras = (t) => esc(t || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  /** 글 보기 (모두) */
  V.postModal = (po) => {
    if (!po) return;
    const author = Store.Group.personName(po.author);
    modal({
      title: po.pinned ? '공지' : '게시글', wide: true,
      body: `<article class="post-view">
        <h2>${esc(po.title)}</h2>
        <p class="muted" style="font-size:13px;margin:6px 0 18px">${esc(author)} · ${when(po.created_at)}</p>
        <div class="post-body">${paras(po.body)}</div>
        ${(po.images || []).map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}
      </article>`,
      extra: Store.Group.isAdmin ? '<a class="btn left" href="#/board" data-close>게시판 관리</a>' : '',
    });
  };

  /** 글쓰기 / 수정 (관리자) */
  function postForm(po) {
    let images = po ? [...(po.images || [])] : [];
    const thumbs = () => images.map((src, i) => `<div style="position:relative"><img src="${esc(src)}" alt=""><button type="button" class="btn icon sm" data-ri="${i}" style="position:absolute;top:4px;right:4px;background:var(--paper)">✕</button></div>`).join('');
    modal({
      title: po ? '글 수정' : '새 글', wide: true,
      body: `
        <div class="field"><span class="lbl">제목 *</span><input name="title" maxlength="80" value="${esc(po ? po.title : '')}" required></div>
        <div class="field"><span class="lbl">내용</span><textarea name="body" maxlength="4000" style="min-height:180px">${esc(po ? po.body : '')}</textarea></div>
        <div class="field"><span class="lbl">사진 (최대 ${MAX_IMG}장)</span><input type="file" accept="image/*" multiple id="pimg"><div class="photos" id="pth">${thumbs()}</div></div>
        <label class="row" style="gap:8px;font-weight:600"><input type="checkbox" name="pinned" ${po && po.pinned ? 'checked' : ''}> 공지로 맨 위에 고정</label>`,
      submit: po ? '저장' : '올리기',
      extra: po ? '<button type="button" class="btn ghost left" id="delP">삭제</button>' : '',
      onOpen(f, close) {
        const box = f.querySelector('#pth');
        const bind = () => box.querySelectorAll('[data-ri]').forEach((b) => b.onclick = () => { images.splice(Number(b.dataset.ri), 1); box.innerHTML = thumbs(); bind(); });
        bind();
        f.querySelector('#pimg').onchange = async (e) => {
          for (const file of e.target.files) {
            if (images.length >= MAX_IMG) { toast(`사진은 ${MAX_IMG}장까지 올릴 수 있습니다`); break; }
            images.push(await UI.readImage(file, 1200));
          }
          e.target.value = ''; box.innerHTML = thumbs(); bind();
        };
        const d = f.querySelector('#delP');
        if (d) d.onclick = () => { close(); UI.confirm(`「${esc(po.title)}」 글을 삭제할까요?`, () => Store.Posts.remove(po.id).then(() => toast('삭제했습니다'), (er) => toast(er.message))); };
      },
      async onSubmit(dt, f) {
        if (!dt.title.trim()) { toast('제목을 입력하세요'); return false; }
        const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
        const payload = { title: dt.title.trim(), body: dt.body.trim(), images, pinned: !!dt.pinned };
        try { if (po) await Store.Posts.update(po.id, payload); else await Store.Posts.add(payload); toast(po ? '저장했습니다' : '글을 올렸습니다'); }
        catch (er) { toast(er.message); btn.disabled = false; return false; }
      },
    });
  }

  /* ================= BOARD (관리자) ================= */
  V.board = (el) => {
    const posts = Store.Posts.list;
    el.innerHTML = V.pageHead(['board', esc((Store.Group.current || {}).name || '')], 'BOARD', 'Notice', '<button class="btn solid" id="add">+ 새 글</button>') + `
      <p class="muted" style="margin:-12px 0 20px;font-size:13px">여기 올린 글은 모든 회원의 Home에 표시됩니다.</p>
      ${posts.map((po) => `<article class="post-card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div style="min-width:0">
            <h3>${po.pinned ? '<span class="chip ink" style="margin-right:6px;vertical-align:3px">공지</span>' : ''}${esc(po.title)}</h3>
            <p class="muted" style="font-size:12px;margin-top:4px">${esc(Store.Group.personName(po.author))} · ${when(po.created_at)}${(po.images || []).length ? ` · 사진 ${po.images.length}` : ''}</p>
          </div>
          <span class="row" style="gap:4px;flex:0 0 auto"><button class="btn sm" data-view="${po.id}">보기</button><button class="btn sm ghost" data-edit="${po.id}">수정</button></span>
        </div>
        ${po.body ? `<p class="post-preview">${esc(po.body.slice(0, 240))}${po.body.length > 240 ? '…' : ''}</p>` : ''}
        ${(po.images || []).length ? `<div class="photos">${po.images.map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>` : ''}
      </article>`).join('') || UI.empty('Board', '아직 글이 없습니다.', '<button class="btn solid" id="add2">첫 글 쓰기</button>')}`;
    el.querySelector('#add').onclick = () => postForm();
    const a2 = el.querySelector('#add2'); if (a2) a2.onclick = () => postForm();
    el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => V.postModal(posts.find((x) => x.id === b.dataset.view)));
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => postForm(posts.find((x) => x.id === b.dataset.edit)));
  };
})();
