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
  String(str || '')
    .replace(/[ĂÂ]/g, 'A').replace(/[ăâ]/g, 'a')
    .replace(/Î/g, 'I').replace(/î/g, 'i')
    .replace(/[ȘŞ]/g, 'S').replace(/[șş]/g, 's')
    .replace(/[ȚŢ]/g, 'T').replace(/[țţ]/g, 't');

export default function EleviPage() {
  const [elevi, setElevi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({
    nume: '', prenume: '', clasa: '', anScolar: '2024-2025'
  });
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
    await addDoc(collection(db, 'elevi'), {
      ...form,
      dataAdaugare: Timestamp.now()
    });
    setForm({ nume: '', prenume: '', clasa: '', anScolar: '2024-2025' });
    setShowForm(false);
    loadElevi();
  };

  const deleteElev = async (id) => {
    if (!confirm('Ștergi elevul?')) return;
    await deleteDoc(doc(db, 'elevi', id));
    loadElevi();
  };

  const deleteAllElevi = async () => {
    if (!confirm('⚠️ Ștergi TOȚI elevii?')) return;
    await Promise.all(elevi.map(e => deleteDoc(doc(db, 'elevi', e.id))));
    loadElevi();
  };

  /* ─── IMPORT EXCEL (CORECT CLASE) ─── */
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

      const eleviCurati = rows.slice(1).map(r => {
        let clasaRaw = clean(r[2]);

        // normalizează clasa
        let clasa = clasaRaw
          .replace(/CLASA/i, '')
          .replace(/\s+/g, '')
          .toUpperCase();

        if (/PREG/i.test(clasaRaw)) {
          const litera = clasaRaw.match(/[A-Z]$/i)?.[0] || '';
          clasa = `Pregătitoare ${litera.toUpperCase()}`;
        }

        return {
          nume: clean(r[0]),
          prenume: clean(r[1]),
          clasa,
          anScolar: '2024-2025',
          dataAdaugare: Timestamp.now()
        };
      }).filter(e => e.nume && e.prenume);

      await Promise.all(
        eleviCurati.map(el => addDoc(collection(db, 'elevi'), el))
      );

      loadElevi();
      alert(`Importați ${eleviCurati.length} elevi`);
    } catch (err) {
      alert(err.message);
    }

    setImporting(false);
    e.target.value = '';
  };

  /* ─── PDF STABIL ─── */
  const generatePDF = async (elev) => {
    const snap = await getDocs(
      query(collection(db, 'imprumuturi'), where('elevId', '==', elev.id))
    );

    const loans = snap.docs.map(d => d.data());

    const pdf = new jsPDF();

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text('FIȘĂ ÎMPRUMUT', 105, 15, { align: 'center' });

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Nume: ${elev.nume} ${elev.prenume}`, 14, 30);
    pdf.text(`Clasa: ${elev.clasa}`, 14, 37);

    autoTable(pdf, {
      startY: 45,
      head: [['Nr', 'Titlu', 'Autor', 'Data', 'Status']],
      body: loans.map((l, i) => [
        i + 1,
        safe(l.carteTitlu),
        safe(l.carteAutor),
        fmtDate(l.dataImprumut),
        l.stare
      ]),
      styles: { font: 'helvetica' }
    });

    pdf.save(`${elev.nume}_${elev.prenume}.pdf`);
  };

  const filtered = elevi.filter(e =>
    `${e.nume} ${e.prenume} ${e.clasa}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <h2>📚 Elevi</h2>

      <button onClick={() => fileRef.current.click()}>
        {importing ? 'Import...' : 'Import Excel'}
      </button>

      <button onClick={deleteAllElevi}>
        Șterge tot ({elevi.length})
      </button>

      <button onClick={() => setShowForm(true)}>
        + Elev
      </button>

      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={importExcel}
      />

      <input
        placeholder="Caută..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading ? 'Loading...' : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nume</th>
              <th>Prenume</th>
              <th>Clasa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={e.id}>
                <td>{i + 1}</td>
                <td>{e.nume}</td>
                <td>{e.prenume}</td>
                <td>{e.clasa}</td>
                <td>
                  <button onClick={() => generatePDF(e)}>PDF</button>
                  <button onClick={() => deleteElev(e.id)}>X</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <div>
          <form onSubmit={addElev}>
            <input
              placeholder="Nume"
              value={form.nume}
              onChange={e => setForm({ ...form, nume: e.target.value })}
            />
            <input
              placeholder="Prenume"
              value={form.prenume}
              onChange={e => setForm({ ...form, prenume: e.target.value })}
            />
            <input
              placeholder="Clasa"
              value={form.clasa}
              onChange={e => setForm({ ...form, clasa: e.target.value })}
            />
            <button>Salvează</button>
          </form>
        </div>
      )}
    </div>
  );
}