import { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ─── helpers ─── */
const fmtDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ro-RO');
};

const safe = (str = '') =>
  str
    .replace(/[ăâ]/gi, m => /[A-Z]/.test(m) ? 'A' : 'a')
    .replace(/î/gi,   m => /[A-Z]/.test(m) ? 'I' : 'i')
    .replace(/[șş]/gi, m => /[A-Z]/.test(m) ? 'S' : 's')
    .replace(/[țţ]/gi, m => /[A-Z]/.test(m) ? 'T' : 't');

const CLASE = ['PREG. A', '1A', '2B', '3C', '4D'];
const clasaOrder = (c = '') => {
  const idx = CLASE.indexOf((c || '').toUpperCase().trim());
  return idx === -1 ? 999 : idx;
};

export default function EleviPage() {
  const [elevi, setElevi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ nume: '', prenume: '', clasa: '', anScolar: '2024-2025' });
  const fileRef = useRef();

  useEffect(() => { loadElevi(); }, []);

  const loadElevi = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'elevi'), orderBy('nume')));
      setElevi(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const addElev = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'elevi'), { ...form, dataAdaugare: Timestamp.now() });
      setForm({ nume: '', prenume: '', clasa: '', anScolar: '2024-2025' });
      setShowForm(false);
      loadElevi();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  const deleteElev = async (id) => {
    if (!confirm('Stergi acest elev?')) return;
    try {
      await deleteDoc(doc(db, 'elevi', id));
      loadElevi();
    } catch (e) { alert(e.message); }
  };

  /* ─── MODIFICARE NOUĂ: ȘTERGE TOT ─── */
  const deleteAllElevi = async () => {
    const confirmare = window.confirm(
      `⚠️ ATENȚIE: Ești pe cale să ștergi TOȚI cei ${elevi.length} elevi din bază.\n\n` +
      `Această acțiune este IREVERSIBILĂ. Sigur vrei să continui?`
    );
    if (!confirmare) return;

    setLoading(true);
    try {
      const promises = elevi.map(elev => deleteDoc(doc(db, 'elevi', elev.id)));
      await Promise.all(promises);
      alert('Baza de date a fost curățată cu succes!');
      loadElevi();
    } catch (e) { alert('Eroare la ștergere: ' + e.message); }
    setLoading(false);
  };

  /* ─── Import Excel ─── */
  const importExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const normalize = (str) =>
        String(str || "").toLowerCase().replace(/\s+/g, '')
          .replace(/[ăâ]/g, 'a').replace(/î/g, 'i')
          .replace(/[șş]/g, 's').replace(/[țţ]/g, 't').trim();

      const clean = (v) => String(v || '').trim();

      const headerRowIndex = rows.findIndex(r => {
        const norm = r.map(cell => normalize(cell));
        return norm.includes('nume') && 
               (norm.includes('prenume1') || norm.includes('prenume')) &&
               (norm.includes('numeclasa') || norm.includes('formatiune') || norm.includes('clasa'));
      });

      if (headerRowIndex === -1) throw new Error("Nu am găsit tabelul!");

      const detectedHeaders = rows[headerRowIndex].map(h => normalize(h));
      const col = {};
      detectedHeaders.forEach((h, i) => {
        if (h === 'cnp') col.cnp = i;
        if (h === 'nume') col.nume = i;
        if (h === 'prenume1' || h === 'prenume') col.prenume1 = i;
        if (h === 'prenume2') col.prenume2 = i;
        if (h === 'prenume3') col.prenume3 = i;
        if (h === 'numeclasa') col.clasa = i;
        if (h === 'tipformatiune') col.tipFormatiune = i;
        else if ((h === 'clasa' || (h.endsWith('formatiune') && h !== 'tipformatiune')) && col.clasa === undefined) col.clasa = i;
      });

      const eleviCurati = rows.slice(headerRowIndex + 1).map(row => {
        const p1 = row[col.prenume1];
        const p2 = col.prenume2 !== undefined ? row[col.prenume2] : '';
        const p3 = col.prenume3 !== undefined ? row[col.prenume3] : '';
        const prenumeComplet = [p1, p2, p3].map(v => clean(v)).filter(Boolean).join(' ');

        return {
          cnp: col.cnp !== undefined ? clean(row[col.cnp]) : '',
          nume: clean(row[col.nume]),
          prenume: prenumeComplet,
          clasa: (() => {
            const numeClasa = clean(row[col.clasa] || '');
            if (col.tipFormatiune !== undefined) {
              const romanToNumber = (r) => {
                const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
                return map[r] || r;
              };
              const tipRaw = clean(row[col.tipFormatiune] || '');
              const roman = tipRaw.toUpperCase().replace(/CLASA|A|\-/g, '').trim();
              const nivel = romanToNumber(roman);
              return `${nivel}${numeClasa}`.toUpperCase();
            }
            return numeClasa.toUpperCase();
          })(),
          anScolar: '2024-2025',
          dataAdaugare: Timestamp.now()
        };
      }).filter(el => el.nume.length > 1 && el.prenume.length > 1);

      await Promise.all(eleviCurati.map(el => addDoc(collection(db, 'elevi'), el)));
      await loadElevi();
      alert(`Importat ${eleviCurati.length} elevi.`);
    } catch (err) { alert('Eroare: ' + err.message); }
    setImporting(false);
    e.target.value = '';
  };

  /* ─── Generare PDF ─── */
  const generatePDF = async (elev) => {
    try {
      const snap = await getDocs(query(collection(db, 'imprumuturi'), where('elevId', '==', elev.id)));
      const loans = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const da = a.dataImprumut?.toDate ? a.dataImprumut.toDate() : new Date(a.dataImprumut);
          const db_ = b.dataImprumut?.toDate ? b.dataImprumut.toDate() : new Date(b.dataImprumut);
          return da - db_;
        });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      pdf.setFillColor(26, 86, 219);
      pdf.rect(0, 0, 210, 38, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.text('SCOALA NR. 5 STEFAN CEL MARE VASLUI', 105, 11, { align: 'center' });
      pdf.text('FISA DE IMPRUMUT', 105, 31, { align: 'center' });

      pdf.setTextColor(0);
      pdf.rect(14, 43, 182, 32);
      pdf.text(`Nume si Prenume: ${safe(elev.nume)} ${safe(elev.prenume)}`, 18, 58);
      pdf.text(`Clasa: ${safe(elev.clasa)}`, 18, 65);

      autoTable(pdf, {
        startY: 82,
        head: [['Nr.', 'Titlu carte', 'Autor', 'Data imprumut', 'Returnat']],
        body: loans.map((l, i) => [
          i + 1, safe(l.carteTitlu), safe(l.carteAutor), fmtDate(l.dataImprumut),
          l.stare === 'returnat' ? 'Da' : 'Nu'
        ]),
        headStyles: { fillColor: [26, 86, 219] }
      });
      pdf.save(`Fisa_${elev.nume}_${elev.clasa}.pdf`);
    } catch (e) { alert('Eroare PDF: ' + e.message); }
  };

  const filtered = elevi
    .filter(e => `${e.cnp || ''} ${e.nume} ${e.prenume} ${e.clasa}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const diff = clasaOrder(a.clasa) - clasaOrder(b.clasa);
      if (diff !== 0) return diff;
      return (a.nume || '').localeCompare(b.nume || '', 'ro');
    });

  return (
    <div className="page">
      <div className="page-header">
        <h2>Evidenta Elevilor</h2>
        <div className="page-actions">
          {/* BUTONUL NOU DE ȘTERGERE TOT */}
          {elevi.length > 0 && (
            <button className="btn" onClick={deleteAllElevi} style={{ backgroundColor: '#e11d48', color: 'white', marginRight: '10px' }}>
              🗑️ Golire Listă ({elevi.length})
            </button>
          )}

          <button className="btn btn-secondary" disabled={importing} onClick={() => fileRef.current.click()}>
            {importing ? 'Se importa...' : '📥 Import Excel'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importExcel} />
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Adauga Elev</button>
        </div>
      </div>

      <div className="search-bar">
        <input className="search-input" placeholder="Cauta nume sau clasa..." value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{filtered.length} elevi</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>CNP</th><th>Nume</th><th>Prenume</th><th>Clasa</th><th>Actiuni</th></tr>
            </thead>
            <tbody>
              {filtered.map((elev, i) => (
                <tr key={elev.id}>
                  <td>{i + 1}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{elev.cnp || '-'}</td>
                  <td><strong>{elev.nume}</strong></td>
                  <td>{elev.prenume}</td>
                  <td><span className="badge badge-blue">{elev.clasa}</span></td>
                  <td>
                    <button className="btn-icon" onClick={() => generatePDF(elev)}>📄</button>
                    <button className="btn-icon" onClick={() => deleteElev(elev.id)}>🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header"><h3>Adauga Elev</h3><button onClick={() => setShowForm(false)}>✕</button></div>
            <form className="form" onSubmit={addElev}>
              <div className="form-row">
                <input required placeholder="Nume" value={form.nume} onChange={e => setForm({ ...form, nume: e.target.value })} />
                <input required placeholder="Prenume" value={form.prenume} onChange={e => setForm({ ...form, prenume: e.target.value })} />
              </div>
              <div className="form-row">
                <select required value={form.clasa} onChange={e => setForm({ ...form, clasa: e.target.value })}>
                  <option value="">-- Alege clasa --</option>
                  {CLASE.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Anuleaza</button>
                <button type="submit" className="btn btn-primary">Salveaza</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}