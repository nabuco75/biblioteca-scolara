import { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection, addDoc, getDocs, updateDoc,
  doc, query, orderBy, Timestamp, where,
} from 'firebase/firestore';
import { db } from '../firebase/config';

/* ─── helpers ─── */
const norm = s => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const fmtDate = (ts) => {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ro-RO');
};

const toDate = (ts) => {
  if (!ts) return new Date();
  return ts.toDate ? ts.toDate() : new Date(ts);
};

const daysDiff = (ts) => Math.floor((Date.now() - toDate(ts).getTime()) / 86_400_000);

const isOverdue = (imp) => imp.stare === 'activ' && daysDiff(imp.dataImprumut) > 14;

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
      if (open && list[hi]) { pick(list[hi]); return; }
      const raw = q.replace(/[-\s]/g, '');
      if (raw) {
        const exact = items.find(it => it.isbn && it.isbn.replace(/[-\s]/g, '') === raw);
        if (exact) { pick(exact); return; }
      }
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

/* ════════════════════════════════════════════════
   Main Page
   ════════════════════════════════════════════════ */
export default function ImprumuturiPage() {
  const [imprumuturi, setImprumuturi] = useState([]);
  const [elevi,       setElevi]       = useState([]);
  const [carti,       setCarti]       = useState([]); // title-level books
  const [copies,      setCopies]      = useState([]); // all copies
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [filter,      setFilter]      = useState('active');
  const [search,      setSearch]      = useState('');

  const today = new Date();
  const [form, setForm] = useState({
    elevId:        '',
    carteId:       '',  // book id (title level)
    copyId:        '',  // specific copy
    dataImprumut:  toInputDate(today),
    dataReturnare: toInputDate(addDays(today, 14)),
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [impSnap, elevSnap, carteSnap, copiesSnap] = await Promise.all([
        getDocs(query(collection(db, 'imprumuturi'), orderBy('dataImprumut', 'desc'))),
        getDocs(query(collection(db, 'elevi'),       orderBy('nume'))),
        getDocs(query(collection(db, 'carti'),       orderBy('titlu'))),
        getDocs(collection(db, 'copies')),
      ]);
      setImprumuturi(impSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setElevi(elevSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCarti(carteSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCopies(copiesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  /* ─── Copies disponibile per book ─── */
  const availableCopiesPerBook = useMemo(() => {
    const map = {}; // bookId → copies disponibile[]
    copies.forEach(c => {
      if (c.status === 'disponibil') {
        if (!map[c.bookId]) map[c.bookId] = [];
        map[c.bookId].push(c);
      }
    });
    return map;
  }, [copies]);

  /* ─── Books sortate: disponibile întâi ─── */
  const cartiSorted = useMemo(() => [...carti].sort((a, b) => {
    const aAvail = (availableCopiesPerBook[a.id] || []).length;
    const bAvail = (availableCopiesPerBook[b.id] || []).length;
    if ((aAvail > 0) !== (bAvail > 0)) return aAvail > 0 ? -1 : 1;
    return (a.titlu || '').localeCompare(b.titlu || '', 'ro');
  }), [carti, availableCopiesPerBook]);

  /* ─── Copii disponibile pentru cartea selectată ─── */
  const selectedBook       = carti.find(c => c.id === form.carteId);
  const availCopiesForBook = form.carteId ? (availableCopiesPerBook[form.carteId] || []) : [];

  /* Auto-selecteaza copia dacă e singura disponibilă */
  const handleBookSelect = (bookId) => {
    const avail = bookId ? (availableCopiesPerBook[bookId] || []) : [];
    setForm(f => ({
      ...f,
      carteId: bookId,
      copyId:  avail.length === 1 ? avail[0].id : '',
    }));
  };

  /* ─── Add imprumut ─── */
  const addImprumut = async (e) => {
    e.preventDefault();
    const elev  = elevi.find(el => el.id === form.elevId);
    const carte = carti.find(c => c.id === form.carteId);
    if (!elev || !carte) { alert('Selecteaza elev si carte valide.'); return; }

    const avail = availableCopiesPerBook[carte.id] || [];
    if (avail.length === 0) { alert('Nu exista exemplare disponibile pentru aceasta carte!'); return; }

    // Dacă nu s-a selectat o copie specifică, luăm prima disponibilă
    const copyId = form.copyId || avail[0].id;
    const copy   = copies.find(c => c.id === copyId);
    if (!copy) { alert('Exemplarul selectat nu mai este disponibil.'); return; }

    try {
      // 1. Creăm împrumutul
      await addDoc(collection(db, 'imprumuturi'), {
        elevId:      elev.id,
        elevNume:    elev.nume,
        elevPrenume: elev.prenume,
        elevClasa:   elev.clasa,
        carteId:  carte.id,        // book id (titlu)
        bookId:   carte.id,
        copyId:   copyId,          // exemplar specific
        carteTitlu:  carte.titlu,
        carteAutor:  carte.autor,
        nrInregistrare: copy.nrInregistrare || '',
        dataImprumut:  Timestamp.fromDate(new Date(form.dataImprumut)),
        dataReturnare: Timestamp.fromDate(new Date(form.dataReturnare)),
        dataReturnareEfectiva: null,
        stare: 'activ',
      });

      // 2. Marcăm copia ca împrumutată
      await updateDoc(doc(db, 'copies', copyId), { status: 'imprumutat' });

      setShowForm(false);
      resetForm();
      loadAll();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  /* ─── Return carte ─── */
  const returnCarte = async (imp) => {
    if (!confirm(`Marchezi returnarea cartii "${imp.carteTitlu}"?`)) return;
    try {
      // Actualizează împrumutul
      await updateDoc(doc(db, 'imprumuturi', imp.id), {
        stare: 'returnat',
        dataReturnareEfectiva: Timestamp.now(),
      });

      // Actualizează statusul copiei (dacă are copyId)
      if (imp.copyId) {
        await updateDoc(doc(db, 'copies', imp.copyId), { status: 'disponibil' });
      }

      loadAll();
    } catch (e) { alert('Eroare: ' + e.message); }
  };

  const resetForm = () => {
    const d = new Date();
    setForm({ elevId: '', carteId: '', copyId: '', dataImprumut: toInputDate(d), dataReturnare: toInputDate(addDays(d, 14)) });
  };

  /* ─── Filtered list ─── */
  const displayed = imprumuturi
    .map(imp => ({ ...imp, overdueFlag: isOverdue(imp) }))
    .filter(imp => {
      if (filter === 'active')     return imp.stare === 'activ' && !imp.overdueFlag;
      if (filter === 'intarziate') return imp.overdueFlag;
      if (filter === 'returnate')  return imp.stare === 'returnat';
      return true;
    })
    .filter(imp =>
      norm(`${imp.elevNume} ${imp.elevPrenume} ${imp.elevClasa} ${imp.carteTitlu} ${imp.nrInregistrare || ''}`)
        .includes(norm(search))
    );

  const counts = {
    toate:      imprumuturi.length,
    active:     imprumuturi.filter(i => i.stare === 'activ' && !isOverdue(i)).length,
    intarziate: imprumuturi.filter(i => isOverdue(i)).length,
    returnate:  imprumuturi.filter(i => i.stare === 'returnat').length,
  };

  const totalDisponibile = copies.filter(c => c.status === 'disponibil').length;
  const totalCopies      = copies.length;

  return (
    <div className="page">
      <div className="page-header">
        <h2>&#128214; Gestiune Împrumuturi</h2>
        <button className="btn btn-primary btn-hero" onClick={() => { resetForm(); setShowForm(true); }}>
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
          <div className="stat-value">{totalDisponibile}</div>
          <div className="stat-label">Exemplare disponibile{totalCopies ? ` (din ${totalCopies})` : ''}</div>
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
          placeholder="Cauta dupa elev, clasa, carte sau nr. inventar..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <span className="search-count">{displayed.length} inregistrari</span>
      </div>

      {loading ? <div className="loading">Se incarca...</div> : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Elev</th><th>Clasa</th>
                <th>Carte</th><th>Nr. Inv.</th>
                <th>Data Imprumut</th><th>Termen</th><th>Zile</th>
                <th>Stare</th><th>Actiuni</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0
                ? <tr><td colSpan="10" className="empty-row">Nicio inregistrare gasita</td></tr>
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
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                          {imp.nrInregistrare || '—'}
                        </span>
                      </td>
                      <td>{fmtDate(imp.dataImprumut)}</td>
                      <td>{fmtDate(imp.dataReturnare)}</td>
                      <td>
                        {zile !== null
                          ? <span style={{ color: zile > 14 ? 'var(--danger)' : 'var(--g700)', fontWeight: 600 }}>{zile}z</span>
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

      {/* ── Add Modal ── */}
      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>Inregistreaza Imprumut</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}>&#10005;</button>
            </div>
            <form className="form" onSubmit={addImprumut}>

              {/* ── Elev ── */}
              <div className="form-group">
                <label>Elev *</label>
                <SearchSelect
                  items={elevi}
                  value={form.elevId}
                  onChange={id => setForm(f => ({ ...f, elevId: id }))}
                  placeholder="Cauta dupa nume, prenume sau clasa..."
                  filterFn={(el, q) => {
                    const nq = norm(q);
                    return norm(el.nume).startsWith(nq)
                      || (nq.length >= 2 && norm(el.clasa).startsWith(nq))
                      || (el.cnp || '').startsWith(q);
                  }}
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

              {/* ── Carte (titlu) ── */}
              <div className="form-group">
                <label>
                  Carte * — {carti.filter(c => (availableCopiesPerBook[c.id] || []).length > 0).length} din {carti.length} au exemplare disponibile
                </label>
                <SearchSelect
                  items={cartiSorted}
                  value={form.carteId}
                  onChange={handleBookSelect}
                  placeholder="Cauta dupa titlu, autor sau ISBN..."
                  filterFn={(c, q) => {
                    const nq = norm(q);
                    return norm(c.titlu).includes(nq)
                      || norm(c.autor).includes(nq)
                      || (c.isbn || '').replace(/[-\s]/g, '').includes(q.replace(/[-\s]/g, ''))
                      || norm(c.gen).startsWith(nq);
                  }}
                  renderItem={c => {
                    const avail   = (availableCopiesPerBook[c.id] || []).length;
                    const total   = copies.filter(cp => cp.bookId === c.id).length;
                    const unavail = avail <= 0;
                    return (
                      <div className={unavail ? 'ss-item-unavail' : ''}>
                        <div className="ss-item-title">
                          <span>{c.titlu}</span>
                          <span className={`badge ${unavail ? 'badge-red' : avail <= Math.ceil(total / 2) ? 'badge-yellow' : 'badge-green'}`}>
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
                    const avail = (availableCopiesPerBook[c.id] || []).length;
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

              {/* ── Exemplar specific (apare după selectarea cărții) ── */}
              {form.carteId && (
                <div className="form-group">
                  <label>
                    Exemplar specific *
                    {availCopiesForBook.length > 0
                      ? ` — ${availCopiesForBook.length} disponibile`
                      : ' — niciun exemplar disponibil'}
                  </label>
                  {availCopiesForBook.length === 0 ? (
                    <div style={{
                      background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
                      border: '2px solid #fca5a5', borderRadius: '12px',
                      padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: '10px',
                    }}>
                      <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>📚</span>
                      <div>
                        <div style={{ fontWeight: 700, color: '#b91c1c', fontSize: '0.95rem', marginBottom: '2px' }}>
                          Niciun exemplar disponibil!
                        </div>
                        <div style={{ color: '#7f1d1d', fontSize: '.875rem' }}>
                          Toate exemplarele din <em>„{selectedBook?.titlu}"</em> sunt momentan împrumutate.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {availCopiesForBook.map(copy => (
                        <label key={copy.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.6rem',
                          padding: '0.5rem 0.75rem', borderRadius: 8, cursor: 'pointer',
                          background: form.copyId === copy.id ? 'var(--blue-50, #eff6ff)' : 'var(--g50, #f9fafb)',
                          border: `2px solid ${form.copyId === copy.id ? 'var(--primary, #2563eb)' : 'transparent'}`,
                          transition: 'all 0.15s',
                        }}>
                          <input
                            type="radio"
                            name="copySelect"
                            value={copy.id}
                            checked={form.copyId === copy.id}
                            onChange={() => setForm(f => ({ ...f, copyId: copy.id }))}
                            style={{ accentColor: 'var(--primary, #2563eb)' }}
                          />
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.95rem' }}>
                            {copy.nrInregistrare || `Exemplar fără nr.`}
                          </span>
                          <span className="badge badge-green" style={{ marginLeft: 'auto' }}>Disponibil</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Date ── */}
              <div className="form-row">
                <div className="form-group">
                  <label>Data imprumut *</label>
                  <input type="date" required value={form.dataImprumut}
                    onChange={e => {
                      const d = new Date(e.target.value);
                      setForm({ ...form, dataImprumut: toInputDate(d), dataReturnare: toInputDate(addDays(d, 14)) });
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
                  disabled={!form.elevId || !form.carteId || availCopiesForBook.length === 0}>
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
