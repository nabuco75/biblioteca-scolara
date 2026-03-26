import { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection, addDoc, getDocs, updateDoc,
  doc, query, orderBy, Timestamp, where
} from 'firebase/firestore';
import { db } from '../firebase/config';

/* helpers */
const fmtDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ro-RO');
};

const toDate = (ts) => {
  if (!ts) return new Date();
  return ts.toDate ? ts.toDate() : new Date(ts);
};

const daysDiff = (ts) => {
  const d = toDate(ts);
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
};

const isOverdue = (imp) =>
  imp.stare === 'activ' && daysDiff(imp.dataImprumut) > 14;

/* returns date string YYYY-MM-DD for <input type="date"> */
const toInputDate = (d = new Date()) => d.toISOString().split('T')[0];

const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

/* ════════════════════════════════════════════════
   SearchSelect – combobox elegant cu suport scanner
   ════════════════════════════════════════════════ */
function SearchSelect({ items, value, onChange, placeholder, filterFn, renderItem, renderChip, scanHint }) {
  const [q,    setQ]    = useState('');
  const [open, setOpen] = useState(false);
  const [hi,   setHi]   = useState(0);
  const inputRef = useRef();
  const boxRef   = useRef();

  const selected = value ? items.find(it => it.id === value) : null;
  const list = q.trim() ? items.filter(it => filterFn(it, q)) : items;

  useEffect(() => {
    const fn = e => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const pick = (item) => { onChange(item.id); setQ(''); setOpen(false); setHi(0); };
  const clear = () => { onChange(''); setQ(''); setHi(0); setTimeout(() => inputRef.current?.focus(), 0); };

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, list.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); return; }
    if (e.key === 'Escape')    { setOpen(false); setQ(''); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // daca e un item evidentiat, selecteaza-l
      if (open && list[hi]) { pick(list[hi]); return; }
      // Zebra scanner / ISBN: cauta potrivire exacta la ISBN
      const raw = q.replace(/[-\s]/g, '');
      if (raw) {
        const exact = items.find(it => it.isbn && it.isbn.replace(/[-\s]/g, '') === raw);
        if (exact) { pick(exact); return; }
      }
      // daca e un singur rezultat, selecteaza-l automat
      if (list.length === 1) { pick(list[0]); return; }
      setOpen(true);
    }
  };

  return (
    <div className="ss-wrap" ref={boxRef}>
      {selected ? (
        <div className="ss-chip">
          <div className="ss-chip-body">{renderChip(selected)}</div>
          <button type="button" className="ss-chip-clear" onClick={clear} title="Schimba selectia">✕</button>
        </div>
      ) : (
        <>
          <div className="ss-input-row">
            <span className="ss-ico">🔍</span>
            <input
              ref={inputRef}
              className="ss-input"
              value={q}
              placeholder={placeholder}
              onChange={e => { setQ(e.target.value); setHi(0); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKey}
              autoComplete="off"
              spellCheck={false}
            />
            {q && (
              <button type="button" className="ss-ico-clear"
                onClick={() => { setQ(''); setHi(0); inputRef.current?.focus(); }}>
                ×
              </button>
            )}
          </div>
          {open && (
            <div className="ss-dropdown">
              {list.length === 0 ? (
                <div className="ss-empty">Niciun rezultat pentru „{q}"</div>
              ) : (
                list.slice(0, 80).map((item, i) => (
                  <div
                    key={item.id}
                    className={`ss-item${i === hi ? ' ss-hi' : ''}`}
                    onMouseDown={() => pick(item)}
                    onMouseEnter={() => setHi(i)}
                  >
                    {renderItem(item)}
                  </div>
                ))
              )}
              {scanHint && <div className="ss-scan-tip">💡 {scanHint}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ImprumuturiPage() {
  const [imprumuturi, setImprumuturi] = useState([]);
  const [elevi,       setElevi]       = useState([]);
  const [carti,       setCarti]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [filter,      setFilter]      = useState('active');
  const [search,      setSearch]      = useState('');

  const today     = new Date();
  const [form, setForm] = useState({
    elevId:        '',
    carteId:       '',
    dataImprumut:  toInputDate(today),
    dataReturnare: toInputDate(addDays(today, 14)),
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [impSnap, elevSnap, carteSnap] = await Promise.all([
        getDocs(query(collection(db, 'imprumuturi'), orderBy('dataImprumut', 'desc'))),
        getDocs(query(collection(db, 'elevi'),       orderBy('nume'))),
        getDocs(query(collection(db, 'carti'),       orderBy('titlu'))),
      ]);
      setImprumuturi(impSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setElevi(elevSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCarti(carteSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* count active loans per book */
  const activeLoansPerBook = useMemo(() => {
    const map = {};
    imprumuturi.forEach(imp => {
      if (imp.stare === 'activ') map[imp.carteId] = (map[imp.carteId] || 0) + 1;
    });
    return map;
  }, [imprumuturi]);

  const availableCarti = carti.filter(c =>
    (c.numarExemplare || 1) > (activeLoansPerBook[c.id] || 0)
  );
  const unavailableCarti = carti.filter(c =>
    (c.numarExemplare || 1) <= (activeLoansPerBook[c.id] || 0)
  );

  const selectedCarte = carti.find(c => c.id === form.carteId);
  const selectedAvail = selectedCarte
    ? (selectedCarte.numarExemplare || 1) - (activeLoansPerBook[selectedCarte.id] || 0)
    : null;

  // carti sortate: disponibile intai, apoi dupa titlu
  const cartiSorted = useMemo(() => [...carti].sort((a, b) => {
    const aAvail = (a.numarExemplare || 1) - (activeLoansPerBook[a.id] || 0);
    const bAvail = (b.numarExemplare || 1) - (activeLoansPerBook[b.id] || 0);
    if ((aAvail > 0) !== (bAvail > 0)) return aAvail > 0 ? -1 : 1;
    return (a.titlu || '').localeCompare(b.titlu || '', 'ro');
  }), [carti, activeLoansPerBook]);

  /* ─── Add imprumut ─── */
  const addImprumut = async (e) => {
    e.preventDefault();
    const elev  = elevi.find(el => el.id === form.elevId);
    const carte = carti.find(c  => c.id  === form.carteId);
    if (!elev || !carte) { alert('Selecteaza elev si carte valide.'); return; }

    // check availability
    const taken = activeLoansPerBook[carte.id] || 0;
    if (taken >= (carte.numarExemplare || 1)) {
      alert('Nu exista exemplare disponibile pentru aceasta carte!'); return;
    }

    try {
      await addDoc(collection(db, 'imprumuturi'), {
        elevId:    elev.id,
        elevNume:  elev.nume,
        elevPrenume: elev.prenume,
        elevClasa: elev.clasa,
        carteId:   carte.id,
        carteTitlu: carte.titlu,
        carteAutor: carte.autor,
        dataImprumut:  Timestamp.fromDate(new Date(form.dataImprumut)),
        dataReturnare: Timestamp.fromDate(new Date(form.dataReturnare)),
        dataReturnareEfectiva: null,
        stare: 'activ',
      });
      setShowForm(false);
      resetForm();
      loadAll();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  /* ─── Return carte ─── */
  const returnCarte = async (imp) => {
    if (!confirm(`Marchezi returnarea cartii "${imp.carteTitlu}"?`)) return;
    try {
      await updateDoc(doc(db, 'imprumuturi', imp.id), {
        stare: 'returnat',
        dataReturnareEfectiva: Timestamp.now(),
      });
      loadAll();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  const resetForm = () => {
    const d = new Date();
    setForm({ elevId: '', carteId: '', dataImprumut: toInputDate(d), dataReturnare: toInputDate(addDays(d, 14)) });
  };

  /* ─── Filtered list ─── */
  const displayed = imprumuturi
    .map(imp => ({ ...imp, overdueFlag: isOverdue(imp) }))
    .filter(imp => {
      if (filter === 'active')    return imp.stare === 'activ' && !imp.overdueFlag;
      if (filter === 'intarziate') return imp.overdueFlag;
      if (filter === 'returnate')  return imp.stare === 'returnat';
      return true; // toate
    })
    .filter(imp =>
      `${imp.elevNume} ${imp.elevPrenume} ${imp.elevClasa} ${imp.carteTitlu}`
        .toLowerCase().includes(search.toLowerCase())
    );

  const counts = {
    toate:      imprumuturi.length,
    active:     imprumuturi.filter(i => i.stare === 'activ' && !isOverdue(i)).length,
    intarziate: imprumuturi.filter(i => isOverdue(i)).length,
    returnate:  imprumuturi.filter(i => i.stare === 'returnat').length,
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Gestiune Imprumuturi</h2>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          + Inregistreaza Imprumut
        </button>
      </div>

      {/* Stats */}
      <div className="cards-grid">
        <div className="stat-card blue">
          <div className="stat-value">{counts.active}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{counts.intarziate}</div>
          <div className="stat-label">Intarziate (&gt;14 zile)</div>
        </div>
        <div className="stat-card green">
          <div className="stat-value">{counts.returnate}</div>
          <div className="stat-label">Returnate</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-value">{counts.toate}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      {/* Overdue alert */}
      {counts.intarziate > 0 && (
        <div className="alert alert-danger">
          &#9888; <strong>{counts.intarziate} imprumut{counts.intarziate > 1 ? 'uri' : ''} intarziat{counts.intarziate > 1 ? 'e' : ''}!</strong>
          &nbsp;Carti nereturate in termenul de 14 zile.
        </div>
      )}

      {/* Filter tabs + search */}
      <div className="filter-tabs">
        {[
          { k: 'active',     label: `Active (${counts.active})` },
          { k: 'intarziate', label: `Intarziate (${counts.intarziate})` },
          { k: 'returnate',  label: `Returnate (${counts.returnate})` },
          { k: 'toate',      label: `Toate (${counts.toate})` },
        ].map(t => (
          <button key={t.k}
            className={`filter-tab ${filter === t.k ? 'active' : ''}`}
            onClick={() => setFilter(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="search-bar">
        <input className="search-input"
          placeholder="Cauta dupa elev, clasa sau carte..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{displayed.length} inregistrari</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Elev</th><th>Clasa</th><th>Carte</th>
                <th>Data Imprumut</th><th>Termen</th><th>Zile</th>
                <th>Stare</th><th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0
                ? <tr><td colSpan="9" className="empty-row">Nicio inregistrare gasita</td></tr>
                : displayed.map((imp, i) => {
                  const zile = imp.stare === 'activ' ? daysDiff(imp.dataImprumut) : null;
                  return (
                    <tr key={imp.id}
                      className={imp.overdueFlag ? 'overdue-row' : imp.stare === 'returnat' ? 'returned-row' : ''}>
                      <td>{i + 1}</td>
                      <td><strong>{imp.elevNume} {imp.elevPrenume}</strong></td>
                      <td><span className="badge badge-blue">{imp.elevClasa}</span></td>
                      <td>
                        <div>{imp.carteTitlu}</div>
                        <div style={{ fontSize: '.75rem', color: 'var(--g500)' }}>{imp.carteAutor}</div>
                      </td>
                      <td>{fmtDate(imp.dataImprumut)}</td>
                      <td>{fmtDate(imp.dataReturnare)}</td>
                      <td>
                        {zile !== null
                          ? <span style={{ color: zile > 14 ? 'var(--danger)' : 'var(--g700)', fontWeight: 600 }}>
                              {zile}z
                            </span>
                          : <span style={{ color: 'var(--g400)' }}>—</span>}
                      </td>
                      <td>
                        {imp.stare === 'returnat'
                          ? <span className="badge badge-green">Returnat {fmtDate(imp.dataReturnareEfectiva)}</span>
                          : imp.overdueFlag
                            ? <span className="badge badge-red">Intarziat</span>
                            : <span className="badge badge-yellow">Activ</span>}
                      </td>
                      <td>
                        {imp.stare === 'activ' && (
                          <button className="btn btn-sm btn-success"
                            onClick={() => returnCarte(imp)}>
                            &#10003; Returneaza
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>Inregistreaza Imprumut</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&#10005;</button>
            </div>
            <form className="form" onSubmit={addImprumut}>
              <div className="form-group">
                <label>Elev *</label>
                <SearchSelect
                  items={elevi}
                  value={form.elevId}
                  onChange={id => setForm(f => ({ ...f, elevId: id }))}
                  placeholder="Cauta dupa nume, prenume sau clasa..."
                  filterFn={(el, q) => `${el.nume} ${el.prenume} ${el.clasa} ${el.cnp || ''}`.toLowerCase().includes(q.toLowerCase())}
                  renderItem={el => (
                    <>
                      <div className="ss-item-title">
                        <span>{el.nume} {el.prenume}</span>
                        <span className="badge badge-blue">{el.clasa}</span>
                      </div>
                      {el.cnp && <div className="ss-item-sub">CNP: {el.cnp}</div>}
                    </>
                  )}
                  renderChip={el => (
                    <>
                      <span className="ss-chip-label">{el.nume} {el.prenume}</span>
                      <span className="badge badge-blue">{el.clasa}</span>
                    </>
                  )}
                />
              </div>

              <div className="form-group">
                <label>Carte * — {availableCarti.length} din {carti.length} disponibile</label>
                <SearchSelect
                  items={cartiSorted}
                  value={form.carteId}
                  onChange={id => setForm(f => ({ ...f, carteId: id }))}
                  placeholder="Cauta dupa titlu, autor sau ISBN..."
                  filterFn={(c, q) => `${c.titlu} ${c.autor} ${c.isbn || ''} ${c.gen || ''}`.toLowerCase().includes(q.toLowerCase())}
                  renderItem={c => {
                    const avail = (c.numarExemplare || 1) - (activeLoansPerBook[c.id] || 0);
                    const unavail = avail <= 0;
                    return (
                      <div className={unavail ? 'ss-item-unavail' : ''}>
                        <div className="ss-item-title">
                          <span>{c.titlu}</span>
                          <span className={`badge ${unavail ? 'badge-red' : avail <= Math.ceil((c.numarExemplare || 1) / 2) ? 'badge-yellow' : 'badge-green'}`}>
                            {unavail ? '✗ indisponibil' : `${avail} disp.`}
                          </span>
                        </div>
                        <div className="ss-item-sub">
                          {c.autor}{c.isbn ? ` · ISBN ${c.isbn}` : ''}
                        </div>
                      </div>
                    );
                  }}
                  renderChip={c => {
                    const avail = (c.numarExemplare || 1) - (activeLoansPerBook[c.id] || 0);
                    return (
                      <>
                        <span className="ss-chip-label">{c.titlu}</span>
                        <span className="ss-chip-sub">{c.autor}</span>
                        <span className={`badge ${avail <= 0 ? 'badge-red' : 'badge-green'}`}>
                          {avail} disp.
                        </span>
                      </>
                    );
                  }}
                  scanHint="Scaneaza codul de bare ISBN cu Zebra LS2208 si apasa Enter"
                />
              </div>

              {selectedAvail !== null && selectedAvail <= 0 && (
                <div style={{
                  background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
                  border: '2px solid #fca5a5',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  animation: 'slideDown .25s ease',
                }}>
                  <span style={{ fontSize: '2rem', lineHeight: 1 }}>📚</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#b91c1c', fontSize: '1rem', marginBottom: '4px' }}>
                      Niciun exemplar disponibil!
                    </div>
                    <div style={{ color: '#7f1d1d', fontSize: '.875rem' }}>
                      Toate cele <strong>{selectedCarte.numarExemplare || 1}</strong> exemplare din{' '}
                      <em>„{selectedCarte.titlu}"</em> sunt momentan imprumutate.
                      Alege alta carte sau asteapta returnarea.
                    </div>
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Data imprumut *</label>
                  <input type="date" required value={form.dataImprumut}
                    onChange={e => {
                      const d = new Date(e.target.value);
                      setForm({
                        ...form,
                        dataImprumut:  toInputDate(d),
                        dataReturnare: toInputDate(addDays(d, 14)),
                      });
                    }} />
                </div>
                <div className="form-group">
                  <label>Termen returnare *</label>
                  <input type="date" required value={form.dataReturnare}
                    onChange={e => setForm({ ...form, dataReturnare: e.target.value })} />
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                  Anuleaza
                </button>
                <button type="submit" className="btn btn-primary"
                  disabled={!form.elevId || !form.carteId || (selectedAvail !== null && selectedAvail <= 0)}>
                  Inregistreaza
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
