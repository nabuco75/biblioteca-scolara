import { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, updateDoc, getDocs, deleteDoc,
  doc, query, orderBy, where, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';

const EMPTY = {
  titlu: '', autor: '', isbn: '', gen: '', anPublicare: '',
  descriere: '', editia: '', locul: '', nrVolum: '', editura: '',
};

/* ════════════════════════════════════════════════
   Scanner Modal – Cititor USB (Zebra / HID)
   ════════════════════════════════════════════════ */
function ScannerModal({ onScan, onClose }) {
  const [isbn, setIsbn] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>&#128269; Cititor Cod de Bare ISBN</h3>
          <button className="modal-close" onClick={onClose}>&#10005;</button>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>&#128222;</div>
          <p style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
            Indreapta cititorul Zebra spre codul de bare
          </p>
          <p style={{ marginBottom: '1.5rem', fontSize: '0.875rem', color: 'var(--g500, #6b7280)' }}>
            Apasa tragaciul — ISBN-ul va aparea automat in campul de mai jos.
          </p>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            placeholder="ISBN apare aici dupa scanare..."
            value={isbn}
            onChange={e => setIsbn(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && isbn.trim()) onScan(isbn.trim()); }}
            style={{
              width: '100%', padding: '0.75rem 1rem',
              fontSize: '1.1rem', textAlign: 'center',
              letterSpacing: '0.12em', borderRadius: '8px',
              border: '2px solid var(--primary, #2563eb)',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--g400, #9ca3af)' }}>
            Sau tasteaza ISBN manual si apasa Enter
          </p>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   Main Page
   ════════════════════════════════════════════════ */
export default function CartiPage() {
  const [carti,       setCarti]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [search,      setSearch]      = useState('');
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [form,        setForm]        = useState(EMPTY);
  const [editingId,   setEditingId]   = useState(null);
  const [nrList,      setNrList]      = useState(['']); // add mode: nr per exemplar
  const [editCopies,  setEditCopies]  = useState([]);   // edit mode: existing + new copies
  const [expandedId,  setExpandedId]  = useState(null);
  const [formError,   setFormError]   = useState('');
  const [sortKey,     setSortKey]     = useState('titlu');
  const [sortDir,     setSortDir]     = useState('asc');

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const Th = ({ k, children, style }) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
        onClick={() => toggleSort(k)}>
      {children}{' '}
      <span style={{ opacity: sortKey === k ? 1 : 0.2, fontSize: '0.65rem' }}>
        {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
      </span>
    </th>
  );

  useEffect(() => { loadCarti(); }, []);

  const loadCarti = async () => {
    setLoading(true);
    try {
      const [booksSnap, copiesSnap] = await Promise.all([
        getDocs(query(collection(db, 'carti'), orderBy('titlu'))),
        getDocs(collection(db, 'copies')),
      ]);

      // Grupează copies după bookId
      const copiesMap = {};
      copiesSnap.docs.forEach(d => {
        const copy = { id: d.id, ...d.data() };
        if (copy.bookId) {
          if (!copiesMap[copy.bookId]) copiesMap[copy.bookId] = [];
          copiesMap[copy.bookId].push(copy);
        }
      });

      const books = booksSnap.docs.map(d => {
        const book = { id: d.id, ...d.data() };
        const bookCopies = copiesMap[d.id] || [];
        return {
          ...book,
          _copies:      bookCopies,
          _total:       bookCopies.length,
          _disponibile: bookCopies.filter(c => c.status === 'disponibil').length,
        };
      });

      setCarti(books);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* ─── ISBN lookup ─── */
  const fetchISBN = async (isbnOverride) => {
    const raw  = isbnOverride ?? form.isbn;
    const isbn = raw.replace(/[-\s]/g, '');
    if (isbn.length < 10) { alert('ISBN invalid'); return; }
    setIsbnLoading(true);
    try {
      // 1. Cauta in Firestore
      const q    = query(collection(db, 'carti'), where('isbn', '==', isbn));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const { _copies, _total, _disponibile, ...data } = snap.docs[0].data();
        setForm(f => ({ ...f, ...data }));
        return;
      }
      // 2. Google Books
      let found = false;
      const gRes  = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      const gData = await gRes.json();
      if (gData.totalItems > 0) {
        const bk = gData.items[0].volumeInfo;
        setForm(f => ({
          ...f, isbn,
          titlu:      bk.title || '',
          autor:      bk.authors?.join(', ') || '',
          editura:    bk.publisher || '',
          anPublicare: bk.publishedDate?.slice(0, 4) || '',
          descriere:  bk.description || '',
        }));
        found = true;
      }
      // 3. OpenLibrary fallback
      if (!found) {
        const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
        const data = await res.json();
        const key  = `ISBN:${isbn}`;
        if (data[key]) {
          const bk = data[key];
          setForm(f => ({
            ...f, isbn,
            titlu:      bk.title || '',
            autor:      bk.authors?.[0]?.name || '',
            editura:    bk.publishers?.[0]?.name || '',
            anPublicare: bk.publish_date?.slice(-4) || '',
          }));
          found = true;
        }
      }
      if (!found) alert('Cartea nu exista in baze externe. Introdu manual (va fi salvata pentru viitor).');
    } catch (e) { alert('Eroare: ' + e.message); }
    finally      { setIsbnLoading(false); }
  };

  const handleScan = async (isbn) => {
    setShowScanner(false);
    setForm({ ...EMPTY, isbn });
    setShowForm(true);
    await fetchISBN(isbn);
  };

  /* ─── Open edit ─── */
  const openEdit = (carte) => {
    const { _copies, _total, _disponibile, id, ...rest } = carte;
    setForm({
      titlu:       rest.titlu       || '',
      autor:       rest.autor       || '',
      isbn:        rest.isbn        || '',
      gen:         rest.gen         || '',
      anPublicare: rest.anPublicare || '',
      descriere:   rest.descriere   || '',
      editia:      rest.editia      || '',
      locul:       rest.locul       || '',
      nrVolum:     rest.nrVolum     || '',
      editura:     rest.editura     || '',
    });
    setEditingId(id);
    setEditCopies(
      (_copies || [])
        .sort((a, b) => String(a.nrInregistrare).localeCompare(String(b.nrInregistrare), undefined, { numeric: true }))
        .map(c => ({ ...c, _deleted: false, _isNew: false }))
    );
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    setNrList(['']);
    setEditCopies([]);
    setFormError('');
  };

  /* ─── Add mode: schimba nr exemplare ─── */
  const handleNrExemplareChange = (val) => {
    const n = Math.max(1, parseInt(val) || 1);
    setNrList(prev => Array.from({ length: n }, (_, i) => prev[i] ?? ''));
  };

  /* ─── Edit mode: marchează copy pentru stergere ─── */
  const markDeleteCopy = (copyId, isNew, tempId) => {
    setEditCopies(prev => isNew
      ? prev.filter(c => !(c._isNew && c._tempId === tempId))
      : prev.map(c => c.id === copyId ? { ...c, _deleted: true } : c)
    );
  };

  /* ─── Edit mode: adaugă rând gol pentru exemplar nou ─── */
  const addNewCopyRow = () => {
    setEditCopies(prev => [...prev, {
      _isNew: true,
      _tempId: `new_${Date.now()}`,
      nrInregistrare: '',
      status: 'disponibil',
      _deleted: false,
    }]);
  };

  /* ─── Curăță undefined înainte de Firestore ─── */
  const eliminaUndefined = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

  /* ─── Save ─── */
  const saveCarte = async (e) => {
    e.preventDefault();
    setFormError('');
    const base = {
      titlu:      form.titlu,
      autor:      form.autor,
      isbn:       form.isbn,
      gen:        form.gen,
      anPublicare: Number(form.anPublicare) || 0,
      descriere:  form.descriere,
      editia:     form.editia,
      locul:      form.locul,
      nrVolum:    form.nrVolum,
      editura:    form.editura,
    };

    try {
      if (editingId) {
        /* ── Editare ── */
        const toDelete = editCopies.filter(c => c._deleted && !c._isNew);
        const borrowedToDelete = toDelete.filter(c => c.status === 'imprumutat');
        if (borrowedToDelete.length > 0) {
          setFormError(`Nu poți șterge exemplare împrumutate: ${borrowedToDelete.map(c => c.nrInregistrare).join(', ')}`);
          return;
        }

        await updateDoc(doc(db, 'carti', editingId), eliminaUndefined(base));

        const newCopies = editCopies.filter(c => c._isNew && !c._deleted);
        await Promise.all(newCopies.map(c =>
          addDoc(collection(db, 'copies'), {
            bookId: editingId,
            nrInregistrare: c.nrInregistrare,
            status: 'disponibil',
            dataAdaugare: Timestamp.now(),
          })
        ));

        await Promise.all(toDelete.map(c => deleteDoc(doc(db, 'copies', c.id))));

      } else {
        /* ── Adăugare ── */
        const bookRef = await addDoc(collection(db, 'carti'), {
          ...base,
          dataAdaugare: Timestamp.now(),
        });
        await Promise.all(nrList.map(nr =>
          addDoc(collection(db, 'copies'), {
            bookId: bookRef.id,
            nrInregistrare: nr,
            status: 'disponibil',
            dataAdaugare: Timestamp.now(),
          })
        ));
      }

      closeForm();
      loadCarti();
    } catch (e) { setFormError('Eroare salvare: ' + e.message); }
  };

  /* ─── Delete carte ─── */
  const deleteCarte = async (carte) => {
    if (carte._copies?.some(c => c.status === 'imprumutat')) {
      alert('Nu poți șterge o carte cu exemplare împrumutate!');
      return;
    }
    if (!confirm(`Stergi "${carte.titlu}" și toate exemplarele (${carte._total}) din catalog?`)) return;
    try {
      await Promise.all((carte._copies || []).map(c => deleteDoc(doc(db, 'copies', c.id))));
      await deleteDoc(doc(db, 'carti', carte.id));
      loadCarti();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  /* ─── Filter & sort ─── */
  const filtered = carti
    .filter(c => `${c.titlu} ${c.autor} ${c.isbn} ${c.gen}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortKey] ?? '';
      const vb = b[sortKey] ?? '';
      const cmp = (typeof va === 'number' && typeof vb === 'number')
        ? va - vb
        : String(va).localeCompare(String(vb), 'ro');
      return sortDir === 'asc' ? cmp : -cmp;
    });

  /* ─── Render ─── */
  return (
    <div className="page">
      <div className="page-header">
        <h2>&#128218; Catalog Cărți</h2>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setShowScanner(true)}>
            &#128269; Scaneaza ISBN
          </button>
          <button className="btn btn-primary"
            onClick={() => { setForm(EMPTY); setEditingId(null); setNrList(['']); setShowForm(true); }}>
            + Adauga Manual
          </button>
        </div>
      </div>

      <div className="search-bar">
        <input className="search-input"
          placeholder="Cauta dupa titlu, autor, ISBN sau gen..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{filtered.length} titluri</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>#</th>
                <Th k="titlu">Titlu</Th>
                <Th k="autor">Autor</Th>
                <Th k="isbn">ISBN</Th>
                <Th k="gen">Gen</Th>
                <Th k="anPublicare">An</Th>
                <th>Exemplare</th>
                <th>Disponibile</th>
                <th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan="10" className="empty-row">Nicio carte gasita</td></tr>
                : filtered.map((c, i) => {
                  const isExpanded = expandedId === c.id;
                  return (
                    <>
                      <tr key={c.id}
                        style={{ background: isExpanded ? 'var(--blue-50, #eff6ff)' : '' }}>
                        <td style={{ textAlign: 'center', padding: '0 0.25rem' }}>
                          <button
                            className="btn-icon"
                            title={isExpanded ? 'Ascunde exemplare' : 'Arata exemplare'}
                            style={{ fontSize: '0.7rem', opacity: 0.7 }}
                            onClick={() => setExpandedId(prev => prev === c.id ? null : c.id)}>
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        </td>
                        <td>{i + 1}</td>
                        <td>
                          <strong>{c.titlu}</strong>
                          {c.nrVolum && (
                            <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: 'var(--g500)', fontWeight: 400 }}>
                              vol. {c.nrVolum}
                            </span>
                          )}
                        </td>
                        <td>{c.autor}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--g600)' }}>
                            {c.isbn || '—'}
                          </span>
                        </td>
                        <td>{c.gen ? <span className="badge badge-blue">{c.gen}</span> : '—'}</td>
                        <td>{c.anPublicare || '—'}</td>
                        <td>
                          <span className="badge badge-blue">{c._total}</span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              c._disponibile === 0
                                ? 'badge-red'
                                : c._disponibile <= Math.ceil(c._total / 2)
                                  ? 'badge-yellow'
                                  : 'badge-green'
                            }`}
                            title={`${c._total - c._disponibile} imprumutate din ${c._total}`}
                          >
                            {c._disponibile} din {c._total}
                          </span>
                        </td>
                        <td>
                          <button className="btn-icon" title="Editeaza"
                            onClick={() => openEdit(c)}>&#9998;</button>
                          <button className="btn-icon" title="Sterge"
                            onClick={() => deleteCarte(c)}>&#128465;</button>
                        </td>
                      </tr>

                      {/* ── Rând expandabil cu exemplarele ── */}
                      {isExpanded && (
                        <tr key={`${c.id}__copies`}>
                          <td colSpan="10" style={{
                            padding: '0 1rem 0.75rem 3.5rem',
                            background: 'var(--blue-50, #eff6ff)',
                          }}>
                            {c._copies.length === 0 ? (
                              <p style={{ fontSize: '0.85rem', color: 'var(--g500)', margin: '0.4rem 0' }}>
                                Niciun exemplar înregistrat — fă migrarea sau adaugă manual.
                              </p>
                            ) : (
                              <table style={{ borderCollapse: 'collapse', fontSize: '0.83rem', width: 'auto' }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: 'left', padding: '0.3rem 1rem 0.3rem 0', color: 'var(--g500)', fontWeight: 600 }}>
                                      Nr. Înregistrare
                                    </th>
                                    <th style={{ textAlign: 'left', padding: '0.3rem 1rem 0.3rem 0', color: 'var(--g500)', fontWeight: 600 }}>
                                      Status
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...c._copies]
                                    .sort((a, b) => String(a.nrInregistrare).localeCompare(String(b.nrInregistrare), undefined, { numeric: true }))
                                    .map(copy => (
                                      <tr key={copy.id}>
                                        <td style={{ padding: '0.2rem 1rem 0.2rem 0', fontFamily: 'monospace', fontWeight: 600 }}>
                                          {copy.nrInregistrare || '—'}
                                        </td>
                                        <td style={{ padding: '0.2rem 0' }}>
                                          <span className={`badge ${
                                            copy.status === 'disponibil'  ? 'badge-green'
                                            : copy.status === 'imprumutat' ? 'badge-yellow'
                                            : 'badge-red'
                                          }`}>
                                            {copy.status === 'disponibil'  ? 'Disponibil'
                                            : copy.status === 'imprumutat' ? 'Împrumutat'
                                            : copy.status || '—'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Scanner Modal ── */}
      {showScanner && (
        <ScannerModal onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {/* ── Add / Edit Form Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="modal">
            <div className="modal-header">
              <h3>
                {editingId
                  ? 'Editeaza Carte'
                  : form.isbn
                    ? `Carte detectata – ISBN ${form.isbn}`
                    : 'Adauga Carte Noua'}
              </h3>
              <button className="modal-close" onClick={closeForm}>&#10005;</button>
            </div>

            <form className="form" onSubmit={saveCarte}>
              {/* ── ISBN ── */}
              <div className="form-group">
                <label>ISBN</label>
                <div className="isbn-row">
                  <input placeholder="ex: 9789730183443"
                    value={form.isbn}
                    onChange={e => setForm({ ...form, isbn: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), fetchISBN())} />
                  <button type="button" className="btn btn-secondary"
                    onClick={() => fetchISBN()} disabled={isbnLoading}>
                    {isbnLoading ? '&#9203; Cauta...' : '&#128269; Cauta'}
                  </button>
                  <button type="button" className="btn btn-secondary"
                    title="Cititor cod de bare USB"
                    onClick={() => { setShowForm(false); setShowScanner(true); }}>
                    &#128269;
                  </button>
                </div>
              </div>

              {isbnLoading && (
                <div className="alert alert-info">&#128269; Se cauta informatii despre carte...</div>
              )}

              {/* ── Date bibliografice ── */}
              <div className="form-row">
                <div className="form-group">
                  <label>Titlu *</label>
                  <input required placeholder="Titlul cartii"
                    value={form.titlu}
                    onChange={e => setForm({ ...form, titlu: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Autor *</label>
                  <input required placeholder="Numele autorului"
                    value={form.autor}
                    onChange={e => setForm({ ...form, autor: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Editura</label>
                  <input placeholder="ex: Humanitas"
                    value={form.editura}
                    onChange={e => setForm({ ...form, editura: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>An publicare</label>
                  <input type="number" placeholder="ex: 2020" min="1800" max="2030"
                    value={form.anPublicare}
                    onChange={e => setForm({ ...form, anPublicare: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Gen / Categorie</label>
                  <input placeholder="ex: Literatura romana"
                    value={form.gen}
                    onChange={e => setForm({ ...form, gen: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Ediția</label>
                  <input placeholder="ex: Ed. a II-a"
                    value={form.editia}
                    onChange={e => setForm({ ...form, editia: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Nr. Volum</label>
                  <input type="number" min="1" placeholder="ex: 1, 2, 3..."
                    value={form.nrVolum}
                    onChange={e => setForm({ ...form, nrVolum: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Locul</label>
                  <input placeholder="ex: București"
                    value={form.locul}
                    onChange={e => setForm({ ...form, locul: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label>Descriere / Note</label>
                <textarea rows="2" placeholder="Descriere scurta (optional)"
                  value={form.descriere}
                  onChange={e => setForm({ ...form, descriere: e.target.value })} />
              </div>

              {/* ══════════════════════════════
                  EXEMPLARE
              ══════════════════════════════ */}
              {!editingId ? (
                /* ── ADD MODE: număr + nr. înregistrare per exemplar ── */
                <div className="form-group">
                  <label>Număr Exemplare *</label>
                  <input type="number" min="1" required
                    value={nrList.length}
                    onChange={e => handleNrExemplareChange(e.target.value)} />

                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--g600)' }}>
                      Nr. Înregistrare per Exemplar:
                    </label>
                    {nrList.map((nr, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}>
                        <span style={{ minWidth: '90px', fontSize: '0.82rem', color: 'var(--g500)', flexShrink: 0 }}>
                          Exemplar {i + 1}:
                        </span>
                        <input
                          placeholder={`Nr. înregistrare ex. ${i + 1}`}
                          value={nr}
                          onChange={e => {
                            const next = [...nrList];
                            next[i] = e.target.value;
                            setNrList(next);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* ── EDIT MODE: gestionare exemplare existente + noi ── */
                <div className="form-group">
                  <label>Exemplare</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.35rem' }}>
                    {editCopies.map((copy, i) => {
                      if (copy._deleted) return null;
                      const isBorrowed = copy.status === 'imprumutat';
                      return (
                        <div key={copy.id || copy._tempId}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.5rem', background: 'var(--g50, #f9fafb)', borderRadius: 6 }}>
                          {copy._isNew ? (
                            <input
                              autoFocus={i === editCopies.length - 1}
                              placeholder="Nr. înregistrare nou"
                              value={copy.nrInregistrare}
                              onChange={e => setEditCopies(prev =>
                                prev.map((c, j) => j === i ? { ...c, nrInregistrare: e.target.value } : c)
                              )}
                              style={{ flex: 1, padding: '0.35rem 0.6rem', borderRadius: 6, border: '2px solid var(--primary, #2563eb)', fontSize: '0.88rem', outline: 'none' }}
                            />
                          ) : (
                            <span style={{ flex: 1, fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: 'var(--g800)' }}>
                              {copy.nrInregistrare || '—'}
                            </span>
                          )}
                          <span className={`badge ${isBorrowed ? 'badge-yellow' : 'badge-green'}`} style={{ flexShrink: 0 }}>
                            {isBorrowed ? 'Împrumutat' : 'Disponibil'}
                          </span>
                          <button
                            type="button"
                            title={isBorrowed ? 'Exemplarul este împrumutat și nu poate fi șters' : 'Șterge exemplar'}
                            disabled={isBorrowed}
                            style={{
                              opacity: isBorrowed ? 0.3 : 1,
                              cursor: isBorrowed ? 'not-allowed' : 'pointer',
                              background: 'none', border: 'none',
                              fontSize: '1rem', padding: '0 0.2rem',
                              color: 'var(--danger, #dc2626)',
                            }}
                            onClick={() => markDeleteCopy(copy.id, copy._isNew, copy._tempId)}
                          >
                            &#128465;
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="btn btn-secondary"
                    style={{ marginTop: '0.6rem', fontSize: '0.85rem', padding: '0.35rem 0.8rem' }}
                    onClick={addNewCopyRow}>
                    + Adaugă exemplar
                  </button>
                </div>
              )}

              {formError && (
                <div className="alert alert-danger">{formError}</div>
              )}

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeForm}>
                  Anuleaza
                </button>
                <button type="submit" className="btn btn-primary">
                  &#128190; {editingId ? 'Salveaza Modificarile' : 'Salveaza Cartea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
