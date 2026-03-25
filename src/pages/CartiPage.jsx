import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, addDoc, getDocs, deleteDoc,
  doc, query, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser';

const EMPTY = {
  titlu: '', autor: '', isbn: '', editura: '',
  anPublicare: '', numarExemplare: 1, gen: '', descriere: '',
};

/* ════════════════════════════════════════════════
   Scanner Modal
   ════════════════════════════════════════════════ */
function ScannerModal({ onScan, onClose }) {
  const videoRef    = useRef(null);
  const readerRef   = useRef(null);
  const doneRef     = useRef(false);           // prevent double-fire
  const [status,    setStatus]  = useState('Se initializeaza camera...');
  const [cameras,   setCameras] = useState([]);
  const [activeId,  setActiveId] = useState(null);

  const startCamera = useCallback(async (deviceId) => {
    // stop previous stream
    if (readerRef.current) {
      try { readerRef.current.stop(); } catch { /* noop */ }
    }
    doneRef.current = false;
    setStatus('Scanare activa – apropie codul de bare...');

    try {
      readerRef.current = await new BrowserMultiFormatReader().decodeFromVideoDevice(
        deviceId ?? undefined,
        videoRef.current,
        (result, _err, controls) => {
          if (result && !doneRef.current) {
            doneRef.current = true;
            controls.stop();
            onScan(result.getText());
          }
        }
      );
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.includes('Permission') || msg.includes('permission') || msg.includes('NotAllowed')) {
        setStatus('Acces camera refuzat. Permite accesul la camera in browser si incearca din nou.');
      } else if (msg.includes('NotFound') || msg.includes('device')) {
        setStatus('Nu s-a gasit nicio camera. Verifica ca dispozitivul are camera.');
      } else {
        setStatus('Eroare camera: ' + msg);
      }
    }
  }, [onScan]);

  useEffect(() => {
    (async () => {
      try {
        // enumerate cameras (needs getUserMedia permission first on some browsers)
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devs = await BrowserCodeReader.listVideoInputDevices();
        setCameras(devs);

        // prefer rear / environment camera
        const rear = devs.find(d => /back|rear|environment|2/i.test(d.label));
        const chosen = rear?.deviceId ?? devs[0]?.deviceId ?? null;
        setActiveId(chosen);
        await startCamera(chosen);
      } catch (e) {
        setStatus('Nu s-a putut accesa camera: ' + (e?.message ?? e));
      }
    })();

    return () => {
      try { readerRef.current?.stop(); } catch { /* noop */ }
    };
  }, [startCamera]);

  const switchCamera = async (deviceId) => {
    setActiveId(deviceId);
    await startCamera(deviceId);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scanner-modal">
        <div className="modal-header">
          <h3>&#128247; Scanare Cod de Bare ISBN</h3>
          <button className="modal-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="scanner-body">
          <div className="scanner-viewport">
            <video ref={videoRef} autoPlay playsInline muted className="scanner-video" />
            {/* Viewfinder overlay */}
            <div className="scanner-overlay">
              <div className="scanner-frame">
                <span className="corner tl" /><span className="corner tr" />
                <span className="corner bl" /><span className="corner br" />
                <div className="scanner-beam" />
              </div>
            </div>
          </div>

          <p className="scanner-status">{status}</p>

          {cameras.length > 1 && (
            <div className="scanner-cameras">
              <span className="scanner-label">Camera:</span>
              {cameras.map((cam, i) => (
                <button
                  key={cam.deviceId}
                  className={`btn btn-sm ${activeId === cam.deviceId ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => switchCamera(cam.deviceId)}
                >
                  {cam.label || `Camera ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          <p className="scanner-hint">
            Tine cartea astfel incat codul de bare sa fie vizibil si bine iluminat.
            Scanarea este automata.
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
  const [loading,     setLoading]    = useState(true);
  const [showForm,    setShowForm]   = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [search,      setSearch]     = useState('');
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => { loadCarti(); }, []);

  const loadCarti = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'carti'), orderBy('titlu')));
      setCarti(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* ─── ISBN lookup ─── */
  const fetchISBN = async (isbnOverride) => {
    const isbn = (isbnOverride ?? form.isbn).replace(/[-\s]/g, '');
    if (isbn.length < 10) { alert('ISBN invalid (minim 10 caractere)'); return; }
    setIsbnLoading(true);
    try {
      const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const data = await res.json();
      const key  = `ISBN:${isbn}`;
      if (!data[key]) {
        alert('Cartea nu a fost gasita pe OpenLibrary pentru acest ISBN.\nPoti completa manual campurile.');
      } else {
        const bk = data[key];
        setForm(f => ({
          ...f,
          isbn,
          titlu:       bk.title                   || f.titlu,
          autor:       bk.authors?.[0]?.name       || f.autor,
          editura:     bk.publishers?.[0]?.name    || f.editura,
          anPublicare: bk.publish_date?.slice(-4)  || f.anPublicare,
          gen:         bk.subjects?.[0]?.name      || f.gen,
          descriere:   bk.notes?.value || bk.notes || f.descriere,
        }));
      }
    } catch (e) { alert('Eroare retea: ' + e.message); }
    setIsbnLoading(false);
  };

  /* ─── Called when scanner detects a barcode ─── */
  const handleScan = async (isbn) => {
    setShowScanner(false);
    setForm({ ...EMPTY, isbn });
    setShowForm(true);
    // auto-fetch after state settles
    setTimeout(() => fetchISBN(isbn), 100);
  };

  const addCarte = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'carti'), {
        ...form,
        numarExemplare: Number(form.numarExemplare) || 1,
        anPublicare:    Number(form.anPublicare)    || 0,
        dataAdaugare:   Timestamp.now(),
      });
      setForm(EMPTY);
      setShowForm(false);
      loadCarti();
    } catch (e) { alert('Eroare salvare: ' + e.message); }
  };

  const deleteCarte = async (id) => {
    if (!confirm('Stergi aceasta carte din catalog?')) return;
    await deleteDoc(doc(db, 'carti', id));
    loadCarti();
  };

  const filtered = carti.filter(c =>
    `${c.titlu} ${c.autor} ${c.isbn} ${c.gen}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>Catalog Carti</h2>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setShowScanner(true)}>
            &#128247; Scaneaza ISBN
          </button>
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setShowForm(true); }}>
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
                <th>#</th><th>Titlu</th><th>Autor</th><th>ISBN</th>
                <th>Gen</th><th>An</th><th>Exemplare</th><th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan="8" className="empty-row">Nicio carte gasita</td></tr>
                : filtered.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td><strong>{c.titlu}</strong></td>
                    <td>{c.autor}</td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--g600)' }}>
                        {c.isbn || '—'}
                      </span>
                    </td>
                    <td>{c.gen ? <span className="badge badge-blue">{c.gen}</span> : '—'}</td>
                    <td>{c.anPublicare || '—'}</td>
                    <td><span className="badge badge-green">{c.numarExemplare}</span></td>
                    <td>
                      <button className="btn-icon" title="Sterge"
                        onClick={() => deleteCarte(c.id)}>&#128465;</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
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
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>
                {form.isbn ? `Carte detectata – ISBN ${form.isbn}` : 'Adauga Carte Noua'}
              </h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&#10005;</button>
            </div>

            <form className="form" onSubmit={addCarte}>
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
                    title="Deschide scanner"
                    onClick={() => { setShowForm(false); setShowScanner(true); }}>
                    &#128247;
                  </button>
                </div>
              </div>

              {isbnLoading && (
                <div className="alert alert-info">
                  &#128269; Se cauta informatii pe OpenLibrary...
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

              <div className="form-group">
                <label>Descriere / Note</label>
                <textarea rows="2" placeholder="Descriere scurta (optional)"
                  value={form.descriere}
                  onChange={e => setForm({ ...form, descriere: e.target.value })} />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary"
                  onClick={() => setShowForm(false)}>Anuleaza</button>
                <button type="submit" className="btn btn-primary">
                  &#128190; Salveaza Cartea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
