const fs = require('fs');

// AdminSettings.jsx
let admin = fs.readFileSync('src/components/AdminSettings.jsx', 'utf-8');

admin = admin.replace(
`   const hiddenSystemFields = ['raw_database_id', 'imageUrl', 'displayOrder', 'createdAt', 'islegacy', 'isLegacy'];
   const sanitizeDisplayFields = (fields = []) => {
      const cleaned = fields.filter((field) => field?.id && !hiddenSystemFields.includes(field.id));
      return cleaned.map((field, index) => ({ ...field, order: index + 1 }));
   };
   const sanitizeConfig = (baseConfig) => ({
      ...baseConfig,
      displayFields: sanitizeDisplayFields(baseConfig?.displayFields || [])
   });

   const [config, setConfig] = useState(() => sanitizeConfig(appConfig));`,
`   const [config, setConfig] = useState(() => sanitizeConfig(appConfig));`
);

admin = admin.replace(
`   useEffect(() => {
      setConfig(sanitizeConfig(appConfig));
   }, [appConfig]);`,
`   useEffect(() => {
      // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
      setConfig(sanitizeConfig(appConfig));
   }, [appConfig]);`
);

admin = admin.replace(
`  const rawSaveTimeoutRef = React.useRef({});
  const [rawDbSaving, setRawDbSaving] = useState({});

  const handleRawEditChange`,
`  const handleRawEditChange`
);

admin = admin.replace(
`      setRawDbSaving(prev => ({ ...prev, [id]: true }));
      try {
         const ref = doc(db, "pokemon_cards", id);`,
`      try {
         const ref = doc(db, "pokemon_cards", id);`
);

admin = admin.replace(
`      } catch (err) {
         console.error("DB ? ????:", err);
      } finally {
         setRawDbSaving(prev => ({ ...prev, [id]: false }));
      }`,
`      } catch (err) {
         console.error("DB ? ????:", err);
      }`
);

admin = admin.replace(
`      } catch(err) {
          alert('?? ?');
      }`,
`      } catch(err) {
          console.error(err);
          alert('?? ?');
      }`
);

admin = admin.replace(
`           let ops = 0;
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
          setRawDbData([...rawDbData]);`,
`           let ops = 0;
           const newData = rawDbData.map(row => ({...row, [colName]: ""}));
           for (const row of newData) {
              batch.update(doc(db, "pokemon_cards", row.raw_database_id), { [colName]: "" });
              ops++;
              if (ops >= BATCH_LIMIT) {
               await batch.commit();
               batch = writeBatch(db);
               ops = 0;
              }
           }
           if (ops > 0) await batch.commit();
          setRawDbData(newData);`
);

admin = admin.replace(
`           let ops = 0;
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
          setRawDbData([...rawDbData]);`,
`           let ops = 0;
           const newData = rawDbData.map(row => {
              const newRow = { ...row };
              delete newRow[colName];
              return newRow;
           });
           for (const row of rawDbData) {
              batch.update(doc(db, "pokemon_cards", row.raw_database_id), { [colName]: deleteField() });
              ops++;
              if (ops >= BATCH_LIMIT) {
               await batch.commit();
               batch = writeBatch(db);
               ops = 0;
              }
           }
           if (ops > 0) await batch.commit();
          setRawDbData(newData);`
);

fs.writeFileSync('src/components/AdminSettings.jsx', admin);


// CardList.jsx
let cardlist = fs.readFileSync('src/components/CardList.jsx', 'utf-8');

cardlist = cardlist.replace(
`  const handleDeleteSub = async (id) => {
    if(!window.confirm("정말로 이 카드를 창고에서 삭제할까요?")) return;
    try {
      await deleteDoc(doc(db, "pokemon_cards", id));
      setCards(prev => prev.filter(c => c.id !== id));
    } catch(err) {
      console.error(err);
      alert("삭제 실패");
    }
  };

`,
``
);

// We know exactly what handlePickerSearch looks like from read_file.
const searchRegex = /  const handlePickerSearch = async \(e\) => \{[\s\S]*?\}\n    \} finally \{\n      setPickerLoading\(false\);\n    \}\n  \};\n/;
const match = cardlist.match(searchRegex);

if (match) {
    cardlist = cardlist.replace(match[0], '');
    
    cardlist = cardlist.replace(
`  // 탭이 바뀔때 바로바로 검색 재가동
  useEffect(() => {
    if (isPickerOpen && pickerQuery.trim()) {
       handlePickerSearch();
    }
  }, [pickerTab]);`,
match[0] + '\n' +
`  // 탭이 바뀔때 바로바로 검색 재가동
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isPickerOpen && pickerQuery.trim()) {
       handlePickerSearch();
    }
  }, [pickerTab]);`
    );
}

fs.writeFileSync('src/components/CardList.jsx', cardlist);
console.log('Fix3 applied');
