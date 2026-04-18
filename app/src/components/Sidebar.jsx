import { NavLink } from 'react-router-dom';
import NotificationsBell from './NotificationsBell';
import { useTheme } from '../contexts/ThemeContext';

export default function Sidebar() {
  const { theme, setTheme, themes } = useTheme();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="material-icons-round logo-icon">vpn_key</span>
        <h1>Gluetun</h1>
      </div>
      
      <nav className="nav-menu">
        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="material-icons-round">dashboard</span>
          Dashboard
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="material-icons-round">terminal</span>
          Logs
        </NavLink>
        <NavLink to="/network" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="material-icons-round">network_check</span>
          Network
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <span className="material-icons-round">settings</span>
          Settings
        </NavLink>
      </nav>

      <div style={{ marginTop: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <NotificationsBell />
        <div className="glass-panel" style={{ padding: '12px', borderRadius: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
            <span className="material-icons-round" style={{ fontSize: '18px' }}>palette</span>
            <strong style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Theme</strong>
          </div>
          <select
            className="select-input"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            style={{ width: '100%' }}
          >
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <button 
          className="btn" 
          style={{ width: '100%', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
          onClick={() => { localStorage.removeItem('token'); window.location.href = '/login'; }}
        >
          <span className="material-icons-round">logout</span>
          Logout
        </button>
      </div>
    </aside>
  );
}
