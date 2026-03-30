import { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, updateDoc, getDocs, deleteDoc,
  doc, query, orderBy, where, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';

const EMPTY = {
  titlu: '', autor: '', isbn: '', nrInregistrare: '', editura: '',
  anPublicare: '', numarExemplare: 1, gen: '', descriere: '',
  editia: '', locul: '', nrVolum: '',
};

/* ════════════════════════════════════════════════
   Scanner Modal – Cititor USB (Zebra / HID)
   ════════════════════════════════════════════════ */
function ScannerModal({ onScan, onClose }) {
  const [isbn, setIsbn] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    // mic delay ca modalul sa fie randat inainte de focus
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isbn.trim()) {
      onScan(isbn.trim());
    }
  };

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
            Apasa tragaciul — ISBN-ul va aparea automat in campul de mai jos si va fi cautat imediat.
          </p>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            placeholder="ISBN apare aici dupa scanare..."
            value={isbn}
            onChange={e => setIsbn(e.target.value)}
            onKeyDown={handleKeyDown}
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
  const [carti,       setCarti]      = useState([]);
  const [activeLoansMap, setActiveLoansMap] = useState({});
  const [loading,     setLoading]    = useState(true);
  const [showForm,    setShowForm]   = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [search,      setSearch]     = useState('');
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [form,        setForm]       = useState(EMPTY);
  const [editingId,   setEditingId]  = useState(null); // null = adaugare, string = editare
  const [editNr,      setEditNr]     = useState(null); // { id, value } pentru editare rapida nr. inventar

  useEffect(() => { loadCarti(); }, []);

  const loadCarti = async () => {
    setLoading(true);
    try {
      const [snap, impSnap] = await Promise.all([
        getDocs(query(collection(db, 'carti'), orderBy('titlu'))),
        getDocs(query(collection(db, 'imprumuturi'), where('stare', '==', 'activ'))),
      ]);
      setCarti(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      const map = {};
      impSnap.docs.forEach(d => {
        const { carteId } = d.data();
        if (carteId) map[carteId] = (map[carteId] || 0) + 1;
      });
      setActiveLoansMap(map);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* ─── ISBN lookup ─── */
  const fetchISBN = async (isbnOverride) => {
  const raw = isbnOverride ?? form.isbn;
  const isbn = raw.replace(/[-\s]/g, '');

  if (isbn.length < 10) {
    alert('ISBN invalid');
    return;
  }

  setIsbnLoading(true);

  try {
    // 🔹 1. cauta in Firestore
    const q = query(collection(db, 'carti'), where('isbn', '==', isbn));
    const snap = await getDocs(q);

    if (!snap.empty) {
      setForm(f => ({ ...f, ...snap.docs[0].data() }));
      return;
    }

    // 🔹 2. Google Books (principal)
    let found = false;

    const gRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const gData = await gRes.json();

    if (gData.totalItems > 0) {
      const bk = gData.items[0].volumeInfo;
      setForm(f => ({
        ...f,
        isbn,
        titlu: bk.title || '',
        autor: bk.authors?.join(', ') || '',
        editura: bk.publisher || '',
        anPublicare: bk.publishedDate?.slice(0, 4) || '',
        descriere: bk.description || '',
      }));
      found = true;
    }

    // 🔹 3. fallback OpenLibrary
    if (!found) {
      const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const data = await res.json();
      const key = `ISBN:${isbn}`;
      if (data[key]) {
        const bk = data[key];
        setForm(f => ({
          ...f,
          isbn,
          titlu: bk.title || '',
          autor: bk.authors?.[0]?.name || '',
          editura: bk.publishers?.[0]?.name || '',
          anPublicare: bk.publish_date?.slice(-4) || '',
        }));
        found = true;
      }
    }

    // 🔹 4. fallback final
    if (!found) {
      alert('Cartea nu exista in baze externe. Introdu manual (va fi salvata pentru viitor).');
    }

  } catch (e) {
    alert('Eroare: ' + e.message);
  } finally {
    setIsbnLoading(false);
  }
};

  /* ─── Called when scanner detects a barcode ─── */
  const handleScan = async (isbn) => {
    setShowScanner(false);
    setForm({ ...EMPTY, isbn });
    setShowForm(true);
    await fetchISBN(isbn);
  };

  const openEdit = (carte) => {
    const { id, ...rest } = carte;
    setForm(rest);
    setEditingId(id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const saveCarte = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      numarExemplare: Number(form.numarExemplare) || 1,
      anPublicare:    Number(form.anPublicare)    || 0,
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'carti', editingId), payload);
      } else {
        await addDoc(collection(db, 'carti'), { ...payload, dataAdaugare: Timestamp.now() });
      }
      closeForm();
      loadCarti();
    } catch (e) { alert('Eroare salvare: ' + e.message); }
  };

  const deleteCarte = async (id) => {
    if (!confirm('Stergi aceasta carte din catalog?')) return;
    try {
      await deleteDoc(doc(db, 'carti', id));
      loadCarti();
    } catch (e) { alert('Eroare la stergere: ' + e.message); }
  };

  const filtered = carti.filter(c =>
    `${c.titlu} ${c.autor} ${c.isbn} ${c.gen}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>📚 Catalog Cărți</h2>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setShowScanner(true)}>
            &#128269; Scaneaza ISBN
          </button>
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(true); }}>
            + Adauga Manual
          </button>
        </div>
      </div>

      <div className="search-bar">
        <input className="search-input"
          placeholder="Cauta dupa titlu, autor, ISBN sau gen..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{filtered.length} carti</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Nr. Reg.</th><th>Titlu</th><th>Autor</th><th>ISBN</th>
                <th>Gen</th><th>An</th><th>Disponibile</th><th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan="9" className="empty-row">Nicio carte gasita</td></tr>
                : filtered.map((c, i) => {
                  const total  = c.numarExemplare || 1;
                  const imprum = activeLoansMap[c.id] || 0;
                  const avail  = total - imprum;
                  return (
                    <tr key={c.id}>
                      <td>{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          {c.nrInregistrare || '—'}
                          <button
                            className="btn-icon"
                            title="Editeaza nr. inventar"
                            style={{ fontSize: '0.75rem', padding: '0 0.25rem', opacity: 0.6 }}
                            onClick={() => setEditNr({ id: c.id, value: c.nrInregistrare || '' })}
                          >&#9998;</button>
                        </span>
                      </td>
                      <td>
                        <strong>{c.titlu}</strong>
                        {c.nrVolum && (
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: 'var(--g500, #6b7280)', fontWeight: 400 }}>
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
                        <span
                          className={`badge ${avail === 0 ? 'badge-red' : avail <= Math.ceil(total / 2) ? 'badge-yellow' : 'badge-green'}`}
                          title={`${imprum} imprumutate din ${total}`}
                        >
                          {avail === 0 ? `0 din ${total}` : `${avail} din ${total}`}
                        </span>
                      </td>
                      <td>
                        <button className="btn-icon" title="Editeaza"
                          onClick={() => openEdit(c)}>&#9998;</button>
                        <button className="btn-icon" title="Sterge"
                          onClick={() => deleteCarte(c.id)}>&#128465;</button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
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
                    setEditNr(null); loadCarti();
                  }
                  if (e.key === 'Escape') setEditNr(null);
                }}
              />
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setEditNr(null)}>Anulează</button>
                <button className="btn btn-primary" onClick={async () => {
                  await updateDoc(doc(db, 'carti', editNr.id), { nrInregistrare: editNr.value });
                  setEditNr(null); loadCarti();
                }}>&#128190; Salvează</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scanner Modal ── */}
      {showScanner && (
        <ScannerModal
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ── Add / Edit Form Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="modal">
            <div className="modal-header">
              <h3>
                {editingId ? `Editeaza Carte` : form.isbn ? `Carte detectata – ISBN ${form.isbn}` : 'Adauga Carte Noua'}
              </h3>
              <button className="modal-close" onClick={closeForm}>&#10005;</button>
            </div>

            <form className="form" onSubmit={saveCarte}>
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

              <div className="form-group">
                <label>Nr. Inregistrare</label>
                <input placeholder="ex: 1234"
                  value={form.nrInregistrare}
                  onChange={e => setForm({ ...form, nrInregistrare: e.target.value })} />
              </div>

              {isbnLoading && (
                <div className="alert alert-info">
                  &#128269; Se cauta informatii despre carte...
                </div>
              )}

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
                  <label>Nr. Exemplare *</label>
                  <input type="number" min="1" required
                    value={form.numarExemplare}
                    onChange={e => setForm({ ...form, numarExemplare: e.target.value })} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Ediția</label>
                  <input placeholder="ex: Ed. a II-a"
                    value={form.editia}
                    onChange={e => setForm({ ...form, editia: e.target.value })} />
                </div>
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

              <div className="form-actions">
                <button type="button" className="btn btn-secondary"
                  onClick={closeForm}>Anuleaza</button>
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
