const fs = require('fs');

// 1. firebase.js
let fb = fs.readFileSync('src/firebase.js', 'utf-8');
fb = fb.replace('import { getStorage } from "firebase/storage";', 'import { getStorage } from "firebase/storage";\nimport { getFunctions } from "firebase/functions";');
fb = fb.replace('export const storage = getStorage(app);', 'export const storage = getStorage(app);\nexport const functions = getFunctions(app);');
fs.writeFileSync('src/firebase.js', fb);

// 2. AdminSettings.jsx
let admin = fs.readFileSync('src/components/AdminSettings.jsx', 'utf-8');
admin = admin.replace('import { doc, updateDoc, collection, getDocs, deleteDoc, deleteField, writeBatch } from \'firebase/firestore\';', 'import { doc, updateDoc, collection, getDocs, deleteDoc, deleteField, writeBatch, addDoc } from \'firebase/firestore\';');

// extract sanitize functions
admin = admin.replace(
`   const hiddenSystemFields = ['raw_database_id', 'imageUrl', 'displayOrder', 'createdAt', 'islegacy', 'isLegacy'];
   const sanitizeDisplayFields = (fields = []) => {
      const cleaned = fields.filter((field) => field?.id && !hiddenSystemFields.includes(field.id));
      return cleaned.map((field, index) => ({ ...field, order: index + 1 }));
   };
   const sanitizeConfig = (baseConfig) => ({
      ...baseConfig,
      displayFields: sanitizeDisplayFields(baseConfig?.displayFields || [])
   });`,
''
);

admin = admin.replace(
`export default function AdminSettings({ appConfig, setAppConfig }) {`,
`const hiddenSystemFields = ['raw_database_id', 'imageUrl', 'displayOrder', 'createdAt', 'islegacy', 'isLegacy'];
const sanitizeDisplayFields = (fields = []) => {
   const cleaned = fields.filter((field) => field?.id && !hiddenSystemFields.includes(field.id));
   return cleaned.map((field, index) => ({ ...field, order: index + 1 }));
};
const sanitizeConfig = (baseConfig) => ({
   ...baseConfig,
   displayFields: sanitizeDisplayFields(baseConfig?.displayFields || [])
});

export default function AdminSettings({ appConfig, setAppConfig }) {`
);

admin = admin.replace(
`   useEffect(() => {
      setConfig(sanitizeConfig(appConfig));
   }, [appConfig]);`,
`   useEffect(() => {
      // eslint-disable-next-line
      setConfig(sanitizeConfig(appConfig));
   }, [appConfig]);`
);

admin = admin.replace('// 1. GitHub   CSV ? ????      let csvRowIds = [];', '// 1. GitHub   CSV ? ????\n          let csvRowIds = [];');
admin = admin.replace('// 2. Firestore?  ?????       const snapshot = await getDocs(collection(db, "pokemon_cards"));', '// 2. Firestore?  ?????\n       const snapshot = await getDocs(collection(db, "pokemon_cards"));');
admin = admin.replace("// ? ? ?????GitHub Actions ?????      const { httpsCallable } = await import('firebase/functions');", "// ? ? ?????GitHub Actions ?????\n      const { httpsCallable } = await import('firebase/functions');");
admin = admin.replace('// ? ???              if (headers) await syncHeadersWithConfig(headers);', '// ? ???\n              if (headers) await syncHeadersWithConfig(headers);');

admin = admin.replace('  const rawSaveTimeoutRef = React.useRef({});\n  const [rawDbSaving, setRawDbSaving] = useState({});\n', '');
admin = admin.replace('      setRawDbSaving(prev => ({ ...prev, [id]: true }));\n      try {\n         const ref = doc(db, "pokemon_cards", id);', '      try {\n         const ref = doc(db, "pokemon_cards", id);');
admin = admin.replace('      } catch (err) {\n         console.error("DB ? ????:", err);\n      } finally {\n         setRawDbSaving(prev => ({ ...prev, [id]: false }));\n      }', '      } catch (err) {\n         console.error("DB ? ????:", err);\n      }');
admin = admin.replace('const { [key]: removed, ...rest } = nextDrafts[id];', 'const rest = { ...nextDrafts[id] };\n               delete rest[key];');
admin = admin.replace("      } catch(err) {\n          alert('?? ?');\n      }", "      } catch(err) {\n          console.error(err);\n          alert('?? ?');\n      }");
admin = admin.replace('for (const [index, row] of data.entries())', 'for (const row of data)');

admin = admin.replace(
`           for (const row of rawDbData) {
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
`           const newData = rawDbData.map(row => ({...row, [colName]: ""}));
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
`           for (const row of rawDbData) {
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
`           const newData = rawDbData.map(row => {
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

// 3. CardList.jsx
let cardlist = fs.readFileSync('src/components/CardList.jsx', 'utf-8');
cardlist = cardlist.replace(
`  useEffect(() => { setCurrentPage(1); }, [deferredSearchTerm, sortBy]);`,
`  // eslint-disable-next-line
  useEffect(() => { setCurrentPage(1); }, [deferredSearchTerm, sortBy]);`
);
cardlist = cardlist.replace('const { [field]: removed, ...rest } = nextDrafts[id];', 'const rest = { ...nextDrafts[id] };\n              delete rest[field];');

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
  };\n`,
''
);

const handlePickerSearchRegex = /const handlePickerSearch = async \(e\) => \{[\s\S]*?\}\n    \} catch \(err\) \{\n      console\.error\(err\);\n      alert\("검색 서버에 연결하는 데 실패했습니다\. 잠시 후 다시 시도해주세요\."\);\n    \} finally \{\n      setPickerLoading\(false\);\n    \}\n  \};\n/m;
const match = cardlist.match(handlePickerSearchRegex);
if (match) {
    cardlist = cardlist.replace(match[0], '');
    cardlist = cardlist.replace('const openPicker = () => {', match[0] + '\n  const openPicker = () => {');
}

cardlist = cardlist.replace(
`  useEffect(() => {
    if (isPickerOpen && pickerQuery.trim()) {
       handlePickerSearch();
    }
  }, [pickerTab]);`,
`  useEffect(() => {
    if (isPickerOpen && pickerQuery.trim()) {
       handlePickerSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerTab]);`
);

fs.writeFileSync('src/components/CardList.jsx', cardlist);

// 4. CardUpload.jsx
let cardupload = fs.readFileSync('src/components/CardUpload.jsx', 'utf-8');
cardupload = cardupload.replace('const [saving, setSaving] = useState(false);', 'const [saving] = useState(false);');
fs.writeFileSync('src/components/CardUpload.jsx', cardupload);

console.log('Fixes applied successfully!');
