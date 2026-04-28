import React, { useState, useRef } from 'react';
import { analyzePokemonCard } from '../gemini';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { normalizePokedexNumber } from '../utils/numberUtils';

export default function CardUpload() {
  const [imagePreview, setImagePreview] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardData, setCardData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const formRef = useRef(null);

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setLoading(true);
    setCardData(null);
    setError('');
    setSuccess(false);

    try {
      const data = await analyzePokemonCard(file);
      setCardData(data);
    } catch (err) {
      setError(err.message || "카드 분석에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToFirebase = async (e) => {
    e.preventDefault();
    if (!cardData || !imageFile) return;
    setError('');
    setSaving(true);
    try {
      // 1) 이미지 업로드
      const fileName = `cards/${Date.now()}_${imageFile.name}`;
      const storageRef = ref(storage, fileName);
      const snapshot = await uploadBytes(storageRef, imageFile);
      const downloadUrl = await getDownloadURL(snapshot.ref);

      // 2) possessions 기본값: 업로더는 기본으로 1장 소유로 설정
      const possessions = [
        { id: `p_${Date.now()}`, count: 1, company: '', grade: '', serial: '', notes: '' }
      ];

      const formData = new FormData(e.target);

      // 3) Firestore에 새 문서 추가
      const payload = {
        cardName: formData.get('cardName') || '',
        series: formData.get('series') || '',
        cardNumber: formData.get('cardNumber') || '',
        pokedexNumber: normalizePokedexNumber(formData.get('pokedexNumber') || ''),
        rarity: formData.get('rarity') || '',
        type: formData.get('type') || '',
        price: parseInt(formData.get('price')) || 0,
        status: formData.get('status') || '수집 완료 (소장중)',
        language: formData.get('language') || '한국',
        imageUrl: downloadUrl,
        possessions,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'pokemon_cards'), payload);
      setSuccess(true);
      setCardData(null);
      setImageFile(null);
      setImagePreview(null);
    } catch (err) {
      console.error(err);
      setError(err.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="upload-container">
      {/* 왼쪽: 이미지 미리보기 및 업로드 버튼 */}
      <div className="upload-box relative group">
        {imagePreview ? (
          <img src={imagePreview} alt="Card Preview" className="card-preview" />
        ) : (
          <div className="placeholder">
            <span className="icon">📸</span>
            <p>여기를 클릭해서<br/>카드 사진 업로드</p>
          </div>
        )}
        <input type="file" accept="image/*" onChange={handleImageChange} className="file-input" />
        {imagePreview && (
            <div className="reupload-overlay">
                사진 다시 고르기
            </div>
        )}
      </div>

      {/* 오른쪽: 로딩 상태 또는 AI 분석 데이터 폼 */}
      <div className="form-box">
        {loading && (
            <div className="loading-state">
                <div className="spinner"></div>
                <p>Gemini AI가 카드 데이터를 판독중입니다... ✨</p>
                <small>카드 텍스트와 세부 정보를 분석하고 있어요.</small>
            </div>
        )}
        
        {saving && (
             <div className="loading-state">
             <div className="spinner"></div>
             <p>안전한 Firebase 창고에 사진과 데이터를 저장 중입니다... ☁️</p>
         </div>
        )}

        {success && (
            <div className="empty-form-state slide-up">
                <span className="icon" style={{fontSize:'3rem'}}>🎉</span>
                <h3 style={{color: '#10b981', margin:'1rem 0'}}>도감 저장 완료!</h3>
                <p>카드가 Firebase 데이터베이스에 성공적으로 안전하게 보관되었습니다.</p>
                <button className="btn btn-secondary" style={{marginTop:'1.5rem'}} onClick={() => setSuccess(false)}>새로운 카드 등록하기</button>
            </div>
        )}

        {error && <div className="error-box">🚨 {error}</div>}
        
        {cardData && !loading && !saving && !success && (
          <form className="card-form slide-in" ref={formRef} onSubmit={handleSaveToFirebase}>
             <h3>✨ 데이터 자동완성 완료!</h3>
             <small className="form-subtitle">노션의 양식 구조에 맞춰 AI가 채워둔 결과입니다. 틀린 부분만 살짝 수정하세요.</small>
             
             <div className="form-group">
                <label>카드 이름</label>
                <input type="text" name="cardName" defaultValue={cardData.cardName} />
             </div>
             <div className="form-group">
                <label>시리즈 기호</label>
                <input type="text" name="series" defaultValue={cardData.series} />
             </div>
             
             <div className="form-row">
                <div className="form-group">
                  <label>카드 넘버</label>
                  <input type="text" name="cardNumber" defaultValue={cardData.cardNumber} />
                </div>
                <div className="form-group">
                  <label>도감 번호</label>
                  <input type="text" name="pokedexNumber" defaultValue={cardData.pokedexNumber} />
                </div>
             </div>
             
                <div className="form-row">
                <div className="form-group">
                  <label>레어도 (Rarity)</label>
                  <input type="text" name="rarity" defaultValue={cardData.rarity} />
                </div>
                <div className="form-group">
                  <label>종류</label>
                  <input type="text" name="type" defaultValue={cardData.type} />
                </div>
             </div>
             
             <hr className="divider" />
             
             <div className="form-row">
                <div className="form-group">
                    <label>💰 구매/미감정 시세 (원)</label>
                    <input type="number" name="price" placeholder="예: 15000" />
                </div>
                <div className="form-group" style={{ display: 'flex', gap: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                        <label>✅ 상태</label>
                        <select name="status" defaultValue="수집 완료 (소장중)">
                            <option value="미보유">미보유</option>
                            <option value="수집 완료 (소장중)">수집 완료 (소장중)</option>
                            <option value="등급카드">등급카드</option>
                            <option value="배송 중">배송 중</option>
                            <option value="위시 리스트">위시 리스트</option>
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label>🌍 언어/국가</label>
                        <select name="language" defaultValue="한국">
                            <option value="한국">한국</option>
                            <option value="일본">일본</option>
                            <option value="미국">미국</option>
                            <option value="중국">중국</option>
                        </select>
                    </div>
                </div>
             </div>
             
             <button type="submit" className="btn btn-primary submit-btn">
                도감(Firebase)에 완전히 저장하기
             </button>
          </form>
        )}
        
        {!cardData && !loading && !saving && !success && !error && (
            <div className="empty-form-state">
                <p>왼쪽에서 사진을 선택하면<br/>AI가 이 곳에 양식을 마법처럼 채워줍니다.</p>
            </div>
        )}
      </div>
    </div>
  );
}
