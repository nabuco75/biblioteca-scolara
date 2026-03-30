import { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ─── HELPERS ─── */
// normalizează textul: elimină diacriticele și transformă în litere mici
const norm = s => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// curăță textul pentru PDF (jspdf helvetica nu suportă diacriticele românești nativ fără fonturi externe)
const safe = (str = '') =>
  String(str || '')
    .replace(/[ĂÂ]/g, 'A').replace(/[ăâ]/g, 'a')
    .replace(/Î/g, 'I').replace(/î/g, 'i')
    .replace(/[ȘŞ]/g, 'S').replace(/[șş]/g, 's')
    .replace(/[ȚŢ]/g, 'T').replace(/[țţ]/g, 't');

const fmtDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ro-RO');
};

const CLASE = ['Pregătitoare A', 'Pregătitoare B', '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B', '6A', '6B', '7A', '7B', '8A', '8B'];

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
    if (!confirm('Ștergi acest elev?')) return;
    try {
      await deleteDoc(doc(db, 'elevi', id));
      loadElevi();
    } catch (e) { alert(e.message); }
  };

  const deleteAllElevi = async () => {
    if (!confirm('⚠️ ATENȚIE: Ștergi TOȚI elevii din bază? Acțiunea este ireversibilă!')) return;
    setLoading(true);
    try {
      const promises = elevi.map(e => deleteDoc(doc(db, 'elevi', e.id)));
      await Promise.all(promises);
      loadElevi();
      alert('Baza de date a fost curățată.');
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  /* ─── IMPORT EXCEL ─── */
  const importExcel = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const clean = v => String(v || '').trim();

      // Presupunem header pe primul rând: Nume, Prenume, Clasa
      const eleviCurati = rows.slice(1).map(r => {
        let clasaRaw = clean(r[2]);
        let clasa = clasaRaw.replace(/CLASA/i, '').replace(/\s+/g, '').toUpperCase();

        if (/PREG/i.test(clasaRaw)) {
          const litera = clasaRaw.match(/[A-Z]$/i)?.[0] || '';
          clasa = `Pregătitoare ${litera.toUpperCase()}`;
        }

        return {
          nume: clean(r[0]),
          prenume: clean(r[1]),
          clasa: clasa || 'NESPECIFICAT',
          anScolar: '2024-2025',
          dataAdaugare: Timestamp.now()
        };
      }).filter(el => el.nume && el.prenume);

      await Promise.all(eleviCurati.map(el => addDoc(collection(db, 'elevi'), el)));
      loadElevi();
      alert(`Importați cu succes ${eleviCurati.length} elevi.`);
    } catch (err) { alert('Eroare la import: ' + err.message); }

    setImporting(false);
    e.target.value = '';
  };

  /* ─── PDF FRUMOS ─── */
  const generatePDF = async (elev) => {
    try {
      const snap = await getDocs(query(collection(db, 'imprumuturi'), where('elevId', '==', elev.id)));
      const loans = snap.docs.map(d => d.data());

      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const W = 210;

      // ── Banner superior ──────────────────────────────────────────
      pdf.setFillColor(26, 54, 93);          // albastru navy
      pdf.rect(0, 0, W, 38, 'F');

      pdf.setFillColor(41, 128, 185);        // bandă accent
      pdf.rect(0, 32, W, 6, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.text('FISA ELEVULUI', W / 2, 14, { align: 'center' });

      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Scoala Nr. 5 Stefan cel Mare Vaslui  |  Biblioteca Scolara', W / 2, 22, { align: 'center' });
      pdf.text(`Generat: ${new Date().toLocaleDateString('ro-RO')}`, W / 2, 29, { align: 'center' });

      // ── Card date elev ───────────────────────────────────────────
      pdf.setFillColor(245, 249, 253);
      pdf.roundedRect(10, 44, W - 20, 34, 3, 3, 'F');
      pdf.setDrawColor(41, 128, 185);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(10, 44, W - 20, 34, 3, 3, 'S');

      // avatar cerc
      pdf.setFillColor(41, 128, 185);
      pdf.circle(26, 61, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      const initiale = `${safe(elev.nume).charAt(0)}${safe(elev.prenume).charAt(0)}`;
      pdf.text(initiale, 26, 64.5, { align: 'center' });

      // nume elev
      pdf.setTextColor(26, 54, 93);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(15);
      pdf.text(`${safe(elev.nume)} ${safe(elev.prenume)}`, 40, 57);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(80, 100, 120);
      pdf.text(`Clasa: ${safe(elev.clasa)}`, 40, 65);
      pdf.text(`An scolar: ${safe(elev.anScolar || '2024-2025')}`, 40, 72);

      // ── Carduri statistici ───────────────────────────────────────
      const total   = loans.length;
      const active  = loans.filter(l => l.stare !== 'returnat').length;
      const returned= loans.filter(l => l.stare === 'returnat').length;

      const stats = [
        { label: 'Total imprumuturi', val: String(total),    bg: [41, 128, 185],  fg: [255,255,255] },
        { label: 'Active',            val: String(active),   bg: [231, 76, 60],   fg: [255,255,255] },
        { label: 'Returnate',         val: String(returned), bg: [39, 174, 96],   fg: [255,255,255] },
      ];
      const cardW = 56, cardH = 22, cardY = 84, gap = 10, startX = 14;
      stats.forEach((s, idx) => {
        const x = startX + idx * (cardW + gap);
        pdf.setFillColor(...s.bg);
        pdf.roundedRect(x, cardY, cardW, cardH, 3, 3, 'F');
        pdf.setTextColor(...s.fg);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        pdf.text(s.val, x + cardW / 2, cardY + 12, { align: 'center' });
        pdf.setFontSize(7.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text(s.label.toUpperCase(), x + cardW / 2, cardY + 19, { align: 'center' });
      });

      // ── Titlu sectiune tabel ─────────────────────────────────────
      pdf.setTextColor(26, 54, 93);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text('ISTORICUL IMPRUMUTURILOR', 14, 118);
      pdf.setDrawColor(41, 128, 185);
      pdf.setLineWidth(0.8);
      pdf.line(14, 120, W - 14, 120);

      // ── Tabel principal ──────────────────────────────────────────
      autoTable(pdf, {
        startY: 124,
        margin: { left: 14, right: 14 },
        head: [['#', 'Titlu Carte', 'Autor', 'Data Imprumut', 'Data Returnare', 'Stare']],
        body: loans.length > 0
          ? loans.map((l, i) => [
              String(i + 1),
              safe(l.carteTitlu) || '-',
              safe(l.carteAutor) || '-',
              fmtDate(l.dataImprumut),
              fmtDate(l.dataReturnare),
              l.stare === 'returnat' ? 'Returnat' : 'Activ',
            ])
          : [['', 'Nu exista imprumuturi inregistrate', '', '', '', '']],
        styles: {
          font: 'helvetica',
          fontSize: 9,
          cellPadding: 3,
          lineColor: [220, 230, 240],
          lineWidth: 0.3,
        },
        headStyles: {
          fillColor: [26, 54, 93],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        alternateRowStyles: { fillColor: [245, 249, 253] },
        columnStyles: {
          0: { cellWidth: 8,  halign: 'center' },
          4: { cellWidth: 26, halign: 'center' },
          5: { cellWidth: 20, halign: 'center' },
        },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 5) {
            const v = data.cell.raw;
            if (v === 'Activ')     { data.cell.styles.textColor = [231, 76, 60];  data.cell.styles.fontStyle = 'bold'; }
            if (v === 'Returnat')  { data.cell.styles.textColor = [39, 174, 96];  data.cell.styles.fontStyle = 'bold'; }
          }
        },
      });

      // ── Footer ────────────────────────────────────────────────────
      const pageH = pdf.internal.pageSize.getHeight();
      pdf.setFillColor(26, 54, 93);
      pdf.rect(0, pageH - 12, W, 12, 'F');
      pdf.setTextColor(200, 215, 230);
      pdf.setFontSize(7.5);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Scoala Nr. 5 Stefan cel Mare Vaslui — Biblioteca Scolara Digitala', W / 2, pageH - 4.5, { align: 'center' });

      pdf.save(`Fisa_${safe(elev.nume)}_${safe(elev.prenume)}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Eroare la generarea PDF-ului.');
    }
  };

  /* ─── FILTRARE "SALT LA LITERĂ" ─── */
  /* ─── FILTRARE STRICTĂ PE NUME ─── */
  const filtered = elevi
    .filter(e => {
      const nq = norm(search);
      // Căutăm DOAR în câmpul nume. 
      // Folosim startsWith pentru "salt la literă" sau includes pentru căutare parțială.
      return norm(e.nume).startsWith(nq);
    })
    .sort((a, b) => a.nume.localeCompare(b.nume, 'ro'));

  return (
    <div className="page">
      <div className="page-header">
        <h2>👥 Evidența Elevilor</h2>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => fileRef.current.click()} disabled={importing}>
            {importing ? 'Se importă...' : '📥 Import Excel'}
          </button>
          <input ref={fileRef} type="file" hidden onChange={importExcel} accept=".xlsx, .xls" />
          
          <button className="btn btn-danger" onClick={deleteAllElevi}>🗑️ Șterge tot</button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Adaugă Elev</button>
        </div>
      </div>

      <div className="search-bar">
        <input 
          className="search-input" 
          placeholder="Tastați litera numelui (ex: P)..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
        />
        <span className="search-count">{filtered.length} elevi găsiți</span>
      </div>

      {loading ? <div className="loading">Se încarcă...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nume</th>
                <th>Prenume</th>
                <th>Clasa</th>
                <th>Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.id}>
                  <td>{i + 1}</td>
                  <td><strong>{e.nume}</strong></td>
                  <td>{e.prenume}</td>
                  <td><span className="badge badge-blue">{e.clasa}</span></td>
                  <td>
                    <button className="btn-icon" title="Descarcă Fișă PDF" onClick={() => generatePDF(e)}>📄</button>
                    <button className="btn-icon" title="Șterge" onClick={() => deleteElev(e.id)}>🗑️</button>
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
            <div className="modal-header">
              <h3>Adaugă Elev Nou</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form className="form" onSubmit={addElev}>
              <div className="form-group">
                <label>Nume</label>
                <input required value={form.nume} onChange={e => setForm({...form, nume: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Prenume</label>
                <input required value={form.prenume} onChange={e => setForm({...form, prenume: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Clasa</label>
                <select required value={form.clasa} onChange={e => setForm({...form, clasa: e.target.value})}>
                  <option value="">Alege clasa...</option>
                  {CLASE.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Anulează</button>
                <button type="submit" className="btn btn-primary">Salvează Elev</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}