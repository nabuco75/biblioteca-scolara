import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function RegistruInventarPage() {
  const [carti, setCarti] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editNr, setEditNr] = useState(null); // { id, value }

  useEffect(() => { loadRegistru(); }, []);

  const loadRegistru = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'carti'), orderBy('dataAdaugare')));
      setCarti(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      // daca dataAdaugare lipseste la unele carti, fallback fara ordonare
      try {
        const snap2 = await getDocs(collection(db, 'carti'));
        setCarti(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e2) { console.error(e2); }
    }
    setLoading(false);
  };

  const formatData = (ts) => {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return '—'; }
  };

  const filtered = carti.filter(c =>
    `${c.titlu} ${c.autor} ${c.nrInregistrare} ${c.editura}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page registru-page">

      {/* ── Header pagina ── */}
      <div className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.4rem' }}>📋</span>
            Registru de Inventar
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--n500)', marginTop: '0.2rem' }}>
            Actualizat automat din Catalog Cărți
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            🖨️ Printează Registrul
          </button>
        </div>
      </div>

      {/* ── Banner oficial ── */}
      <div className="registru-banner">
        <div className="registru-banner-inner">
          <div className="registru-banner-icon">📚</div>
          <div>
            <div className="registru-banner-school">Școala Gimnazială „Ștefan cel Mare" Vaslui</div>
            <div className="registru-banner-title">REGISTRU DE INVENTAR — FOND DE CARTE</div>
            <div className="registru-banner-sub">
              {filtered.length} {filtered.length === 1 ? 'titlu înregistrat' : 'titluri înregistrate'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="search-bar no-print">
        <input
          className="search-input"
          placeholder="Caută după titlu, autor, nr. inventar, editură..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="search-count">{filtered.length} rezultate</span>
      </div>

      {/* ── Tabel ── */}
      {loading ? (
        <div className="loading">Se încarcă registrul...</div>
      ) : (
        <div className="registru-table-wrap">
          <table className="registru-table">
            <thead>
              <tr>
                <th className="col-nr">Nr.<br />crt.</th>
                <th className="col-data">Data</th>
                <th className="col-nrinv">Nr.<br />Inventar</th>
                <th className="col-autor">Autorul</th>
                <th className="col-titlu">Titlul</th>
                <th className="col-editia">Ediția</th>
                <th className="col-locul">Locul</th>
                <th className="col-editura">Editura</th>
                <th className="col-anul">Anul</th>
                <th className="col-pret">Prețul</th>
                <th className="col-obs">Observații</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="11" className="empty-row">
                    {search ? 'Niciun rezultat găsit.' : 'Nicio carte înregistrată în catalog.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                    <td className="cell-center cell-nr">{i + 1}</td>
                    <td className="cell-center">{formatData(c.dataAdaugare)}</td>
                    <td className="cell-center cell-bold no-print">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        {c.nrInregistrare || '—'}
                        <button
                          className="btn-icon no-print"
                          title="Editează nr. inventar"
                          style={{ fontSize: '0.72rem', padding: '0 0.2rem', opacity: 0.55 }}
                          onClick={() => setEditNr({ id: c.id, value: c.nrInregistrare || '' })}
                        >&#9998;</button>
                      </span>
                    </td>
                    <td>{c.autor || '—'}</td>
                    <td className="cell-titlu">{c.titlu || '—'}</td>
                    <td className="cell-center">{c.editia || '—'}</td>
                    <td className="cell-center">{c.locul || '—'}</td>
                    <td>{c.editura || '—'}</td>
                    <td className="cell-center">{c.anPublicare || '—'}</td>
                    <td className="cell-center">
                      {c.pretul ? (
                        <span className="badge badge-green">{c.pretul} lei</span>
                      ) : '—'}
                    </td>
                    <td className="cell-obs">{c.descriere || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan="11" className="registru-footer-row">
                    Total: <strong>{filtered.length}</strong> {filtered.length === 1 ? 'titlu' : 'titluri'} înregistrate
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {/* ── Quick Edit Nr. Inventar ── */}
      {editNr && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditNr(null)}>
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h3>&#9998; Nr. Inventar</h3>
              <button className="modal-close" onClick={() => setEditNr(null)}>&#10005;</button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
                Nr. Înregistrare / Inventar
              </label>
              <input
                autoFocus
                style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '1rem', borderRadius: 8, border: '2px solid var(--primary, #2563eb)', outline: 'none', boxSizing: 'border-box' }}
                value={editNr.value}
                onChange={e => setEditNr(en => ({ ...en, value: e.target.value }))}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    await updateDoc(doc(db, 'carti', editNr.id), { nrInregistrare: editNr.value });
                    setEditNr(null); loadRegistru();
                  }
                  if (e.key === 'Escape') setEditNr(null);
                }}
              />
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setEditNr(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={async () => {
                  await updateDoc(doc(db, 'carti', editNr.id), { nrInregistrare: editNr.value });
                  setEditNr(null); loadRegistru();
                }}>&#128190; Salvează</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
