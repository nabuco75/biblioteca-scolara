import { useState } from 'react';
import EleviPage from './pages/EleviPage';
import CartiPage from './pages/CartiPage';
import ImprumuturiPage from './pages/ImprumuturiPage';
import RapoartePage from './pages/RapoartePage';

const TABS = [
  { id: 'elevi',        label: 'Elevi' },
  { id: 'carti',        label: 'Catalog Carti' },
  { id: 'imprumuturi',  label: 'Imprumuturi' },
  { id: 'rapoarte',     label: 'Rapoarte' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('elevi');

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-logo">&#128218;</div>
          <div className="header-text">
            <h1>Biblioteca Scolara</h1>
            <p>Scoala Nr. 5 Stefan cel Mare Vaslui</p>
          </div>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'elevi'       && <EleviPage />}
        {activeTab === 'carti'       && <CartiPage />}
        {activeTab === 'imprumuturi' && <ImprumuturiPage />}
        {activeTab === 'rapoarte'    && <RapoartePage />}
      </main>
    </div>
  );
}
