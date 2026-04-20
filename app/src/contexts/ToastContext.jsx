import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';

const ToastContext = createContext();

const DEFAULT_DURATION_MS = 3500;

const ICON_BY_TYPE = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const armTimer = useCallback(
    (id, durationMs) => {
      const prevTid = timersRef.current.get(id);
      if (prevTid) clearTimeout(prevTid);
      const tid = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((p) => p.filter((x) => x.id !== id));
      }, durationMs);
      timersRef.current.set(id, tid);
    },
    [],
  );

  useEffect(() => () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
  }, []);

  /**
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type]
   * @param {{ dedupeKey?: string, durationMs?: number }} [options]
   */
  const addToast = useCallback(
    (message, type = 'success', options = {}) => {
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
      const dedupeKey = options.dedupeKey;

      setToasts((prev) => {
        if (dedupeKey) {
          const existing = prev.find((t) => t.dedupeKey === dedupeKey);
          if (existing) {
            queueMicrotask(() => armTimer(existing.id, durationMs));
            return prev.map((t) =>
              t.dedupeKey === dedupeKey ? { ...t, message, type } : t,
            );
          }
        }

        const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        queueMicrotask(() => armTimer(id, durationMs));
        const row = { id, message, type, dedupeKey: dedupeKey || null };
        if (!dedupeKey) return [...prev, row];
        return [...prev.filter((t) => t.dedupeKey !== dedupeKey), row];
      });
    },
    [armTimer],
  );

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="material-icons-round">
              {ICON_BY_TYPE[t.type] || ICON_BY_TYPE.info}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
