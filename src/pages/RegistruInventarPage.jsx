import { useState, useEffect } from 'react';
import {
  collection, getDocs, query, orderBy, updateDoc, doc,
} from 'firebase/firestore';
import { db } from '../firebase/config';

export default function RegistruInventarPage() {
  const [rows,    setRows]    = useState([]); // copies joined cu carti
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [editNr,  setEditNr]  = useState(null); // { id, value } — editare rapida nr. inventar pe copies doc
  const [sortKey, setSortKey] = useState('nrInregistrare');
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const Th = ({ k, children, className }) => (
    <th className={className}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => toggleSort(k)}>
      {children}{' '}
      <span style={{ opacity: sortKey === k ? 1 : 0.2, fontSize: '0.62rem' }}>
        {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
      </span>
    </th>
  );

  useEffect(() => { loadRegistru(); }, []);

  const loadRegistru = async () => {
    setLoading(true);
    try {
      const [copiesSnap, cartiSnap] = await Promise.all([
        getDocs(collection(db, 'copies')),
        getDocs(collection(db, 'carti')),
      ]);

      // Mapă bookId → book data
      const booksMap = {};
      cartiSnap.docs.forEach(d => { booksMap[d.id] = { id: d.id, ...d.data() }; });

      // Join copies cu carti
      const joined = copiesSnap.docs.map(d => {
        const copy = { id: d.id, ...d.data() };
        const book = booksMap[copy.bookId] || {};
        return {
          // identificator unic = copies doc id
          copyId:          copy.id,
          bookId:          copy.bookId,
          nrInregistrare:  copy.nrInregistrare || '',
          status:          copy.status || 'disponibil',
          dataAdaugare:    copy.dataAdaugare || book.dataAdaugare || null,
          // date din carti
          titlu:     book.titlu     || '—',
          autor:     book.autor     || '—',
          isbn:      book.isbn      || '',
          anPublicare: book.anPublicare || '',
          gen:       book.gen       || '',
          editia:    book.editia    || '',
          locul:     book.locul     || '',
          editura:   book.editura   || '',
          pretul:    book.pretul    || '',
          descriere: book.descriere || '',
        };
      });

      setRows(joined);
    } catch (e) {
      console.error('Eroare incarcare registru:', e);
      // Fallback: dacă copies nu există încă, afișăm din carti (pre-migrare)
      try {
        const snap = await getDocs(query(collection(db, 'carti'), orderBy('dataAdaugare')));
        const legacy = snap.docs.map(d => {
          const c = { id: d.id, ...d.data() };
          return {
            copyId:         c.id,
            bookId:         c.id,
            nrInregistrare: c.nrInregistrare || '',
            status:         'disponibil',
            dataAdaugare:   c.dataAdaugare,
            titlu:     c.titlu     || '—',
            autor:     c.autor     || '—',
            isbn:      c.isbn      || '',
            anPublicare: c.anPublicare || '',
            gen:       c.gen       || '',
            editia:    c.editia    || '',
            locul:     c.locul     || '',
            editura:   c.editura   || '',
            pretul:    c.pretul    || '',
            descriere: c.descriere || '',
            _legacy: true,
          };
        });
        setRows(legacy);
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

  const filtered = rows
    .filter(r =>
      `${r.titlu} ${r.autor} ${r.nrInregistrare} ${r.editura} ${r.isbn}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let va = a[sortKey] ?? '';
      let vb = b[sortKey] ?? '';
      if (va?.toDate) va = va.toDate().getTime();
      if (vb?.toDate) vb = vb.toDate().getTime();
      // sortare numerică pentru nrInregistrare
      if (sortKey === 'nrInregistrare') {
        const na = parseInt(va) || 0;
        const nb = parseInt(vb) || 0;
        if (na !== nb) return sortDir === 'asc' ? na - nb : nb - na;
      }
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'ro');
      return sortDir === 'asc' ? cmp : -cmp;
    });

  return (
    <div className="page registru-page">

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.4rem' }}>&#128203;</span>
            Registru de Inventar
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--n500)', marginTop: '0.2rem' }}>
            Actualizat automat — un rând per exemplar fizic
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => window.print()}>
            &#128424; Printează Registrul
          </button>
        </div>
      </div>

      {/* ── Banner oficial ── */}
      <div className="registru-banner">
        <div className="registru-banner-inner">
          <div className="registru-banner-icon">&#128218;</div>
          <div>
            <div className="registru-banner-school">Școala Gimnazială „Ștefan cel Mare" Vaslui</div>
            <div className="registru-banner-title">REGISTRU DE INVENTAR — FOND DE CARTE</div>
            <div className="registru-banner-sub">
              {filtered.length} {filtered.length === 1 ? 'exemplar înregistrat' : 'exemplare înregistrate'}
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
                <Th k="dataAdaugare" className="col-data">Data</Th>
                <Th k="nrInregistrare" className="col-nrinv">Nr.<br />Inventar</Th>
                <Th k="autor" className="col-autor">Autorul</Th>
                <Th k="titlu" className="col-titlu">Titlul</Th>
                <Th k="editia" className="col-editia">Ediția</Th>
                <Th k="locul" className="col-locul">Locul</Th>
                <Th k="editura" className="col-editura">Editura</Th>
                <Th k="anPublicare" className="col-anul">Anul</Th>
                <th className="col-pret">Prețul</th>
                <th className="col-obs">Observații / Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="11" className="empty-row">
                    {search ? 'Niciun rezultat găsit.' : 'Niciun exemplar înregistrat. Rulează migrarea sau adaugă cărți noi.'}
                  </td>
                </tr>
              ) : (
                filtered.map((r, i) => (
                  <tr key={r.copyId} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                    <td className="cell-center cell-nr">{i + 1}</td>
                    <td className="cell-center">{formatData(r.dataAdaugare)}</td>

                    {/* Nr. Inventar — editabil inline */}
                    <td className="cell-center cell-bold no-print">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        {r.nrInregistrare || '—'}
                        {!r._legacy && (
                          <button
                            className="btn-icon no-print"
                            title="Editează nr. inventar"
                            style={{ fontSize: '0.72rem', padding: '0 0.2rem', opacity: 0.55 }}
                            onClick={() => setEditNr({ id: r.copyId, value: r.nrInregistrare || '' })}
                          >&#9998;</button>
                        )}
                      </span>
                    </td>

                    <td>{r.autor || '—'}</td>
                    <td className="cell-titlu">{r.titlu || '—'}</td>
                    <td className="cell-center">{r.editia || '—'}</td>
                    <td className="cell-center">{r.locul || '—'}</td>
                    <td>{r.editura || '—'}</td>
                    <td className="cell-center">{r.anPublicare || '—'}</td>
                    <td className="cell-center">
                      {r.pretul ? (
                        <span className="badge badge-green">{r.pretul} lei</span>
                      ) : '—'}
                    </td>
                    <td className="cell-obs">
                      <span className={`badge ${
                        r.status === 'disponibil'  ? 'badge-green'
                        : r.status === 'imprumutat' ? 'badge-yellow'
                        : 'badge-red'
                      }`}>
                        {r.status === 'disponibil'  ? 'Disponibil'
                        : r.status === 'imprumutat' ? 'Împrumutat'
                        : r.status || '—'}
                      </span>
                      {r.descriere && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.78rem', color: 'var(--g500)' }}>
                          {r.descriere}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan="11" className="registru-footer-row">
                    Total: <strong>{filtered.length}</strong> {filtered.length === 1 ? 'exemplar' : 'exemplare'} înregistrate
                    &nbsp;·&nbsp;
                    <strong>{filtered.filter(r => r.status === 'disponibil').length}</strong> disponibile
                    &nbsp;·&nbsp;
                    <strong>{filtered.filter(r => r.status === 'imprumutat').length}</strong> împrumutate
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
                    await updateDoc(doc(db, 'copies', editNr.id), { nrInregistrare: editNr.value });
                    setEditNr(null);
                    loadRegistru();
                  }
                  if (e.key === 'Escape') setEditNr(null);
                }}
              />
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setEditNr(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={async () => {
                  await updateDoc(doc(db, 'copies', editNr.id), { nrInregistrare: editNr.value });
                  setEditNr(null);
                  loadRegistru();
                }}>&#128190; Salvează</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
