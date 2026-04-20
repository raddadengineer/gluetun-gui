export const DASHBOARD_WIDGET_STORAGE_KEY = 'gluetun_gui_dashboard_widgets_v1';

/** @type {{ id: string, label: string, description: string }[]} */
export const DASHBOARD_WIDGET_CATALOG = [
  { id: 'connection', label: 'VPN status', description: 'Provider, IP, uptime, image digest hints, last connectivity check.' },
  { id: 'protocol', label: 'Protocol', description: 'WireGuard / OpenVPN and MTU note.' },
  { id: 'resources', label: 'CPU & RAM', description: 'Container CPU and memory from Docker stats.' },
  { id: 'network', label: 'Live throughput', description: 'Current RX/TX speeds and cumulative totals.' },
  { id: 'throughputChart', label: 'Throughput chart', description: 'Recent tunnel throughput (KB/s) sparkline.' },
  { id: 'internalNetwork', label: 'Proxy & DNS toggles', description: 'Shadowsocks, HTTP proxy, adblock switches.' },
  { id: 'monitoring', label: 'PIA monitoring', description: 'Port forwarding and connectivity probe summary (when API returns data).' },
  { id: 'proxyPorts', label: 'Service ports', description: 'Quick reference for SOCKS, HTTP proxy, and Gluetun control ports.' },
  { id: 'dnsFirewall', label: 'DNS & firewall', description: 'DNS, DoT, and firewall-related env fields when present in the status snapshot.' },
];

export const DEFAULT_WIDGET_ORDER = DASHBOARD_WIDGET_CATALOG.map((w) => w.id);

/** Default positions on a 12-col grid (react-grid-layout). */
export const DEFAULT_RGL_LAYOUT = [
  { i: 'connection', x: 0, y: 0, w: 6, h: 12, minW: 4, minH: 8 },
  { i: 'protocol', x: 6, y: 0, w: 3, h: 5, minW: 2, minH: 3 },
  { i: 'resources', x: 9, y: 0, w: 3, h: 5, minW: 2, minH: 3 },
  { i: 'network', x: 6, y: 5, w: 6, h: 7, minW: 3, minH: 4 },
  { i: 'monitoring', x: 0, y: 12, w: 4, h: 7, minW: 3, minH: 4 },
  { i: 'proxyPorts', x: 4, y: 12, w: 4, h: 7, minW: 3, minH: 4 },
  { i: 'dnsFirewall', x: 8, y: 12, w: 4, h: 7, minW: 3, minH: 4 },
  { i: 'throughputChart', x: 0, y: 19, w: 12, h: 9, minW: 6, minH: 5 },
  { i: 'internalNetwork', x: 0, y: 28, w: 12, h: 10, minW: 4, minH: 6 },
];

const META = Object.fromEntries(
  DEFAULT_RGL_LAYOUT.map((it) => [it.i, { minW: it.minW ?? 2, minH: it.minH ?? 3 }]),
);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {unknown} raw
 * @returns {{ order: string[], hidden: Set<string> }}
 */
