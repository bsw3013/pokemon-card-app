import React, { useState, useEffect } from 'react';
import { doc, updateDoc, collection, getDocs, deleteDoc, deleteField, writeBatch } from 'firebase/firestore';
import { db, functions } from '../firebase';
import Papa from 'papaparse';

export default function AdminSettings({ appConfig, setAppConfig }) {
   const hiddenSystemFields = ['raw_database_id', 'imageUrl', 'displayOrder', 'createdAt', 'islegacy', 'isLegacy'];
   const sanitizeDisplayFields = (fields = []) => {
      const cleaned = fields.filter((field) => field?.id && !hiddenSystemFields.includes(field.id));
      return cleaned.map((field, index) => ({ ...field, order: index + 1 }));
   };
   const sanitizeConfig = (baseConfig) => ({
      ...baseConfig,
      displayFields: sanitizeDisplayFields(baseConfig?.displayFields || [])
   });

   const [config, setConfig] = useState(() => sanitizeConfig(appConfig));
  const [saving, setSaving] = useState(false);

   useEffect(() => {
      setConfig(sanitizeConfig(appConfig));
   }, [appConfig]);
  
  // 새 항목 추가 위한 로컬 상태
  const [newSeries, setNewSeries] = useState('');
  const [newRarity, setNewRarity] = useState('');
   const [newGradingCompany, setNewGradingCompany] = useState('');
  const [newType, setNewType] = useState('');
  const [newStatus, setNewStatus] = useState('');
   const [newGradingScale, setNewGradingScale] = useState('');

  // 원시 데이터베이스 뷰어 상태
  const [rawDbData, setRawDbData] = useState(null);
  const [showRawDb, setShowRawDb] = useState(false);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rawSortConfig, setRawSortConfig] = useState({ key: null, direction: 'asc' });
  const [isGlobalProcessing, setIsGlobalProcessing] = useState(false);
   const [rawCellDrafts, setRawCellDrafts] = useState({});

  // 커스텀 필드 추가 로직
  const [newFieldLabel, setNewFieldLabel] = useState('');

  // 8가지 기본 항목 배열 하드코딩 (삭제 방지용)
  const coreFields = ['cardName', 'pokedexNumber', 'series', 'cardNumber', 'rarity', 'type', 'status', 'price'];

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
         const cleanedConfig = sanitizeConfig(config);
         await updateDoc(doc(db, "settings", "appConfig"), cleanedConfig);
         setConfig(cleanedConfig);
         setAppConfig(cleanedConfig);
      alert("✅ 마스터 설정이 저장되었습니다.");
    } catch(err) {
      console.error(err);
      alert("설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  // --- 헤더-설정 동기화 유틸리티 ---
  const syncHeadersWithConfig = async (headers) => {
    if (!headers || headers.length === 0) return;
    
   // 1. 시스템 내부용 필드 및 이미지 주소 제외
    const excluded = [...hiddenSystemFields];
    const csvFields = headers.filter(h => h && !excluded.includes(h));

      const updatedFields = [...sanitizeDisplayFields(config.displayFields)];
    let changed = false;

    // A. 추가 로직: CSV에는 있는데 설정에는 없는 필드 추가
    csvFields.forEach(header => {
      if (!updatedFields.find(f => f.id === header)) {
        updatedFields.push({
          id: header,
          label: header, 
          visible: true,
          order: updatedFields.length + 1
        });
        changed = true;
      }
    });

    // B. 삭제 로직: 설정에는 있는데 CSV에는 없고, 코어 필드도 아닌 것 제거
      const finalFields = updatedFields.filter(field => {
      const isCore = coreFields.includes(field.id);
      const inCsv = csvFields.includes(field.id);
         const isHiddenSystemField = hiddenSystemFields.includes(field.id);
         if (isHiddenSystemField || (!inCsv && !isCore)) {
        changed = true;
        return false;
      }
      return true;
    });

    if (changed) {
      // 순서 재정렬
      finalFields.forEach((f, i) => f.order = i + 1);
      const newConfig = { ...config, displayFields: finalFields };
      setConfig(newConfig);
      // 서버에도 즉시 저장
      try {
        await updateDoc(doc(db, "settings", "appConfig"), newConfig);
        setAppConfig(newConfig);
        console.log("✅ CSV 헤더에 맞춰 마스터 표시 항목이 자동 갱신되었습니다.");
      } catch (err) {
        console.error("설정 자동 동기화 실패:", err);
      }
    }
  };



  const fetchRawDb = async () => {
     if (showRawDb) {
        setShowRawDb(false);
        return;
     }
     setRawSortConfig({ key: null, direction: 'asc' });
     setLoadingRaw(true);
     try {
          // 1. GitHub 최신 백업 CSV 기준 행 가져오기
      let csvRowIds = [];
       try {
             const listRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/database_backups`, {
           headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'pokedex-app' }
         });

             if (!listRes.ok) throw new Error('백업 폴더 목록을 가져올 수 없습니다.');
             const files = await listRes.json();
             const backupFiles = files
                .filter(f => f.name.startsWith('backup_') && f.name.endsWith('.csv'))
                .sort((a, b) => a.name.localeCompare(b.name));
             if (backupFiles.length === 0) throw new Error('최신 백업 파일이 없습니다.');

             const latestFile = backupFiles[backupFiles.length - 1];
             const contentRes = await fetch(latestFile.url, {
                headers: { Authorization: `token ${GH_TOKEN}`, 'User-Agent': 'pokedex-app' }
             });

         if (contentRes.ok) {
           const json = await contentRes.json();
           const cleanBase64 = json.content.replace(/\n/g, '');
           const bytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));
           const csvStr = new TextDecoder('utf-8').decode(bytes);
           
           const parsed = Papa.parse(csvStr, {
             header: true,
             skipEmptyLines: 'greedy',
             transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim()
           });

           const rows = (parsed.data || []).filter((row) => {
             const values = Object.values(row || {});
             return values.some(v => String(v ?? '').trim() !== '');
           });

           // GitHub CSV의 raw_database_id 순서 보존
           csvRowIds = rows.map(r => String(r.raw_database_id || '').trim()).filter(id => id.length > 5);
         }
          } catch (ghErr) {
             console.log("GitHub 최신 백업 CSV 읽기 실패:", ghErr);
             throw ghErr;
       }

       // 2. Firestore에서 모든 데이터 가져오기
       const snapshot = await getDocs(collection(db, "pokemon_cards"));
       let allData = snapshot.docs.map(d => ({ raw_database_id: d.id, ...d.data() }));
       
          // 3. 정렬: GitHub CSV 순서만 화면에 표시 (GitHub가 기준)
       const csvDataMap = new Map();
       
       allData.forEach(item => {
         const id = String(item.raw_database_id || '');
             if (csvRowIds.includes(id)) csvDataMap.set(id, item);
       });
       
          const sortedData = csvRowIds
             .map((id) => csvDataMap.get(id))
             .filter(Boolean);
       
       setRawDbData(sortedData);
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
      setRawCellDrafts(prev => ({
         ...prev,
         [id]: {
            ...(prev[id] || {}),
            [key]: value
         }
      }));
  };

  const commitRawEditChange = async (id, key) => {
      const draftValue = rawCellDrafts[id]?.[key];
      const row = rawDbData?.find(item => item.raw_database_id === id);
      if (!row || draftValue === undefined) return;

      const nextValue = key === 'price' ? (parseInt(String(draftValue)) || 0) : draftValue;
      const currentValue = key === 'price' ? (Number(row[key]) || 0) : (row[key] ?? '');
      const normalizedNext = key === 'price' ? Number(nextValue || 0) : String(nextValue ?? '');
      const normalizedCurrent = key === 'price' ? Number(currentValue || 0) : String(currentValue ?? '');
      if (normalizedNext === normalizedCurrent) return;

      setRawDbSaving(prev => ({ ...prev, [id]: true }));
      try {
         const ref = doc(db, "pokemon_cards", id);
         await updateDoc(ref, { [key]: nextValue });
         setRawDbData(prev => prev.map(item => item.raw_database_id === id ? { ...item, [key]: nextValue } : item));
         setRawCellDrafts(prev => {
            const nextDrafts = { ...prev };
            if (nextDrafts[id]) {
               const { [key]: removed, ...rest } = nextDrafts[id];
               if (Object.keys(rest).length === 0) delete nextDrafts[id];
               else nextDrafts[id] = rest;
            }
            return nextDrafts;
         });
      } catch (err) {
         console.error("DB 원격 저장 오류:", err);
      } finally {
         setRawDbSaving(prev => ({ ...prev, [id]: false }));
      }
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
           const BATCH_LIMIT = 400;
           let batch = writeBatch(db);
           let ops = 0;
           for (const row of rawDbData) {
              batch.update(doc(db, "pokemon_cards", row.raw_database_id), { [colName]: "" });
              row[colName] = "";
              ops++;
              if (ops >= BATCH_LIMIT) {
               await batch.commit();
               batch = writeBatch(db);
               ops = 0;
              }
           }
           if (ops > 0) await batch.commit();
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
           const BATCH_LIMIT = 400;
           let batch = writeBatch(db);
           let ops = 0;
           for (const row of rawDbData) {
              batch.update(doc(db, "pokemon_cards", row.raw_database_id), { [colName]: deleteField() });
              delete row[colName];
              ops++;
              if (ops >= BATCH_LIMIT) {
               await batch.commit();
               batch = writeBatch(db);
               ops = 0;
              }
           }
           if (ops > 0) await batch.commit();
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
      if (!rawSortConfig.key) {
         return sortable;
      } else {
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

     const rawVisibleColumns = React.useMemo(() => {
        if (!rawDbData || rawDbData.length === 0) return [];
        return [...new Set(rawDbData.flatMap(Object.keys))].filter((key) => {
           return key !== 'raw_database_id' && !hiddenSystemFields.includes(key);
        });
     }, [rawDbData]);

  // --- 깃허브 직접 연동 로직 ---
   // Security change: client must not hold a GitHub PAT.
   // All GitHub write/read operations should be performed server-side (Functions/Actions).
   const GH_TOKEN  = import.meta.env.VITE_GITHUB_TOKEN;
   const GH_OWNER  = import.meta.env.VITE_GITHUB_OWNER;
   const GH_REPO   = import.meta.env.VITE_GITHUB_REPO;
   const GH_MAIN_PATH = import.meta.env.VITE_GITHUB_BACKUP_PATH || 'database_backups/main_dataset.csv';

  const [ghStatus, setGhStatus] = useState('');

  const handleGithubBackup = async () => {
     if (!window.confirm('🚀 파이어베이스 데이터를 깃허브에 누적 백업하시겠습니까?')) return;
     if (!GH_TOKEN) return alert("VITE_GITHUB_TOKEN 설정이 필요합니다.");
     setGhStatus('⏳ 백업 데이터 준비 중...');
     try {
        const snapshot = await getDocs(collection(db, 'pokemon_cards'));
        const allData = snapshot.docs
          .map(d => ({ raw_database_id: d.id, ...d.data() }))
          .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0));

        const allKeys = new Set(['raw_database_id']);
        allData.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
        
        const csvStr = Papa.unparse(allData, { columns: Array.from(allKeys) });
        const bom = "\uFEFF";
        const encodedContent = btoa(unescape(encodeURIComponent(bom + csvStr)));
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        const filename = `database_backups/backup_${timestamp}.csv`;

        // 1. 타임스탬프 로그 백업
        setGhStatus('⏳ 로그 백업 파일 업로드 중...');
        const logRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${filename}`, {
           method: 'PUT',
           headers: { Authorization: `token ${GH_TOKEN}`, 'Content-Type': 'application/json' },
           body: JSON.stringify({ message: `🔒 누적 백업: ${timestamp} (총 ${allData.length}건)`, content: encodedContent })
        });
        if (!logRes.ok) throw new Error("로그 백업 실패");

        // 2. 메인 데이터셋 갱신 (항상 최신 상태 유지)
        setGhStatus('⏳ 메인 데이터셋(main_dataset.csv) 동기화 중...');
        let sha = null;
        const checkRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_MAIN_PATH}`, {
           headers: { Authorization: `token ${GH_TOKEN}` }
        });
        if (checkRes.ok) {
           const json = await checkRes.json();
           sha = json.sha;
        }

        const mainRes = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_MAIN_PATH}`, {
           method: 'PUT',
           headers: { Authorization: `token ${GH_TOKEN}`, 'Content-Type': 'application/json' },
           body: JSON.stringify({ message: `✅ 최신 데이터 동기화: ${timestamp}`, content: encodedContent, sha })
        });
        if (!mainRes.ok) throw new Error("메인 데이터셋 갱신 실패");

        setGhStatus(`✅ 백업 성공! (${allData.length}건)`);
     } catch (err) {
        console.error(err);
        setGhStatus('❌ 백업 실패: ' + err.message);
     }
  };

  const handleGithubRestore = async () => {
    if (!GH_TOKEN) return alert("VITE_GITHUB_TOKEN 설정이 필요합니다.");
    if (!window.confirm(`⚠️ GitHub의 'main_dataset.csv' 파일로 현재 DB를 덮어씁니다.\n\n이 작업은 Firestore의 모든 데이터를 CSV 내용과 100% 일치시킵니다.\n(수동으로 수정한 CSV를 DB에 즉시 반영하기에 아주 좋습니다)`)) return;
    
    setGhStatus('⏳ GitHub에서 데이터 가져오는 중...');
    try {
       const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_MAIN_PATH}`, {
          headers: { Authorization: `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' }
       });
       if (!res.ok) throw new Error("GitHub CSV 파일을 찾을 수 없습니다.");
       const csvStr = await res.text();
       
       Papa.parse(csvStr, {
          header: true,
          skipEmptyLines: true,
          complete: async (results) => {
             const csvData = results.data;
             if (!csvData || csvData.length === 0) throw new Error("CSV 데이터가 비어있습니다.");
             
             setGhStatus(`⏳ 동기화 중... (0/${csvData.length})`);
             const cardsCol = collection(db, "pokemon_cards");
             
             // 1. 현재 Firestore 데이터 모두 가져오기 (매칭 및 삭제용)
             const snapshot = await getDocs(cardsCol);
             const currentIds = snapshot.docs.map(d => d.id);
             const csvIds = csvData.map(row => String(row.raw_database_id || '').trim()).filter(Boolean);

             const BATCH_LIMIT = 400;
             let batch = writeBatch(db);
             let ops = 0;

             // 2. CSV 기준으로 추가 또는 업데이트
             for (const [idx, row] of csvData.entries()) {
                const id = String(row.raw_database_id || '').trim();
                const payload = { ...row };
                delete payload.raw_database_id;
                
                // 데이터 타입 변환 (숫자 및 JSON 객체)
                Object.keys(payload).forEach(key => {
                   let val = payload[key];
                   if (key === 'price' || key === 'displayOrder') {
                      payload[key] = parseInt(val) || 0;
                   } else if (typeof val === 'string' && val.trim().startsWith('[') && val.trim().endsWith(']')) {
                      try { payload[key] = JSON.parse(val); } catch(e) { payload[key] = val; }
                   }
                });

                if (id && currentIds.includes(id)) {
                   // 업데이트
                   batch.update(doc(db, "pokemon_cards", id), payload);
                } else {
                   // 신규 생성 (ID 지정 가능하면 지정, 없으면 자동생성)
                   if (id) batch.set(doc(db, "pokemon_cards", id), payload);
                   else batch.set(doc(cardsCol), payload);
                }

                ops++;
                if (ops >= BATCH_LIMIT) {
                   await batch.commit();
                   batch = writeBatch(db);
                   ops = 0;
                   setGhStatus(`⏳ 동기화 중... (${idx + 1}/${csvData.length})`);
                }
             }

             // 3. CSV에 없는 데이터 삭제 (필요한 경우)
             if (window.confirm("🤔 깃허브 엑셀에 없는 데이터를 DB에서 모두 삭제하여 100% 일치시킬까요?\n(새로 등록된 카드만 삭제할 경우 '취소'를 누르면 업데이트만 진행됩니다)")) {
                for (const id of currentIds) {
                   if (!csvIds.includes(id)) {
                      batch.delete(doc(db, "pokemon_cards", id));
                      ops++;
                      if (ops >= BATCH_LIMIT) {
                         await batch.commit();
                         batch = writeBatch(db);
                         ops = 0;
                      }
                   }
                }
             }

             if (ops > 0) await batch.commit();
             setGhStatus(`✅ 복원 및 동기화 완료! (총 ${csvData.length}건)`);
             alert("🚀 모든 데이터가 성공적으로 동기화되었습니다.");
             window.location.reload();
          }
       });

    } catch (err) {
       console.error(err);
       setGhStatus('❌ 복원 실패: ' + err.message);
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
          const allData = snapshot.docs
             .map(d => ({ raw_database_id: d.id, ...d.data() }))
             .sort((a, b) => (Number(a.displayOrder) || Number.MAX_SAFE_INTEGER) - (Number(b.displayOrder) || Number.MAX_SAFE_INTEGER));
       
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
        const data = (results.data || []).filter(row => Object.values(row).some(v => String(v).trim() !== ''));
        const headers = results.meta.fields;

        if (!data || data.length === 0) return alert("데이터가 없거나 형식이 잘못되었습니다.");
        if (!window.confirm(`총 ${data.length}개의 카드를 동기화(추가/수정)하시겠습니까?`)) {
          e.target.value = null;
          return;
        }

        setSaving(true);
        try {
          if (headers) await syncHeadersWithConfig(headers);

          const cardsCol = collection(db, "pokemon_cards");
          const snapshot = await getDocs(cardsCol);
          const currentIds = snapshot.docs.map(d => d.id);

          const BATCH_LIMIT = 400;
          let batch = writeBatch(db);
          let ops = 0;

          for (const [index, row] of data.entries()) {
            const id = String(row.raw_database_id || '').trim();
            const payload = {};
            for (const [k, v] of Object.entries(row)) {
              if (k === 'raw_database_id') continue;
              
              let val = v || '';
              // 타입 변환
              if (k === 'price' || k === 'displayOrder') {
                 val = parseInt(val) || 0;
              } else if (typeof val === 'string' && val.trim().startsWith('[') && val.trim().endsWith(']')) {
                 try { val = JSON.parse(val); } catch(e) {}
              }
              payload[k] = val;
            }

            if (id && currentIds.includes(id)) {
              batch.update(doc(db, "pokemon_cards", id), payload);
            } else {
              if (id) batch.set(doc(db, "pokemon_cards", id), payload);
              else batch.set(doc(cardsCol), payload);
            }

            ops++;
            if (ops >= BATCH_LIMIT) {
              await batch.commit();
              batch = writeBatch(db);
              ops = 0;
            }
          }

          if (ops > 0) await batch.commit();
          alert(`✅ 총 ${data.length}장의 카드가 동기화되었습니다.`);
          window.location.reload();
        } catch(err) {
          console.error(err);
          alert("데이터 등록 중 오류가 발생했습니다.");
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
          {renderArrayManager("💎 카드 레어도(Rarity) 관리", "rarityOptions", newRarity, setNewRarity)}
          {renderArrayManager("🏷️ 등급 업체 관리", "gradingCompaniesOptions", newGradingCompany, setNewGradingCompany)}
          {renderArrayManager("🔢 등급(스케일) 관리 (1-10 기본)", "gradingScaleOptions", newGradingScale, setNewGradingScale)}
          {renderArrayManager("🔥 포켓몬 카드 종류 관리", "typeOptions", newType, setNewType)}
          {renderArrayManager("✨ 보관 상태 관리", "statusOptions", newStatus, setNewStatus)}
       </div>

       <div className="admin-section full-width">
          <h3>👁️ 카드 정보 표시 & 화면 UI 자동 동기화</h3>
          <p className="help-text">엑셀이나 깃허브에서 데이터를 불러올 때, 엑셀의 헤더 구성에 따라 아래 항목들이 자동으로 생기거나 없어지도록 연동되었습니다.</p>
          
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
          <h3>🐙 깃허브 누적 클라우드 백업 (GitHub)</h3>
          <p className="help-text">
             기존 파일을 덮어씌우지 않고 백업 파일을 계속 생성하여 안전하게 보관합니다.<br/>
             복원 시에는 항상 backup_ 파일 중 가장 최신 파일을 기준으로 Firestore를 동기화합니다.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
             <div style={{ background: 'rgba(124,58,237,0.1)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.3)' }}>
                <h4 style={{ color: '#7c3aed', marginBottom: '0.5rem' }}>🚀 깃허브 누적 백업 (DB → GitHub)</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>현재 데이터를 <code>backup_날짜_시간.csv</code> 로 안전하게 저장합니다.</p>
                <button className="btn" style={{ background: '#7c3aed', color: 'white', width: '100%', padding: '0.8rem' }} onClick={handleGithubBackup}>
                   ⬆️ 지금 즉시 누적 백업 생성
                </button>
             </div>
             <div style={{ background: 'rgba(124,58,237,0.1)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(124,58,237,0.3)' }}>
                <h4 style={{ color: '#a78bfa', marginBottom: '0.5rem' }}>📥 깃허브 기준 데이터 복원</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>GitHub의 최신 백업 데이터베이스를 기준으로 모든 행순서, 개수, 설정을 일치시킵니다.</p>
                <button className="btn" style={{ border: '1px solid #7c3aed', color: '#a78bfa', width: '100%', padding: '0.8rem', background: 'transparent' }} onClick={handleGithubRestore}>
                   ⬇️ 최신 백업 DB로 복원
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
             방대한 양의 카드 데이터를 엑셀로 한 번에 넣거나 백업할 수 있습니다.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
             <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                <h4 style={{ color: '#3b82f6', marginBottom: '1rem' }}>📥 대량 데이터 업로드 (Import)</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>엑셀(.csv) 파일을 올려 수천 장의 카드를 등록하고 항목 설정까지 자동 동기화합니다.</p>
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
                      📄 빈 엑셀 템플릿 다운로드
                   </button>
                </div>
             </div>

              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                <h4 style={{ color: '#10b981', marginBottom: '1rem' }}>📤 전체 데이터 풀 백업 & 열람</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                   <button className="btn" style={{ background: '#10b981', color: 'white', width: '100%', padding: '0.8rem' }} onClick={handleExportDatabase}>
                      ⬇️ 클라우드 데이터 엑셀(CSV) 다운로드
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
                       🔎 실시간 원본 데이터베이스 뷰어 (총 {rawDbData.length}건, 🐙 GitHub 기준 정렬됨)
                   </h4>
                   <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" disabled={true} title="행 추가는 GitHub 기준 DB CSV를 먼저 수정한 뒤 복원으로 반영됩니다">➕ 새 행 추가 (비활성)</button>
                       <button className="btn btn-primary" disabled={isGlobalProcessing} onClick={handleRawAddColumn}>➕ 새로운 열(항목) 추가</button>
                   </div>
                </div>
                <table className="admin-table" style={{ fontSize: '0.8rem' }}>
                   <thead>
                      <tr>
                         <th style={{ padding: '0.5rem', width: '60px' }}>삭제</th>
                         {rawVisibleColumns.map(k => (
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
                         <tr key={row.raw_database_id || i}>
                            <td style={{ padding: '0.2rem 0.5rem', textAlign: 'center' }}>
                                <button className="btn btn-danger" style={{ padding: '2px 8px' }} onClick={() => handleRawDeleteRow(row.raw_database_id)}>✕</button>
                            </td>
                            {rawVisibleColumns.map(k => (
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
                                            color: 'white' 
                                         }} 
                                                             value={rawCellDrafts[row.raw_database_id]?.[k] ?? (typeof row[k] === 'object' ? JSON.stringify(row[k]) : (row[k] || ''))} 
                                                             onChange={(e) => handleRawEditChange(row.raw_database_id, k, e.target.value)} 
                                                             onBlur={() => commitRawEditChange(row.raw_database_id, k)}
                                                             onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
