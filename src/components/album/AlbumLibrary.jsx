import React, { useEffect, useMemo, useState } from 'react';
import AlbumCover from './AlbumCover';
import CardThumbnail from '../CardThumbnail';
import { ALBUM_COLORS, COVER_POSITIONS, DEFAULT_ALBUM_COLOR, albumCards, albumStats, relativeTime } from './albumUtils';

const SORTS = [
  ['updated', '최근 수정순'],
  ['created', '만든 순'],
  ['name', '이름순'],
  ['progress', '완성률순'],
];
const readLS = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 화면은 그대로 */ } };

function ColorPicker({ value, onChange }) {
  const isCustom = !ALBUM_COLORS.some((c) => c.hex.toLowerCase() === String(value).toLowerCase());
  return (
    <div className="alb-colors" role="radiogroup" aria-label="앨범 색">
      {ALBUM_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c.hex.toLowerCase()}
          className={`alb-color ${value.toLowerCase() === c.hex.toLowerCase() ? 'on' : ''}`}
          style={{ '--c': c.hex }}
          title={c.label}
          onClick={() => onChange(c.hex)}
        />
      ))}
      <label className={`alb-color custom ${isCustom ? 'on' : ''}`} title="직접 고르기" style={isCustom ? { '--c': value } : undefined}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="색 직접 고르기" />
        <span aria-hidden="true">{isCustom ? '' : '+'}</span>
      </label>
    </div>
  );
}

