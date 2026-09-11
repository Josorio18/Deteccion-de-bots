import { NavLink, Route, Routes } from 'react-router-dom';
import Analyze from './pages/Analyze';
import Dashboard from './pages/Dashboard';
import TakeOrder from './pages/TakeOrder';
import WhatsAppSetup from './pages/WhatsAppSetup';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">RT</span>
          <div>
            <p className="brand-name">RespuestaTrack</p>
            <p className="brand-tag">Domicilios WhatsApp</p>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Analizar
          </NavLink>
          <NavLink to="/historial">Historial</NavLink>
          <NavLink to="/tomar">Tomar pedido</NavLink>
          <NavLink to="/whatsapp">WhatsApp API</NavLink>
        </nav>
        <p className="sidebar-foot">Sube · mide · estadísticas</p>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Analyze />} />
          <Route path="/historial" element={<Dashboard />} />
          <Route path="/tomar" element={<TakeOrder />} />
          <Route path="/whatsapp" element={<WhatsAppSetup />} />
        </Routes>
      </main>
    </div>
  );
}
