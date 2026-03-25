import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import * as XLSX from 'xlsx';

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ro-RO');
};

const isOverdue = (imp) => {
  if (imp.stare !== 'activ') return false;
  const d = imp.dataImprumut?.toDate ? imp.dataImprumut.toDate() : new Date(imp.dataImprumut);
  return (Date.now() - d.getTime()) / 86_400_000 > 14;
};

export default function RapoartePage() {
  const [imprumuturi, setImprumuturi] = useState([]);
  const [elevi,       setElevi]       = useState([]);
  const [carti,       setCarti]       = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [iSnap, eSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, 'imprumuturi'), orderBy('dataImprumut', 'desc'))),
        getDocs(collection(db, 'elevi')),
        getDocs(collection(db, 'carti')),
      ]);
      setImprumuturi(iSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setElevi(eSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCarti(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* ─── Stats ─── */
  const active    = imprumuturi.filter(i => i.stare === 'activ' && !isOverdue(i));
  const overdue   = imprumuturi.filter(i => isOverdue(i));
  const returned  = imprumuturi.filter(i => i.stare === 'returnat');

  /* Top 5 most borrowed books */
  const bookCount = {};
  imprumuturi.forEach(i => { bookCount[i.carteTitlu] = (bookCount[i.carteTitlu] || 0) + 1; });
  const topBooks = Object.entries(bookCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  /* Top 5 most active students */
  const elevCount = {};
  imprumuturi.forEach(i => {
    const k = `${i.elevNume} ${i.elevPrenume} (${i.elevClasa})`;
    elevCount[k] = (elevCount[k] || 0) + 1;
  });
  const topElevi = Object.entries(elevCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  /* ─── Excel export helpers ─── */
  const downloadXLSX = (rows, headers, sheetName, fileName) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Column widths
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length, 15) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const exportToateImprumuturi = () => {
    const headers = [
      'Nr.', 'Elev Nume', 'Elev Prenume', 'Clasa',
      'Titlu Carte', 'Autor', 'Data Imprumut', 'Termen Returnare',
      'Data Returnare Efectiva', 'Stare'
    ];
    const rows = imprumuturi.map((imp, i) => [
      i + 1,
      imp.elevNume, imp.elevPrenume, imp.elevClasa,
      imp.carteTitlu, imp.carteAutor,
      fmtDate(imp.dataImprumut), fmtDate(imp.dataReturnare),
      imp.dataReturnareEfectiva ? fmtDate(imp.dataReturnareEfectiva) : '',
      isOverdue(imp) ? 'Intarziat' : imp.stare === 'returnat' ? 'Returnat' : 'Activ',
    ]);
    downloadXLSX(rows, headers, 'Imprumuturi', `Imprumuturi_${new Date().toLocaleDateString('ro-RO').replace(/\//g, '-')}.xlsx`);
  };

  const exportIntarzieri = () => {
    const list = imprumuturi.filter(isOverdue);
    if (list.length === 0) { alert('Nu exista imprumuturi intarziate!'); return; }
    const headers = ['Nr.', 'Elev', 'Clasa', 'Carte', 'Data Imprumut', 'Termen', 'Zile Intarziere'];
    const rows = list.map((imp, i) => {
      const d = imp.dataImprumut?.toDate ? imp.dataImprumut.toDate() : new Date(imp.dataImprumut);
      const zile = Math.floor((Date.now() - d.getTime()) / 86_400_000);
      return [
        i + 1,
        `${imp.elevNume} ${imp.elevPrenume}`, imp.elevClasa,
        imp.carteTitlu, fmtDate(imp.dataImprumut), fmtDate(imp.dataReturnare),
        zile,
      ];
    });
    downloadXLSX(rows, headers, 'Intarzieri', `Intarzieri_${new Date().toLocaleDateString('ro-RO').replace(/\//g, '-')}.xlsx`);
  };

  const exportElevi = () => {
    const headers = ['Nr.', 'Nume', 'Prenume', 'Clasa', 'An Scolar', 'Nr. Imprumuturi'];
    const rows = elevi.map((el, i) => {
      const cnt = imprumuturi.filter(imp => imp.elevId === el.id).length;
      return [i + 1, el.nume, el.prenume, el.clasa, el.anScolar || '', cnt];
    });
    downloadXLSX(rows, headers, 'Elevi', `Elevi_${new Date().toLocaleDateString('ro-RO').replace(/\//g, '-')}.xlsx`);
  };

  const exportCarti = () => {
    const headers = ['Nr.', 'Titlu', 'Autor', 'ISBN', 'Gen', 'An', 'Exemplare', 'Imprumuturi Total'];
    const rows = carti.map((c, i) => {
      const cnt = imprumuturi.filter(imp => imp.carteId === c.id).length;
      return [i + 1, c.titlu, c.autor, c.isbn || '', c.gen || '', c.anPublicare || '', c.numarExemplare || 1, cnt];
    });
    downloadXLSX(rows, headers, 'Carti', `Carti_${new Date().toLocaleDateString('ro-RO').replace(/\//g, '-')}.xlsx`);
  };

  const exportRaportComplet = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1 – all loans
    const s1 = XLSX.utils.aoa_to_sheet([
      ['Nr.', 'Elev Nume', 'Elev Prenume', 'Clasa', 'Titlu Carte', 'Autor', 'Data Imprumut', 'Termen', 'Returnat', 'Stare'],
      ...imprumuturi.map((imp, i) => [
        i + 1, imp.elevNume, imp.elevPrenume, imp.elevClasa,
        imp.carteTitlu, imp.carteAutor,
        fmtDate(imp.dataImprumut), fmtDate(imp.dataReturnare),
        imp.dataReturnareEfectiva ? fmtDate(imp.dataReturnareEfectiva) : '',
        isOverdue(imp) ? 'INTARZIAT' : imp.stare === 'returnat' ? 'Returnat' : 'Activ',
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, s1, 'Toate Imprumuturile');

    // Sheet 2 – overdue
    const overdueList = imprumuturi.filter(isOverdue);
    const s2 = XLSX.utils.aoa_to_sheet([
      ['Nr.', 'Elev', 'Clasa', 'Carte', 'Data Imprumut', 'Termen', 'Zile Intarziere'],
      ...overdueList.map((imp, i) => {
        const d = imp.dataImprumut?.toDate ? imp.dataImprumut.toDate() : new Date(imp.dataImprumut);
        return [
          i + 1,
          `${imp.elevNume} ${imp.elevPrenume}`, imp.elevClasa, imp.carteTitlu,
          fmtDate(imp.dataImprumut), fmtDate(imp.dataReturnare),
          Math.floor((Date.now() - d.getTime()) / 86_400_000),
        ];
      }),
    ]);
    XLSX.utils.book_append_sheet(wb, s2, 'Intarzieri');

    // Sheet 3 – statistics
    const s3 = XLSX.utils.aoa_to_sheet([
      ['Indicator', 'Valoare'],
      ['Total elevi',                elevi.length],
      ['Total carti (titluri)',       carti.length],
      ['Total imprumuturi',           imprumuturi.length],
      ['Imprumuturi active',          active.length],
      ['Imprumuturi intarziate',      overdue.length],
      ['Imprumuturi returnate',       returned.length],
      ['Rata returnare (%)',          imprumuturi.length
        ? Math.round(returned.length / imprumuturi.length * 100)
        : 0],
      ['', ''],
      ['Top 5 carti', 'Nr. imprumuturi'],
      ...topBooks.map(([t, n]) => [t, n]),
      ['', ''],
      ['Top 5 cititori', 'Nr. imprumuturi'],
      ...topElevi.map(([n, c]) => [n, c]),
    ]);
    XLSX.utils.book_append_sheet(wb, s3, 'Statistici');

    XLSX.writeFile(wb, `Raport_Biblioteca_${new Date().toLocaleDateString('ro-RO').replace(/\//g, '-')}.xlsx`);
  };

  if (loading) return <div className="loading">Se incarca rapoartele...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Rapoarte si Statistici</h2>
        <button className="btn btn-success" onClick={exportRaportComplet}>
          &#128229; Raport Complet Excel
        </button>
      </div>

      {/* Summary cards */}
      <div className="cards-grid">
        <div className="stat-card blue">
          <div className="stat-value">{elevi.length}</div>
          <div className="stat-label">Elevi inregistrati</div>
        </div>
        <div className="stat-card green">
          <div className="stat-value">{carti.length}</div>
          <div className="stat-label">Titluri de carti</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-value">{active.length}</div>
          <div className="stat-label">Imprumuturi active</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{overdue.length}</div>
          <div className="stat-label">Intarzieri</div>
        </div>
        <div className="stat-card green">
          <div className="stat-value">{returned.length}</div>
          <div className="stat-label">Returnate</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-value">{imprumuturi.length}</div>
          <div className="stat-label">Total imprumuturi</div>
        </div>
      </div>

      {/* Top books & students */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="report-section">
          <h3>&#128218; Top 5 Carti Imprumutate</h3>
          {topBooks.length === 0
            ? <p style={{ color: 'var(--g400)', fontSize: '.85rem' }}>Nicio activitate inca.</p>
            : topBooks.map(([titlu, cnt], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--g100)' }}>
                <span style={{ fontSize: '.875rem', color: 'var(--g700)' }}>
                  <strong style={{ color: 'var(--primary)', marginRight: '.4rem' }}>{i + 1}.</strong>
                  {titlu}
                </span>
                <span className="badge badge-blue">{cnt}x</span>
              </div>
            ))}
        </div>

        <div className="report-section">
          <h3>&#128106; Top 5 Cititori Activi</h3>
          {topElevi.length === 0
            ? <p style={{ color: 'var(--g400)', fontSize: '.85rem' }}>Nicio activitate inca.</p>
            : topElevi.map(([elev, cnt], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.4rem 0', borderBottom: '1px solid var(--g100)' }}>
                <span style={{ fontSize: '.875rem', color: 'var(--g700)' }}>
                  <strong style={{ color: 'var(--primary)', marginRight: '.4rem' }}>{i + 1}.</strong>
                  {elev}
                </span>
                <span className="badge badge-green">{cnt}x</span>
              </div>
            ))}
        </div>
      </div>

      {/* Export buttons */}
      <div className="report-section">
        <h3>&#128229; Export Date</h3>
        <div className="export-row">
          <button className="btn btn-primary" onClick={exportToateImprumuturi}>
            Toate imprumuturile (.xlsx)
          </button>
          <button className="btn btn-danger" onClick={exportIntarzieri}>
            Intarzieri (.xlsx)
          </button>
          <button className="btn btn-secondary" onClick={exportElevi}>
            Lista elevi (.xlsx)
          </button>
          <button className="btn btn-secondary" onClick={exportCarti}>
            Catalog carti (.xlsx)
          </button>
          <button className="btn btn-success" onClick={exportRaportComplet}>
            Raport complet (toate foile)
          </button>
        </div>
      </div>

      {/* Overdue table */}
      {overdue.length > 0 && (
        <div className="report-section">
          <h3 style={{ color: 'var(--danger)' }}>&#9888; Imprumuturi Intarziate ({overdue.length})</h3>
          <div className="table-container" style={{ boxShadow: 'none', border: '1px solid #f98080' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th><th>Elev</th><th>Clasa</th>
                  <th>Carte</th><th>Dat Imprumut</th><th>Termen</th><th>Zile Intarziere</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((imp, i) => {
                  const d = imp.dataImprumut?.toDate ? imp.dataImprumut.toDate() : new Date(imp.dataImprumut);
                  const zile = Math.floor((Date.now() - d.getTime()) / 86_400_000);
                  return (
                    <tr key={imp.id} className="overdue-row">
                      <td>{i + 1}</td>
                      <td><strong>{imp.elevNume} {imp.elevPrenume}</strong></td>
                      <td><span className="badge badge-blue">{imp.elevClasa}</span></td>
                      <td>{imp.carteTitlu}</td>
                      <td>{fmtDate(imp.dataImprumut)}</td>
                      <td>{fmtDate(imp.dataReturnare)}</td>
                      <td><span className="badge badge-red">{zile} zile</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
