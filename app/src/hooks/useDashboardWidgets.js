import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_WIDGET_ORDER,
  DASHBOARD_WIDGET_STORAGE_KEY,
  buildLayoutFromTemplate,
  loadDashboardWidgetPrefs,
  saveDashboardWidgetPrefs,
} from '../dashboard/dashboardWidgets';

export const DASHBOARD_WIDGETS_CHANGED = 'gluetun-dashboard-widgets-changed';

export function useDashboardWidgets() {
  const [hidden, setHidden] = useState(() => loadDashboardWidgetPrefs().hidden);
  const [layout, setLayout] = useState(() => loadDashboardWidgetPrefs().layout);
  const [layoutEditMode, setLayoutEditMode] = useState(() => loadDashboardWidgetPrefs().layoutEditMode);
  const saveTimerRef = useRef(0);

  useEffect(() => {
    const sync = () => {
      const p = loadDashboardWidgetPrefs();
      setHidden(p.hidden);
      setLayout(p.layout);
      setLayoutEditMode(p.layoutEditMode);
    };
    window.addEventListener(DASHBOARD_WIDGETS_CHANGED, sync);
    const onStorage = (e) => {
      if (e.key === DASHBOARD_WIDGET_STORAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DASHBOARD_WIDGETS_CHANGED, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveDashboardWidgetPrefs(hidden, layout, layoutEditMode);
    }, 400);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [hidden, layout, layoutEditMode]);

  const visibleOrderedIds = useMemo(
    () => [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x)).map((x) => x.i),
    [layout],
  );

  const resetDefaults = useCallback(() => {
    setHidden(new Set());
    setLayout(buildLayoutFromTemplate(DEFAULT_WIDGET_ORDER));
    setLayoutEditMode(false);
  }, []);

  /** Save current layout and turn off edit mode (flush, no debounce). */
  const persistAndLockLayout = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveDashboardWidgetPrefs(hidden, layout, false);
    setLayoutEditMode(false);
    window.dispatchEvent(new CustomEvent(DASHBOARD_WIDGETS_CHANGED));
  }, [hidden, layout]);

  return {
    layout,
    setLayout,
    hidden,
    setHidden,
    layoutEditMode,
    setLayoutEditMode,
    persistAndLockLayout,
    visibleOrderedIds,
    resetDefaults,
  };
}
