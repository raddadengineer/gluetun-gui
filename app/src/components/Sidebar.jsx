import { NavLink } from 'react-router-dom';

export default function Sidebar() {
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
        <button 
          className="nav-item" 
          style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent' }}
          onClick={() => {
            const current = document.documentElement.getAttribute('data-theme');
            document.documentElement.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
          }}
        >
          <span className="material-icons-round">brightness_4</span>
          Toggle Theme
        </button>
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
