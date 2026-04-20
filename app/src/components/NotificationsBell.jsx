import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '../contexts/NotificationsContext';

function levelIcon(level) {
  switch (level) {
    case 'success': return 'check_circle';
    case 'warning': return 'warning';
    case 'error': return 'error';
    default: return 'info';
  }
}

function levelColor(level) {
  switch (level) {
    case 'success': return 'var(--success)';
    case 'warning': return 'var(--warning)';
    case 'error': return 'var(--danger)';
    default: return 'var(--accent-primary)';
  }
}

export default function NotificationsBell() {
  const { items, unreadCount, isOpen, setIsOpen, markAllRead, clearAll, markRead } = useNotifications();
  const ref = useRef(null);
  const panelRef = useRef(null);
  const [side, setSide] = useState('right'); // 'right' | 'left'
  const [panelStyle, setPanelStyle] = useState(null);

  useEffect(() => {
    const onDoc = (e) => {
      const anchor = ref.current;
      const panel = panelRef.current;
      if (!anchor) return;
      const t = e.target;
      if (anchor.contains(t)) return;
      if (panel && panel.contains(t)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [setIsOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const decide = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const panelW = 360;
      const gap = 12;
      const wouldOverflowRight = rect.right + gap + panelW > window.innerWidth - 8;
      const wouldOverflowLeft = rect.left - gap - panelW < 8;
      if (wouldOverflowRight && !wouldOverflowLeft) setSide('left');
      else setSide('right');
    };
    decide();
    window.addEventListener('resize', decide);
    return () => window.removeEventListener('resize', decide);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const anchor = ref.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const pRect = panel.getBoundingClientRect();
      const gap = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(pRect.width || 360, vw - 16);
      const h = Math.min(pRect.height || 320, vh - 16);

      const leftWanted = rect.right + gap;
      const rightWanted = vw - rect.left + gap;

      const left = side === 'right' ? Math.min(leftWanted, vw - w - 8) : null;
      const right = side === 'left' ? Math.min(rightWanted, vw - w - 8) : null;

      const topWanted = rect.bottom - h;
      const top = Math.max(8, Math.min(topWanted, vh - h - 8));

      setPanelStyle({
        position: 'fixed',
        top,
        left,
        right,
        width: w,
        zIndex: 20000,
      });
    };
    // Place after the panel has rendered/measured.
    requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOpen, side]);

  const latest = useMemo(() => [...items].reverse().slice(0, 20), [items]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="nav-item"
        style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent', position: 'relative' }}
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
      >
        <span className="material-icons-round">notifications</span>
        Notifications
        {unreadCount > 0 && (
          <span style={{
            marginLeft: 'auto',
            minWidth: '20px',
            height: '20px',
            padding: '0 6px',
            borderRadius: '999px',
            background: 'rgba(59,130,246,0.25)',
            border: '1px solid rgba(59,130,246,0.35)',
            color: 'var(--text-primary)',
            fontSize: '12px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="notif-panel custom-scrollbar"
          style={panelStyle || { position: 'fixed', right: 8, bottom: 8, zIndex: 20000 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <strong style={{ fontSize: '14px' }}>Notifications</strong>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="btn" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={markAllRead}>Mark read</button>
              <button type="button" className="btn" style={{ padding: '6px 10px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)' }} onClick={clearAll}>Clear</button>
            </div>
          </div>

          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {latest.length === 0 ? (
              <div style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                No notifications yet.
              </div>
            ) : latest.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n.id)}
                className="notif-item"
                style={{ opacity: n.readAt ? 0.7 : 1 }}
              >
                <span className="material-icons-round" style={{ color: levelColor(n.level), fontSize: '18px', marginTop: '2px' }}>
                  {levelIcon(n.level)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                    <strong style={{ fontSize: '13px' }}>{n.title}</strong>
                    {!n.readAt && <span style={{ fontSize: '10px', color: 'var(--accent-primary)' }}>NEW</span>}
                  </div>
                  {n.message && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.message}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {new Date(n.createdAt).toLocaleString()}
                    {n.source ? ` • ${n.source}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