function legacyOrderHidden(raw) {
  const order = [];
  const hidden = new Set();

  if (raw && typeof raw === 'object' && Array.isArray(raw.order)) {
    const seen = new Set();
    for (const id of raw.order) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      if (!DEFAULT_WIDGET_ORDER.includes(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of DEFAULT_WIDGET_ORDER) {
      if (!seen.has(id)) order.push(id);
    }
  } else {
    order.push(...DEFAULT_WIDGET_ORDER);
  }

  if (raw && typeof raw === 'object' && raw.hidden && typeof raw.hidden === 'object') {
    for (const [k, v] of Object.entries(raw.hidden)) {
      if (v === true && DEFAULT_WIDGET_ORDER.includes(k)) hidden.add(k);
    }
  }

  if (
    raw && typeof raw === 'object'
    && Array.isArray(raw.visibleOrder)
    && !(raw.hidden && typeof raw.hidden === 'object' && Object.keys(raw.hidden).length)
  ) {
    const vis = new Set(raw.visibleOrder.filter((x) => typeof x === 'string'));
    for (const id of DEFAULT_WIDGET_ORDER) {
      if (!vis.has(id)) hidden.add(id);
    }
  }

  return { order, hidden };
}

/** @param {string[]} visibleIds */
export function buildLayoutFromTemplate(visibleIds) {
  const vis = new Set(visibleIds);
  return DEFAULT_RGL_LAYOUT
    .filter((it) => vis.has(it.i))
    .map((it) => ({ ...it }));
}

/** Bottom placement for a newly shown widget */
export function appendDefaultLayoutItem(layout, id) {
  const template = DEFAULT_RGL_LAYOUT.find((t) => t.i === id);
  let maxY = 0;
  for (const it of layout) {
    maxY = Math.max(maxY, it.y + it.h);
  }
  const base = template || { i: id, w: 6, h: 6, minW: 2, minH: 3 };
  return [...layout, { ...base, i: id, x: 0, y: maxY }];
}

/**
 * @param {unknown[]} rawLayout
 * @param {Set<string>} hidden
 */
function sanitizeLayout(rawLayout, hidden) {
  if (!Array.isArray(rawLayout)) return null;
  const out = [];
  for (const it of rawLayout) {
    if (!it || typeof it !== 'object' || typeof it.i !== 'string') continue;
    if (!DEFAULT_WIDGET_ORDER.includes(it.i)) continue;
    if (hidden.has(it.i)) continue;
    const m = META[it.i] || { minW: 2, minH: 3 };
    const wRaw = Math.floor(Number(it.w)) || m.minW;
    out.push({
      i: it.i,
      x: clamp(Math.floor(Number(it.x)) || 0, 0, 11),
      y: Math.max(0, Math.floor(Number(it.y)) || 0),
      w: clamp(wRaw, m.minW, 12),
      h: Math.max(Math.floor(Number(it.h)) || m.minH, m.minH),
      minW: m.minW,
      minH: m.minH,
    });
  }
  return out;
}

function ensureLayoutCoversVisible(layout, hidden) {
  const present = new Set(layout.map((l) => l.i));
  let next = [...layout];
  for (const id of DEFAULT_WIDGET_ORDER) {
    if (hidden.has(id) || present.has(id)) continue;
    next = appendDefaultLayoutItem(next, id);
    present.add(id);
  }
  return next.filter((l) => !hidden.has(l.i));
}

/**
 * @returns {{ hidden: Set<string>, layout: object[], layoutEditMode: boolean }}
 */
export function loadDashboardWidgetPrefs() {
  if (typeof localStorage === 'undefined') {
    return {
      hidden: new Set(),
      layout: buildLayoutFromTemplate(DEFAULT_WIDGET_ORDER),
      layoutEditMode: false,
    };
  }
  const parsed = safeParse(localStorage.getItem(DASHBOARD_WIDGET_STORAGE_KEY));
  if (!parsed || typeof parsed !== 'object') {
    return {
      hidden: new Set(),
      layout: buildLayoutFromTemplate(DEFAULT_WIDGET_ORDER),
      layoutEditMode: false,
    };
  }

  const hidden = new Set();
  if (parsed.hidden && typeof parsed.hidden === 'object') {
    for (const [k, v] of Object.entries(parsed.hidden)) {
      if (v === true && DEFAULT_WIDGET_ORDER.includes(k)) hidden.add(k);
    }
  }

  let layout = null;
  if (Array.isArray(parsed.layout) && parsed.layout.length) {
    layout = sanitizeLayout(parsed.layout, hidden);
  }
  if (!layout || layout.length === 0) {
    const { order, hidden: h2 } = legacyOrderHidden(parsed);
    for (const k of h2) hidden.add(k);
    const visible = order.filter((id) => !hidden.has(id));
    layout = buildLayoutFromTemplate(visible);
  }

  layout = ensureLayoutCoversVisible(layout, hidden);
  const layoutEditMode = parsed.layoutEditMode === true;
  return { hidden, layout, layoutEditMode };
}

/**
 * @param {Set<string>} hidden
 * @param {object[]} layout
 * @param {boolean} [layoutEditMode] if omitted, keeps existing value in storage
 */
export function saveDashboardWidgetPrefs(hidden, layout, layoutEditMode) {
  if (typeof localStorage === 'undefined') return;
  const prev = safeParse(localStorage.getItem(DASHBOARD_WIDGET_STORAGE_KEY)) || {};
  const lem = layoutEditMode === undefined ? prev.layoutEditMode === true : !!layoutEditMode;
  const hiddenObj = {};
  for (const id of hidden) {
    hiddenObj[id] = true;
  }
  const visibleLayout = layout.filter((l) => !hidden.has(l.i));
  localStorage.setItem(
    DASHBOARD_WIDGET_STORAGE_KEY,
    JSON.stringify({ hidden: hiddenObj, layout: visibleLayout, layoutEditMode: lem }),
  );
}

export function catalogMeta(id) {
  return DASHBOARD_WIDGET_CATALOG.find((w) => w.id === id);
}
