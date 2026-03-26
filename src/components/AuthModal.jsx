import { useState, useEffect, useRef } from 'react';

const VALID_USER = 'bibliotecarsc5vs';
const VALID_PASS = 'Scoala-5-vaslui';
const SESSION_KEY = 'bsc5_auth';

export function useAuth() {
  const [autentificat, setAutentificat] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === '1'
  );

  const login = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setAutentificat(true);
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAutentificat(false);
  };

  return { autentificat, login, logout };
}

export default function AuthModal({ onLogin }) {
  const [user, setUser]       = useState('');
  const [pass, setPass]       = useState('');
  const [showPass, setShowPass] = useState(false);
  const [eroare, setEroare]   = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake]     = useState(false);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setEroare('');
    setLoading(true);

    setTimeout(() => {
      if (user.trim() === VALID_USER && pass === VALID_PASS) {
        onLogin();
      } else {
        setLoading(false);
        setShake(true);
        setEroare('Utilizator sau parolă incorectă.');
        setPass('');
        setTimeout(() => setShake(false), 600);
      }
    }, 700);
  };

  return (
    <div className="auth-overlay">
      <div className={`auth-card ${shake ? 'auth-shake' : ''}`}>
        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo">&#128218;</div>
          <h1 className="auth-title">Biblioteca Scolara</h1>
          <p className="auth-subtitle">Scoala Nr. 5 Stefan cel Mare Vaslui</p>
          <div className="auth-badge">&#128274; Acces Restricționat</div>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-user">
              <span className="auth-label-icon">&#128100;</span>
              Utilizator
            </label>
            <input
              id="auth-user"
              ref={userRef}
              className="auth-input"
              type="text"
              value={user}
              onChange={e => { setUser(e.target.value); setEroare(''); }}
              placeholder="Introdu utilizatorul..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-pass">
              <span className="auth-label-icon">&#128272;</span>
              Parolă
            </label>
            <div className="auth-input-wrap">
              <input
                id="auth-pass"
                className="auth-input"
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={e => { setPass(e.target.value); setEroare(''); }}
                placeholder="Introdu parola..."
                autoComplete="new-password"
              />
              <button
                type="button"
                className="auth-toggle-pass"
                onClick={() => setShowPass(v => !v)}
                tabIndex={-1}
                aria-label={showPass ? 'Ascunde parola' : 'Afișează parola'}
              >
                {showPass ? '&#128065;' : '&#128064;'}
              </button>
            </div>
          </div>

          {eroare && (
            <div className="auth-error">
              <span>&#9888;</span> {eroare}
            </div>
          )}

          <button
            className="auth-btn"
            type="submit"
            disabled={loading || !user || !pass}
          >
            {loading
              ? <span className="auth-spinner" />
              : <><span>&#128275;</span> Autentificare</>
            }
          </button>
        </form>

        <p className="auth-footer">
          Sistem de management bibliotecă &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
