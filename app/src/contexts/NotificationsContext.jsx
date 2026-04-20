import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useToast } from './ToastContext';

const STORAGE_KEY = 'gluetun_gui_notifications_v1';
const PREFS_KEY = 'gluetun_gui_notification_prefs_v1';

/** Merge window for same `dedupeKey` (scan newest matching item, not only the list tail). */
const NOTIFICATION_DEDUPE_WINDOW_MS = 120_000;

function levelToToastType(level) {
  if (level === 'success') return 'success';
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  return 'info';
}

/**
 * @returns {{ next: typeof item[], didReplace: boolean }}
 */
function applyNotificationDedupe(prev, item, windowMs = NOTIFICATION_DEDUPE_WINDOW_MS) {
  if (!item.dedupeKey) {
    return { next: [...prev, item].slice(-200), didReplace: false };
  }
  const tNew = Date.parse(item.createdAt);
  for (let i = prev.length - 1; i >= 0; i -= 1) {
    const p = prev[i];
    if (p.dedupeKey !== item.dedupeKey) continue;
    const age = tNew - Date.parse(p.createdAt);
    if (age >= 0 && age <= windowMs) {
      return {
        next: [...prev.slice(0, i), { ...item, id: p.id }].slice(-200),
        didReplace: true,
      };
    }
    break;
  }
  return { next: [...prev, item].slice(-200), didReplace: false };
}

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
  /** Local browser time — suppress toast popups only (bell entries still apply). */
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
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

function parseHHMMToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function isLocalBrowserQuietHours(qh) {
  if (!qh?.enabled) return false;
  const st = parseHHMMToMinutes(qh.start ?? '22:00');
  const en = parseHHMMToMinutes(qh.end ?? '07:00');
  if (st === null || en === null) return false;
  const d = new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  if (st === en) return false;
  if (st < en) return cur >= st && cur < en;
  return cur >= st || cur < en;
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
        quietHours: { ...prev.quietHours, ...(parsedPrefs.quietHours || {}) },
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

    let didReplace = false;
    setItems((prev) => {
      const { next, didReplace: rep } = applyNotificationDedupe(prev, item);
      didReplace = rep;
      return next;
    });

    // Toast only for new bell rows — updates to the same dedupeKey refresh the panel silently
    const wantToast = prefs.toasts?.[item.level] && !isLocalBrowserQuietHours(prefs.quietHours);
    if (wantToast && !didReplace) {
      addToast(item.title, levelToToastType(item.level), {
        dedupeKey: item.dedupeKey || `${item.source || 'app'}:${item.level}:${item.title}`,
      });
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
  }), [items, unreadCount, notify, markRead, markAllRead, clearAll, isOpen, setIsOpen, prefs, setPrefs]);

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

