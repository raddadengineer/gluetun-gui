import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import NotificationsBell from './NotificationsBell';

const NARROW_MAX = 900;
const DESKTOP_COLLAPSED_KEY = 'gluetun_gui_sidebar_collapsed_desktop';

function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${NARROW_MAX}px)`).matches : false),
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return narrow;
}

export default function Sidebar() {
  const isNarrow = useIsNarrow();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(
    () => (typeof window !== 'undefined' ? localStorage.getItem(DESKTOP_COLLAPSED_KEY) === '1' : false),
  );
  const [desktopDrawerOpen, setDesktopDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isNarrow) setMobileOpen(false);
  }, [isNarrow]);

  const drawerOpen = isNarrow ? mobileOpen : (desktopCollapsed && desktopDrawerOpen);
  const drawerMode = (isNarrow && mobileOpen) || (!isNarrow && desktopCollapsed && desktopDrawerOpen);
  const showFloatingToggle = isNarrow || (!isNarrow && desktopCollapsed);

  useEffect(() => {
    const drawerBlocksScroll = (isNarrow && mobileOpen) || (!isNarrow && desktopCollapsed && desktopDrawerOpen);
    if (!drawerBlocksScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isNarrow, mobileOpen, desktopCollapsed, desktopDrawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (isNarrow) setMobileOpen(false);
        else setDesktopDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, isNarrow]);

  const closeDrawer = useCallback(() => {
    if (isNarrow) setMobileOpen(false);
    else setDesktopDrawerOpen(false);
  }, [isNarrow]);

  const afterNavClick = useCallback(() => {
    if (isNarrow) setMobileOpen(false);
    else if (desktopCollapsed) setDesktopDrawerOpen(false);
  }, [isNarrow, desktopCollapsed]);

  const collapseDesktopSidebar = useCallback(() => {
    setDesktopCollapsed(true);
    localStorage.setItem(DESKTOP_COLLAPSED_KEY, '1');
    setDesktopDrawerOpen(false);
  }, []);

  const pinDesktopSidebar = useCallback(() => {
    setDesktopCollapsed(false);
    localStorage.setItem(DESKTOP_COLLAPSED_KEY, '0');
    setDesktopDrawerOpen(false);
  }, []);

  const navClass = ({ isActive }) => `nav-item ${isActive ? 'active' : ''}`;

  const expanded = isNarrow ? mobileOpen : desktopDrawerOpen;
  const floatingIcon = expanded ? 'close' : 'menu';

  return (
    <div className={`sidebar-host${!isNarrow && desktopCollapsed ? ' sidebar-host--desktop-collapsed' : ''}`}>
      {showFloatingToggle && (
        <>
          <button
            type="button"
            className="sidebar-floating-toggle"
            aria-label={expanded ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={expanded}
            aria-controls="app-sidebar"
            onClick={() => {
              if (isNarrow) setMobileOpen((o) => !o);
              else setDesktopDrawerOpen((o) => !o);
            }}
          >
            <span className="material-icons-round">{floatingIcon}</span>
          </button>
          {drawerOpen && (
            <button
              type="button"
              className="sidebar-backdrop sidebar-backdrop-visible"
              aria-label="Close menu"
              tabIndex={-1}
              onClick={closeDrawer}
            />
          )}
        </>
      )}

      <aside
        id="app-sidebar"
        className={`sidebar${drawerOpen ? ' sidebar--open' : ''}${drawerMode ? ' sidebar--drawer-mode' : ''}`}
      >
        {drawerMode && (
          <div className="sidebar-drawer-header">
            <span className="material-icons-round logo-icon" style={{ fontSize: '28px', color: 'var(--accent-primary)' }}>vpn_key</span>
            <span style={{ fontWeight: 700, fontSize: '18px', letterSpacing: '-0.02em' }}>Gluetun</span>
            <button
              type="button"
              className="sidebar-drawer-close"
              aria-label="Close menu"
              onClick={closeDrawer}
            >
              <span className="material-icons-round">close</span>
            </button>
          </div>
        )}

        {!isNarrow && !desktopCollapsed && (
          <div className="sidebar-desktop-collapse-row">
            <button
              type="button"
              className="sidebar-collapse-desktop"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={collapseDesktopSidebar}
            >
              <span className="material-icons-round">keyboard_double_arrow_left</span>
              <span className="sidebar-collapse-desktop-label">Collapse</span>
            </button>
          </div>
        )}

        <div className="brand" style={drawerMode ? { marginBottom: '24px' } : undefined}>
          <span className="material-icons-round logo-icon">vpn_key</span>
          <h1>Gluetun</h1>
        </div>

        <nav className="nav-menu" aria-label="Main navigation">
          <p className="nav-section-label">Overview</p>
          <NavLink to="/" end className={navClass} onClick={afterNavClick}>
            <span className="material-icons-round">dashboard</span>
            Dashboard
          </NavLink>
          <NavLink to="/logs" className={navClass} onClick={afterNavClick}>
            <span className="material-icons-round">terminal</span>
            Logs
          </NavLink>
          <p className="nav-section-label">Tools</p>
          <NavLink to="/network" className={navClass} onClick={afterNavClick}>
            <span className="material-icons-round">network_check</span>
            Network
          </NavLink>
          <NavLink to="/settings" className={navClass} onClick={afterNavClick}>
            <span className="material-icons-round">settings</span>
            Settings
          </NavLink>
          <NavLink to="/about" className={navClass} onClick={afterNavClick}>
            <span className="material-icons-round">info</span>
            About
          </NavLink>
        </nav>

        {!isNarrow && desktopCollapsed && desktopDrawerOpen && (
          <div style={{ padding: '0 24px 16px' }}>
            <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={pinDesktopSidebar}>
              <span className="material-icons-round" style={{ fontSize: '18px' }}>push_pin</span>
              Keep sidebar open
            </button>
          </div>
        )}

        <div className="sidebar-footer" style={{ padding: '0 24px 24px' }}>
          <NotificationsBell />
          <button
            type="button"
            className="btn"
            style={{ width: '100%', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
            onClick={() => { localStorage.removeItem('token'); window.location.href = '/login'; }}
          >
            <span className="material-icons-round">logout</span>
            Logout
          </button>
        </div>
      </aside>
    </div>
  );
}
