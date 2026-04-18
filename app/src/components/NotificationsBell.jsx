import { useEffect, useMemo, useRef } from 'react';
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

  useEffect(() => {
    const onDoc = (e) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [setIsOpen]);

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

      {isOpen && (
        <div className="notif-panel custom-scrollbar">
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
        </div>
      )}
    </div>
  );
}

