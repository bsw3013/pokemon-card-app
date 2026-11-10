import React, { useState, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';
import { useAuth } from '../AuthContext';
import CardThumbnail from './CardThumbnail';
import CardDetailView from './CardDetailView';
import PossessionEditor from './PossessionEditor';
import { normalizeStatus } from '../utils/statusUtils';
import { useOwnedCards } from '../hooks/useOwnedCards';
import { DEFAULT_SETS, buildSetIndex, findSetForCard } from '../utils/catalog';
import { koreanImageCandidates, loadJpIndex, loadKrIndex, parseCardCode, searchJpIndex, searchKrIndex, searchTcgdexEn } from '../utils/imageSources';
import { statusFromRows } from '../utils/sales';

const { krToEn, krToJa } = pokemonMapAll;

export default function CardDetailModal({ isOpen, card, appConfig, isAdmin = false, onClose, onSave, onDelete, onDuplicate, onViewMarket, onOpenCard, suspendKeys = false }) {
  const { user, signInWithGoogle } = useAuth();
  // 'view': 카드 보기 화면(기본) / 'edit': 정보·보유 기록 수정. 다른 카드를 열면 다시 기본값부터.
  const cardIdentity = card?.isNew ? 'new' : card?.id;
  const [modeState, setModeState] = useState({ id: null, mode: 'view' });
  const mode = modeState.id === cardIdentity ? modeState.mode : (cardIdentity === 'new' ? 'edit' : 'view');
  const setMode = (next) => setModeState({ id: cardIdentity, mode: next });
  const [editData, setEditData] = useState({});
  // 'loading' 상태는 null, 기록 없음은 'none', 있으면 {count,min,max,avg}
  const [isSaving, setIsSaving] = useState(false);

  // 사진 찾기 창: 한국(세트 코드·번호로 바로) / 일본(공식 카드 목록) / 영어(TCGdex)
  const { catalog } = useOwnedCards();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState('kr'); // 'kr', 'ja', 'en'
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerNote, setPickerNote] = useState('');
  const [pickerFailed, setPickerFailed] = useState(() => new Set()); // 사진이 안 열린 후보(한국 탭)
  const [pickerLoaded, setPickerLoaded] = useState(0);
  const [jpSameSet, setJpSameSet] = useState(true);

  // 📷 직접 업로드 및 URL 입력 상태
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    if (isOpen && card) {
      let possessions = card.possessions || [];
      if (typeof possessions === 'string' && possessions.trim().startsWith('[')) {
        try { possessions = JSON.parse(possessions); } catch (e) { possessions = []; }
      }
      if (!Array.isArray(possessions)) possessions = [];

      setEditData({
        ...card,
        cardName: card.cardName || '',
        series: card.series || '',
        cardNumber: card.cardNumber || '',
        pokedexNumber: card.pokedexNumber || '',
        rarity: card.rarity || '',
        type: card.type || '',
        status: card.status || '미보유',
        price: Number(card.price) || 0,
        imageUrl: card.imageUrl || '',
        possessions: possessions,
      });
      setUrlInput('');
      setIsPickerOpen(false);
      setPickerResults([]);
    }
  }, [isOpen, card]);

  // Esc 로 닫기 (수정 중이면 보기 화면으로)
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || isPickerOpen || suspendKeys) return;
      if (mode === 'edit' && cardIdentity !== 'new') setModeState({ id: cardIdentity, mode: 'view' }); else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, mode, cardIdentity, isPickerOpen, suspendKeys, onClose]);


  if (!isOpen || !card) return null;

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveInternal = async (e) => {
    e.preventDefault();
    if (!user) {
      signInWithGoogle();
      return;
    }
    setIsSaving(true);
    try {
      // 보유 기록이 있으면 갖고 있는 장이 있을 때 "보유중", 전부 판매완료면 "미보유".
      // 등급 카드인지는 보유 기록(한 장씩)으로 구분한다.
      const rows = Array.isArray(editData.possessions) ? editData.possessions.filter((p) => p && Number(p.count ?? 1) > 0) : [];
      const status = statusFromRows(rows, normalizeStatus(editData.status));
      await onSave({ ...editData, possessions: rows, status });
      if (!card?.isNew) setMode('view');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicateInternal = async () => {
    if (window.confirm('이 카드와 동일한 정보로 새 카드를 만드시겠습니까?')) {
      setIsSaving(true);
      try {
        await onDuplicate(editData);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleDeleteInternal = async () => {
    if (!window.confirm("정말로 이 카드를 데이터베이스에서 완전히 삭제할까요?")) return;
    try {
      await onDelete();
    } catch (err) {
      console.error(err);
      alert("삭제 실패");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `cards/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, fileName);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      setEditData((prev) => ({ ...prev, imageUrl: downloadUrl }));
    } catch (err) {
      console.error(err);
      alert("이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const applyUrlInput = () => {
    if (!urlInput.trim()) return;
    setEditData((prev) => ({ ...prev, imageUrl: urlInput.trim() }));
    setUrlInput('');
  };

  // 이 카드의 세트 코드·번호 (예: SV8a-217)
  const pickerSet = findSetForCard(editData, buildSetIndex(catalog?.sets || DEFAULT_SETS));
  const cardCodeText = () => {
    const raw = String(editData.cardNumber || '').trim();
    if (parseCardCode(raw)) return raw;
    const no = String(raw).match(/(\d{1,3})\s*$/);
    return pickerSet && no ? `${pickerSet.code}-${no[1]}` : raw;
  };
  const tabDefaultQuery = (tab) => (tab === 'kr' ? (cardCodeText() || String(editData.cardName || '').trim()) : String(editData.cardName || '').trim());

  // 한글 이름 → 일본어·영어 이름 (첫 단어만 번역되면 나머지는 그대로 붙임)
  const translate = (text, map) => {
    if (map[text]) return map[text];
    const parts = text.split(' ');
    return map[parts[0]] ? [map[parts[0]], ...parts.slice(1)].join(' ') : text;
  };

  const runPickerSearch = async (tab, queryText, sameSet = jpSameSet) => {
    const q = String(queryText || '').trim();
    setPickerResults([]);
    setPickerFailed(new Set());
    setPickerLoaded(0);
    setPickerNote('');
    if (!q) return;
    setPickerLoading(true);
    try {
      if (tab === 'kr') {
        // 세트 코드·번호면 공식 사진 주소를 바로 만들고, 이름이면 한국 공식 카드 목록에서 찾는다
        const isCode = !!parseCardCode(q);
        let index = null;
        try { index = await loadKrIndex(); } catch (err) { console.warn(err); }
        const setCode = sameSet && pickerSet && !isCode ? pickerSet.code : '';
        let fromIndex = index ? searchKrIndex(index, { text: q, setCode }) : [];
        if (fromIndex.length === 0 && setCode && index) fromIndex = searchKrIndex(index, { text: q });
        const direct = isCode ? koreanImageCandidates(q, pickerSet?.era) : [];
        // 목록에서 찾은 사진을 앞에 두고, 같은 사진 주소는 한 번만
        const seen = new Set(fromIndex.map((r) => r.fullImage));
        setPickerResults([...fromIndex, ...direct.filter((r) => !seen.has(r.fullImage))]);
        if (!index) setPickerNote(isCode ? '' : '한국 공식 카드 목록을 아직 못 불러와서 이름으로는 찾을 수 없어요. 세트 코드와 번호(예: SV8a-217)로 찾아 주세요.');
        else setPickerNote(`한국 공식 카드 ${Number(index.count || 0).toLocaleString()}장 중에서 찾았어요${index.complete ? '' : ' (목록을 아직 모으는 중이라 빠진 카드가 있을 수 있어요)'} · 목록 갱신 ${String(index.updatedAt || '').slice(0, 10)}`);
      } else if (tab === 'ja') {
        const index = await loadJpIndex();
        const isJa = /[぀-ヿ]/.test(q);
        const names = [isJa ? q : translate(q, krToJa)].filter(Boolean);
        const setCode = sameSet && pickerSet ? pickerSet.code : '';
        let list = searchJpIndex(index, { names, setCode });
        if (list.length === 0 && setCode) list = searchJpIndex(index, { names });
        setPickerResults(list);
        setPickerNote(`일본 공식 카드 ${Number(index.count || 0).toLocaleString()}장 중에서 찾았어요 · 목록 갱신 ${String(index.updatedAt || '').slice(0, 10)}`);
      } else {
        setPickerResults(await searchTcgdexEn(translate(q, krToEn)));
      }
    } catch (err) {
      console.error(err);
      setPickerNote(tab === 'ja'
        ? '일본 공식 카드 목록이 아직 없어요. GitHub Actions에서 "Build card image index"를 한 번 실행해 주세요.'
        : `사진을 불러오지 못했어요. (${err.message})`);
    } finally {
      setPickerLoading(false);
    }
  };

  const openPicker = () => {
    setIsPickerOpen(true);
    setPickerTab('kr');
    const q = tabDefaultQuery('kr');
    setPickerQuery(q);
    runPickerSearch('kr', q);
  };

  const switchPickerTab = (tab) => {
    setPickerTab(tab);
    const q = tabDefaultQuery(tab);
    setPickerQuery(q);
    runPickerSearch(tab, q);
  };

  const closePicker = () => {
    setIsPickerOpen(false);
    setPickerResults([]);
  };

  const handlePickerSearch = (e) => {
    if (e) e.preventDefault();
    runPickerSearch(pickerTab, pickerQuery);
  };

  const selectPickerImage = (imgUrl) => {
    setEditData((prev) => ({ ...prev, imageUrl: imgUrl }));
    closePicker();
  };

  return (
    <>
      <div className="modal-backdrop fade-in" onClick={onClose} style={{ zIndex: 1000 }}>
        <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose} aria-label="닫기">✕</button>
          {mode === 'view' && !card.isNew ? (
            <CardDetailView
              card={card}
              isAdmin={isAdmin}
              onEdit={() => (user ? setMode('edit') : signInWithGoogle())}
              onViewMarket={onViewMarket ? () => onViewMarket({ ...card }) : undefined}
              onOpenCard={onOpenCard}
            />
          ) : (<>
          <div className="modal-edit-head">
            {!card.isNew && <button type="button" className="btn btn-secondary btn-compact" onClick={() => setMode('view')}>← 보기로</button>}
            <h2 className="modal-title">{card.isNew ? '새 카드 추가' : isAdmin ? '카드 정보 수정' : '내 보유 정보 기록'}</h2>
          </div>
          <div className="modal-body">
            <div className="modal-image-col">
              <div className="modal-card-image">
                <CardThumbnail imageUrl={editData.imageUrl} alt="preview" type="modal" />
              </div>

              <div className="image-upload-options">
                <h5>사진 등록 방식 선택</h5>
                {!isAdmin && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>카드 사진/기본 정보 수정은 관리자만 가능합니다.</p>}

                <div className="upload-option">
                  <button type="button" className="btn btn-secondary fetch-btn" onClick={openPicker} disabled={!isAdmin}>
                    공식 사진 찾기 (한·일·영)
                  </button>
                </div>

                <div className="upload-option">
                  <label className={`btn btn-secondary file-upload-btn ${!isAdmin ? 'disabled' : ''}`}>
                    {uploading ? "업로드 중..." : "기기에서 파일 선택"}
                    <input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading || !isAdmin} />
                  </label>
                </div>

                <div className="upload-option url-input-group">
                  <input
                    type="text"
                    placeholder="이미지 URL 직접 입력..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    disabled={!isAdmin}
                  />
                  <button type="button" className="btn btn-primary" onClick={applyUrlInput} disabled={!isAdmin}>적용</button>
                </div>
              </div>
            </div>
            <form className="modal-form" onSubmit={handleSaveInternal}>
              <div className="dynamic-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                {appConfig.displayFields.filter(f => f.visible && f.id !== 'price').sort((a, b) => a.order - b.order).map(f => (
                  <div className="sub-group" key={f.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{f.label}</label>
                    {f.id === 'cardName' && <input type="text" name="cardName" value={editData.cardName || ''} onChange={handleEditChange} disabled={!isAdmin} />}
                    {f.id === 'pokedexNumber' && <input type="text" name="pokedexNumber" value={editData.pokedexNumber || ''} onChange={handleEditChange} disabled={!isAdmin} />}
                    {f.id === 'cardNumber' && <input type="text" name="cardNumber" value={editData.cardNumber || ''} onChange={handleEditChange} disabled={!isAdmin} />}

                    {f.id === 'series' && (
                      <select name="series" value={editData.series || ''} onChange={handleEditChange} disabled={!isAdmin}>
                        <option value="">시리즈 직접 선택</option>
                        {appConfig.seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'rarity' && (
                      <select name="rarity" value={editData.rarity || ''} onChange={handleEditChange} disabled={!isAdmin}>
                        <option value="">직접 선택</option>
                        {appConfig.rarityOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'type' && (
                      <select name="type" value={editData.type || ''} onChange={handleEditChange} disabled={!isAdmin}>
                        <option value="">선택</option>
                        {appConfig.typeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'status' && (
                      <div>
                        {!user && (
                          <p className="market-hint" style={{ marginBottom: '0.6rem' }}>
                            로그인하면 내 계정에만 보이는 보유 정보를 기록할 수 있어요. 지금 입력하고 저장을 누르면 로그인 화면으로 안내돼요.
                          </p>
                        )}
                        <div style={{ marginBottom: '0.6rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                          <div style={{ flex: '0 0 auto' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>보유여부</label>
                          </div>
                          <div style={{ flex: '0 0 120px' }}>
                            <select name="status" value={statusFromRows(editData.possessions || [], normalizeStatus(editData.status))} onChange={handleEditChange} style={{ width: '100%' }} disabled={(editData.possessions || []).length > 0} title={(editData.possessions || []).length > 0 ? '아래 보유 기록을 보고 자동으로 정해집니다' : ''}>
                              <option value="미보유">미보유</option>
                              <option value="보유중">보유중</option>
                            </select>
                          </div>
                          <div style={{ flex: '0 0 auto', marginLeft: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>언어</label>
                          </div>
                          <div style={{ flex: '0 0 120px' }}>
                            <select name="language" value={editData.language || '한국'} onChange={handleEditChange} style={{ width: '100%' }}>
                              <option value="한국">한국</option>
                              <option value="일본">일본</option>
                              <option value="미국">미국</option>
                              <option value="중국">중국</option>
                            </select>
                          </div>
                        </div>

                        <PossessionEditor
                          rows={editData.possessions || []}
                          onChange={(rows) => setEditData((prev) => ({ ...prev, possessions: rows }))}
                          gradingCompanies={appConfig.gradingCompaniesOptions || []}
                          gradingScale={(appConfig.gradingScaleOptions && appConfig.gradingScaleOptions.length) ? appConfig.gradingScaleOptions : Array.from({ length: 10 }, (_, i) => String(i + 1))}
                          defaultLanguage={editData.language || '한국'}
                        />
                      </div>
                    )}
                    {!['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'].includes(f.id)
                      && f.label !== '보유 여부' && f.label !== '보유여부' && (
                        <input type="text" name={f.id} value={editData[f.id] || ''} onChange={handleEditChange} disabled={!isAdmin} />
                      )}
                  </div>
                ))}
              </div>

              {onViewMarket && !card?.isNew && (
                <p className="market-hint">
                  시세는 저장 후 카드 상세에서 종류별(Raw·등급, 언어판)로 볼 수 있어요.{' '}
                  <button type="button" className="link-btn" onClick={() => onViewMarket({ ...card })}>시세 기록하기</button>
                </p>
              )}

              <div className="modal-actions">
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {onDelete && <button type="button" className="btn btn-danger" onClick={handleDeleteInternal}>카드 지우기</button>}
                  {onDuplicate && !card?.isNew && <button type="button" className="btn btn-secondary" onClick={handleDuplicateInternal}>카드 복제</button>}
                </div>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? "저장 중..." : user ? "수정사항 덮어쓰기" : "로그인하고 저장하기"}
                </button>
              </div>
            </form>
          </div>
          </>)}
        </div>
      </div>

      {isPickerOpen && (
        <div className="picker-backdrop fade-in" onClick={closePicker} style={{ zIndex: 2000 }}>
          <div className="picker-content slide-up" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closePicker}>✕</button>
            <div className="picker-header">
              <h2>카드 사진 찾기</h2>
              <p>카드 이름이나 세트 코드·번호(예: SV8a-217)로 공식 사진을 찾아요.</p>
            </div>

            <div className="picker-tabs">
              <button type="button" className={`tab-btn ${pickerTab === 'kr' ? 'active' : ''}`} onClick={() => switchPickerTab('kr')}>한국판 (공식)</button>
              <button type="button" className={`tab-btn ${pickerTab === 'ja' ? 'active' : ''}`} onClick={() => switchPickerTab('ja')}>일본판 (공식)</button>
              <button type="button" className={`tab-btn ${pickerTab === 'en' ? 'active' : ''}`} onClick={() => switchPickerTab('en')}>영문판 (TCGdex)</button>
            </div>

            <form className="picker-search-bar" onSubmit={handlePickerSearch}>
              <input
                type="text"
                placeholder={pickerTab === 'kr' ? '카드 이름 또는 세트 코드-번호 (예: 리자몽, SV8a-217)' : '한글 이름 (자동으로 번역해서 찾아요)'}
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">검색</button>
            </form>
            {(pickerTab === 'ja' || (pickerTab === 'kr' && !parseCardCode(pickerQuery))) && pickerSet && (
              <label className="picker-option">
                <input type="checkbox" checked={jpSameSet} onChange={(e) => { setJpSameSet(e.target.checked); runPickerSearch(pickerTab, pickerQuery, e.target.checked); }} />
                이 카드 세트({pickerSet.code.toUpperCase()})에서만 찾기
              </label>
            )}
            {pickerNote && <p className="picker-note">{pickerNote}</p>}

            <div className="picker-body">
              {pickerLoading ? (
                <div className="picker-loading">
                  <div className="spinner"></div><div>사진을 찾는 중...</div>
                </div>
              ) : pickerResults.length > 0 && pickerFailed.size < pickerResults.length ? (
                <>
                  {pickerTab === 'kr' && pickerLoaded === 0 && parseCardCode(pickerQuery) && <p className="picker-note">공식 사진 주소를 확인하는 중...</p>}
                  <div className="picker-grid">
                    {pickerResults.filter((r) => !pickerFailed.has(r.id)).map((res) => (
                      <div key={res.id} className="picker-img-wrapper" onClick={() => selectPickerImage(res.fullImage)} title={res.title || res.source}>
                        <img
                          src={res.thumbnail}
                          alt={res.title || 'card'}
                          loading="lazy"
                          onLoad={() => setPickerLoaded((n) => n + 1)}
                          onError={() => setPickerFailed((prev) => new Set(prev).add(res.id))}
                        />
                        <div className="picker-img-overlay">선택하기</div>
                        <span className="picker-src">{res.source}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="picker-empty">
                  {pickerTab === 'kr'
                    ? (parseCardCode(pickerQuery)
                      ? '이 세트 코드·번호로 된 공식 사진을 찾지 못했어요. 번호를 확인하거나 이름으로 찾아보세요.'
                      : '이 이름으로 된 한국 공식 카드를 찾지 못했어요. 이름을 줄여서(예: "리자몽") 찾거나 일본판·영문판 탭을 써 보세요.')
                    : '이 이름으로 된 사진을 찾지 못했어요.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