function Dialog({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="alb-dialog-wrap" onClick={onClose}>
      <div className={`alb-dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="alb-dialog-head">
          <h3>{title}</h3>
          <button type="button" className="alb-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="alb-dialog-body">{children}</div>
        {footer && <div className="alb-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

// 표지·색 바꾸기
function CoverDialog({ album, cardsById, onClose, onSave, uploadCover }) {
  const [color, setColor] = useState(album.coverColor || DEFAULT_ALBUM_COLOR);
  const [cover, setCover] = useState(album.cover || { type: 'pages' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = useMemo(() => albumCards(album, cardsById), [album, cardsById]);

  const pick = (type) => setCover((c) => (type === 'pages' ? { type: 'pages' } : { ...c, type, imageUrl: c.type === type ? c.imageUrl : '' }));

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('사진 파일만 올릴 수 있어요.'); return; }
    setBusy(true);
    setError('');
    try {
      const url = await uploadCover(album.id, file);
      setCover({ type: 'photo', imageUrl: url, position: cover.position || 'center' });
    } catch (err) {
      console.error('표지 사진 올리기 실패', err);
      setError(err?.code === 'storage/unauthorized'
        ? '사진 저장소 권한이 없어 올리지 못했어요. Firebase 저장소 규칙에서 앨범 사진 폴더를 허용해야 해요.'
        : `사진을 올리지 못했어요. (${err.message || err})`);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const nextCover = cover.type === 'pages' || !cover.imageUrl ? { type: 'pages' } : cover;
      await onSave({ coverColor: color, cover: nextCover });
      onClose();
    } catch (err) {
      console.error(err);
      setError('저장하지 못했어요.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="표지·색 바꾸기"
      onClose={onClose}
      wide
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '저장 중...' : '저장'}</button>
        </>
      )}
    >
      <div className="alb-cover-edit">
        <div className="alb-cover-preview">
          <AlbumCover album={album} cardsById={cardsById} cover={cover} color={color} />
          <p className="alb-preview-name">{album.name}</p>
        </div>
        <div className="alb-cover-form">
          <div className="alb-field">
            <span className="alb-label">앨범 색</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="alb-field">
            <span className="alb-label">표지</span>
            <div className="seg alb-seg" role="tablist">
              {[['pages', '첫 페이지'], ['card', '앨범 속 카드'], ['photo', '내 사진']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={cover.type === k} className={cover.type === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
              ))}
            </div>
          </div>

          {cover.type === 'pages' && <p className="alb-hint">첫 페이지에 넣은 카드가 표지에 미리 보여요.</p>}

          {cover.type === 'card' && (
            choices.length === 0 ? <p className="alb-hint">아직 앨범에 넣은 카드가 없어요.</p> : (
              <div className="alb-cover-cards">
                {choices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`alb-cover-choice ${cover.imageUrl === c.imageUrl ? 'on' : ''}`}
                    onClick={() => setCover({ type: 'card', cardId: c.cardId, imageUrl: c.imageUrl })}
                    title={c.name}
                  >
                    <CardThumbnail imageUrl={c.imageUrl} alt={c.name} type="grid" />
                  </button>
                ))}
              </div>
            )
          )}

          {cover.type === 'photo' && (
            <div className="alb-photo-form">
              <label className={`btn btn-secondary alb-upload ${busy ? 'disabled' : ''}`}>
                <input type="file" accept="image/*" onChange={onFile} disabled={busy} />
                {busy ? '올리는 중...' : cover.imageUrl ? '다른 사진 고르기' : '사진 고르기'}
              </label>
              <p className="alb-hint">사진은 자동으로 알맞은 크기로 줄여서 저장해요.</p>
              {cover.imageUrl && (
                <div className="alb-field">
                  <span className="alb-label">보이는 위치</span>
                  <div className="seg alb-seg">
                    {COVER_POSITIONS.map((p) => (
                      <button key={p.key} type="button" className={(cover.position || 'center') === p.key ? 'on' : ''} onClick={() => setCover((c) => ({ ...c, position: p.key }))}>{p.label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p className="alb-error" role="alert">{error}</p>}
        </div>
      </div>
    </Dialog>
  );
}

function RenameDialog({ album, onClose, onSave }) {
  const [name, setName] = useState(album.name || '');
  const submit = async (e) => {
    e?.preventDefault();
    const v = name.trim();
    if (!v) return;
    await onSave({ name: v });
    onClose();
  };
  return (
    <Dialog
      title="이름 바꾸기"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={submit}>저장</button>
        </>
      )}
    >
      <form onSubmit={submit}>
        <input className="input alb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="앨범 이름" />
      </form>
    </Dialog>
  );
}

function CreateDialog({ layouts, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [layoutKey, setLayoutKey] = useState('3x3');
  const [pageCount, setPageCount] = useState(4);
  const [color, setColor] = useState(DEFAULT_ALBUM_COLOR);
  const [busy, setBusy] = useState(false);
  const layout = layouts.find((l) => l.key === layoutKey) || layouts[0];
  const preview = { name: name || '새 앨범', cols: layout.cols, rows: layout.rows, pages: [{ slots: [] }], coverColor: color };
  const submit = async () => {
    setBusy(true);
    try { await onCreate({ name: name.trim() || '새 앨범', layoutKey, pageCount: Math.max(1, Math.min(60, Number(pageCount) || 1)), coverColor: color }); } finally { setBusy(false); }
  };
  return (
    <Dialog
      title="새 앨범 만들기"
      onClose={onClose}
      wide
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? '만드는 중...' : '만들기'}</button>
        </>
      )}
    >
      <div className="alb-cover-edit">
        <div className="alb-cover-preview">
          <AlbumCover album={preview} cardsById={new Map()} />
          <p className="alb-preview-name">{preview.name}</p>
        </div>
        <div className="alb-cover-form">
          <label className="alb-field">
            <span className="alb-label">앨범 이름</span>
            <input className="input alb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: SV SAR 전시 앨범" maxLength={60} autoFocus />
          </label>
          <div className="alb-field">
            <span className="alb-label">한 페이지 칸 수</span>
            <div className="seg alb-seg">
              {layouts.map((l) => (
                <button key={l.key} type="button" className={layoutKey === l.key ? 'on' : ''} onClick={() => setLayoutKey(l.key)}>{l.cols}×{l.rows} <small>{l.cols * l.rows}칸</small></button>
              ))}
            </div>
          </div>
          <label className="alb-field">
            <span className="alb-label">시작 페이지 수</span>
            <input className="input alb-input alb-num" type="number" min={1} max={60} value={pageCount} onChange={(e) => setPageCount(e.target.value)} />
          </label>
          <div className="alb-field">
            <span className="alb-label">앨범 색</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <p className="alb-hint">표지 사진은 앨범을 만든 뒤 [⋯] → 표지·색 바꾸기에서 고를 수 있어요.</p>
        </div>
      </div>
    </Dialog>
  );
}

// 앨범 목록 (서재)
export default function AlbumLibrary({
  albums, cardsById, layouts, createOpen, onOpenCreate, onCloseCreate, onCreate,
  onOpen, onTrash, onRestore, onPurge, onPatch, onDuplicate, uploadCover,
}) {
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => readLS('album_sort_v1', 'updated'));
  const [view, setView] = useState(() => readLS('album_view_v1', 'grid'));
  const [menuFor, setMenuFor] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [coverFor, setCoverFor] = useState(null);

  useEffect(() => { writeLS('album_sort_v1', sort); }, [sort]);
  useEffect(() => { writeLS('album_view_v1', view); }, [view]);
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => { if (!e.target.closest?.('.alb-menu-wrap')) setMenuFor(null); };
    const esc = (e) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menuFor]);

  const withStats = useMemo(() => albums.map((a) => ({ album: a, stats: albumStats(a, cardsById) })), [albums, cardsById]);
  const active = withStats.filter((x) => !x.album.isDeleted);
  const trash = withStats.filter((x) => x.album.isDeleted);
  const summary = useMemo(() => active.reduce((t, { stats }) => ({ placed: t.placed + stats.placed, owned: t.owned + stats.owned }), { placed: 0, owned: 0 }), [active]);

  const list = useMemo(() => {
    const key = q.trim().toLowerCase();
    const src = (tab === 'trash' ? trash : active).filter(({ album }) => !key || String(album.name || '').toLowerCase().includes(key));
    const pct = (s) => (s.placed ? s.owned / s.placed : 0);
    return [...src].sort((a, b) => {
      if (sort === 'name') return String(a.album.name || '').localeCompare(String(b.album.name || ''), 'ko');
      if (sort === 'created') return String(b.album.createdAt || '').localeCompare(String(a.album.createdAt || ''));
      if (sort === 'progress') return pct(b.stats) - pct(a.stats) || b.stats.placed - a.stats.placed;
      return String(b.album.updatedAt || '').localeCompare(String(a.album.updatedAt || ''));
    });
  }, [tab, trash, active, q, sort]);

  const isTrash = tab === 'trash';

  const menu = (album) => (
    <div className="alb-menu-wrap">
      <button
        type="button"
        className="alb-more"
        aria-label={`${album.name} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={menuFor === album.id}
        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === album.id ? null : album.id); }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menuFor === album.id && <div className="alb-menu-backdrop" onClick={(e) => { e.stopPropagation(); setMenuFor(null); }} aria-hidden="true" />}
      {menuFor === album.id && (
        <div className="alb-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <p className="alb-menu-title">{album.name || '이름 없는 앨범'}</p>
          {isTrash ? (
            <>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onRestore(album.id); }}>복구하기</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); onPurge(album.id); }}>영구 삭제</button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onOpen(album); }}>열기</button>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setCoverFor(album); }}>표지·색 바꾸기</button>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setRenaming(album); }}>이름 바꾸기</button>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onDuplicate(album); }}>복제하기</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuFor(null); onTrash(album.id); }}>휴지통으로</button>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className="page alb-lib fade-in">
      <div className="page-head">
        <div>
          <h1>앨범</h1>
          <p className="sub">카드를 바인더처럼 배치하고, 빠진 카드를 한눈에 관리해요.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onOpenCreate}>＋ 새 앨범</button>
      </div>

      <div className="alb-summary">
        <div><strong>{active.length}</strong><span>앨범</span></div>
        <div><strong>{summary.placed.toLocaleString()}</strong><span>배치한 카드</span></div>
        <div><strong>{summary.owned.toLocaleString()}</strong><span>보유</span></div>
        <div><strong>{(summary.placed - summary.owned).toLocaleString()}</strong><span>아직 없는 카드</span></div>
      </div>

      <div className="alb-tools">
        <div className="seg" role="tablist" aria-label="앨범 구분">
          <button type="button" role="tab" aria-selected={!isTrash} className={!isTrash ? 'on' : ''} onClick={() => setTab('active')}>내 앨범 {active.length}</button>
          <button type="button" role="tab" aria-selected={isTrash} className={isTrash ? 'on' : ''} onClick={() => setTab('trash')}>휴지통 {trash.length}</button>
        </div>
        <input className="input alb-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="앨범 이름 검색" aria-label="앨범 이름 검색" />
        <div className="alb-tools-right">
          <select className="select alb-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="seg alb-view" role="group" aria-label="보기 방식">
            <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="표지로 보기" title="표지로 보기">▦</button>
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="목록으로 보기" title="목록으로 보기">☰</button>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="alb-empty">
          {isTrash ? '휴지통이 비어 있어요.' : q ? '검색한 이름의 앨범이 없어요.' : (
            <>
              <p>아직 앨범이 없어요.</p>
              <button type="button" className="btn btn-primary" onClick={onOpenCreate}>첫 앨범 만들기</button>
            </>
          )}
        </div>
      ) : (
        <section className={`alb-grid ${view === 'list' ? 'is-list' : ''}`}>
          {list.map(({ album, stats }) => {
            const pct = stats.placed ? Math.round((stats.owned / stats.placed) * 100) : 0;
            const open = () => { if (!isTrash) onOpen(album); };
            return (
              <article key={album.id} className={`alb-card ${isTrash ? 'trashed' : ''}`}>
                <div
                  className="alb-card-hit"
                  role={isTrash ? undefined : 'button'}
                  tabIndex={isTrash ? -1 : 0}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                  aria-label={isTrash ? undefined : `${album.name} 열기`}
                >
                  <AlbumCover album={album} cardsById={cardsById} />
                </div>
                <div className="alb-info">
                  <div className="alb-title">
                    <h3 title={album.name}>{album.name || '이름 없는 앨범'}</h3>
                    {menu(album)}
                  </div>
                  <p className="alb-layout">{album.cols}×{album.rows} · {stats.pages}페이지 · {stats.total}칸</p>
                  <div className="alb-prog">
                    <div className="alb-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="보유 비율"><i style={{ width: `${pct}%` }} /></div>
                    <span><b>{stats.owned}</b>/{stats.placed} 보유</span>
                  </div>
                  <p className="alb-meta">
                    <span>빈 칸 {stats.empty}</span>
                    <span>미보유 {stats.missing}</span>
                    {album.updatedAt && <span>{relativeTime(album.updatedAt)} 수정</span>}
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {createOpen && <CreateDialog layouts={layouts} onClose={onCloseCreate} onCreate={onCreate} />}
      {renaming && <RenameDialog album={renaming} onClose={() => setRenaming(null)} onSave={(patch) => onPatch(renaming.id, patch)} />}
      {coverFor && (
        <CoverDialog
          album={coverFor}
          cardsById={cardsById}
          onClose={() => setCoverFor(null)}
          onSave={(patch) => onPatch(coverFor.id, patch)}
          uploadCover={uploadCover}
        />
      )}
    </main>
  );
}
