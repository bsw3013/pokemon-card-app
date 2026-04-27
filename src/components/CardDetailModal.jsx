import React, { useState, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import pokemonMapAll from '../utils/pokemonMapAll.json';
import CardThumbnail from './CardThumbnail';

const { krToEn, krToJa } = pokemonMapAll;

export default function CardDetailModal({ isOpen, card, appConfig, onClose, onSave, onDelete }) {
  const [editData, setEditData] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // 📸 두 번째 초대형 멀티 언어 이미지 픽커 상태
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState('en'); // 'en', 'ja'
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

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

  if (!isOpen || !card) return null;

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveInternal = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(editData);
    } finally {
      setIsSaving(false);
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

  const openPicker = () => {
    setIsPickerOpen(true);
    setPickerTab('en');
    setPickerQuery(editData.cardName || editData.cardNumber || '');
    setPickerResults([]);
  };

  const closePicker = () => {
    setIsPickerOpen(false);
    setPickerResults([]);
  };

  const handlePickerSearch = async (e) => {
    if (e) e.preventDefault();
    if (!pickerQuery.trim()) return;

    setPickerLoading(true);
    setPickerResults([]);

    try {
      const queryText = pickerQuery.trim();

      if (pickerTab === 'en') {
        let enName = krToEn[queryText] || queryText;
        const parts = queryText.split(' ');
        if (krToEn[parts[0]]) {
          enName = krToEn[parts[0]] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
        }

        const url = `https://api.pokemontcg.io/v2/cards?q=name:"*${enName}*" OR number:"*${queryText}*"&pageSize=50`;
        const res = await fetch(url);
        const json = await res.json();

        if (json.data) {
          setPickerResults(json.data.map((c) => ({
            id: c.id,
            thumbnail: c.images.small,
            fullImage: c.images.large || c.images.small,
          })));
        }
      } else if (pickerTab === 'ja') {
        let jaName = krToJa[queryText] || queryText;
        const parts = queryText.split(' ');
        if (krToJa[parts[0]]) {
          jaName = krToJa[parts[0]] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
        }

        const url = `https://api.tcgdex.net/v2/ja/cards?name=${encodeURIComponent(jaName)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (Array.isArray(json)) {
          const valid = json.filter((c) => c.image).slice(0, 50);
          setPickerResults(valid.map((c) => ({
            id: c.id,
            thumbnail: `${c.image}/low.webp`,
            fullImage: `${c.image}/high.png`,
          })));
        }
      }
    } catch (err) {
      console.error(err);
      alert("검색 서버에 연결하는 데 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setPickerLoading(false);
    }
  };

  const selectPickerImage = (imgUrl) => {
    setEditData((prev) => ({ ...prev, imageUrl: imgUrl }));
    closePicker();
  };

  const addPossession = () => {
    setEditData((prev) => ({
      ...prev,
      possessions: [
        ...(prev.possessions || []),
        { id: `p_${Date.now()}`, region: 'KR', count: 1, company: '', grade: '', serial: '', notes: '' },
      ],
    }));
  };

  const updatePossessionField = (index, field, value) => {
    setEditData((prev) => {
      const poss = (prev.possessions || []).slice();
      if (!poss[index]) return prev;
      poss[index] = { ...poss[index], [field]: value };
      return { ...prev, possessions: poss };
    });
  };

  const removePossession = (index) => {
    setEditData((prev) => {
      const poss = (prev.possessions || []).slice();
      poss.splice(index, 1);
      return { ...prev, possessions: poss };
    });
  };

  return (
    <>
      <div className="modal-backdrop fade-in" onClick={onClose} style={{ zIndex: 1000 }}>
        <div className="modal-content slide-up" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>✕</button>
          <h2 className="modal-title">💎 카드 상세 / 편집기</h2>
          <div className="modal-body">
            <div className="modal-image-col">
              <div className="modal-card-image">
                <CardThumbnail imageUrl={editData.imageUrl} alt="preview" type="modal" />
              </div>

              <div className="image-upload-options">
                <h5>사진 등록 방식 선택</h5>

                <div className="upload-option">
                  <button type="button" className="btn btn-secondary fetch-btn" onClick={openPicker}>
                    🌐 스마트 다국어 검색
                  </button>
                </div>

                <div className="upload-option">
                  <label className="btn btn-secondary file-upload-btn">
                    {uploading ? "📤 업로드 중..." : "📤 기기에서 파일 선택"}
                    <input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
                  </label>
                </div>

                <div className="upload-option url-input-group">
                  <input
                    type="text"
                    placeholder="이미지 URL 직접 입력..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary" onClick={applyUrlInput}>적용</button>
                </div>
              </div>
            </div>
            <form className="modal-form" onSubmit={handleSaveInternal}>
              <div className="dynamic-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                {appConfig.displayFields.filter(f => f.visible).sort((a, b) => a.order - b.order).map(f => (
                  <div className="sub-group" key={f.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{f.label}</label>
                    {f.id === 'cardName' && <input type="text" name="cardName" value={editData.cardName || ''} onChange={handleEditChange} />}
                    {f.id === 'pokedexNumber' && <input type="text" name="pokedexNumber" value={editData.pokedexNumber || ''} onChange={handleEditChange} />}
                    {f.id === 'cardNumber' && <input type="text" name="cardNumber" value={editData.cardNumber || ''} onChange={handleEditChange} />}
                    {f.id === 'price' && <input type="number" name="price" value={editData.price || 0} onChange={handleEditChange} />}

                    {f.id === 'series' && (
                      <select name="series" value={editData.series || ''} onChange={handleEditChange}>
                        <option value="">시리즈 직접 선택</option>
                        {appConfig.seriesOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'rarity' && (
                      <select name="rarity" value={editData.rarity || ''} onChange={handleEditChange}>
                        <option value="">직접 선택</option>
                        {appConfig.rarityOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'type' && (
                      <select name="type" value={editData.type || ''} onChange={handleEditChange}>
                        <option value="">선택</option>
                        {appConfig.typeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {f.id === 'status' && (
                      <div>
                        <div style={{ marginBottom: '0.6rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                          <div style={{ flex: '0 0 auto' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>보유여부</label>
                          </div>
                          <div style={{ flex: '0 0 220px' }}>
                            <select name="status" value={editData.status || '미보유'} onChange={handleEditChange} style={{ width: '100%' }}>
                              <option value="미보유">미보유</option>
                              <option value="보유중">보유중</option>
                              <option value="등급카드">등급카드</option>
                            </select>
                          </div>
                        </div>

                        <div className="possession-section">
                          <div className="possession-header">
                            <div className="pos-field country">국가</div>
                            <div className="pos-field company">등급 업체</div>
                            <div className="pos-field grade">등급</div>
                            <div className="pos-field count">수량</div>
                            <div className="pos-field serial">시리얼 번호</div>
                            <div className="pos-actions"></div>
                          </div>

                          {(editData.possessions || []).map((p, idx) => (
                            <div key={p.id || idx} className="possession-row">
                              <div className="pos-field country">
                                <label style={{ display: 'none' }}>국가</label>
                                <select name={`poss-${idx}-region`} data-pos-field="region" value={p.region || 'KR'} onChange={(e) => updatePossessionField(idx, 'region', e.target.value)}>
                                  <option value="KR">한국판 (KR)</option>
                                  <option value="JP">일본판 (JP)</option>
                                  <option value="US">미국판 (US)</option>
                                  <option value="CN">중국판 (CN)</option>
                                </select>
                              </div>

                              <div className="pos-field company">
                                <label style={{ display: 'none' }}>등급 업체</label>
                                <select name={`poss-${idx}-company`} data-pos-field="company" value={p.company || ''} onChange={(e) => updatePossessionField(idx, 'company', e.target.value)}>
                                  <option value="">선택</option>
                                  {(appConfig.gradingCompaniesOptions || []).map(c => <option key={c} value={c}>{c}</option>)}
                                  <option value="raw">raw</option>
                                </select>
                              </div>

                              <div className="pos-field grade">
                                <label style={{ display: 'none' }}>등급</label>
                                <select name={`poss-${idx}-grade`} data-pos-field="grade" value={p.grade || ''} onChange={(e) => updatePossessionField(idx, 'grade', e.target.value)} disabled={p.company === 'raw'}>
                                  <option value="">선택</option>
                                  {((appConfig.gradingScaleOptions && appConfig.gradingScaleOptions.length) ? appConfig.gradingScaleOptions : Array.from({ length: 10 }, (_, i) => String(i + 1))).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                              </div>

                              <div className="pos-field count">
                                <label style={{ display: 'none' }}>수량</label>
                                <input name={`poss-${idx}-count`} data-pos-field="count" type="number" min={0} value={p.count || 1} onChange={(e) => updatePossessionField(idx, 'count', parseInt(e.target.value || 0))} />
                              </div>

                              <div className="pos-field serial">
                                <label style={{ display: 'none' }}>시리얼</label>
                                <input name={`poss-${idx}-serial`} data-pos-field="serial" type="text" value={p.serial || ''} onChange={(e) => updatePossessionField(idx, 'serial', e.target.value)} disabled={p.company === 'raw'} />
                              </div>

                              <div className="pos-actions">
                                <button
                                  type="button"
                                  className="btn btn-delete"
                                  title="보유 정보 삭제"
                                  onClick={() => removePossession(idx)}
                                >
                                  <span className="icon" aria-hidden>🗑</span>
                                </button>
                              </div>
                            </div>
                          ))}

                          <div style={{ marginTop: '0.5rem' }}>
                            <button type="button" className="btn btn-secondary" onClick={addPossession}>➕ 보유 정보 추가</button>
                          </div>
                        </div>
                      </div>
                    )}
                    {!['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'].includes(f.id)
                      && f.label !== '보유 여부' && f.label !== '보유여부' && (
                        <input type="text" name={f.id} value={editData[f.id] || ''} onChange={handleEditChange} />
                      )}
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                {onDelete && <button type="button" className="btn btn-danger" onClick={handleDeleteInternal}>🗑 카드 지우기</button>}
                <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? "저장 중..." : "수정사항 덮어쓰기"}</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {isPickerOpen && (
        <div className="picker-backdrop fade-in" onClick={closePicker} style={{ zIndex: 2000 }}>
          <div className="picker-content slide-up" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closePicker}>✕</button>
            <div className="picker-header">
              <h2>🌐 글로벌 카드 라이브러리 검색</h2>
              <p>전 세계의 서버에서 실시간으로 정품 고해상도 카드 디자인을 끌어옵니다.</p>
            </div>

            <form className="picker-search-bar" onSubmit={handlePickerSearch}>
              <input type="text" placeholder="한글 이름 또는 번호를 치세요 (알아서 다국어로 번역됩니다!)" value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} />
              <button type="submit" className="btn btn-primary">검색</button>
            </form>

            <div className="picker-tabs">
              <button className={`tab-btn ${pickerTab === 'en' ? 'active' : ''}`} onClick={() => setPickerTab('en')}>🇺🇸 영문판 글로벌 (가져오기 빠름)</button>
              <button className={`tab-btn ${pickerTab === 'ja' ? 'active' : ''}`} onClick={() => setPickerTab('ja')}>🇯🇵 일본 오리지널판</button>
            </div>

            <div className="picker-body">
              {pickerLoading ? (
                <div className="picker-loading">
                  <div className="spinner"></div><div>국경을 넘어 사진을 수집하는 중입니다...</div>
                </div>
              ) : pickerResults.length > 0 ? (
                <div className="picker-grid">
                  {pickerResults.map(res => (
                    <div key={res.id} className="picker-img-wrapper" onClick={() => selectPickerImage(res.fullImage)}>
                      <img src={res.thumbnail} alt="card" loading="lazy" />
                      <div className="picker-img-overlay">선택하기</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="picker-empty">해당 국가에서는 이 이름으로 된 사진을 구하지 못했습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
