import { useState } from 'react';
import EleviPage from './pages/EleviPage';
import CartiPage from './pages/CartiPage';
import ImprumuturiPage from './pages/ImprumuturiPage';
import RapoartePage from './pages/RapoartePage';
import RegistruInventarPage from './pages/RegistruInventarPage';
import AuthModal, { useAuth } from './components/AuthModal';

const TABS = [
  { id: 'elevi',             label: 'Elevi',             icon: '👥' },
  { id: 'carti',             label: 'Catalog Cărți',     icon: '📚' },
  { id: 'imprumuturi',       label: 'Împrumuturi',       icon: '📖' },
  { id: 'rapoarte',          label: 'Rapoarte',          icon: '📊' },
  { id: 'registru-inventar', label: 'Registru Inventar', icon: '📋' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('elevi');
  const { autentificat, login, logout } = useAuth();

  if (!autentificat) {
    return <AuthModal onLogin={login} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-brand">
            <div className="header-logo">&#128218;</div>
            <div className="header-text">
              <h1>Bibliotecă Școlară</h1>
              <p>Școala Gimnazială „Ștefan cel Mare" Vaslui</p>
            </div>
          </div>
          <button className="auth-logout-btn" onClick={logout} title="Deconectare">
            &#128275; Deconectare
          </button>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="nav-tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'elevi'             && <EleviPage />}
        {activeTab === 'carti'             && <CartiPage />}
        {activeTab === 'imprumuturi'       && <ImprumuturiPage />}
        {activeTab === 'rapoarte'          && <RapoartePage />}
        {activeTab === 'registru-inventar' && <RegistruInventarPage />}
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <span className="footer-copy">
            &copy; {new Date().getFullYear()} Școala Gimnazială „Ștefan cel Mare" Vaslui
          </span>
          <span className="footer-sep">·</span>
          <span className="footer-dev">
            Dezvoltat de <strong>Patrichi A. Ștefan</strong> — Persoană Fizică Autorizată
          </span>
        </div>
      </footer>
    </div>
  );
}
