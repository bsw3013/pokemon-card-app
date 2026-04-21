import React, { useState, useRef } from 'react';
import { analyzePokemonCard } from '../gemini';

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
    setError('직접 저장이 비활성화되었습니다. GitHub 기준 DB CSV를 먼저 수정한 뒤 관리자 화면에서 기준 DB 파일 복원을 실행해주세요.');
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
                  <label>등급 (Rarity)</label>
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
                <div className="form-group">
                    <label>✅ 상태</label>
                    <select name="status">
                        <option value="수집 완료 (소장중)">수집 완료 (소장중)</option>
                        <option value="배송 중">배송 중</option>
                        <option value="위시 리스트">위시 리스트</option>
                    </select>
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
