import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'gluetun_gui_notifications_v1';
const PREFS_KEY = 'gluetun_gui_notification_prefs_v1';

const DEFAULT_PREFS = {
  enabled: true,
  sources: {
    settings: true,
    dashboard: true,
    monitor: true,
    logs: true,
  },
  levels: {
    info: true,
    success: true,
    warning: true,
    error: true,
  },
  toasts: {
    success: true,
    error: true,
    warning: false,
    info: false,
  },
};

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const addToast = useToast();
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? safeParse(raw) : null;
    if (Array.isArray(parsed)) setItems(parsed);

    const rawPrefs = localStorage.getItem(PREFS_KEY);
    const parsedPrefs = rawPrefs ? safeParse(rawPrefs) : null;
    if (parsedPrefs && typeof parsedPrefs === 'object') {
      setPrefs(prev => ({
        ...prev,
        ...parsedPrefs,
        sources: { ...prev.sources, ...(parsedPrefs.sources || {}) },
        levels: { ...prev.levels, ...(parsedPrefs.levels || {}) },
        toasts: { ...prev.toasts, ...(parsedPrefs.toasts || {}) },
      }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 200)));
  }, [items]);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const notify = useCallback((n) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const item = {
      id,
      createdAt: nowIso(),
      readAt: null,
      level: n?.level || 'info', // info | success | warning | error
      title: n?.title || 'Notification',
      message: n?.message || '',
      source: n?.source || null, // e.g. "monitor", "settings"
      dedupeKey: n?.dedupeKey || null,
    };

    if (!prefs.enabled) return;
    const src = item.source || 'unknown';
    if (prefs.sources && src in prefs.sources && prefs.sources[src] === false) return;
    if (prefs.levels && item.level in prefs.levels && prefs.levels[item.level] === false) return;

    setItems((prev) => {
      // simple dedupe: if last item has same dedupeKey within 10s, replace it
      if (item.dedupeKey && prev.length) {
        const last = prev[prev.length - 1];
        const dt = Date.parse(item.createdAt) - Date.parse(last.createdAt);
        if (last?.dedupeKey === item.dedupeKey && dt >= 0 && dt < 10_000) {
          return [...prev.slice(0, -1), { ...item, id: last.id }];
        }
      }
      return [...prev, item].slice(-200);
    });

    // Optional toast for high-signal events
    if (prefs.toasts?.[item.level]) {
      addToast(item.title, item.level === 'success' ? 'success' : (item.level === 'error' ? 'error' : 'success'));
    }
  }, [addToast, prefs]);

  const markAllRead = useCallback(() => {
    const ts = nowIso();
    setItems(prev => prev.map(i => (i.readAt ? i : { ...i, readAt: ts })));
  }, []);

  const markRead = useCallback((id) => {
    const ts = nowIso();
    setItems(prev => prev.map(i => (i.id === id ? { ...i, readAt: ts } : i)));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const unreadCount = useMemo(() => items.filter(i => !i.readAt).length, [items]);

  const value = useMemo(() => ({
    items,
    unreadCount,
    notify,
    markRead,
    markAllRead,
    clearAll,
    isOpen,
    setIsOpen,
    prefs,
    setPrefs,
  }), [items, unreadCount, notify, markRead, markAllRead, clearAll, isOpen]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}

