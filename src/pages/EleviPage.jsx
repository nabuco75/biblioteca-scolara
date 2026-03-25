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

// Strip Romanian diacritics so the default jsPDF font can render them
const safe = (str = '') =>
  str
    .replace(/[ăâ]/gi, m => /[A-Z]/.test(m) ? 'A' : 'a')
    .replace(/î/gi,   m => /[A-Z]/.test(m) ? 'I' : 'i')
    .replace(/[șş]/gi, m => /[A-Z]/.test(m) ? 'S' : 's')
    .replace(/[țţ]/gi, m => /[A-Z]/.test(m) ? 'T' : 't');

/* ─── Component ─── */
export default function EleviPage() {
  const [elevi,      setElevi]     = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [showForm,   setShowForm]  = useState(false);
  const [search,     setSearch]    = useState('');
  const [importing,  setImporting] = useState(false);
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
    await deleteDoc(doc(db, 'elevi', id));
    loadElevi();
  };

  /* ─── Excel import ─── */
  const importExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const hdrs = rows[0].map(h => String(h).toLowerCase().trim());
      const idx = (kw, fallback) => {
        const i = hdrs.findIndex(h => h.includes(kw));
        return i >= 0 ? i : fallback;
      };
      const numeI    = idx('num', 0);
      const prenumeI = idx('pren', 1);
      const clasaI   = idx('clas', 2);
      const anI      = idx('an',   3);

      const batch = rows.slice(1)
        .filter(r => r[numeI])
        .map(r =>
          addDoc(collection(db, 'elevi'), {
            nume:     String(r[numeI]    ?? '').trim(),
            prenume:  String(r[prenumeI] ?? '').trim(),
            clasa:    String(r[clasaI]   ?? '').trim(),
            anScolar: String(r[anI]      ?? '2024-2025').trim(),
            dataAdaugare: Timestamp.now(),
          })
        );
      await Promise.all(batch);
      await loadElevi();
      alert(`${batch.length} elevi importati cu succes!`);
    } catch (e) { alert('Eroare import: ' + e.message); }
    setImporting(false);
    e.target.value = '';
  };

  /* ─── PDF fisa de imprumut ─── */
  const generatePDF = async (elev) => {
    try {
      const snap = await getDocs(
        query(collection(db, 'imprumuturi'), where('elevId', '==', elev.id))
      );
      const loans = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const da = a.dataImprumut?.toDate?.() ?? new Date(a.dataImprumut);
          const db_ = b.dataImprumut?.toDate?.() ?? new Date(b.dataImprumut);
          return da - db_;
        });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      /* Header band */
      pdf.setFillColor(26, 86, 219);
      pdf.rect(0, 0, 210, 38, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.text('SCOALA NR. 5 STEFAN CEL MARE VASLUI', 105, 11, { align: 'center' });
      pdf.setFontSize(10);
      pdf.text('BIBLIOTECA SCOLARA', 105, 18, { align: 'center' });
      pdf.setFontSize(17);
      pdf.text('FISA DE IMPRUMUT', 105, 31, { align: 'center' });

      /* Student box */
      pdf.setTextColor(0);
      pdf.setFillColor(235, 245, 255);
      pdf.rect(14, 43, 182, 32, 'F');
      pdf.setDrawColor(26, 86, 219);
      pdf.setLineWidth(0.4);
      pdf.rect(14, 43, 182, 32, 'S');

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text('DATE ELEV:', 18, 51);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Nume si Prenume: ${safe(elev.nume)} ${safe(elev.prenume)}`, 18, 58);
      pdf.text(`Clasa: ${safe(elev.clasa)}`, 18, 65);
      pdf.text(`An Scolar: ${safe(elev.anScolar || '2024-2025')}`, 100, 65);

      /* Loans table */
      autoTable(pdf, {
        startY: 82,
        head: [['Nr.', 'Titlu carte', 'Autor', 'Data imprumut', 'Termen retur', 'Returnat', 'Semnatura']],
        body: loans.map((l, i) => [
          i + 1,
          safe(l.carteTitlu),
          safe(l.carteAutor),
          fmtDate(l.dataImprumut),
          fmtDate(l.dataReturnare),
          l.stare === 'returnat' ? fmtDate(l.dataReturnareEfectiva) : 'Nu',
          '',
        ]),
        styles:      { fontSize: 8, cellPadding: 2 },
        headStyles:  { fillColor: [26, 86, 219], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 10 }, 1: { cellWidth: 46 }, 2: { cellWidth: 36 },
          3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 5: { cellWidth: 18 }, 6: { cellWidth: 25 },
        },
      });

      const finalY = (pdf.lastAutoTable?.finalY ?? 200) + 18;
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Bibliotecar,', 30, finalY);
      pdf.text('Data: _______________', 130, finalY);
      pdf.line(14, finalY + 14, 76, finalY + 14);
      pdf.setFontSize(8);
      pdf.text('(semnatura si stampila)', 28, finalY + 18);

      pdf.setFontSize(7);
      pdf.setTextColor(150);
      pdf.text(`Generat: ${new Date().toLocaleDateString('ro-RO')}`, 14, 288);

      pdf.save(`Fisa_${elev.nume}_${elev.prenume}_${elev.clasa}.pdf`);
    } catch (e) { alert('Eroare PDF: ' + e.message); }
  };

  const filtered = elevi.filter(e =>
    `${e.nume} ${e.prenume} ${e.clasa}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>Evidenta Elevilor</h2>
        <div className="page-actions">
          <button className="btn btn-secondary" disabled={importing}
            onClick={() => fileRef.current.click()}>
            {importing ? 'Se importa...' : '&#128229; Import Excel'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            style={{ display: 'none' }} onChange={importExcel} />
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Adauga Elev
          </button>
        </div>
      </div>

      <div className="alert alert-info">
        &#128203; Template Excel: coloane <strong>Nume, Prenume, Clasa, An Scolar</strong>
      </div>

      <div className="search-bar">
        <input className="search-input" placeholder="Cauta dupa nume, prenume sau clasa..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{filtered.length} elevi</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Nume</th><th>Prenume</th>
                <th>Clasa</th><th>An Scolar</th><th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan="6" className="empty-row">Niciun elev gasit</td></tr>
                : filtered.map((elev, i) => (
                  <tr key={elev.id}>
                    <td>{i + 1}</td>
                    <td><strong>{elev.nume}</strong></td>
                    <td>{elev.prenume}</td>
                    <td><span className="badge badge-blue">{elev.clasa}</span></td>
                    <td>{elev.anScolar}</td>
                    <td style={{ display: 'flex', gap: '.3rem' }}>
                      <button className="btn-icon" title="Genereaza PDF fisa"
                        onClick={() => generatePDF(elev)}>&#128196;</button>
                      <button className="btn-icon" title="Sterge"
                        onClick={() => deleteElev(elev.id)}>&#128465;</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>Adauga Elev Nou</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&#10005;</button>
            </div>
            <form className="form" onSubmit={addElev}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nume *</label>
                  <input required placeholder="Popescu"
                    value={form.nume} onChange={e => setForm({ ...form, nume: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Prenume *</label>
                  <input required placeholder="Ion"
                    value={form.prenume} onChange={e => setForm({ ...form, prenume: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Clasa *</label>
                  <input required placeholder="5A"
                    value={form.clasa} onChange={e => setForm({ ...form, clasa: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>An Scolar</label>
                  <input placeholder="2024-2025"
                    value={form.anScolar} onChange={e => setForm({ ...form, anScolar: e.target.value })} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                  Anuleaza
                </button>
                <button type="submit" className="btn btn-primary">Salveaza</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
