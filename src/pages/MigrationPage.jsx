import { useState } from 'react';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, where, Timestamp, deleteField,
} from 'firebase/firestore';
import { db } from '../firebase/config';

/* ─── Descarcă un obiect JS ca fișier JSON ─── */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Serializează Timestamp Firestore → string ISO ─── */
function serializeDoc(data) {
  if (!data || typeof data !== 'object') return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (v?.toDate) out[k] = v.toDate().toISOString();
    else           out[k] = v;
  }
  return out;
}

/* ─── helpers ─── */
const normalizeKey = (c) =>
  `${(c.titlu || '').trim().toLowerCase()}|||${(c.autor || '').trim().toLowerCase()}|||${(c.isbn || '').replace(/[-\s]/g, '').toLowerCase()}`;

export default function MigrationPage() {
  const [step,          setStep]          = useState('idle');
  const [preview,       setPreview]       = useState(null);
  const [log,           setLog]           = useState([]);
  const [progress,      setProgress]      = useState({ done: 0, total: 0 });
  const [backupLoading, setBackupLoading] = useState(false);

  /* ══════════════════════════════════
     BACKUP — descarcă JSON local
  ══════════════════════════════════ */
  const downloadBackup = async () => {
    setBackupLoading(true);
    try {
      const [cartiSnap, impSnap, copiesSnap] = await Promise.all([
        getDocs(collection(db, 'carti')),
        getDocs(collection(db, 'imprumuturi')),
        getDocs(collection(db, 'copies')),
      ]);

      const backup = {
        exportedAt: new Date().toISOString(),
        carti:       cartiSnap.docs.map(d  => ({ id: d.id,  ...serializeDoc(d.data()) })),
        imprumuturi: impSnap.docs.map(d    => ({ id: d.id,  ...serializeDoc(d.data()) })),
        copies:      copiesSnap.docs.map(d => ({ id: d.id,  ...serializeDoc(d.data()) })),
      };

      const date = new Date().toISOString().slice(0, 10);
      downloadJSON(backup, `backup-biblioteca-${date}.json`);
    } catch (e) {
      alert('Eroare la backup: ' + e.message);
    }
    setBackupLoading(false);
  };

  const addLog = (msg, type = 'info') =>
    setLog(prev => [...prev, { msg, type, t: new Date().toLocaleTimeString('ro-RO') }]);

  /* ══════════════════════════════════
     PASUL 1 – Analizează & preview
  ══════════════════════════════════ */
  const analyzeData = async () => {
    setStep('checking');
    setLog([]);
    try {
      // Verifică dacă colecția copies există deja
      const copiesSnap = await getDocs(collection(db, 'copies'));
      if (!copiesSnap.empty) {
        addLog(`⚠️ Colecția 'copies' conține deja ${copiesSnap.docs.length} documente. Migrarea pare deja efectuată.`, 'warning');
        addLog('Dacă dorești să reiei migrarea, șterge manual colecția "copies" din Firebase Console.', 'warning');
        setStep('idle');
        return;
      }

      // Încarcă toate cărțile
      const cartiSnap = await getDocs(collection(db, 'carti'));
      const allCarti = cartiSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      addLog(`📚 Găsite ${allCarti.length} documente în colecția 'carti'.`);

      // Grupează după cheie (titlu + autor + isbn)
      const groupMap = new Map();
      allCarti.forEach(c => {
        const key = normalizeKey(c);
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(c);
      });

      const groups = [];
      let totalCopiesWillCreate = 0;
      let duplicatesWillDelete = 0;

      for (const [, group] of groupMap) {
        // Sortează: cel mai vechi devine canonical
        group.sort((a, b) => {
          const ta = a.dataAdaugare?.toDate?.()?.getTime() || 0;
          const tb = b.dataAdaugare?.toDate?.()?.getTime() || 0;
          return ta - tb;
        });
        const canonical = group[0];
        let copiesCount = 0;

        for (const carte of group) {
          const n = Math.max(1, parseInt(carte.numarExemplare) || 1);
          copiesCount += n;
          if (carte.id !== canonical.id) duplicatesWillDelete++;
        }
        totalCopiesWillCreate += copiesCount;
        groups.push({ canonical, docs: group, copiesCount });
      }

      // Număr împrumuturi active
      const impSnap = await getDocs(query(collection(db, 'imprumuturi'), where('stare', '==', 'activ')));
      addLog(`📖 Găsite ${impSnap.docs.length} împrumuturi active care vor fi actualizate.`);

      setPreview({
        totalDocs: allCarti.length,
        uniqueTitles: groups.length,
        duplicatesToDelete: duplicatesWillDelete,
        totalCopiesWillCreate,
        activeLoanCount: impSnap.docs.length,
        groups,
      });
      setStep('previewing');
    } catch (e) {
      addLog(`❌ Eroare la analiză: ${e.message}`, 'error');
      setStep('error');
    }
  };

  /* ══════════════════════════════════
     PASUL 2 – Execută migrarea
  ══════════════════════════════════ */
  const runMigration = async () => {
    setStep('running');
    setLog([]);
    const { groups } = preview;

    try {
      // ── Calculăm totalul operațiunilor ──
      let totalOps = 0;
      groups.forEach(({ docs }) => {
        docs.forEach(c => totalOps += Math.max(1, parseInt(c.numarExemplare) || 1));
        totalOps += docs.length - 1; // stergeri duplicate
      });
      setProgress({ done: 0, total: totalOps });
      let done = 0;

      addLog('▶ Începe crearea colecției copies...');

      // ── Mapă: originalCarteId → [copyDocIds create] ──
      const carteIdToCopyIds = {}; // originalCarteId → string[]

      for (const { canonical, docs } of groups) {
        for (const carte of docs) {
          const n = Math.max(1, parseInt(carte.numarExemplare) || 1);
          carteIdToCopyIds[carte.id] = [];

          for (let i = 0; i < n; i++) {
            const nr = i === 0 ? (carte.nrInregistrare || '') : '';
            const copyRef = await addDoc(collection(db, 'copies'), {
              bookId: canonical.id,
              nrInregistrare: nr,
              status: 'disponibil',
              dataAdaugare: carte.dataAdaugare || Timestamp.now(),
              _migratedFromCarteId: carte.id,
            });
            carteIdToCopyIds[carte.id].push(copyRef.id);
            done++;
            setProgress({ done, total: totalOps });
          }
        }

        // Șterge documentele duplicate (non-canonical)
        for (const carte of docs) {
          if (carte.id !== canonical.id) {
            await deleteDoc(doc(db, 'carti', carte.id));
            done++;
            setProgress({ done, total: totalOps });
          }
        }

        // Curăță câmpurile copy-specific de pe doc-ul canonical
        await updateDoc(doc(db, 'carti', canonical.id), {
          nrInregistrare: deleteField(),
          numarExemplare: deleteField(),
        });
      }

      addLog(`✅ Copii create: ${Object.values(carteIdToCopyIds).flat().length}`);
      addLog(`🗑 Duplicate șterse: ${preview.duplicatesToDelete}`);

      // ── Actualizează împrumuturile active ──
      addLog('▶ Actualizează împrumuturi active cu copyId...');
      const impSnap = await getDocs(query(collection(db, 'imprumuturi'), where('stare', '==', 'activ')));

      // Pentru fiecare carteId: ținem un index ca să distribuim copiile între multipli împrumuturi
      const assignmentIndex = {}; // carteId → nextIndex

      for (const impDoc of impSnap.docs) {
        const imp = { id: impDoc.id, ...impDoc.data() };
        const originalCarteId = imp.carteId;
        const copyIds = carteIdToCopyIds[originalCarteId];

        if (!copyIds || copyIds.length === 0) {
          addLog(`⚠️ Împrumut ${imp.id}: carteId '${originalCarteId}' nu a fost găsit în migrare.`, 'warning');
          continue;
        }

        const idx = assignmentIndex[originalCarteId] || 0;
        const copyId = copyIds[idx % copyIds.length];
        assignmentIndex[originalCarteId] = idx + 1;

        // Găsim bookId-ul canonical pentru acest carteId
        const { canonical } = groups.find(g => g.docs.some(d => d.id === originalCarteId)) || {};
        const bookId = canonical?.id || originalCarteId;

        // Actualizează copia: status → 'imprumutat'
        await updateDoc(doc(db, 'copies', copyId), { status: 'imprumutat' });

        // Actualizează împrumutul: adaugă copyId și bookId (dacă diferă)
        await updateDoc(doc(db, 'imprumuturi', imp.id), {
          copyId,
          bookId,
        });
      }

      addLog(`✅ ${impSnap.docs.size || impSnap.docs.length} împrumuturi actualizate.`);
      addLog('🎉 Migrare completă cu succes!', 'success');
      setStep('done');
    } catch (e) {
      addLog(`❌ Eroare la migrare: ${e.message}`, 'error');
      setStep('error');
    }
  };

  /* ─── UI ─── */
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>🔄 Migrare Bază de Date</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--n500)', marginTop: '0.2rem' }}>
            Restructurează colecția <code>carti</code> (un doc per titlu) + creează colecția <code>copies</code> (un doc per exemplar fizic)
          </p>
        </div>
      </div>

      {/* ── Backup ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap',
        background: 'var(--g50, #f9fafb)', border: '2px solid var(--g200, #e5e7eb)',
        borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem',
      }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>📥 Pasul 1 — Fă backup</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--g600)' }}>
            Descarcă toate datele ca fișier JSON pe calculator înainte de a migra.
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={downloadBackup}
          disabled={backupLoading}
          style={{ flexShrink: 0 }}
        >
          {backupLoading ? '⏳ Se descarcă...' : '📥 Descarcă Backup JSON'}
        </button>
      </div>

      {/* ── Avertisment ── */}
      <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
        <strong>⚠️ Fă backup mai întâi!</strong> Migrarea modifică ireversibil structura datelor.
        Folosește butonul de mai sus pentru a salva o copie locală.
      </div>

      {/* ── Status cards ── */}
      {preview && (
        <div className="cards-grid" style={{ marginBottom: '1.5rem' }}>
          <div className="stat-card blue">
            <div className="stat-value">{preview.totalDocs}</div>
            <div className="stat-label">Documente existente</div>
          </div>
          <div className="stat-card green">
            <div className="stat-value">{preview.uniqueTitles}</div>
            <div className="stat-label">Titluri unice</div>
          </div>
          <div className="stat-card red">
            <div className="stat-value">{preview.duplicatesToDelete}</div>
            <div className="stat-label">Duplicate de șters</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-value">{preview.totalCopiesWillCreate}</div>
            <div className="stat-label">Exemplare de creat</div>
          </div>
        </div>
      )}

      {/* ── Progress bar ── */}
      {step === 'running' && progress.total > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.85rem', color: 'var(--g600)' }}>
            <span>Progres migrare</span>
            <span>{progress.done} / {progress.total}</span>
          </div>
          <div style={{ height: 10, background: 'var(--g100, #f3f4f6)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: 'var(--primary, #2563eb)',
              borderRadius: 6,
              width: `${Math.round((progress.done / progress.total) * 100)}%`,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>
      )}

      {/* ── Butoane ── */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {step === 'idle' && (
          <button className="btn btn-primary" onClick={analyzeData}>
            🔍 Analizează date (fără modificări)
          </button>
        )}
        {step === 'previewing' && (
          <>
            <button className="btn btn-secondary" onClick={() => { setStep('idle'); setPreview(null); setLog([]); }}>
              ↩ Înapoi
            </button>
            <button className="btn btn-primary" onClick={runMigration}
              style={{ background: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>
              ⚡ Execută Migrarea (ireversibil!)
            </button>
          </>
        )}
        {step === 'done' && (
          <div className="alert alert-info" style={{ width: '100%' }}>
            ✅ Migrarea s-a finalizat cu succes. Poți naviga la <strong>Catalog Cărți</strong> și <strong>Registru Inventar</strong> pentru a verifica rezultatele.
          </div>
        )}
        {step === 'error' && (
          <button className="btn btn-secondary" onClick={() => { setStep('idle'); setPreview(null); setLog([]); }}>
            ↩ Înapoi
          </button>
        )}
      </div>

      {/* ── Preview grupuri ── */}
      {step === 'previewing' && preview && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Previzualizare grupuri de titluri</h3>
          <div className="table-container" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data-table" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Titlu canonical</th>
                  <th>Autor</th>
                  <th>Doc-uri grupate</th>
                  <th>Exemplare de creat</th>
                </tr>
              </thead>
              <tbody>
                {preview.groups.map((g, i) => (
                  <tr key={g.canonical.id}>
                    <td>{i + 1}</td>
                    <td><strong>{g.canonical.titlu}</strong></td>
                    <td>{g.canonical.autor}</td>
                    <td>
                      {g.docs.length > 1
                        ? <span className="badge badge-yellow">{g.docs.length} docs → 1 titlu</span>
                        : <span className="badge badge-green">1 doc</span>}
                    </td>
                    <td><span className="badge badge-blue">{g.copiesCount}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Log ── */}
      {log.length > 0 && (
        <div style={{
          background: '#0f172a', color: '#e2e8f0',
          borderRadius: 10, padding: '1rem 1.25rem',
          fontFamily: 'monospace', fontSize: '0.82rem',
          maxHeight: 300, overflowY: 'auto',
          lineHeight: 1.7,
        }}>
          {log.map((entry, i) => (
            <div key={i} style={{
              color: entry.type === 'error' ? '#fca5a5'
                : entry.type === 'success' ? '#86efac'
                : entry.type === 'warning' ? '#fde68a'
                : '#e2e8f0',
            }}>
              <span style={{ opacity: 0.45, marginRight: '0.5rem' }}>{entry.t}</span>
              {entry.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
