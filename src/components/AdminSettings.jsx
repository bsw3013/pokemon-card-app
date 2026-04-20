import React, { useState } from 'react';
import { doc, updateDoc, collection, getDocs, addDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import Papa from 'papaparse';

export default function AdminSettings({ appConfig, setAppConfig }) {
  const [config, setConfig] = useState(appConfig);
  const [saving, setSaving] = useState(false);
  
  // 새 항목 추가 위한 로컬 상태
  const [newSeries, setNewSeries] = useState('');
  const [newRarity, setNewRarity] = useState('');
  const [newType, setNewType] = useState('');
  const [newStatus, setNewStatus] = useState('');

  // 원시 데이터베이스 뷰어 상태
  const [rawDbData, setRawDbData] = useState(null);
  const [showRawDb, setShowRawDb] = useState(false);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rawSortConfig, setRawSortConfig] = useState({ key: null, direction: 'asc' });
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);

  // 커스텀 필드 추가 로직
  const [newFieldLabel, setNewFieldLabel] = useState('');

  // 8가지 기본 항목 배열 하드코딩 (삭제 방지용)
  const coreFields = ['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'];

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "settings", "appConfig"), config);
      setAppConfig(config);
      alert("✅ 마스터 설정이 저장되었습니다.");
    } catch(err) {
      console.error(err);
      alert("설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const fetchRawDb = async () => {
     if (showRawDb) {
        setShowRawDb(false);
        return;
     }
     setLoadingRaw(true);
     try {
       const snapshot = await getDocs(collection(db, "pokemon_cards"));
       const allData = snapshot.docs.map(d => ({ raw_database_id: d.id, ...d.data() }));
       setRawDbData(allData);
       setShowRawDb(true);
     } catch (err) {
       console.error(err);
       alert("데이터베이스 로드에 실패했습니다.");
     } finally {
       setLoadingRaw(false);
     }
  };

  const rawSaveTimeoutRef = React.useRef({});
  const [rawDbSaving, setRawDbSaving] = useState({});

  const handleRawEditChange = (id, key, value) => {
     // 실시간 로컬 State 업데이트
     setRawDbData(prev => prev.map(row => row.raw_database_id === id ? { ...row, [key]: value } : row));

     // 디바운스 서버 저장
     if (rawSaveTimeoutRef.current[id + key]) clearTimeout(rawSaveTimeoutRef.current[id + key]);
     
     rawSaveTimeoutRef.current[id + key] = setTimeout(async () => {
        setRawDbSaving(prev => ({ ...prev, [id]: true }));
        try {
           const ref = doc(db, "pokemon_cards", id);
           let finalValue = value;
           if (key === 'price') finalValue = parseInt(value) || 0;
           await updateDoc(ref, { [key]: finalValue });
        } catch (err) {
           console.error("DB 원격 저장 오류:", err);
        } finally {
           setRawDbSaving(prev => ({ ...prev, [id]: false }));
        }
     }, 800);
  };

  const handleRawDeleteRow = async (id) => {
      if(!window.confirm("이 카드를 데이터베이스에서 완전히 삭제할까요?")) return;
      try {
          await deleteDoc(doc(db, "pokemon_cards", id));
          setRawDbData(prev => prev.filter(r => r.raw_database_id !== id));
      } catch(err) {
          alert('삭제 실패');
      }
  };

  const handleRawAddRow = async () => {
      try {
          const newDoc = { cardName: "비어 있는 카드", price: 0 };
          const ref = await addDoc(collection(db, "pokemon_cards"), newDoc);
          setRawDbData(prev => [{ raw_database_id: ref.id, ...newDoc }, ...prev]);
      } catch(err) {
          alert("추가 실패");
      }
  };

  const handleRawSort = (key) => {
      let direction = 'asc';
      if (rawSortConfig.key === key && rawSortConfig.direction === 'asc') direction = 'desc';
      setRawSortConfig({ key, direction });
  };

  const handleRawAddColumn = async () => {
      const colName = window.prompt("데이터베이스의 모든 카드에 일괄적으로 삽입할 새로운 [열(Column)/항목 이름]을 영어 또는 숫자로 입력하세요.");
      if (!colName || !colName.trim()) return;

      if(!window.confirm(`정말로 모든 카드 데이터에 '${colName}' 이라는 빈 항목을 전역 생성하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

      setIsGlobalProcessing(true);
      try {
          const updates = rawDbData.map(async (row) => {
              const ref = doc(db, "pokemon_cards", row.raw_database_id);
              await updateDoc(ref, { [colName]: "" });
              row[colName] = "";
          });
          await Promise.all(updates);
          setRawDbData([...rawDbData]);
          alert("✅ 모든 문서에 항목이 성공적으로 생성되었습니다.");
      } catch (err) {
          console.error(err);
          alert("항목 추가 중 오류가 발생했습니다.");
      } finally {
          setIsGlobalProcessing(false);
      }
  };

  const handleRawDeleteColumn = async (colName) => {
      if (coreFields.includes(colName) || colName === 'raw_database_id') {
          return alert("코어 시스템 항목은 전체 삭제가 불가능합니다.");
      }
      
      if(!window.confirm(`🔥 경고: 정말로 [${colName}] 항목 자체를 클라우드에서 완전히 날려버리시겠습니까?\n모든 카드의 해당 정보가 영구 삭제됩니다!`)) return;

      setIsGlobalProcessing(true);
      try {
          const updates = rawDbData.map(async (row) => {
              const ref = doc(db, "pokemon_cards", row.raw_database_id);
              await updateDoc(ref, { [colName]: deleteField() });
              delete row[colName];
          });
          await Promise.all(updates);
          setRawDbData([...rawDbData]);
          alert(`✅ [${colName}] 항목이 모든 문서에서 성공적으로 삭제되었습니다.`);
      } catch (err) {
          console.error(err);
          alert("항목 삭제 중 오류가 발생했습니다.");
      } finally {
          setIsGlobalProcessing(false);
      }
  };

  const sortedRawData = React.useMemo(() => {
      if(!rawDbData) return [];
      const sortable = [...rawDbData];
      if (rawSortConfig.key) {
         sortable.sort((a,b) => {
            let va = a[rawSortConfig.key];
            let vb = b[rawSortConfig.key];
            if(va === undefined || va === null) va = '';
            if(vb === undefined || vb === null) vb = '';
            
            if (typeof va === 'number' && typeof vb === 'number') {
                return rawSortConfig.direction === 'asc' ? va - vb : vb - va;
            }
            va = String(va).toLowerCase();
            vb = String(vb).toLowerCase();
            if (va < vb) return rawSortConfig.direction === 'asc' ? -1 : 1;
            if (va > vb) return rawSortConfig.direction === 'asc' ? 1 : -1;
            return 0;
         });
      }
      return sortable;
  }, [rawDbData, rawSortConfig]);

  // --- 깃허브 직접 연동 로직 ---
  const GH_TOKEN  = import.meta.env.VITE_GITHUB_TOKEN;
  const GH_OWNER  = import.meta.env.VITE_GITHUB_OWNER;
  const GH_REPO   = import.meta.env.VITE_GITHUB_REPO;
  const GH_PATH   = import.meta.env.VITE_GITHUB_BACKUP_PATH || 'database_backups/main_dataset.csv';
  const GH_API    = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}`;

  const [ghStatus, setGhStatus] = useState('');

  const handleGithubBackup = async () => {
      if (!window.confirm('🚀 파이어베이스의 현재 전체 데이터를 깃허브에 CSV로 백업하시겠습니까?')) return;
      setGhStatus('⏳ 업로드 중...');
      try {
          // 1. DB 전체 읽기
          const snapshot = await getDocs(collection(db, 'pokemon_cards'));
          const allData = snapshot.docs.map(d => ({ raw_database_id: d.id, ...d.data() }));
          
          // 2. CSV 변환 (papaparse)
          const csvStr = Papa.unparse(allData, { header: true });
          const bom = '\uFEFF';
          const encoded = btoa(unescape(encodeURIComponent(bom + csvStr)));

          // 3. 기존 파일 SHA 조회 (덮어씌우려면 필요)
          let sha = null;
          try {
              const res = await fetch(GH_API, { headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'pokedex-app' } });
              if (res.ok) { const json = await res.json(); sha = json.sha; }
          } catch(_) {}

          // 4. 깃허브 PUT
          const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
          const body = { message: `🔒 DB 백업: ${now} (총 ${allData.length}건)`, content: encoded, ...(sha ? { sha } : {}) };
          const putRes = await fetch(GH_API, {
              method: 'PUT',
              headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'pokedex-app', 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
          });
          if (!putRes.ok) throw new Error(await putRes.text());
          setGhStatus(`✅ 깃허브 백업 완료! (${allData.length}건 저장됨)`);
      } catch (err) {
          console.error(err);
          setGhStatus('❌ 백업 실패: ' + err.message);
      }
  };

  const handleGithubRestore = async () => {
      if (!window.confirm('⚠️ 깃허브에 저장된 CSV로 현재 파이어베이스 DB를 교체하시겠습니까?\n기존 데이터는 유지되며, CSV에 있는 데이터가 추가/덮어씌워집니다.')) return;
      setGhStatus('⏳ 깃허브에서 불러오는 중...');
      try {
          // 1. 깃허브 파일 읽기
          const res = await fetch(GH_API, { headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'pokedex-app' } });
          if (!res.ok) throw new Error('깃허브에 백업 파일이 없습니다. 먼저 백업을 실행하세요.');
          const json = await res.json();
          const csvStr = decodeURIComponent(escape(atob(json.content)));

          // 2. CSV 파싱
          const parsed = Papa.parse(csvStr, { header: true, skipEmptyLines: true });
          const rows = parsed.data;

          // 3. Firestore에 upsert (raw_database_id가 있으면 해당 문서 update, 없으면 add)
          let count = 0;
          for (const row of rows) {
              const { raw_database_id, ...data } = row;
              if (data.price) data.price = parseInt(data.price) || 0;
              if (raw_database_id && raw_database_id.length > 5) {
                  await updateDoc(doc(db, 'pokemon_cards', raw_database_id), data);
              } else {
                  await addDoc(collection(db, 'pokemon_cards'), data);
              }
              count++;
          }
          setGhStatus(`✅ 깃허브에서 불러오기 완료! (${count}건 반영됨)`);
      } catch (err) {
          console.error(err);
          setGhStatus('❌ 불러오기 실패: ' + err.message);
      }
  };

  // --- 엑셀(CSV) 연동 로직 ---

  const downloadCsv = (csvStr, filename) => {
     // 한글 인코딩 깨짐 방지 BOM 추가
     const bom = "\uFEFF";
     const blob = new Blob([bom + csvStr], { type: 'text/csv;charset=utf-8;' });
     const link = document.createElement("a");
     const url = URL.createObjectURL(blob);
     link.setAttribute("href", url);
     link.setAttribute("download", filename);
     link.style.visibility = 'hidden';
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
  };

  const handleExportTemplate = () => {
     // 현재 설정된 필드들의 id값만 추출해서 헤더로 사용
     const headers = config.displayFields.sort((a,b)=>a.order-b.order).map(f => f.id);
     headers.push("imageUrl"); // 이미지 주소 입력 칸 기본 포함
     
     const csvStr = Papa.unparse([headers, []]);
     downloadCsv(csvStr, "pokemon_cards_template.csv");
  };

  const handleExportDatabase = async () => {
     try {
       const snapshot = await getDocs(collection(db, "pokemon_cards"));
       const allData = snapshot.docs.map(d => ({ raw_database_id: d.id, ...d.data() }));
       
       if (allData.length === 0) {
          alert("데이터베이스가 비어있습니다!");
          return;
       }

       // 모든 키(항목) 수집 (커스텀 항목 포함 전부)
       const allKeys = new Set();
       allData.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
       
       const csvStr = Papa.unparse(allData, { columns: Array.from(allKeys) });
       downloadCsv(csvStr, `pokemon_db_backup_${new Date().toISOString().split('T')[0]}.csv`);
     } catch (err) {
       console.error(err);
       alert("데이터베이스 추출에 실패했습니다.");
     }
  };

  const handleImportCSV = (e) => {
     const file = e.target.files[0];
     if (!file) return;

     Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
           const data = results.data;
           if (!data || data.length === 0) return alert("데이터가 없거나 형식이 잘못되었습니다.");
           if (!window.confirm(`총 ${data.length}개의 카드를 데이터베이스에 일괄 등록하시겠습니까? (복구 불가)`)) {
               e.target.value = null; // reset input
               return;
           }

           setSaving(true);
           try {
              let addedCount = 0;
              const cardsCol = collection(db, "pokemon_cards");
              
              for (const row of data) {
                 const payload = {};
                 for (const [k, v] of Object.entries(row)) {
                     // 엑셀에서 내려받은 내부 id값은 업로드시 제외 (새로운 카드로 등록)
                     if (k === 'raw_database_id') continue;
                     
                     if (k === 'price') payload[k] = parseInt(v) || 0;
                     else payload[k] = v || '';
                 }
                 // 필드 부족해도 무조건 생성
                 await addDoc(cardsCol, payload);
                 addedCount++;
              }
              alert(`✅ 총 ${addedCount}장의 카드가 데이터베이스에 성공적으로 등록되었습니다!\n페이지를 새로고침(나의 도감)하여 확인하세요.`);
           } catch(err) {
              console.error(err);
              alert("데이터 등록 중 일부 오류가 발생했습니다.");
           } finally {
              setSaving(false);
              e.target.value = null;
           }
        }
     });
  };

  const handleArrayAdd = (key, value, setter) => {
    if (!value.trim()) return;
    setConfig(prev => ({ ...prev, [key]: [...prev[key], value.trim()] }));
    setter('');
  };

  const handleArrayDelete = (key, index) => {
    setConfig(prev => {
      const arr = [...prev[key]];
      arr.splice(index, 1);
      return { ...prev, [key]: arr };
    });
  };

  const handleFieldLabelChange = (index, newLabel) => {
    setConfig(prev => {
      const newFields = [...prev.displayFields];
      newFields[index] = { ...newFields[index], label: newLabel };
      return { ...prev, displayFields: newFields };
    });
  };

  const deleteCustomField = (index) => {
    setConfig(prev => {
      const newFields = [...prev.displayFields];
      newFields.splice(index, 1);
      newFields.forEach((f, i) => f.order = i + 1); // re-calc order
      return { ...prev, displayFields: newFields };
    });
  };

  const moveArrayItem = (key, index, direction) => {
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === config[key].length - 1) return;

    setConfig(prev => {
      const newArr = [...prev[key]];
      const temp = newArr[index];
      newArr[index] = newArr[index + direction];
      newArr[index + direction] = temp;
      return { ...prev, [key]: newArr };
    });
  };

  const handleArrayEdit = (key, index, newText) => {
    setConfig(prev => {
      const newArr = [...prev[key]];
      newArr[index] = newText;
      return { ...prev, [key]: newArr };
    });
  };

  const addCustomField = () => {
    if (!newFieldLabel.trim()) return;
    const newFieldId = `custom_${Date.now()}`;
    setConfig(prev => {
      const newFields = [...prev.displayFields, { 
        id: newFieldId, 
        label: newFieldLabel.trim(), 
        visible: true, 
        order: prev.displayFields.length + 1 
      }];
      return { ...prev, displayFields: newFields };
    });
    setNewFieldLabel('');
  };

  const toggleFieldVisibility = (index) => {
    setConfig(prev => {
      const newFields = [...prev.displayFields];
      newFields[index] = { ...newFields[index], visible: !newFields[index].visible };
      return { ...prev, displayFields: newFields };
    });
  };

  const moveField = (index, direction) => {
    if (direction === -1 && index === 0) return;
    if (direction === 1 && index === config.displayFields.length - 1) return;

    setConfig(prev => {
      const newFields = [...prev.displayFields];
      const temp = newFields[index];
      newFields[index] = newFields[index + direction];
      newFields[index + direction] = temp;
      
      // Update order property
      newFields.forEach((f, i) => f.order = i + 1);
      return { ...prev, displayFields: newFields };
    });
  };

  const renderArrayManager = (title, key, newValue, setter) => (
    <div className="admin-section">
      <h3>{title}</h3>
      <div className="array-list">
        {config[key].map((item, idx) => (
          <div key={idx} className="field-row">
             <div className="field-order-controls">
                <button onClick={() => moveArrayItem(key, idx, -1)} disabled={idx === 0}>▲</button>
                <button onClick={() => moveArrayItem(key, idx, 1)} disabled={idx === config[key].length - 1}>▼</button>
             </div>
             <div className="field-label" style={{ fontWeight: 'normal', fontSize: '0.9rem', flex: 1, margin: '0 0.5rem' }}>
                <input 
                  type="text" 
                  value={item} 
                  onChange={(e) => handleArrayEdit(key, idx, e.target.value)} 
                  style={{ width: '100%', background: 'transparent', border: 'none', color: 'white', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '2px 4px', outline: 'none' }}
                />
             </div>
             <button className="btn btn-danger" style={{ padding: '2px 5px', fontSize: '0.75rem' }} onClick={() => handleArrayDelete(key, idx)}>✕</button>
          </div>
        ))}
      </div>
      <div className="add-field" style={{ marginTop: '1rem' }}>
        <input type="text" placeholder="새 항목 추가" value={newValue} onChange={e => setter(e.target.value)} onKeyDown={e => e.key==='Enter' && handleArrayAdd(key, newValue, setter)}/>
        <button className="btn btn-secondary" onClick={() => handleArrayAdd(key, newValue, setter)}>추가</button>
      </div>
    </div>
  );

  return (
    <div className="admin-settings fade-in">
       <div className="settings-header">
          <h2>⚙️ 마스터 환경설정</h2>
          <button className="btn btn-primary" onClick={handleSaveConfig} disabled={saving}>
             {saving ? "저장 중..." : "💾 모든 설정 서버에 저장하기"}
          </button>
       </div>

       <div className="settings-grid">
          {renderArrayManager("📦 확장팩/시리즈 관리", "seriesOptions", newSeries, setNewSeries)}
          {renderArrayManager("💎 카드 등급(Rarity) 관리", "rarityOptions", newRarity, setNewRarity)}
          {renderArrayManager("🔥 포켓몬 카드 종류 관리", "typeOptions", newType, setNewType)}
          {renderArrayManager("✨ 보관 상태 관리", "statusOptions", newStatus, setNewStatus)}
       </div>

       <div className="admin-section full-width">
          <h3>👁️ 카드 정보 표시 (화면 UI 조립)</h3>
          <p className="help-text">마우스로 항목을 가리키고 상/하 화살표를 눌러 우선순위(순서)를 바꾸거나 토글 버튼으로 숨길 수 있습니다. 여기서 숨겨도 기존 카드의 데이터는 데이터베이스에 영구 보존됩니다.</p>
          
          <div className="display-fields-list">
             {config.displayFields.map((field, idx) => (
               <div key={field.id} className={`field-row ${field.visible ? '' : 'disabled'}`}>
                  <div className="field-order-controls">
                     <button onClick={() => moveField(idx, -1)} disabled={idx === 0}>▲</button>
                     <button onClick={() => moveField(idx, 1)} disabled={idx === config.displayFields.length - 1}>▼</button>
                  </div>
                  
                  <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                     <input 
                       type="text" 
                       className="table-input" 
                       style={{ background: 'rgba(0,0,0,0.3)', width: 'auto', flex: 1 }}
                       value={field.label} 
                       onChange={(e) => handleFieldLabelChange(idx, e.target.value)} 
                       placeholder="표시 화면 타이틀"
                     />
                     <small>({field.id})</small>
                  </div>
                  
                  <div className="field-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div className="toggle-switch" onClick={() => toggleFieldVisibility(idx)}>
                        <div className={`switch ${field.visible ? 'on' : 'off'}`}></div>
                        <span>{field.visible ? '표시됨' : '숨김'}</span>
                      </div>
                      
                      {!coreFields.includes(field.id) && (
                         <button className="btn btn-danger" style={{ padding: '4px 8px' }} onClick={() => deleteCustomField(idx)}>✕ 지우기</button>
                      )}
                      {coreFields.includes(field.id) && (
                         <button className="btn" disabled style={{ padding: '4px 8px', visibility: 'hidden' }}>✕ 지우기</button>
                      )}
                  </div>
               </div>
             ))}
          </div>


          <div className="add-field-container" style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
             <h4 style={{ margin: '0 0 1rem 0', color: 'var(--primary-color)' }}>➕ 새로운 빈칸 정보 추가 (Custom Field 커스텀 필드)</h4>
             <div className="add-field">
                <input 
                  type="text" 
                  placeholder="예: 획득 일자, 카드 디자이너 이름 등..." 
                  value={newFieldLabel} 
                  onChange={e => setNewFieldLabel(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && addCustomField()}
                />
                <button className="btn btn-primary" onClick={addCustomField}>새 항목 만들기</button>
             </div>
          </div>
       </div>

       {/* 깃허브 연동 섹션 */}
       <div className="admin-section full-width" style={{ marginTop: '2rem', border: '1px solid #7c3aed' }}>
          <h3>🐙 깃허브 클라우드 백업 & 복원 (GitHub)</h3>
          <p className="help-text">
             파이어베이스 DB 전체 데이터를 <strong style={{ color: '#7c3aed' }}>github.com/bsw3013/pokemon-card-app</strong> 에 원터치로 저장하거나 불러옵니다.<br/>
             백업 시 기존 파일을 덮어씌우며, 깃허브가 자동으로 버전 히스토리를 관리합니다.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
             <div style={{ background: 'rgba(124,58,237,0.1)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.3)' }}>
                <h4 style={{ color: '#7c3aed', marginBottom: '0.5rem' }}>🚀 깃허브로 백업 (DB → GitHub)</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>현재 DB의 모든 카드를 <code>database_backups/main_dataset.csv</code> 로 저장합니다.</p>
                <button className="btn" style={{ background: '#7c3aed', color: 'white', width: '100%', padding: '0.8rem' }} onClick={handleGithubBackup}>
                   ⬆️ 지금 즉시 깃허브에 백업
                </button>
             </div>
             <div style={{ background: 'rgba(124,58,237,0.1)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.3)' }}>
                <h4 style={{ color: '#a78bfa', marginBottom: '0.5rem' }}>📥 깃허브에서 복원 (GitHub → DB)</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>깃허브에 저장된 <code>main_dataset.csv</code>를 읽어 파이어베이스에 반영합니다.</p>
                <button className="btn" style={{ border: '1px solid #7c3aed', color: '#a78bfa', width: '100%', padding: '0.8rem', background: 'transparent' }} onClick={handleGithubRestore}>
                   ⬇️ 깃허브에서 DB로 불러오기
                </button>
             </div>
          </div>

          {ghStatus && (
             <div style={{ marginTop: '1rem', padding: '0.8rem 1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', color: ghStatus.startsWith('✅') ? '#10b981' : ghStatus.startsWith('❌') ? '#ef4444' : '#facc15', fontWeight: 'bold', fontSize: '0.9rem' }}>
                {ghStatus}
             </div>
          )}
       </div>

       {/* 데이터베이스 연동 섹션 추가 */}
       <div className="admin-section full-width" style={{ marginTop: '2rem', border: '1px solid #10b981' }}>

          <h3>💾 글로벌 데이터 클라우드 관리 (엑셀 연동)</h3>
          <p className="help-text">
             화면 표시 설정과 무관하게, 서버에 저장된 100% 원본 표 데이터베이스를 엑셀과 연동합니다.<br/>
             방대한 양의 카드 데이터를 한 번에 넣거나 백업할 때 사용하세요.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
             <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                <h4 style={{ color: '#3b82f6', marginBottom: '1rem' }}>📥 대량 데이터 밀어넣기 (Import)</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>미리 작성된 엑셀(.csv) 파일을 올려 수천 장의 카드를 단번에 등록합니다.</p>
                <input 
                   type="file" 
                   accept=".csv" 
                   onChange={handleImportCSV} 
                   style={{ display: 'none' }} 
                   id="csv-upload"
                />
                <label htmlFor="csv-upload" className="btn btn-primary" style={{ display: 'inline-block', cursor: 'pointer', textAlign: 'center', width: '100%' }}>
                   📂 CSV 엑셀 파일 업로드
                </label>
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                   <button className="btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem', border: '1px solid rgba(255,255,255,0.2)' }} onClick={handleExportTemplate}>
                      📄 빈 엑셀 템플릿(양식) 다운로드
                   </button>
                </div>
             </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                <h4 style={{ color: '#10b981', marginBottom: '1rem' }}>📤 전체 데이터 풀 백업 & 열람</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>DB에 쌓인 모든 카드의 숨은 항목 데이터를 엑셀로 추출하거나 웹에서 봅니다.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                   <button className="btn" style={{ background: '#10b981', color: 'white', width: '100%', padding: '0.8rem' }} onClick={handleExportDatabase}>
                      ⬇️ 클라우드 전체 데이터 엑셀(CSV) 다운로드
                   </button>
                   <button className="btn" style={{ border: '1px solid #10b981', color: '#10b981', width: '100%', padding: '0.8rem', background: 'transparent' }} onClick={fetchRawDb}>
                      {loadingRaw ? '불러오는 중...' : showRawDb ? '📋 원격 데이터 뷰어 닫기' : '📋 웹에서 원시 표 즉시 펼치기'}
                   </button>
                </div>
             </div>
          </div>
          
          {showRawDb && rawDbData && (
             <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(0,0,0,0.5)', borderRadius: '8px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                   <h4 style={{ color: 'var(--primary-color)', margin: 0 }}>
                       🔎 실시간 원본 데이터베이스 뷰어 (총 {rawDbData.length}건)
                       {isGlobalProcessing && <span style={{ color: '#ef4444', marginLeft: '1rem', fontSize: '0.8rem' }}>대규모 전역 동기화 처리 중...</span>}
                   </h4>
                   <div style={{ display: 'flex', gap: '0.5rem' }}>
                       <button className="btn btn-secondary" disabled={isGlobalProcessing} onClick={handleRawAddRow}>➕ 최상단 빈 카드 1장 추가</button>
                       <button className="btn btn-primary" disabled={isGlobalProcessing} onClick={handleRawAddColumn}>➕ 새로운 열(항목) 전체 추가</button>
                   </div>
                </div>
                <table className="admin-table" style={{ fontSize: '0.8rem' }}>
                   <thead>
                      <tr>
                         <th style={{ padding: '0.5rem', width: '60px' }}>삭제</th>
                         {[...new Set(rawDbData.flatMap(Object.keys))].map(k => (
                             <th 
                               key={k} 
                               onClick={() => handleRawSort(k)}
                               style={{ padding: '0.5rem', color: '#3b82f6', minWidth: '80px', cursor: 'pointer', userSelect: 'none' }}
                             >
                                 <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'4px' }}>
                                    {k}
                                    {rawSortConfig.key === k ? (rawSortConfig.direction === 'asc' ? ' 🔼' : ' 🔽') : ''}
                                    {k !== 'raw_database_id' && !coreFields.includes(k) && (
                                        <button className="btn btn-danger" style={{ padding: '2px 4px', fontSize: '0.6rem', marginLeft: '5px' }} onClick={(e) => { e.stopPropagation(); handleRawDeleteColumn(k); }}>🗑️</button>
                                    )}
                                 </div>
                             </th>
                         ))}
                      </tr>
                   </thead>
                   <tbody>
                      {sortedRawData.map((row, i) => (
                         <tr key={row.raw_database_id || i} className={rawDbSaving[row.raw_database_id] ? 'row-draft' : ''}>
                            <td style={{ padding: '0.2rem 0.5rem', textAlign: 'center' }}>
                                <button className="btn btn-danger" style={{ padding: '2px 8px' }} onClick={() => handleRawDeleteRow(row.raw_database_id)}>✕</button>
                            </td>
                            {[...new Set(rawDbData.flatMap(Object.keys))].map(k => (
                               <td key={k} style={{ padding: '0' }}>
                                  {k === 'raw_database_id' ? (
                                      <div style={{ padding: '0.5rem', color: 'gray', fontSize:'0.7rem' }}>{row[k]}</div>
                                  ) : (
                                      <input 
                                         type="text" 
                                         className="table-input" 
                                         style={{ 
                                            background: 'transparent', 
                                            border: 'none', 
                                            width: '100%', 
                                            padding: '0.5rem', 
                                            outline: 'none', 
                                            color: rawDbSaving[row.raw_database_id] ? '#10b981' : 'white' 
                                         }} 
                                         value={typeof row[k] === 'object' ? JSON.stringify(row[k]) : (row[k] || '')} 
                                         onChange={(e) => handleRawEditChange(row.raw_database_id, k, e.target.value)} 
                                      />
                                  )}
                               </td>
                            ))}
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
          )}
       </div>
    </div>
  );
}
