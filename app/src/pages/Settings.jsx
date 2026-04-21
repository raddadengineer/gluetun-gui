import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useNotifications } from '../contexts/NotificationsContext';
import ThemePicker from '../components/ThemePicker';
import {
  appendDefaultLayoutItem,
  buildLayoutFromTemplate,
  DASHBOARD_WIDGET_CATALOG,
  DEFAULT_WIDGET_ORDER,
  DASHBOARD_WIDGET_STORAGE_KEY,
  loadDashboardWidgetPrefs,
  saveDashboardWidgetPrefs,
} from '../dashboard/dashboardWidgets';
import { DASHBOARD_WIDGETS_CHANGED } from '../hooks/useDashboardWidgets';

function isGuiPiaProvider(v) {
  return String(v || '').trim().toLowerCase() === 'private internet access';
}

function isGuiOpenVpnType(v) {
  return String(v || '').trim().toLowerCase() === 'openvpn';
}

function isGuiWireGuardType(v) {
  return String(v || 'wireguard').trim().toLowerCase() === 'wireguard';
}

export default function Settings() {
  const location = useLocation();
  const { notify, prefs: notifyPrefs, setPrefs: setNotifyPrefs } = useNotifications();
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const [dashPrefs, setDashPrefs] = useState(() => {
    const p = loadDashboardWidgetPrefs();
    return { hidden: [...p.hidden], layout: p.layout.map((x) => ({ ...x })) };
  });
  const settingsFormRef = useRef(null);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [saveDiffModal, setSaveDiffModal] = useState({
    open: false,
    changes: [],
    pending: null,
    /** After successful apply from the diff modal, run outbound VPN probe. */
    runVpnProbeAfter: false,
  });

  // GUI auth password change (never pre-filled)
  const [guiPasswordNew, setGuiPasswordNew] = useState('');
  const [guiPasswordConfirm, setGuiPasswordConfirm] = useState('');
  const importEnvRef = useRef(null);
  const [homelabBackups, setHomelabBackups] = useState([]);
  const [homelabBackupBusy, setHomelabBackupBusy] = useState(false);
  const [diffHistoryOpen, setDiffHistoryOpen] = useState(false);
  const [diffHistoryEntries, setDiffHistoryEntries] = useState([]);
  const [diffHistoryLoading, setDiffHistoryLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState(null);
  const [engineStatusLoading, setEngineStatusLoading] = useState(false);
  const [engineStatusErr, setEngineStatusErr] = useState(null);

  const refreshHomelabBackups = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/homelab/backups', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      setHomelabBackups(Array.isArray(d.backups) ? d.backups : []);
    } catch {
      // ignore
    }
  }, []);

  const refreshEngineStatus = useCallback(async () => {
    setEngineStatusLoading(true);
    setEngineStatusErr(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to load engine status (${res.status})${text ? `: ${text}` : ''}`);
      }
      const data = await res.json();
      setEngineStatus(data);
    } catch (e) {
      setEngineStatus(null);
      setEngineStatusErr(e.message || 'Failed to load engine status');
    } finally {
      setEngineStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHomelabBackups();
  }, [refreshHomelabBackups]);

  useEffect(() => {
    if (activeTab !== 'application') return undefined;
    refreshEngineStatus();
    const id = setInterval(refreshEngineStatus, 60000);
    return () => clearInterval(id);
  }, [activeTab, refreshEngineStatus]);

  useEffect(() => {
    const st = location.state;
    if (!st || (!st.settingsTab && !st.scrollTo)) return;
    if (st.settingsTab) setActiveTab(st.settingsTab);
    if (st.scrollTo) {
      requestAnimationFrame(() => {
        document.getElementById(st.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [location.state, location.key]);

  useEffect(() => {
    const sameDash = (a, b) => [...a.hidden].sort().join(',') === [...b.hidden].sort().join(',')
      && JSON.stringify(a.layout) === JSON.stringify(b.layout);

    const sync = () => {
      const p = loadDashboardWidgetPrefs();
      setDashPrefs((prev) => {
        const next = { hidden: [...p.hidden], layout: p.layout.map((x) => ({ ...x })) };
        if (sameDash(prev, next)) return prev;
        return next;
      });
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

  const pushDashPrefs = useCallback((next) => {
    saveDashboardWidgetPrefs(new Set(next.hidden), next.layout, false);
    setDashPrefs({ hidden: [...next.hidden], layout: next.layout.map((x) => ({ ...x })) });
    window.dispatchEvent(new CustomEvent(DASHBOARD_WIDGETS_CHANGED));
  }, []);

  const toggleDashWidget = useCallback((id) => {
    setDashPrefs((prev) => {
      const h = new Set(prev.hidden);
      let layout = prev.layout.map((x) => ({ ...x }));
      if (h.has(id)) {
        h.delete(id);
        layout = appendDefaultLayoutItem(layout, id);
      } else {
        h.add(id);
        layout = layout.filter((l) => l.i !== id);
      }
      const hidden = [...h];
      saveDashboardWidgetPrefs(h, layout);
      window.dispatchEvent(new CustomEvent(DASHBOARD_WIDGETS_CHANGED));
      return { hidden, layout };
    });
  }, []);

  const resetDashWidgets = useCallback(() => {
    pushDashPrefs({ hidden: [], layout: buildLayoutFromTemplate(DEFAULT_WIDGET_ORDER) });
  }, [pushDashPrefs]);

  useEffect(() => {
    const root = settingsFormRef.current;
    if (!root) return;
    const q = settingsSearch.trim().toLowerCase();
    root.querySelectorAll('.form-group').forEach((el) => {
      const t = (el.textContent || '').toLowerCase();
      el.style.display = !q || t.includes(q) ? '' : 'none';
    });
  }, [settingsSearch, activeTab]);

  // PIA WireGuard state
  const [piaUsername, setPiaUsername] = useState('');
  const [piaPassword, setPiaPassword] = useState('');
  const [piaWgRegionsList, setPiaWgRegionsList] = useState([]);
  const [piaOpenVpnRegionsList, setPiaOpenVpnRegionsList] = useState([]);
  const [piaPortForwarding, setPiaPortForwarding] = useState(false);
  const [piaGenerating, setPiaGenerating] = useState(false);
  const [piaStatus, setPiaStatus] = useState(null);
  const [piaMonitoring, setPiaMonitoring] = useState(null);
  const [piaRegions, setPiaRegions] = useState([]);         // WireGuard regions (from PIA API)
  const [piaOpenVpnRegions, setPiaOpenVpnRegions] = useState([]); // PIA OpenVPN region labels for Gluetun SERVER_REGIONS
  const [fetchingPiaWgRegions, setFetchingPiaWgRegions] = useState(false);
  const [fetchingPiaOpenVpnList, setFetchingPiaOpenVpnList] = useState(false);

  // Dynamic server options state
  const [serverOptions, setServerOptions] = useState({ countries: [], regions: [], cities: [], hostnames: [], server_names: [] });
  const [fetchingServers, setFetchingServers] = useState(false);
  const [fetchingFiltered, setFetchingFiltered] = useState(false);

  // Load from `.env` via our backend
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setConfig(data);
        if (data.PIA_USERNAME) setPiaUsername(data.PIA_USERNAME);
        if (data.PIA_PASSWORD) setPiaPassword(data.PIA_PASSWORD);
        if (data.PIA_WG_REGIONS) setPiaWgRegionsList(data.PIA_WG_REGIONS.split(',').filter(Boolean));
        if (data.PIA_OPENVPN_REGIONS) setPiaOpenVpnRegionsList(data.PIA_OPENVPN_REGIONS.split(',').filter(Boolean));
        // Legacy PIA_REGIONS: never copy WireGuard-style ids into the OpenVPN list unless last save was OpenVPN
        if (!data.PIA_WG_REGIONS && !data.PIA_OPENVPN_REGIONS) {
          if (data.PIA_REGIONS) {
            setPiaWgRegionsList(data.PIA_REGIONS.split(',').filter(Boolean));
            if ((data.VPN_TYPE || '').toLowerCase() === 'openvpn') {
              setPiaOpenVpnRegionsList(data.PIA_REGIONS.split(',').filter(Boolean));
            }
          } else if (data.PIA_REGION) {
            setPiaWgRegionsList([data.PIA_REGION]);
            if ((data.VPN_TYPE || '').toLowerCase() === 'openvpn') {
              setPiaOpenVpnRegionsList([data.PIA_REGION]);
            }
          }
        }
        if (data.PIA_PORT_FORWARDING === 'true' || data.PIA_PORT_FORWARDING === 'on') setPiaPortForwarding(true);
      })
      .catch(console.error);

    fetch('/api/pia/status', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setPiaStatus(data))
      .catch(console.error);

    // Fetch PIA WireGuard regions via backend proxy (avoids CORS)
    fetch('/api/pia/regions')
      .then(r => r.json())
      .then(regions => { if (Array.isArray(regions)) setPiaRegions(regions); })
      .catch(console.error);

    // Initial monitoring fetch
    const fetchMonitoring = () => {
      fetch('/api/pia/monitoring', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Monitoring request failed: ${r.status}`);
          return r.json();
        })
        .then(data => {
          const safe = {
            failCount: Number.isFinite(Number(data?.failCount)) ? Number(data.failCount) : 0,
            pfFailCount: Number.isFinite(Number(data?.pfFailCount)) ? Number(data.pfFailCount) : 0,
            lastForwardedPort: data?.lastForwardedPort ?? null,
            checkInterval: Number.isFinite(Number(data?.checkInterval)) ? Number(data.checkInterval) : 30 * 1000,
          };
          setPiaMonitoring(safe);
        })
        .catch((err) => {
          console.error(err);
          // Avoid breaking UI with undefined/NaN values on auth/server errors
          setPiaMonitoring({
            failCount: 0,
            pfFailCount: 0,
            lastForwardedPort: null,
            checkInterval: 30 * 1000,
          });
        });
    };
    fetchMonitoring();
    const monitorInterval = setInterval(fetchMonitoring, 30000);
    return () => clearInterval(monitorInterval);
  }, []);

  const fetchPiaRegions = async () => {
    setFetchingPiaWgRegions(true);
    try {
      const pfQ = piaPortForwarding ? '?portForwardOnly=1' : '';
      const res = await fetch(`/api/pia/regions${pfQ}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch PIA regions (${res.status})${text ? `: ${text}` : ''}`);
      }
      const regions = await res.json();
      if (!Array.isArray(regions)) {
        throw new Error('Failed to fetch PIA regions: unexpected response');
      }
      setPiaRegions(regions);
      notify({
        level: 'success',
        title: 'Regions updated',
        message: `${regions.length} WireGuard region${regions.length === 1 ? '' : 's'} from PIA${piaPortForwarding ? ' (port-forwarding only)' : ''}.`,
        source: 'settings',
        dedupeKey: 'pia_wg_regions_ok',
      });
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: e.message || 'Failed to fetch PIA regions.' });
      notify({ level: 'error', title: 'PIA regions fetch failed', message: e.message, source: 'settings', dedupeKey: 'pia_regions_fetch' });
      setTimeout(() => setMessage(null), 4000);
    } finally {
      setFetchingPiaWgRegions(false);
    }
  };

  // When PF is enabled, limit WG region selection to PF-capable regions
  useEffect(() => {
    if (!piaPortForwarding) return;
    if (!Array.isArray(piaRegions) || piaRegions.length === 0) return;
    const pfIds = new Set(piaRegions.filter(r => r?.portForward).map(r => r.id));
    setPiaWgRegionsList(prev => prev.filter(id => pfIds.has(id)));
  }, [piaPortForwarding, piaRegions]);

  const displayPiaRegions = useMemo(() => {
    const list = Array.isArray(piaRegions) ? piaRegions : [];
    return piaPortForwarding ? list.filter(r => r?.portForward) : list;
  }, [piaPortForwarding, piaRegions]);

  const piaRegionNameById = useMemo(() => {
    const map = new Map();
    (Array.isArray(piaRegions) ? piaRegions : []).forEach(r => {
      if (r?.id) map.set(r.id, r.name || r.id);
    });
    return map;
  }, [piaRegions]);

  const wgFailoverOrderLabel = useMemo(() => {
    if (!piaWgRegionsList.length) return 'None selected';
    return piaWgRegionsList.map(id => piaRegionNameById.get(id) || id).join(' ➜ ');
  }, [piaRegionNameById, piaWgRegionsList]);

  const fetchPiaOpenVpnRegions = useCallback(async (opts) => {
    const userClick = opts?.userInitiated === true;
    setFetchingPiaOpenVpnList(true);
    try {
      const token = localStorage.getItem('token');
      const portForwardGui =
        piaPortForwarding || String(config.VPN_PORT_FORWARDING || '').toLowerCase() === 'on';
      const pfQ = portForwardGui ? '&portForwardOnly=1' : '';
      const res = await fetch(
        `/api/helpers/servers?provider=private%20internet%20access&vpnType=openvpn${pfQ}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to fetch PIA OpenVPN servers (${res.status})${text ? `: ${text}` : ''}`);
      }
      const data = await res.json();
      if (data.unknownProvider) {
        throw new Error('Provider not found in Gluetun server list (servers.json).');
      }
      // Gluetun validates PIA OpenVPN SERVER_REGIONS against region labels (e.g. "DE Berlin"); legacy server_name codes are mapped on save.
      const names = [...(data.server_names || [])].filter(Boolean);
      const combined = names.length
        ? Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))
        : Array.from(new Set([...(data.regions || []), ...(data.countries || [])])).sort((a, b) => a.localeCompare(b));
      if (combined.length === 0) {
        throw new Error(
          'No regions returned (empty list). If VPN port forwarding is on, try disabling it to load all OpenVPN regions, or check the server can reach GitHub (servers.json).',
        );
      }
      setPiaOpenVpnRegions(combined);
      if (userClick) {
        notify({
          level: 'success',
          title: 'OpenVPN server list updated',
          message: `${combined.length} region${combined.length === 1 ? '' : 's'} loaded.`,
          source: 'settings',
          dedupeKey: 'pia_ov_fetch_ok',
        });
      }
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: e.message || 'Failed to fetch PIA OpenVPN servers.' });
      notify({ level: 'error', title: 'PIA OpenVPN list failed', message: e.message, source: 'settings', dedupeKey: 'pia_ov_fetch' });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setFetchingPiaOpenVpnList(false);
    }
  }, [notify, piaPortForwarding, config.VPN_PORT_FORWARDING]);

  useEffect(() => {
    if (!isGuiPiaProvider(config.VPN_SERVICE_PROVIDER)) return;
    if (!isGuiOpenVpnType(config.VPN_TYPE)) return;
    fetchPiaOpenVpnRegions();
  }, [config.VPN_SERVICE_PROVIDER, config.VPN_TYPE, piaPortForwarding, config.VPN_PORT_FORWARDING, fetchPiaOpenVpnRegions]);

  useEffect(() => {
    if (!piaOpenVpnRegions.length) return;
    const allow = new Set(piaOpenVpnRegions);
    setPiaOpenVpnRegionsList(prev => {
      const next = prev.filter(x => allow.has(x));
      return next.length !== prev.length ? next : prev;
    });
  }, [piaOpenVpnRegions]);

  const fetchServerOptions = async () => {
    setFetchingServers(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `/api/helpers/servers?provider=${encodeURIComponent(config.VPN_SERVICE_PROVIDER || '')}&vpnType=${config.VPN_TYPE || 'wireguard'}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Failed to fetch servers (${res.status})`;
        throw new Error(typeof msg === 'string' ? msg : `Failed to fetch servers (${res.status})`);
      }
      if (data.unknownProvider) {
        throw new Error(
          `Unknown provider "${config.VPN_SERVICE_PROVIDER || ''}" for Gluetun. Use the exact name from Gluetun (e.g. mullvad, nordvpn, private internet access).`,
        );
      }
      // Base fetch: all countries always come back unfiltered from backend
      setServerOptions({
        countries: data.countries || [],
        regions: data.regions || [],
        cities: data.cities || [],
        hostnames: data.hostnames || [],
        server_names: data.server_names || [],
      });
    } catch (e) {
      console.error('Failed to fetch servers:', e);
      setMessage({ type: 'error', text: e.message || 'Failed to fetch servers.' });
      notify({ level: 'error', title: 'Server list failed', message: e.message, source: 'settings', dedupeKey: 'generic_servers_fetch' });
      setTimeout(() => setMessage(null), 5000);
    }
    setFetchingServers(false);
  };

  // Re-fetch filtered server options whenever country/region selection changes
  const fetchFilteredOptions = async (selectedCountries, selectedRegions) => {
    if (!config.VPN_SERVICE_PROVIDER || serverOptions.countries.length === 0) return;
    setFetchingFiltered(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        provider: config.VPN_SERVICE_PROVIDER || '',
        vpnType: config.VPN_TYPE || 'wireguard',
      });
      if (selectedCountries) params.set('country', selectedCountries);
      if (selectedRegions) params.set('region', selectedRegions);
      const res = await fetch(`/api/helpers/servers?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.unknownProvider) return;
        // Merge: always keep full country list from original fetch, update the rest
        setServerOptions(prev => ({
          countries: prev.countries,
          regions: data.regions || [],
          cities: data.cities || [],
          hostnames: data.hostnames || [],
          server_names: data.server_names || [],
        }));
      }
    } catch (e) {
      console.error('Failed to fetch filtered servers:', e);
    }
    setFetchingFiltered(false);
  };

  // (removed unused renderPills helper)

  // Linked pill renderer — uses handlePillClick for cascading filter propagation
  const renderLinkedPills = (list, fieldName) => {
    if (!list || list.length === 0) return null;
    return (
      <div className="custom-scrollbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px', maxHeight: '120px', overflowY: 'auto', padding: '6px', background: 'var(--surface-1)', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
        {list.map(name => {
          const isSelected = (config[fieldName] || '').split(',').map(s => s.trim()).includes(name);
          return (
            <span
              key={name}
              onClick={() => handlePillClick(fieldName, name)}
              title={name}
              style={{
                fontSize: '11px', padding: '4px 9px',
                background: isSelected ? 'var(--accent-primary)' : 'var(--glass-bg)',
                border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s',
                color: isSelected ? '#fff' : 'inherit',
                maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'inline-flex', alignItems: 'center', gap: '4px',
              }}
              onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-3)'; }}
              onMouseOut={e => { if (!isSelected) e.currentTarget.style.background = 'var(--glass-bg)'; }}
            >
              {isSelected && <span className="material-icons-round" style={{ fontSize: '10px' }}>check</span>}
              {name}
            </span>
          );
        })}
      </div>
    );
  };

  const buildSaveData = (baseConfig) => {
    const activePiaRegions = isGuiOpenVpnType(baseConfig?.VPN_TYPE || config.VPN_TYPE)
      ? piaOpenVpnRegionsList.join(',')
      : piaWgRegionsList.join(',');
    const saveData = {
      ...(baseConfig || config),
      PIA_REGIONS: activePiaRegions,
      PIA_WG_REGIONS: piaWgRegionsList.join(','),
      PIA_OPENVPN_REGIONS: piaOpenVpnRegionsList.join(','),
      PIA_PORT_FORWARDING: piaPortForwarding ? 'true' : 'false',
      // Always persist credentials when present (Generate uses them anyway)
      PIA_USERNAME: piaUsername,
      PIA_PASSWORD: piaPassword,
    };
    // Gluetun OpenVPN auth uses OPENVPN_* only; copy from PIA_* when OpenVPN fields are empty (same PIA login).
    if (isGuiPiaProvider(saveData.VPN_SERVICE_PROVIDER) && isGuiOpenVpnType(saveData.VPN_TYPE)) {
      if (!String(saveData.OPENVPN_USER || '').trim() && piaUsername) saveData.OPENVPN_USER = piaUsername;
      if (!String(saveData.OPENVPN_PASSWORD || '').trim() && piaPassword) saveData.OPENVPN_PASSWORD = piaPassword;
    }
    if (guiPasswordNew || guiPasswordConfirm) {
      if (guiPasswordNew.length < 6) {
        throw new Error('New password must be at least 6 characters.');
      }
      if (guiPasswordNew !== guiPasswordConfirm) {
        throw new Error('New password and confirmation do not match.');
      }
      saveData.GUI_PASSWORD = guiPasswordNew;
    }
    return saveData;
  };

  const handlePiaGenerate = async () => {
    setPiaGenerating(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');

      // Save all settings first so Generate/Connect is always consistent.
      const saveRes = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(buildSaveData()),
      });
      if (!saveRes.ok) {
        const errData = await saveRes.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to save settings (${saveRes.status})`);
      }
      // Clear password fields if we just changed it successfully
      if (guiPasswordNew) {
        setGuiPasswordNew('');
        setGuiPasswordConfirm('');
      }

      const res = await fetch('/api/pia/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          PIA_USERNAME: piaUsername,
          PIA_PASSWORD: piaPassword,
          PIA_REGIONS: piaWgRegionsList.join(','),
          PIA_WG_REGIONS: piaWgRegionsList.join(','),
          PIA_OPENVPN_REGIONS: piaOpenVpnRegionsList.join(','),
          PIA_PORT_FORWARDING: piaPortForwarding ? 'true' : 'false'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
        setPiaStatus({ state: 'success', message: data.message, lastGenerated: data.generatedAt, failCount: 0 });
        notify({
          level: 'success',
          title: 'WireGuard keys generated',
          message: (data.message || '').slice(0, 200),
          source: 'settings',
          dedupeKey: 'pia_generate_ok',
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Generation failed.' });
        setPiaStatus({ state: 'error', message: data.error, lastGenerated: null, failCount: (piaStatus?.failCount || 0) + 1 });
        notify({
          level: 'error',
          title: 'Key generation failed',
          message: data.error || 'Generation failed.',
          source: 'settings',
          dedupeKey: 'pia_generate_err',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      notify({ level: 'error', title: 'Key generation failed', message: err.message, source: 'settings', dedupeKey: 'pia_generate_exc' });
    }
    setPiaGenerating(false);
    setTimeout(() => setMessage(null), 5000);
  };

  const handleChange = (e, afterChange) => {
    const value = e.target.type === 'checkbox' ? (e.target.checked ? 'on' : 'off') : e.target.value;
    const newConfig = { ...config, [e.target.name]: value };
    setConfig(newConfig);
    if (afterChange) afterChange(newConfig);
  };

  // Called when server field pill is clicked — updates config and re-filters downstream
  const handleServerFieldChange = (fieldName, newValue, newConfig) => {
    const allConfig = newConfig || { ...config, [fieldName]: newValue };
    const selectedCountries = fieldName === 'SERVER_COUNTRIES' ? newValue : (allConfig.SERVER_COUNTRIES || '');
    const selectedRegions = fieldName === 'SERVER_REGIONS' ? newValue : (allConfig.SERVER_REGIONS || '');
    // Only re-fetch if we have server data already loaded
    if (serverOptions.countries.length > 0) {
      fetchFilteredOptions(
        selectedCountries || undefined,
        selectedRegions || undefined,
      );
    }
  };

  // Pill click handler that also cascades downstream filter re-fetch
  const handlePillClick = (fieldName, name) => {
    const current = config[fieldName] ? config[fieldName].split(',').map(s => s.trim()).filter(Boolean) : [];
    const newList = current.includes(name)
      ? current.filter(n => n !== name)
      : [...current, name];
    const newValue = newList.join(', ');
    const newConfig = { ...config, [fieldName]: newValue };

    // Clear downstream selections when a parent filter changes
    if (fieldName === 'SERVER_COUNTRIES') {
      newConfig.SERVER_REGIONS = '';
      newConfig.SERVER_CITIES = '';
      newConfig.SERVER_HOSTNAMES = '';
      newConfig.SERVER_NAMES = '';
    } else if (fieldName === 'SERVER_REGIONS') {
      newConfig.SERVER_CITIES = '';
      newConfig.SERVER_HOSTNAMES = '';
      newConfig.SERVER_NAMES = '';
    }

    setConfig(newConfig);
    handleServerFieldChange(fieldName, newValue, newConfig);
  };

  const runConfigPost = async (saveData) => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(saveData)
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const extra =
        Array.isArray(data.containerDiff) && data.containerDiff.length
          ? ` Gluetun env delta: ${data.containerDiff.length} key(s).`
          : '';
      setMessage({ type: 'success', text: (data.message || 'All settings securely saved to .env file!') + extra });
      notify({
        level: 'success',
        title: 'Settings saved',
        message: `${(data.message || 'Configuration written and Gluetun updated.').slice(0, 200)}${extra}`.slice(0, 280),
        source: 'settings',
        dedupeKey: 'settings_save_ok',
      });
      if (guiPasswordNew) {
        setGuiPasswordNew('');
        setGuiPasswordConfirm('');
        notify({
          level: 'success',
          title: 'GUI password updated',
          message: 'Use the new password next time you sign in.',
          source: 'settings',
          dedupeKey: 'gui_password_changed',
        });
      }
      return true;
    }
    const errData = await res.json().catch(() => ({}));
    setMessage({ type: 'error', text: errData.error || `Server returned ${res.status}: ${res.statusText}` });
    notify({
      level: 'error',
      title: 'Save failed',
      message: errData.error || `Server returned ${res.status}`,
      source: 'settings',
      dedupeKey: 'settings_save_err',
    });
    return false;
  };

  const runConnectivityProbeAfterSave = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/vpn/connectivity-test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) {
      notify({
        level: 'success',
        title: 'VPN connectivity OK',
        message: `Public IP: ${data.publicIp || '—'} (${data.method || 'probe'})`,
        source: 'settings',
        dedupeKey: 'settings_vpn_probe_ok',
      });
    } else {
      notify({
        level: 'warning',
        title: 'VPN check after save',
        message: (data.detail || data.error || 'Probe did not confirm outbound traffic').slice(0, 240),
        source: 'settings',
        dedupeKey: 'settings_vpn_probe_fail',
      });
    }
  };

  const openSavePreview = async (alsoRunVpnProbe) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const saveData = buildSaveData();
      const previewRes = await fetch('/api/config/preview-diff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(saveData)
      });
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        throw new Error(preview.error || `Could not compare configuration (${previewRes.status})`);
      }
      const changes = preview.changes || [];
      if (changes.length === 0) {
        if (alsoRunVpnProbe) {
          setMessage({ type: 'success', text: 'No configuration changes. Running connectivity check…' });
          await runConnectivityProbeAfterSave();
        } else {
          setMessage({ type: 'success', text: 'No changes to save.' });
        }
        setSaving(false);
        setTimeout(() => setMessage(null), 3000);
        return;
      }
      setSaveDiffModal({ open: true, changes, pending: saveData, runVpnProbeAfter: !!alsoRunVpnProbe });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      notify({ level: 'error', title: 'Save failed', message: err.message, source: 'settings', dedupeKey: 'settings_save_exc' });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    await openSavePreview(false);
  };

  const handleSaveAndConnect = async (e) => {
    e?.preventDefault();
    await openSavePreview(true);
  };

  const confirmSaveAfterDiff = async () => {
    const pending = saveDiffModal.pending;
    const runProbeAfter = !!saveDiffModal.runVpnProbeAfter;
    if (!pending) return;
    setSaveDiffModal({ open: false, changes: [], pending: null, runVpnProbeAfter: false });
    setSaving(true);
    try {
      const ok = await runConfigPost(pending);
      if (ok && runProbeAfter) {
        try {
          await runConnectivityProbeAfterSave();
        } catch (probeErr) {
          notify({
            level: 'error',
            title: 'Connectivity check failed',
            message: probeErr.message,
            source: 'settings',
            dedupeKey: 'settings_vpn_probe_exc',
          });
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      notify({ level: 'error', title: 'Save failed', message: err.message, source: 'settings', dedupeKey: 'settings_save_exc' });
    }
    setSaving(false);
    setTimeout(() => setMessage(null), 3000);
  };

  const downloadConfigExport = async (redact) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/config/export?redact=${redact ? '1' : '0'}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = redact ? 'gluetun-gui-config-redacted.env' : 'gluetun-gui-config.env';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify({
        level: 'success',
        title: 'Configuration downloaded',
        message: redact ? 'Secrets replaced with __REDACTED__ (safe to paste).' : 'Full backup — keep this file private.',
        source: 'settings',
        dedupeKey: 'config_export',
      });
    } catch (err) {
      notify({ level: 'error', title: 'Export failed', message: err.message, source: 'settings', dedupeKey: 'config_export_err' });
    }
  };

  const handleImportEnvFile = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (!window.confirm(
        'Import replaces your saved GUI configuration and recreates the Gluetun container from the file. Continue?'
      )) {
        return;
      }
      const token = localStorage.getItem('token');
      const res = await fetch('/api/config/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ envText: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }
      notify({
        level: 'success',
        title: 'Configuration imported',
        message: (data.message || `Imported ${data.keyCount != null ? data.keyCount + ' keys' : 'settings'}.`).slice(0, 220),
        source: 'settings',
        dedupeKey: 'config_import',
      });
      const cfgRes = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
      if (cfgRes.ok) {
        const dataCfg = await cfgRes.json();
        setConfig(dataCfg);
        if (dataCfg.PIA_USERNAME) setPiaUsername(dataCfg.PIA_USERNAME);
        if (dataCfg.PIA_PASSWORD) setPiaPassword(dataCfg.PIA_PASSWORD);
        if (dataCfg.PIA_WG_REGIONS) setPiaWgRegionsList(dataCfg.PIA_WG_REGIONS.split(',').filter(Boolean));
        if (dataCfg.PIA_OPENVPN_REGIONS) setPiaOpenVpnRegionsList(dataCfg.PIA_OPENVPN_REGIONS.split(',').filter(Boolean));
        if (dataCfg.PIA_PORT_FORWARDING === 'true' || dataCfg.PIA_PORT_FORWARDING === 'on') setPiaPortForwarding(true);
        else if (dataCfg.PIA_PORT_FORWARDING === 'false' || dataCfg.PIA_PORT_FORWARDING === 'off') setPiaPortForwarding(false);
      }
    } catch (err) {
      notify({ level: 'error', title: 'Import failed', message: err.message, source: 'settings', dedupeKey: 'config_import_err' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <header className="header" style={{ marginBottom: 0 }}>
          <div className="header-title">
            <h2>Settings</h2>
            <p>VPN and container settings are grouped by topic; GUI-only options are under <strong style={{ fontWeight: 600 }}>This app</strong>.</p>
          </div>
        </header>

        <button type="button" onClick={handleSave} className="btn btn-primary" disabled={saving}>
          <span className="material-icons-round">save</span>
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>

      {message && (
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          background: message.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
          border: `1px solid ${message.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          color: message.type === 'success' ? 'var(--success)' : 'var(--danger)'
        }}>
          {message.text}
        </div>
      )}

      <div className="settings-search-bar glass-panel" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span className="material-icons-round" style={{ color: 'var(--text-secondary)' }}>search</span>
        <input
          type="search"
          className="text-input"
          placeholder="Filter fields on this tab (labels & values)…"
          value={settingsSearch}
          onChange={(e) => setSettingsSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px', margin: 0 }}
          aria-label="Filter settings"
        />
        {settingsSearch.trim() && (
          <button type="button" className="btn" onClick={() => setSettingsSearch('')} style={{ padding: '6px 12px', fontSize: '13px' }}>
            Clear
          </button>
        )}
      </div>

      <div className="tabs-container">
        <button className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
          <span className="material-icons-round">vpn_key</span> VPN &amp; tunnel
        </button>
        <button className={`tab-btn ${activeTab === 'network' ? 'active' : ''}`} onClick={() => setActiveTab('network')}>
          <span className="material-icons-round">router</span> Firewall &amp; ports
        </button>
        <button className={`tab-btn ${activeTab === 'dns' ? 'active' : ''}`} onClick={() => setActiveTab('dns')}>
          <span className="material-icons-round">dns</span> DNS &amp; blocklists
        </button>
        <button className={`tab-btn ${activeTab === 'proxies' ? 'active' : ''}`} onClick={() => setActiveTab('proxies')}>
          <span className="material-icons-round">cell_wifi</span> Local proxies
        </button>
        <button className={`tab-btn ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>
          <span className="material-icons-round">settings_applications</span> Gluetun advanced
        </button>
        <button className={`tab-btn ${activeTab === 'application' ? 'active' : ''}`} onClick={() => setActiveTab('application')}>
          <span className="material-icons-round">widgets</span> This app
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '32px' }}>
        <form ref={settingsFormRef} onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {activeTab === 'general' && (
            <>
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ fontSize: '20px', color: 'var(--accent-primary)' }}>cloud</span>
                Provider &amp; protocol
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
                Choose who you connect through and whether Gluetun uses WireGuard or OpenVPN. Provider-specific options appear below.
              </p>
              <div className="form-group">
                <label>VPN Service Provider</label>
                <select name="VPN_SERVICE_PROVIDER" value={config.VPN_SERVICE_PROVIDER || ''} onChange={handleChange} className="select-input">
                  <option value="">Select a provider...</option>
                  <option value="airvpn">AirVPN</option>
                  <option value="custom">Custom</option>
                  <option value="cyberghost">CyberGhost</option>
                  <option value="expressvpn">ExpressVPN</option>
                  <option value="fastestvpn">FastestVPN</option>
                  <option value="giganews">Giganews</option>
                  <option value="hidemyass">HideMyAss</option>
                  <option value="ipvanish">IPVanish</option>
                  <option value="ivpn">IVPN</option>
                  <option value="mullvad">Mullvad</option>
                  <option value="nordvpn">NordVPN</option>
                  <option value="perfect privacy">Perfect Privacy</option>
                  <option value="privado">Privado</option>
                  <option value="private internet access">Private Internet Access</option>
                  <option value="privatevpn">PrivateVPN</option>
                  <option value="protonvpn">ProtonVPN</option>
                  <option value="purevpn">PureVPN</option>
                  <option value="slickvpn">SlickVPN</option>
                  <option value="surfshark">Surfshark</option>
                  <option value="torguard">TorGuard</option>
                  <option value="vpn secure">VPN Secure</option>
                  <option value="vpn unlimited">VPN Unlimited</option>
                  <option value="vyprvpn">Vyprvpn</option>
                  <option value="windscribe">Windscribe</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>VPN Type</label>
                  <select name="VPN_TYPE" value={config.VPN_TYPE || ''} onChange={handleChange} className="select-input">
                    <option value="wireguard">WireGuard</option>
                    <option value="openvpn">OpenVPN</option>
                  </select>
                </div>
              </div>

              {/* ── PIA Provider: Either/Or WireGuard or OpenVPN panels, no generic blocks ── */}
              {isGuiPiaProvider(config.VPN_SERVICE_PROVIDER) ? (
                <>
                  {/* PIA WireGuard Panel */}
                  {isGuiWireGuardType(config.VPN_TYPE) && (
                    <>
                      <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '4px 0' }} />
                      <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid var(--glass-highlight)' }}>
                        <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                          <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_lock</span>
                          PIA WireGuard — credentials generate ephemeral keys automatically. Regions rotate via auto-failover when the VPN fails.
                        </p>
                      </div>

                      {piaMonitoring && (
                        <div style={{
                          padding: '16px', borderRadius: '10px', marginBottom: '20px',
                          background: piaMonitoring.failCount === 0 && (piaMonitoring.pfFailCount === 0 || !piaPortForwarding) ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                          border: `1px solid ${piaMonitoring.failCount === 0 && (piaMonitoring.pfFailCount === 0 || !piaPortForwarding) ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                              width: '10px', height: '10px', borderRadius: '50%',
                              background: piaMonitoring.failCount === 0 ? 'var(--success)' : 'var(--danger)',
                              boxShadow: `0 0 8px ${piaMonitoring.failCount === 0 ? 'var(--success)' : 'var(--danger)'}`
                            }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong style={{ fontSize: '14px', color: '#fff' }}>
                                  {piaMonitoring.failCount === 0 ? 'Connection Healthy' : `Connectivity Issues (${piaMonitoring.failCount}/3)`}
                                </strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  Auto-refresh: {Math.round(piaMonitoring.checkInterval / 60000)}m
                                </span>
                              </div>
                              {piaPortForwarding && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '12px' }}>
                                  <span className="material-icons-round" style={{ fontSize: '14px', color: piaMonitoring.pfFailCount === 0 ? 'var(--success)' : 'var(--warning)' }}>
                                    {piaMonitoring.pfFailCount === 0 ? 'hub' : 'warning'}
                                  </span>
                                  <span style={{ color: 'var(--text-secondary)' }}>
                                    Port Forwarding: {piaMonitoring.pfFailCount === 0 ? (
                                      <strong style={{ color: 'var(--success)' }}>Active (Port {piaMonitoring.port || piaMonitoring.lastForwardedPort || 'Pending'})</strong>
                                    ) : (
                                      <span style={{ color: 'var(--warning)' }}>Retrying ({piaMonitoring.pfFailCount}/3)...</span>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <h3 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 0 }}>
                        <span className="material-icons-round" style={{ color: 'var(--accent-primary)', fontSize: '20px' }}>key</span>
                        PIA Account Credentials
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="form-group">
                          <label>PIA Username (p-number)</label>
                          <input type="text" value={piaUsername} onChange={e => setPiaUsername(e.target.value)} className="text-input" placeholder="p1234567" />
                        </div>
                        <div className="form-group">
                          <label>PIA Password</label>
                          <input type="password" value={piaPassword} onChange={e => setPiaPassword(e.target.value)} className="text-input" placeholder="Your PIA password" />
                        </div>
                      </div>

                      {/* WireGuard Region Tag Cloud */}
                      <div className="form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <label style={{ marginBottom: 0 }}>Regions — Auto-Failover Sequence
                            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>{piaWgRegionsList.length} selected</span>
                            {fetchingPiaWgRegions && (
                              <span style={{ marginLeft: '10px', fontSize: '12px', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}>
                                <span className="material-icons-round" style={{ fontSize: '14px', animation: 'spin 1s linear infinite' }}>refresh</span>
                                Loading from PIA…
                              </span>
                            )}
                          </label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {piaWgRegionsList.length > 0 && (
                              <button type="button" onClick={() => setPiaWgRegionsList([])} disabled={fetchingPiaWgRegions} className="btn" style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                <span className="material-icons-round" style={{ fontSize: '13px' }}>clear_all</span> Clear
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={fetchPiaRegions}
                              disabled={fetchingPiaWgRegions}
                              aria-busy={fetchingPiaWgRegions}
                              className="btn"
                              style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(59,130,246,0.1)', opacity: fetchingPiaWgRegions ? 0.85 : 1 }}
                            >
                              <span className="material-icons-round" style={{ fontSize: '13px', animation: fetchingPiaWgRegions ? 'spin 1s linear infinite' : undefined }}>refresh</span>
                              {fetchingPiaWgRegions ? 'Refreshing…' : 'Refresh'}
                            </button>
                          </div>
                        </div>
                        <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
                          <div className="custom-scrollbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '180px', overflowY: 'auto', padding: '4px' }}>
                            {displayPiaRegions.length > 0 ? displayPiaRegions.map(r => {
                              const isSelected = piaWgRegionsList.includes(r.id);
                              return (
                                <div key={r.id} onClick={() => {
                                  setPiaWgRegionsList(prev => {
                                    if (prev.includes(r.id)) return prev.filter(x => x !== r.id);
                                    return [...prev, r.id];
                                  });
                                }} style={{
                                  padding: '5px 11px', borderRadius: '16px', fontSize: '12px', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s',
                                  background: isSelected ? 'var(--accent-primary)' : 'var(--surface-1)',
                                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                                  border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--glass-border)'}`
                                }}>
                                  {r.name}
                                  {r.portForward && <span style={{ fontSize: '9px', background: 'var(--code-bg)', padding: '1px 4px', borderRadius: '3px' }}>PF</span>}
                                  {isSelected && <span className="material-icons-round" style={{ fontSize: '12px' }}>check</span>}
                                </div>
                              );
                            }) : (
                              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic', width: '100%', textAlign: 'center', padding: '20px' }}>
                                {fetchingPiaWgRegions
                                  ? 'Loading regions from PIA…'
                                  : piaPortForwarding
                                    ? 'No port-forwarding regions available yet. Click "Refresh".'
                                    : 'Click "Refresh" to load regions from PIA...'}
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '10px', marginBottom: 0 }}>
                            Failover order: <strong style={{ color: 'var(--accent-primary)' }}>{wgFailoverOrderLabel}</strong>
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="form-group">
                          <label>Auto-Failover Retries</label>
                          <input type="number" name="PIA_ROTATION_RETRIES" value={config.PIA_ROTATION_RETRIES || '3'} onChange={handleChange} className="text-input" placeholder="3" />
                        </div>
                        <div className="form-group">
                          <label>Rotation Limit <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(0 = infinite)</span></label>
                          <input type="number" name="PIA_ROTATION_COUNT" value={config.PIA_ROTATION_COUNT || '0'} onChange={handleChange} className="text-input" placeholder="0" />
                        </div>
                      </div>

                      <div className="toggle-switch-container" style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
                        <div className="toggle-info">
                          <strong style={{ fontSize: '15px' }}>Port Forwarding</strong>
                          <span>Only use PIA servers that support port forwarding</span>
                        </div>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={piaPortForwarding}
                            onChange={e => {
                              const on = e.target.checked;
                              setPiaPortForwarding(on);
                              setConfig(c => ({ ...c, PIA_PORT_FORWARDING: on ? 'true' : 'false' }));
                            }}
                          />
                          <span className="slider"></span>
                        </label>
                      </div>

                      <button
                        type="button" onClick={handlePiaGenerate}
                        disabled={piaGenerating || !piaUsername || !piaPassword || piaWgRegionsList.length === 0}
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '14px', fontSize: '15px' }}
                      >
                        <span className="material-icons-round">{piaGenerating ? 'hourglass_top' : 'bolt'}</span>
                        {piaGenerating ? 'Generating Keys & Connecting...' : 'Generate Keys & Connect VPN'}
                      </button>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '4px' }}>
                        Generates a WireGuard config via PIA API, writes it to Gluetun, and restarts.
                      </p>
                    </>
                  )}

                  {/* PIA OpenVPN Panel */}
                  {isGuiOpenVpnType(config.VPN_TYPE) && (
                    <>
                      <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '4px 0' }} />
                      <div style={{
                        padding: '14px 16px',
                        borderRadius: '10px',
                        background: 'rgba(16, 185, 129, 0.07)',
                        border: '1px solid rgba(16, 185, 129, 0.22)',
                      }}>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                          <span className="material-icons-round" style={{ color: 'var(--success)', fontSize: '24px', flexShrink: 0, lineHeight: 1 }}>lock</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.01em', marginBottom: '6px' }}>
                              PIA OpenVPN
                            </div>
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.55 }}>
                              Uses the PIA username and password below. The region tags you pick are sent to Gluetun as{' '}
                              <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>SERVER_REGIONS</code>.
                            </p>
                            <ul style={{
                              margin: 0,
                              paddingLeft: '1.1rem',
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                              lineHeight: 1.55,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}>
                              <li>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Choose</span>{' '}
                                Gluetun <strong>region labels</strong> (e.g.{' '}
                                <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>CA Montreal</code>
                                ), not WireGuard API ids (e.g.{' '}
                                <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>montreal427</code>
                                ).
                              </li>
                              <li>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Legacy</span>{' '}
                                internal host tokens (e.g.{' '}
                                <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>berlin422</code>
                                ) are converted to the correct region on <strong style={{ fontWeight: 600 }}>load</strong> or <strong style={{ fontWeight: 600 }}>Save</strong>.
                              </li>
                              <li>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Logs</span>{' '}
                                <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>RTNETLINK answers: File exists</code>
                                {' '}on a route add often appears when OpenVPN reconnects inside Gluetun and is usually safe to ignore if the tunnel still comes up. Repeated VPN restarts point to healthcheck or DNS issues—see the{' '}
                                <a
                                  href="https://github.com/qdm12/gluetun-wiki/blob/main/faq/healthcheck.md"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: 'var(--accent-primary)', fontWeight: 500 }}
                                >
                                  Gluetun healthcheck FAQ
                                </a>
                                .
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      {piaMonitoring && (
                        <div style={{
                          padding: '16px', borderRadius: '10px', marginTop: '20px',
                          background: piaMonitoring.failCount === 0 && (piaMonitoring.pfFailCount === 0 || !piaPortForwarding) ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                          border: `1px solid ${piaMonitoring.failCount === 0 && (piaMonitoring.pfFailCount === 0 || !piaPortForwarding) ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                              width: '10px', height: '10px', borderRadius: '50%',
                              background: piaMonitoring.failCount === 0 ? 'var(--success)' : 'var(--danger)',
                              boxShadow: `0 0 8px ${piaMonitoring.failCount === 0 ? 'var(--success)' : 'var(--danger)'}`
                            }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong style={{ fontSize: '14px', color: '#fff' }}>
                                  {piaMonitoring.failCount === 0 ? 'Connection Healthy' : `Connectivity Issues (${piaMonitoring.failCount}/3)`}
                                </strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                  Auto-refresh: {Math.round(piaMonitoring.checkInterval / 60000)}m
                                </span>
                              </div>
                              {piaPortForwarding && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '12px' }}>
                                  <span className="material-icons-round" style={{ fontSize: '14px', color: piaMonitoring.pfFailCount === 0 ? 'var(--success)' : 'var(--warning)' }}>
                                    {piaMonitoring.pfFailCount === 0 ? 'hub' : 'warning'}
                                  </span>
                                  <span style={{ color: 'var(--text-secondary)' }}>
                                    Port Forwarding: {piaMonitoring.pfFailCount === 0 ? (
                                      <strong style={{ color: 'var(--success)' }}>Active (Port {piaMonitoring.port || piaMonitoring.lastForwardedPort || 'Pending'})</strong>
                                    ) : (
                                      <span style={{ color: 'var(--warning)' }}>Retrying ({piaMonitoring.pfFailCount}/3)...</span>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <h3 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 0 }}>
                        <span className="material-icons-round" style={{ color: 'var(--success)', fontSize: '20px' }}>key</span>
                        PIA Account Credentials
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="form-group">
                          <label>Username</label>
                          <input type="text" name="OPENVPN_USER" value={config.OPENVPN_USER || ''} onChange={handleChange} className="text-input" placeholder="e.g. p1234567 (PIA login)" />
                        </div>
                        <div className="form-group">
                          <label>Password</label>
                          <input type="password" name="OPENVPN_PASSWORD" value={config.OPENVPN_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="PIA account password" />
                        </div>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '-8px 0 8px 0', lineHeight: 1.45 }}>
                        Gluetun only sees <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>OPENVPN_USER</code> / <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>OPENVPN_PASSWORD</code>.
                        If you still have <strong style={{ fontWeight: 600 }}>PIA_USERNAME</strong> / <strong style={{ fontWeight: 600 }}>PIA_PASSWORD</strong> from WireGuard but these boxes are empty, <strong style={{ fontWeight: 600 }}>Save</strong> copies them automatically. Wrong or empty values cause <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>AUTH_FAILED</code>.
                      </p>

                      {/* PIA OpenVPN regions → Gluetun SERVER_REGIONS */}
                      <div className="form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <label style={{ marginBottom: 0 }}>Regions — Auto-Failover Sequence
                            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                              {piaOpenVpnRegionsList.length} selected
                            </span>
                            {fetchingPiaOpenVpnList && (
                              <span style={{ marginLeft: '10px', fontSize: '12px', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}>
                                <span className="material-icons-round" style={{ fontSize: '14px', animation: 'spin 1s linear infinite' }}>refresh</span>
                                Loading from Gluetun…
                              </span>
                            )}
                          </label>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {piaOpenVpnRegionsList.length > 0 && (
                              <button type="button" onClick={() => setPiaOpenVpnRegionsList([])} disabled={fetchingPiaOpenVpnList} className="btn" style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                <span className="material-icons-round" style={{ fontSize: '13px' }}>clear_all</span> Clear
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => fetchPiaOpenVpnRegions({ userInitiated: true })}
                              disabled={fetchingPiaOpenVpnList}
                              aria-busy={fetchingPiaOpenVpnList}
                              className="btn"
                              style={{ padding: '4px 10px', fontSize: '12px', background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.3)', opacity: fetchingPiaOpenVpnList ? 0.85 : 1 }}
                            >
                              <span className="material-icons-round" style={{ fontSize: '13px', animation: fetchingPiaOpenVpnList ? 'spin 1s linear infinite' : undefined }}>refresh</span>
                              {fetchingPiaOpenVpnList ? 'Fetching…' : 'Fetch server list'}
                            </button>
                          </div>
                        </div>
                        <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '10px', border: '1px solid var(--glass-border)' }}>
                          <div className="custom-scrollbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '200px', overflowY: 'auto', padding: '4px' }}>
                            {piaOpenVpnRegions.length > 0 ? piaOpenVpnRegions.map(region => {
                              const isSelected = piaOpenVpnRegionsList.includes(region);
                              return (
                                <div key={region} onClick={() => {
                                  if (isSelected) setPiaOpenVpnRegionsList(piaOpenVpnRegionsList.filter(x => x !== region));
                                  else setPiaOpenVpnRegionsList([...piaOpenVpnRegionsList, region]);
                                }} style={{
                                  padding: '5px 12px', borderRadius: '16px', fontSize: '12px', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s',
                                  background: isSelected ? 'var(--success)' : 'var(--surface-1)',
                                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                                  border: `1px solid ${isSelected ? 'var(--success)' : 'var(--glass-border)'}`
                                }}>
                                  {region}
                                  {isSelected && <span className="material-icons-round" style={{ fontSize: '12px' }}>check</span>}
                                </div>
                              );
                            }) : (
                              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic', width: '100%', textAlign: 'center', padding: '20px' }}>
                                {fetchingPiaOpenVpnList
                                  ? 'Fetching server list from Gluetun (servers.json)…'
                                  : 'No regions loaded yet. Click "Fetch server list" to load labels from Gluetun.'}
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '10px', marginBottom: 0 }}>
                            Failover order: <strong style={{ color: 'var(--success)' }}>{piaOpenVpnRegionsList.join(' ➜ ') || 'None selected'}</strong>
                          </p>
                          {(piaPortForwarding || String(config.VPN_PORT_FORWARDING || '').toLowerCase() === 'on') && (
                            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', marginBottom: 0, lineHeight: 1.45 }}>
                              VPN port forwarding is on, so this list only includes regions where Gluetun marks OpenVPN servers for port forwarding (see servers.json). Many <strong style={{ fontWeight: 600 }}>US state</strong> regions have no such servers—use <strong style={{ fontWeight: 600 }}>CA</strong>/<strong style={{ fontWeight: 600 }}>EU</strong> style regions, disable port forwarding, or use <strong style={{ fontWeight: 600 }}>WireGuard</strong> if you need US + PF.
                            </p>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="form-group">
                          <label>Auto-Failover Retries</label>
                          <input type="number" name="PIA_ROTATION_RETRIES" value={config.PIA_ROTATION_RETRIES || '3'} onChange={handleChange} className="text-input" placeholder="3" />
                        </div>
                        <div className="form-group">
                          <label>Rotation Limit <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(0 = infinite)</span></label>
                          <input type="number" name="PIA_ROTATION_COUNT" value={config.PIA_ROTATION_COUNT || '0'} onChange={handleChange} className="text-input" placeholder="0" />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                        <div className="form-group">
                          <label>Protocol</label>
                          <select name="OPENVPN_PROTOCOL" value={config.OPENVPN_PROTOCOL || 'udp'} onChange={handleChange} className="select-input">
                            <option value="udp">UDP</option>
                            <option value="tcp">TCP</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Version</label>
                          <select name="OPENVPN_VERSION" value={config.OPENVPN_VERSION || '2.6'} onChange={handleChange} className="select-input">
                            <option value="2.6">2.6</option>
                            <option value="2.5">2.5</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Verbosity</label>
                          <select name="OPENVPN_VERBOSITY" value={config.OPENVPN_VERBOSITY || '1'} onChange={handleChange} className="select-input">
                            <option value="0">0 Silent</option>
                            <option value="1">1 Default</option>
                            <option value="3">3</option>
                            <option value="6">6 Max</option>
                          </select>
                        </div>
                      </div>

                      <button
                        type="button" onClick={handleSave}
                        disabled={
                          saving ||
                          piaOpenVpnRegionsList.length === 0 ||
                          !(String(config.OPENVPN_USER || '').trim() || String(piaUsername || '').trim()) ||
                          !(String(config.OPENVPN_PASSWORD || '').trim() || String(piaPassword || '').trim())
                        }
                        className="btn btn-primary"
                        style={{ width: '100%', padding: '14px', fontSize: '15px', background: 'var(--success)', boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}
                      >
                        <span className="material-icons-round">{saving ? 'hourglass_top' : 'save'}</span>
                        {saving ? 'Saving & Connecting...' : 'Save & Connect OpenVPN'}
                      </button>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '4px' }}>
                        Saves credentials and selected regions, then restarts Gluetun with OpenVPN.
                      </p>
                    </>
                  )}
                </>
              ) : (
                // ── Non-PIA: Generic cascading server filter + WG + OpenVPN config ──
                <>
                  {/* Generic Server Selection (cascading filter) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Server Selection</h3>
                      {fetchingFiltered && (
                        <span style={{ fontSize: '12px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="material-icons-round" style={{ fontSize: '14px', animation: 'spin 1s linear infinite' }}>refresh</span>
                          Filtering...
                        </span>
                      )}
                      {(config.SERVER_COUNTRIES || config.SERVER_REGIONS) && serverOptions.countries.length > 0 && (
                        <span style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(59,130,246,0.15)', border: '1px solid var(--accent-primary)', borderRadius: '10px', color: 'var(--accent-primary)' }}>
                          Cascading filter active
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={fetchServerOptions} className="btn" style={{ padding: '6px 12px', fontSize: '13px', background: 'rgba(59, 130, 246, 0.1)' }} disabled={fetchingServers || !config.VPN_SERVICE_PROVIDER}>
                      <span className="material-icons-round" style={{ fontSize: '14px' }}>refresh</span>
                      {fetchingServers ? 'Fetching...' : 'Fetch Servers'}
                    </button>
                  </div>

                  {serverOptions.countries.length === 0 && !fetchingServers && config.VPN_SERVICE_PROVIDER && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 0 }}>
                      Click "Fetch Servers" to load options. Selecting a Country will automatically filter Regions, Cities, and Hostnames.
                    </p>
                  )}

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Server Countries
                      {serverOptions.countries.length > 0 && <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>({serverOptions.countries.length} available)</span>}
                    </label>
                    <input type="text" name="SERVER_COUNTRIES" value={config.SERVER_COUNTRIES || ''} onChange={e => { handleChange(e); handleServerFieldChange('SERVER_COUNTRIES', e.target.value); }} className="text-input" placeholder="e.g. Switzerland, Romania" />
                    {renderLinkedPills(serverOptions.countries, 'SERVER_COUNTRIES')}
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Server Regions
                      {serverOptions.regions.length > 0 && <span style={{ fontSize: '11px', color: config.SERVER_COUNTRIES ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>({serverOptions.regions.length}{config.SERVER_COUNTRIES ? ' filtered' : ' available'})</span>}
                    </label>
                    <input type="text" name="SERVER_REGIONS" value={config.SERVER_REGIONS || ''} onChange={e => { handleChange(e); handleServerFieldChange('SERVER_REGIONS', e.target.value); }} className="text-input" placeholder="e.g. East US, Western Europe" />
                    {renderLinkedPills(serverOptions.regions, 'SERVER_REGIONS')}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Server Cities
                        {serverOptions.cities.length > 0 && <span style={{ fontSize: '11px', color: (config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>({serverOptions.cities.length}{(config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? ' filtered' : ''})</span>}
                      </label>
                      <input type="text" name="SERVER_CITIES" value={config.SERVER_CITIES || ''} onChange={handleChange} className="text-input" placeholder="e.g. New York, London" />
                      {renderLinkedPills(serverOptions.cities, 'SERVER_CITIES')}
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Server Hostnames
                        {serverOptions.hostnames.length > 0 && <span style={{ fontSize: '11px', color: (config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>({serverOptions.hostnames.length}{(config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? ' filtered' : ''})</span>}
                      </label>
                      <input type="text" name="SERVER_HOSTNAMES" value={config.SERVER_HOSTNAMES || ''} onChange={handleChange} className="text-input" placeholder="e.g. us-nyc1.server.com" />
                      {renderLinkedPills(serverOptions.hostnames, 'SERVER_HOSTNAMES')}
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Server Names
                        {serverOptions.server_names.length > 0 && <span style={{ fontSize: '11px', color: (config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>({serverOptions.server_names.length}{(config.SERVER_COUNTRIES||config.SERVER_REGIONS) ? ' filtered' : ''})</span>}
                      </label>
                      <input type="text" name="SERVER_NAMES" value={config.SERVER_NAMES || ''} onChange={handleChange} className="text-input" placeholder="e.g. server-name-1" />
                      {renderLinkedPills(serverOptions.server_names, 'SERVER_NAMES')}
                    </div>
                  </div>

                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.45 }}>
                    Protocol-specific fields below follow <strong style={{ fontWeight: 600 }}>VPN Type</strong> (same idea as PIA): choose WireGuard or OpenVPN above to show only the matching section.
                  </p>

                  {isGuiWireGuardType(config.VPN_TYPE) && (
                  <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_lock</span>
                    WireGuard configuration
                  </h3>

                  <div className="form-group">
                    <label>Private Key</label>
                    <input type="password" name="WIREGUARD_PRIVATE_KEY" value={config.WIREGUARD_PRIVATE_KEY || ''} onChange={handleChange} className="text-input" placeholder="Base64 encoded private key" />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Public Key (Server)</label>
                      <input type="text" name="WIREGUARD_PUBLIC_KEY" value={config.WIREGUARD_PUBLIC_KEY || ''} onChange={handleChange} className="text-input" placeholder="Server's base64 public key" />
                    </div>
                    <div className="form-group">
                      <label>Preshared Key</label>
                      <input type="password" name="WIREGUARD_PRESHARED_KEY" value={config.WIREGUARD_PRESHARED_KEY || ''} onChange={handleChange} className="text-input" placeholder="Optional preshared key" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Client Addresses</label>
                      <input type="text" name="WIREGUARD_ADDRESSES" value={config.WIREGUARD_ADDRESSES || ''} onChange={handleChange} className="text-input" placeholder="IPv4 CIDR (e.g. 10.64.22.1/32)" />
                    </div>
                    <div className="form-group">
                      <label>Allowed IPs</label>
                      <input type="text" name="WIREGUARD_ALLOWED_IPS" value={config.WIREGUARD_ALLOWED_IPS || ''} onChange={handleChange} className="text-input" placeholder="0.0.0.0/0,::/0" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Endpoint IP</label>
                      <input type="text" name="WIREGUARD_ENDPOINT_IP" value={config.WIREGUARD_ENDPOINT_IP || ''} onChange={handleChange} className="text-input" placeholder="VPN server IP address" />
                    </div>
                    <div className="form-group">
                      <label>Endpoint Port</label>
                      <input type="text" name="WIREGUARD_ENDPOINT_PORT" value={config.WIREGUARD_ENDPOINT_PORT || ''} onChange={handleChange} className="text-input" placeholder="51820" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Implementation</label>
                      <select name="WIREGUARD_IMPLEMENTATION" value={config.WIREGUARD_IMPLEMENTATION || 'auto'} onChange={handleChange} className="select-input">
                        <option value="auto">Auto</option>
                        <option value="kernelspace">Kernelspace</option>
                        <option value="userspace">Userspace</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>MTU</label>
                      <input type="number" name="WIREGUARD_MTU" value={config.WIREGUARD_MTU || ''} onChange={handleChange} className="text-input" placeholder="1420" />
                    </div>
                    <div className="form-group">
                      <label>Keepalive Interval</label>
                      <input type="text" name="WIREGUARD_PERSISTENT_KEEPALIVE_INTERVAL" value={config.WIREGUARD_PERSISTENT_KEEPALIVE_INTERVAL || ''} onChange={handleChange} className="text-input" placeholder="e.g. 25s" />
                    </div>
                  </div>
                  </>
                  )}

                  {isGuiOpenVpnType(config.VPN_TYPE) && (
                  <>
                  <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>lock</span>
                    OpenVPN configuration
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Username</label>
                      <input type="text" name="OPENVPN_USER" value={config.OPENVPN_USER || ''} onChange={handleChange} className="text-input" placeholder="Provider Username" />
                    </div>
                    <div className="form-group">
                      <label>Password</label>
                      <input type="password" name="OPENVPN_PASSWORD" value={config.OPENVPN_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Provider Password" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Protocol</label>
                      <select name="OPENVPN_PROTOCOL" value={config.OPENVPN_PROTOCOL || 'udp'} onChange={handleChange} className="select-input">
                        <option value="udp">UDP</option>
                        <option value="tcp">TCP</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Version</label>
                      <select name="OPENVPN_VERSION" value={config.OPENVPN_VERSION || '2.6'} onChange={handleChange} className="select-input">
                        <option value="2.6">2.6</option>
                        <option value="2.5">2.5</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Endpoint IP</label>
                      <input type="text" name="OPENVPN_ENDPOINT_IP" value={config.OPENVPN_ENDPOINT_IP || ''} onChange={handleChange} className="text-input" placeholder="Server IP" />
                    </div>
                    <div className="form-group">
                      <label>Endpoint Port</label>
                      <input type="text" name="OPENVPN_ENDPOINT_PORT" value={config.OPENVPN_ENDPOINT_PORT || ''} onChange={handleChange} className="text-input" placeholder="1194" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Cipher</label>
                      <input type="text" name="OPENVPN_CIPHERS" value={config.OPENVPN_CIPHERS || ''} onChange={handleChange} className="text-input" placeholder="aes-256-gcm" />
                    </div>
                    <div className="form-group">
                      <label>Auth Algorithm</label>
                      <input type="text" name="OPENVPN_AUTH" value={config.OPENVPN_AUTH || ''} onChange={handleChange} className="text-input" placeholder="sha256" />
                    </div>
                    <div className="form-group">
                      <label>MSS Fix</label>
                      <input type="number" name="OPENVPN_MSSFIX" value={config.OPENVPN_MSSFIX || ''} onChange={handleChange} className="text-input" placeholder="0 (default)" />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Verbosity</label>
                      <select name="OPENVPN_VERBOSITY" value={config.OPENVPN_VERBOSITY || '1'} onChange={handleChange} className="select-input">
                        <option value="0">0 (Silent)</option>
                        <option value="1">1 (Default)</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                        <option value="6">6 (Max)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Run as Root</label>
                      <select name="OPENVPN_ROOT" value={config.OPENVPN_ROOT || 'no'} onChange={handleChange} className="select-input">
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Process User</label>
                      <input type="text" name="OPENVPN_PROCESS_USER" value={config.OPENVPN_PROCESS_USER || ''} onChange={handleChange} className="text-input" placeholder="root" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Extra OpenVPN Flags</label>
                    <input type="text" name="OPENVPN_FLAGS" value={config.OPENVPN_FLAGS || ''} onChange={handleChange} className="text-input" placeholder="Space-delimited flags passed to openvpn" />
                  </div>

                  <div className="form-group">
                    <label>Custom Config File Path</label>
                    <input type="text" name="OPENVPN_CUSTOM_CONFIG" value={config.OPENVPN_CUSTOM_CONFIG || ''} onChange={handleChange} className="text-input" placeholder="Path to custom .ovpn file (custom provider only)" />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Certificate (base64 PEM)</label>
                      <textarea name="OPENVPN_CERT" value={config.OPENVPN_CERT || ''} onChange={handleChange} className="text-input" placeholder="Base64 part of certificate PEM" rows={3} style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                      <label>Key (base64 PEM)</label>
                      <textarea name="OPENVPN_KEY" value={config.OPENVPN_KEY || ''} onChange={handleChange} className="text-input" placeholder="Base64 part of key PEM" rows={3} style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="form-group">
                      <label>Encrypted Key (base64 PEM)</label>
                      <textarea name="OPENVPN_ENCRYPTED_KEY" value={config.OPENVPN_ENCRYPTED_KEY || ''} onChange={handleChange} className="text-input" placeholder="Base64 part of encrypted key PEM" rows={3} style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }} />
                    </div>
                    <div className="form-group">
                      <label>Key Passphrase</label>
                      <input type="password" name="OPENVPN_KEY_PASSPHRASE" value={config.OPENVPN_KEY_PASSPHRASE || ''} onChange={handleChange} className="text-input" placeholder="Decrypt encrypted key" />
                    </div>
                  </div>
                  </>
                  )}
                </>
              )} {/* end PIA ternary */}

            </>
          )}

          {activeTab === 'dns' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
                Resolver settings and hostname blocklists run inside Gluetun. Public IP logging lives under <strong style={{ fontWeight: 600 }}>Gluetun advanced</strong> with the other <code style={{ fontSize: '12px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>PUBLICIP_*</code> options.
              </p>
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>dns</span>
                Resolvers
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Upstream Resolver Type</label>
                  <select name="DNS_UPSTREAM_RESOLVER_TYPE" value={config.DNS_UPSTREAM_RESOLVER_TYPE || 'dot'} onChange={handleChange} className="select-input">
                    <option value="dot">DNS over TLS (DoT)</option>
                    <option value="doh">DNS over HTTPS (DoH)</option>
                    <option value="plain">Plain UDP</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Upstream Resolvers (comma separated)</label>
                  <input type="text" name="DNS_UPSTREAM_RESOLVERS" value={config.DNS_UPSTREAM_RESOLVERS || 'cloudflare'} onChange={handleChange} className="text-input" placeholder="cloudflare, quad9" />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    cloudflare, quad9, google, mullvad, libredns, opendns, quadrant
                  </p>
                </div>
              </div>

              <div className="form-group">
                <label>Plain DNS Upstream Addresses</label>
                <input type="text" name="DNS_UPSTREAM_PLAIN_ADDRESSES" value={config.DNS_UPSTREAM_PLAIN_ADDRESSES || ''} onChange={handleChange} className="text-input" placeholder="e.g. 1.1.1.1:53 (not recommended)" />
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  ⚠️ Using a VPN provider DNS exposes all queries. Prefer encrypted upstream resolvers above.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                  <div className="toggle-info">
                    <strong style={{ fontSize: '15px' }}>DNS Caching</strong>
                    <span>Cache DNS queries internally</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="DNS_CACHING" checked={config.DNS_CACHING !== 'off'} onChange={handleChange} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                  <div className="toggle-info">
                    <strong style={{ fontSize: '15px' }}>IPv6 DNS</strong>
                    <span>Enable DNS IPv6 resolution (<code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>DNS_UPSTREAM_IPV6</code>). Mirrored under Firewall &amp; ports → IPv6.</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="DNS_UPSTREAM_IPV6" checked={config.DNS_UPSTREAM_IPV6 === 'on'} onChange={handleChange} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="form-group">
                  <label>DNS Update Period</label>
                  <input type="text" name="DNS_UPDATE_PERIOD" value={config.DNS_UPDATE_PERIOD || ''} onChange={handleChange} className="text-input" placeholder="24h (0 to disable)" />
                </div>
                <div className="form-group">
                  <label>Unblock Hostnames</label>
                  <input type="text" name="DNS_UNBLOCK_HOSTNAMES" value={config.DNS_UNBLOCK_HOSTNAMES || ''} onChange={handleChange} className="text-input" placeholder="domain1.com, x.domain2.co.uk" />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Exempt from blocklist filtering</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Block IPs</label>
                  <input type="text" name="DNS_BLOCK_IPS" value={config.DNS_BLOCK_IPS || ''} onChange={handleChange} className="text-input" placeholder="Comma-separated IPs to block" />
                </div>
                <div className="form-group">
                  <label>Block IP Prefixes (CIDRs)</label>
                  <input type="text" name="DNS_BLOCK_IP_PREFIXES" value={config.DNS_BLOCK_IP_PREFIXES || ''} onChange={handleChange} className="text-input" placeholder="e.g. 10.0.0.0/8" />
                </div>
              </div>

              <div className="form-group">
                <label>Rebinding Protection Exempt Hostnames</label>
                <input type="text" name="DNS_REBINDING_PROTECTION_EXEMPT_HOSTNAMES" value={config.DNS_REBINDING_PROTECTION_EXEMPT_HOSTNAMES || ''} onChange={handleChange} className="text-input" placeholder="Comma-separated public domain names" />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '12px 0' }} />
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--danger)' }}>gpp_bad</span>
                Blocklists System
              </h3>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Block Malicious</strong>
                  <span>Block malicious hostnames and IPs</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_MALICIOUS" checked={config.BLOCK_MALICIOUS !== 'off'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Block Surveillance</strong>
                  <span>Block surveillance and tracking requests</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_SURVEILLANCE" checked={config.BLOCK_SURVEILLANCE === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="toggle-switch-container">
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Block Ads</strong>
                  <span>Block well-known advertising networks</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="BLOCK_ADS" checked={config.BLOCK_ADS === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>
            </>
          )}

          {activeTab === 'network' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
                Firewall rules control what can reach the container; port forwarding is for inbound services through the VPN when your provider supports it.
              </p>
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginTop: 0 }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>security</span>
                Firewall
              </h3>

              <div className="form-group">
                <label>Outbound Subnets (Local Network Access)</label>
                <input type="text" name="FIREWALL_OUTBOUND_SUBNETS" value={config.FIREWALL_OUTBOUND_SUBNETS || ''} onChange={handleChange} className="text-input" placeholder="e.g. 192.168.1.0/24, 10.0.0.0/8" />
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Required to access local services while the VPN is active. Do NOT overlap with VPN tunnel address range.
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>VPN Input Ports</label>
                  <input type="text" name="FIREWALL_VPN_INPUT_PORTS" value={config.FIREWALL_VPN_INPUT_PORTS || ''} onChange={handleChange} className="text-input" placeholder="e.g. 1000,8080" />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Ports to allow from the VPN server side</p>
                </div>
                <div className="form-group">
                  <label>Input Ports (Default Interface)</label>
                  <input type="text" name="FIREWALL_INPUT_PORTS" value={config.FIREWALL_INPUT_PORTS || ''} onChange={handleChange} className="text-input" placeholder="e.g. 1000,8000" />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Needed for Kubernetes sidecars</p>
                </div>
              </div>

              <div className="form-group">
                <label>IPTables Log Level</label>
                <select name="FIREWALL_IPTABLES_LOG_LEVEL" value={config.FIREWALL_IPTABLES_LOG_LEVEL || ''} onChange={handleChange} className="select-input">
                  <option value="">Default</option>
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </div>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>IPv6</strong>
                  <span>
                    Turns IPv6 on or off for Gluetun’s <strong style={{ fontWeight: 600 }}>DNS upstream</strong> connections (<code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>DNS_UPSTREAM_IPV6</code>). Same as <strong style={{ fontWeight: 600 }}>IPv6 DNS</strong> on the DNS tab. For stack-wide IPv6 in the container, use Docker <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>sysctls</code> (see Gluetun wiki).
                  </span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="DNS_UPSTREAM_IPV6" checked={config.DNS_UPSTREAM_IPV6 === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>hub</span>
                VPN Port Forwarding
              </h3>

              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)', marginBottom: '12px' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>info</span>
                  Supported providers: Private Internet Access, ProtonVPN, Perfect Privacy, PrivateVPN.
                </p>
              </div>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable Port Forwarding</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Request and maintain an open port on the VPN server</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="VPN_PORT_FORWARDING" checked={config.VPN_PORT_FORWARDING === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="form-group">
                  <label>Port Forwarding Provider Override</label>
                  <select name="VPN_PORT_FORWARDING_PROVIDER" value={config.VPN_PORT_FORWARDING_PROVIDER || ''} onChange={handleChange} className="select-input">
                    <option value="">Default (same as VPN provider)</option>
                    <option value="private internet access">Private Internet Access</option>
                    <option value="protonvpn">ProtonVPN</option>
                    <option value="perfect privacy">Perfect Privacy</option>
                    <option value="privatevpn">PrivateVPN</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Listening Port (Redirect)</label>
                  <input type="text" name="VPN_PORT_FORWARDING_LISTENING_PORT" value={config.VPN_PORT_FORWARDING_LISTENING_PORT || ''} onChange={handleChange} className="text-input" placeholder="Port to redirect incoming traffic to" />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>Do not use with torrent clients</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Status File Path</label>
                  <input type="text" name="VPN_PORT_FORWARDING_STATUS_FILE" value={config.VPN_PORT_FORWARDING_STATUS_FILE || ''} onChange={handleChange} className="text-input" placeholder="/tmp/gluetun/forwarded_port" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Up Command</label>
                  <input type="text" name="VPN_PORT_FORWARDING_UP_COMMAND" value={config.VPN_PORT_FORWARDING_UP_COMMAND || ''} onChange={handleChange} className="text-input" placeholder="Shell command on PF setup" />
                </div>
                <div className="form-group">
                  <label>Down Command</label>
                  <input type="text" name="VPN_PORT_FORWARDING_DOWN_COMMAND" value={config.VPN_PORT_FORWARDING_DOWN_COMMAND || ''} onChange={handleChange} className="text-input" placeholder="Shell command on PF teardown" />
                </div>
              </div>
            </>
          )}

          {activeTab === 'proxies' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
                Optional HTTP and Shadowsocks listeners on the Gluetun container so LAN clients can use the VPN without full-tunnel routing.
              </p>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)', marginBottom: '12px' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>info</span>
                  Built-in proxy servers allow devices on your LAN to privately route traffic through the VPN without complex network-level routing.
                </p>
              </div>

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_lock</span>
                Shadowsocks Proxy
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable Shadowsocks Server</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Runs a lightweight, undetectable proxy on port 8388</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="SHADOWSOCKS" checked={config.SHADOWSOCKS === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="form-group">
                <label>Shadowsocks Password</label>
                <input type="password" name="SHADOWSOCKS_PASSWORD" value={config.SHADOWSOCKS_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Super Secure Password" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="form-group">
                  <label>Listening Address</label>
                  <input type="text" name="SHADOWSOCKS_LISTENING_ADDRESS" value={config.SHADOWSOCKS_LISTENING_ADDRESS || ''} onChange={handleChange} className="text-input" placeholder="e.g. :8388" />
                </div>
                <div className="form-group">
                  <label>Cipher</label>
                  <select name="SHADOWSOCKS_CIPHER" value={config.SHADOWSOCKS_CIPHER || 'chacha20-ietf-poly1305'} onChange={handleChange} className="select-input">
                    <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
                    <option value="aes-128-gcm">aes-128-gcm</option>
                    <option value="aes-256-gcm">aes-256-gcm</option>
                  </select>
                </div>
              </div>

              <div className="toggle-switch-container" style={{ marginTop: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Shadowsocks Tracing Log</strong>
                  <span>Enable detailed traffic logging for Shadowsocks proxy</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="SHADOWSOCKS_LOG" checked={config.SHADOWSOCKS_LOG === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>public</span>
                HTTP Proxy
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable HTTP Proxy Server</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Runs a standard HTTP proxy on port 8888</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="HTTPPROXY" checked={config.HTTPPROXY === 'on'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Username (Optional)</label>
                  <input type="text" name="HTTPPROXY_USER" value={config.HTTPPROXY_USER || ''} onChange={handleChange} className="text-input" placeholder="Proxy Username" />
                </div>
                <div className="form-group">
                  <label>Password (Optional)</label>
                  <input type="password" name="HTTPPROXY_PASSWORD" value={config.HTTPPROXY_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="Proxy Password" />
                </div>
              </div>

              <div className="form-group">
                <label>Listening Address</label>
                <input type="text" name="HTTPPROXY_LISTENING_ADDRESS" value={config.HTTPPROXY_LISTENING_ADDRESS || ''} onChange={handleChange} className="text-input" placeholder=":8888" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '16px' }}>
                <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                  <div className="toggle-info">
                    <strong style={{ fontSize: '15px' }}>Stealth Mode</strong>
                    <span>Strip proxy headers from requests</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="HTTPPROXY_STEALTH" checked={config.HTTPPROXY_STEALTH === 'on'} onChange={handleChange} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                  <div className="toggle-info">
                    <strong style={{ fontSize: '15px' }}>Tracing Log</strong>
                    <span>Log every tunnel request</span>
                  </div>
                  <label className="switch">
                    <input type="checkbox" name="HTTPPROXY_LOG" checked={config.HTTPPROXY_LOG === 'on'} onChange={handleChange} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'application' && (
            <>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>
                These options affect this web UI only (login, notification bell, toasts). They are not passed to the Gluetun container.
              </p>

              <div className="glass-panel" style={{ padding: '16px', borderRadius: '12px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>layers</span>
                    Gluetun engine image
                  </h3>
                  <button
                    type="button"
                    className="btn"
                    onClick={refreshEngineStatus}
                    disabled={engineStatusLoading}
                    style={{
                      whiteSpace: 'nowrap',
                      padding: '10px 14px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--text-primary)',
                      opacity: engineStatusLoading ? 0.7 : 1,
                    }}
                  >
                    {engineStatusLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
                  This is the running VPN container image as seen by Docker (not a GUI setting). It was moved out of the Dashboard status card to reduce clutter.
                </p>
                {engineStatusErr ? (
                  <p style={{ fontSize: '12px', color: 'var(--danger)', margin: 0 }}>{engineStatusErr}</p>
                ) : !engineStatus ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Loading…</p>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    <div style={{ wordBreak: 'break-all', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {engineStatus.image || '—'}
                    </div>
                    {engineStatus.imageId && (
                      <div style={{ marginTop: '6px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' }}>
                        {String(engineStatus.imageId).length > 48 ? `${String(engineStatus.imageId).slice(0, 48)}…` : engineStatus.imageId}
                      </div>
                    )}
                    {engineStatus.containerName && (
                      <div style={{ marginTop: '6px' }}>
                        Container: <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{engineStatus.containerName}</strong>
                      </div>
                    )}
                    {engineStatus.imageUpdate?.updateAvailable && (
                      <div style={{ marginTop: '10px', color: 'var(--warning)', fontWeight: 600 }}>
                        Newer image may exist on Docker Hub (digest differs from registry manifest for this tag).
                      </div>
                    )}
                    {engineStatus.imageUpdate?.checkError && !engineStatus.imageUpdate?.updateAvailable && (
                      <div style={{ marginTop: '8px', opacity: 0.85 }}>
                        Image update check: {engineStatus.imageUpdate.checkError}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>palette</span>
                Appearance
              </h3>

              <div className="form-group theme-picker-wrap">
                <label>Theme</label>
                <ThemePicker />
                <p className="theme-picker-hint">
                  Applied immediately and saved in this browser (
                  <code>localStorage</code> key <code>gluetun_gui_theme_v1</code>).
                </p>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <div id="network-monitor" style={{ scrollMarginTop: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>sensors</span>
                  Network Monitor
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                  Controls the auto-refresh rate and chart history size on the <strong style={{ fontWeight: 600 }}>Network</strong> page. Stored in this browser only.
                </p>

                <div className="glass-panel" style={{ padding: '16px', borderRadius: '12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Auto-refresh</label>
                      <select
                        className="text-input"
                        value={(() => {
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : null;
                            return parsed?.refreshMs ?? 1500;
                          } catch {
                            return 1500;
                          }
                        })()}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : {};
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ ...parsed, refreshMs: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          } catch {
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ refreshMs: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          }
                        }}
                      >
                        <option value={750}>0.75s</option>
                        <option value={1500}>1.5s</option>
                        <option value={3000}>3s</option>
                        <option value={5000}>5s</option>
                      </select>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Lower values update charts more often but use more CPU.
                      </p>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Chart history (points)</label>
                      <input
                        type="number"
                        className="text-input"
                        min={30}
                        max={600}
                        defaultValue={(() => {
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : null;
                            return parsed?.historyMax ?? 180;
                          } catch {
                            return 180;
                          }
                        })()}
                        onBlur={(e) => {
                          const v = Math.max(30, Math.min(600, Number(e.target.value) || 180));
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : {};
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ ...parsed, historyMax: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          } catch {
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ historyMax: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          }
                        }}
                      />
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        How many samples the live charts keep before dropping old points.
                      </p>
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Default range</label>
                      <select
                        className="text-input"
                        defaultValue={(() => {
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : null;
                            return parsed?.defaultRange ?? 30;
                          } catch {
                            return 30;
                          }
                        })()}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          try {
                            const raw = localStorage.getItem('gluetun_gui_network_monitor_prefs_v1');
                            const parsed = raw ? JSON.parse(raw) : {};
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ ...parsed, defaultRange: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          } catch {
                            localStorage.setItem('gluetun_gui_network_monitor_prefs_v1', JSON.stringify({ defaultRange: v }));
                            window.dispatchEvent(new CustomEvent('gluetun-network-monitor-prefs'));
                          }
                        }}
                      >
                        <option value={15}>15s</option>
                        <option value={30}>30s</option>
                        <option value={60}>60s</option>
                        <option value={90}>90s</option>
                      </select>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        Initial time window when opening the page.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <div id="dashboard-widgets" style={{ scrollMarginTop: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>dashboard_customize</span>
                  Dashboard widgets
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                  Turn widgets on or off here. On <strong style={{ fontWeight: 600 }}>Overview</strong>, turn on <strong style={{ fontWeight: 600 }}>Edit layout</strong> to move and resize tiles; turn it off to lock and save. Preferences are stored in this browser (
                  <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>localStorage</code> key{' '}
                  <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>{DASHBOARD_WIDGET_STORAGE_KEY}</code>
                  ).
                </p>

                <div className="glass-panel" style={{ padding: '0', borderRadius: '12px', border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
                  {DASHBOARD_WIDGET_CATALOG.map((meta, idx) => {
                    const visible = !dashPrefs.hidden.includes(meta.id);
                    return (
                      <div
                        key={meta.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          gap: '12px',
                          alignItems: 'center',
                          padding: '12px 14px',
                          borderBottom: idx < DASHBOARD_WIDGET_CATALOG.length - 1 ? '1px solid var(--glass-border)' : 'none',
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={visible}
                            onChange={() => toggleDashWidget(meta.id)}
                            aria-label={`Show ${meta.label}`}
                          />
                        </label>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>{meta.label}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>{meta.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn" onClick={resetDashWidgets}>
                    <span className="material-icons-round" style={{ fontSize: '18px' }}>restart_alt</span>
                    Reset layout
                  </button>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>admin_panel_settings</span>
                GUI security
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>New GUI Password</label>
                  <input
                    type="password"
                    value={guiPasswordNew}
                    onChange={e => setGuiPasswordNew(e.target.value)}
                    className="text-input"
                    placeholder="Enter a new password"
                    autoComplete="new-password"
                  />
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Leave blank to keep your current password.
                  </p>
                </div>
                <div className="form-group">
                  <label>Confirm New Password</label>
                  <input
                    type="password"
                    value={guiPasswordConfirm}
                    onChange={e => setGuiPasswordConfirm(e.target.value)}
                    className="text-input"
                    placeholder="Re-enter the new password"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>webhook</span>
                Outbound webhooks
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                Optional HTTP POST for automation when the monitor detects loss of connectivity, port forwarding failures, or a missing Gluetun container. JSON body includes <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>event</code>, <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>timestamp</code>, and details. Not passed to Gluetun.
              </p>
              <div className="form-group">
                <label>Webhook URL</label>
                <input type="url" name="GUI_NOTIFY_WEBHOOK_URL" value={config.GUI_NOTIFY_WEBHOOK_URL || ''} onChange={handleChange} className="text-input" placeholder="https://example.com/hooks/gluetun" />
              </div>
              <div className="form-group">
                <label>Webhook bearer secret (optional)</label>
                <input type="password" name="GUI_NOTIFY_WEBHOOK_SECRET" value={config.GUI_NOTIFY_WEBHOOK_SECRET || ''} onChange={handleChange} className="text-input" placeholder="Sent as Authorization: Bearer …" autoComplete="off" />
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
                Quiet hours use the <strong style={{ fontWeight: 600 }}>server clock</strong> (usually UTC in Docker). No outbound webhook POSTs are sent during this window.
              </p>
              <div className="toggle-switch-container" style={{ padding: '12px 16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '12px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Webhook quiet hours</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Suppress monitor webhooks (GUI .env)</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    name="GUI_NOTIFY_QUIET_ENABLED"
                    checked={config.GUI_NOTIFY_QUIET_ENABLED === 'on' || config.GUI_NOTIFY_QUIET_ENABLED === 'true'}
                    onChange={(e) => setConfig((c) => ({ ...c, GUI_NOTIFY_QUIET_ENABLED: e.target.checked ? 'on' : 'off' }))}
                  />
                  <span className="slider"></span>
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group">
                  <label>Quiet start (HH:MM)</label>
                  <input type="text" name="GUI_NOTIFY_QUIET_START" value={config.GUI_NOTIFY_QUIET_START || '22:00'} onChange={handleChange} className="text-input" placeholder="22:00" />
                </div>
                <div className="form-group">
                  <label>Quiet end (HH:MM)</label>
                  <input type="text" name="GUI_NOTIFY_QUIET_END" value={config.GUI_NOTIFY_QUIET_END || '07:00'} onChange={handleChange} className="text-input" placeholder="07:00" />
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>notifications</span>
                Notifications
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '12px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Enable Notifications</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Controls the in-app notification center</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={notifyPrefs?.enabled !== false}
                    onChange={(e) => setNotifyPrefs(p => ({ ...p, enabled: e.target.checked }))}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '16px' }}>
                  <strong style={{ display: 'block', marginBottom: '10px' }}>Sources</strong>
                  {['settings', 'dashboard', 'monitor', 'logs'].map(src => (
                    <div key={src} className="toggle-switch-container" style={{ padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                      <div className="toggle-info">
                        <strong style={{ fontSize: '14px' }}>{src}</strong>
                        <span>Show notifications from {src}</span>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={notifyPrefs?.sources?.[src] !== false}
                          onChange={(e) => setNotifyPrefs(p => ({ ...p, sources: { ...(p.sources || {}), [src]: e.target.checked } }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  ))}
                </div>

                <div className="glass-panel" style={{ padding: '16px' }}>
                  <strong style={{ display: 'block', marginBottom: '10px' }}>Toast popups</strong>
                  {['success', 'error', 'warning', 'info'].map(level => (
                    <div key={level} className="toggle-switch-container" style={{ padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                      <div className="toggle-info">
                        <strong style={{ fontSize: '14px' }}>{level}</strong>
                        <span>Show toast popup for {level}</span>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!notifyPrefs?.toasts?.[level]}
                          onChange={(e) => setNotifyPrefs(p => ({ ...p, toasts: { ...(p.toasts || {}), [level]: e.target.checked } }))}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  ))}
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '10px' }}>
                    Tip: keep warnings in the bell, and reserve toasts for errors/success.
                  </p>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '16px', marginTop: '12px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <strong style={{ display: 'block', marginBottom: '8px' }}>Local quiet hours (this browser)</strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                  Suppresses <strong style={{ fontWeight: 600 }}>toast popups</strong> only during the window; the notification bell still receives items.
                </p>
                <div className="toggle-switch-container" style={{ padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }}>
                  <div className="toggle-info">
                    <strong style={{ fontSize: '14px' }}>Enable</strong>
                    <span>Uses your computer local time</span>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={!!notifyPrefs?.quietHours?.enabled}
                      onChange={(e) => setNotifyPrefs((p) => ({ ...p, quietHours: { ...(p.quietHours || {}), enabled: e.target.checked } }))}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Start</label>
                    <input
                      type="text"
                      className="text-input"
                      value={notifyPrefs?.quietHours?.start || '22:00'}
                      onChange={(e) => setNotifyPrefs((p) => ({ ...p, quietHours: { ...(p.quietHours || {}), start: e.target.value } }))}
                      placeholder="22:00"
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>End</label>
                    <input
                      type="text"
                      className="text-input"
                      value={notifyPrefs?.quietHours?.end || '07:00'}
                      onChange={(e) => setNotifyPrefs((p) => ({ ...p, quietHours: { ...(p.quietHours || {}), end: e.target.value } }))}
                      placeholder="07:00"
                    />
                  </div>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>save_alt</span>
                Backup &amp; restore
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                Download your GUI config as <code style={{ fontSize: '12px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>.env</code> text. Import applies the same pipeline as <strong style={{ fontWeight: 600 }}>Save All Changes</strong> (rewrites the GUI store and recreates Gluetun).
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <button type="button" className="btn" onClick={() => downloadConfigExport(true)}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>visibility_off</span>
                  Download (redacted)
                </button>
                <button type="button" className="btn" onClick={() => downloadConfigExport(false)} style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', color: 'var(--warning)' }}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>warning</span>
                  Download full
                </button>
              </div>
              <input
                ref={importEnvRef}
                type="file"
                accept=".env,.txt,text/plain"
                style={{ display: 'none' }}
                onChange={handleImportEnvFile}
              />
              <button type="button" className="btn btn-primary" onClick={() => importEnvRef.current?.click()}>
                <span className="material-icons-round" style={{ fontSize: '18px' }}>upload_file</span>
                Import from file…
              </button>

              <h4 style={{ fontSize: '15px', fontWeight: 600, margin: '20px 0 10px 0' }}>Scheduled data backup</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                Writes <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>.tar.gz</code> under <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>DATA_DIR/backups/</code> (gui-config, sessions, VPN probe state, gluetun.env, wireguard/). Requires <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>DATA_DIR</code> on the server.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
                <div className="form-group">
                  <label>Interval (hours, 0 = off)</label>
                  <input type="number" min="0" step="1" name="GUI_BACKUP_INTERVAL_HOURS" value={config.GUI_BACKUP_INTERVAL_HOURS ?? ''} onChange={handleChange} className="text-input" placeholder="0" />
                </div>
                <div className="form-group">
                  <label>Retention (archives to keep)</label>
                  <input type="number" min="1" max="500" name="GUI_BACKUP_RETENTION" value={config.GUI_BACKUP_RETENTION ?? '10'} onChange={handleChange} className="text-input" />
                </div>
              </div>
              <div className="form-group">
                <label>Diff history max entries</label>
                <input type="number" min="5" max="200" name="GUI_DIFF_HISTORY_MAX" value={config.GUI_DIFF_HISTORY_MAX ?? '30'} onChange={handleChange} className="text-input" />
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>After each successful save, redacted GUI env diffs are appended on the server.</p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={homelabBackupBusy}
                  onClick={async () => {
                    setHomelabBackupBusy(true);
                    try {
                      const token = localStorage.getItem('token');
                      const r = await fetch('/api/homelab/backup-run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                      const d = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(d.error || `Backup failed (${r.status})`);
                      notify({ level: 'success', title: 'Backup created', message: d.filename || 'Archive written', source: 'settings', dedupeKey: 'homelab_backup_ok' });
                      refreshHomelabBackups();
                    } catch (e) {
                      notify({ level: 'error', title: 'Backup failed', message: e.message, source: 'settings', dedupeKey: 'homelab_backup_err' });
                    } finally {
                      setHomelabBackupBusy(false);
                    }
                  }}
                >
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>archive</span>
                  {homelabBackupBusy ? 'Running…' : 'Run backup now'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      const token = localStorage.getItem('token');
                      const r = await fetch('/api/compose-snippet', { headers: { Authorization: `Bearer ${token}` } });
                      const text = await r.text();
                      if (!r.ok) {
                        let err = text;
                        try {
                          const j = JSON.parse(text);
                          err = j.error || err;
                        } catch { /* use text */ }
                        throw new Error(err || `HTTP ${r.status}`);
                      }
                      await navigator.clipboard.writeText(text);
                      notify({ level: 'success', title: 'Compose snippet copied', message: 'Paste into a client stack YAML.', source: 'settings', dedupeKey: 'compose_snippet_copy' });
                    } catch (e) {
                      notify({ level: 'error', title: 'Copy failed', message: e.message, source: 'settings', dedupeKey: 'compose_snippet_err' });
                    }
                  }}
                >
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>content_copy</span>
                  Copy compose client snippet
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    setDiffHistoryLoading(true);
                    setDiffHistoryOpen(true);
                    try {
                      const token = localStorage.getItem('token');
                      const r = await fetch('/api/config/diff-history', { headers: { Authorization: `Bearer ${token}` } });
                      const d = await r.json();
                      setDiffHistoryEntries(Array.isArray(d.entries) ? d.entries : []);
                    } catch {
                      setDiffHistoryEntries([]);
                    } finally {
                      setDiffHistoryLoading(false);
                    }
                  }}
                >
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>history</span>
                  View config diff history
                </button>
              </div>
              {homelabBackups.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', maxHeight: '140px', overflow: 'auto', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Recent archives</strong>
                  <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
                    {homelabBackups.slice(0, 12).map((b) => (
                      <li key={b.name} style={{ marginBottom: '4px' }}>
                        {b.name} — {(b.size / 1024).toFixed(1)} KiB — {b.mtime}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diffHistoryOpen && (
                <div
                  role="presentation"
                  onClick={() => setDiffHistoryOpen(false)}
                  style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.45)',
                  zIndex: 1000,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px',
                }}
                >
                  <div
                    role="dialog"
                    className="glass-panel"
                    onClick={(e) => e.stopPropagation()}
                    style={{ maxWidth: '720px', width: '100%', maxHeight: '80vh', overflow: 'auto', padding: '20px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '18px' }}>Config diff history</h3>
                      <button type="button" className="btn" onClick={() => setDiffHistoryOpen(false)}>Close</button>
                    </div>
                    {diffHistoryLoading ? (
                      <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
                    ) : diffHistoryEntries.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)' }}>No entries yet. Save settings after upgrading to populate.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {[...diffHistoryEntries].reverse().map((entry, idx) => (
                          <div key={`${entry.at}-${idx}`} style={{ border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '10px', fontSize: '12px' }}>
                            <div style={{ fontWeight: 600, marginBottom: '6px' }}>{entry.at} — {entry.changeCount} change(s)</div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px', maxHeight: '200px', overflow: 'auto' }}>
                              {JSON.stringify(entry.changes, null, 2)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'advanced' && (
            <>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--glass-highlight)', marginBottom: '16px' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>warning</span>
                  Low-level Gluetun container options. GUI login and notification preferences are under <strong style={{ fontWeight: 600 }}>This app</strong>.
                </p>
              </div>

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>bug_report</span>
                Logging &amp; debugging
              </h3>
              
              <div className="form-group">
                <label>Gluetun Log Level</label>
                <select name="LOG_LEVEL" value={config.LOG_LEVEL || 'info'} onChange={handleChange} className="select-input">
                  <option value="debug">Debug (Verbose)</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>monitor_heart</span>
                Health check
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '16px' }}>Auto-Restart VPN on Failure</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Automatically restart VPN if health check fails (recommended)</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="HEALTH_RESTART_VPN" checked={config.HEALTH_RESTART_VPN !== 'off'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>TCP+TLS Health Targets</label>
                  <input type="text" name="HEALTH_TARGET_ADDRESSES" value={config.HEALTH_TARGET_ADDRESSES || ''} onChange={handleChange} className="text-input" placeholder="cloudflare.com:443,github.com:443" />
                </div>
                <div className="form-group">
                  <label>ICMP Ping Targets</label>
                  <input type="text" name="HEALTH_ICMP_TARGET_IPS" value={config.HEALTH_ICMP_TARGET_IPS || ''} onChange={handleChange} className="text-input" placeholder="1.1.1.1,8.8.8.8" />
                </div>
              </div>

              <div className="form-group">
                <label>Health Server Address</label>
                <input type="text" name="HEALTH_SERVER_ADDRESS" value={config.HEALTH_SERVER_ADDRESS || ''} onChange={handleChange} className="text-input" placeholder="127.0.0.1:9999" />
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />
              
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>update</span>
                Servers Updater
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Updater Period</label>
                  <input type="text" name="UPDATER_PERIOD" value={config.UPDATER_PERIOD || ''} onChange={handleChange} className="text-input" placeholder="e.g. 24h, 30m (0 = off)" />
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '6px 0 0 0', lineHeight: 1.45 }}>
                    Gluetun requires a <strong style={{ fontWeight: 600 }}>unit</strong> (h, m, s). A plain number like <code style={{ fontSize: '10px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>12</code> is invalid; use <code style={{ fontSize: '10px', background: 'var(--code-bg)', padding: '2px 5px', borderRadius: '4px' }}>12h</code>. Saving from this GUI turns bare numbers into hours automatically.
                  </p>
                </div>
                <div className="form-group">
                  <label>Updater Min Ratio</label>
                  <input type="number" step="0.1" name="UPDATER_MIN_RATIO" value={config.UPDATER_MIN_RATIO || ''} onChange={handleChange} className="text-input" placeholder="0.8" />
                </div>
              </div>
              <div className="form-group">
                <label>Updater VPN Service Providers</label>
                <input type="text" name="UPDATER_VPN_SERVICE_PROVIDERS" value={config.UPDATER_VPN_SERVICE_PROVIDERS || ''} onChange={handleChange} className="text-input" placeholder="Comma separated, e.g. mullvad,pia" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>ProtonVPN Email (for paid server data)</label>
                  <input type="text" name="UPDATER_PROTONVPN_EMAIL" value={config.UPDATER_PROTONVPN_EMAIL || ''} onChange={handleChange} className="text-input" placeholder="proton@email.com" />
                </div>
                <div className="form-group">
                  <label>ProtonVPN Password</label>
                  <input type="password" name="UPDATER_PROTONVPN_PASSWORD" value={config.UPDATER_PROTONVPN_PASSWORD || ''} onChange={handleChange} className="text-input" placeholder="ProtonVPN account password" />
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />
              
              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>settings</span>
                System &amp; identity
              </h3>

              <div className="toggle-switch-container" style={{ padding: '16px', background: 'var(--surface-2)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '16px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Public IP check</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Log and track public IP on connect (uses PUBLICIP_* settings below)</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="PUBLICIP_ENABLED" checked={config.PUBLICIP_ENABLED !== 'false'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Timezone (TZ)</label>
                  <input type="text" name="TZ" value={config.TZ || ''} onChange={handleChange} className="text-input" placeholder="America/New_York" />
                </div>
                <div className="form-group">
                  <label>PUID (User ID)</label>
                  <input type="number" name="PUID" value={config.PUID || ''} onChange={handleChange} className="text-input" placeholder="1000" />
                </div>
                <div className="form-group">
                  <label>PGID (Group ID)</label>
                  <input type="number" name="PGID" value={config.PGID || ''} onChange={handleChange} className="text-input" placeholder="1000" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>VPN Interface Name</label>
                  <input type="text" name="VPN_INTERFACE" value={config.VPN_INTERFACE || ''} onChange={handleChange} className="text-input" placeholder="tun0" />
                </div>
                <div className="form-group">
                  <label>Public IP API</label>
                  <input type="text" name="PUBLICIP_API" value={config.PUBLICIP_API || ''} onChange={handleChange} className="text-input" placeholder="ipinfo,ifconfigco,ip2location,cloudflare" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>Public IP API Token</label>
                  <input type="password" name="PUBLICIP_API_TOKEN" value={config.PUBLICIP_API_TOKEN || ''} onChange={handleChange} className="text-input" placeholder="Optional API token for rate limiting" />
                </div>
                <div className="form-group">
                  <label>Public IP File Path</label>
                  <input type="text" name="PUBLICIP_FILE" value={config.PUBLICIP_FILE || ''} onChange={handleChange} className="text-input" placeholder="/tmp/gluetun/ip" />
                </div>
              </div>

              <div className="toggle-switch-container" style={{ marginTop: '8px' }}>
                <div className="toggle-info">
                  <strong style={{ fontSize: '15px' }}>Version Information</strong>
                  <span>Log a message if a newer Gluetun version is available</span>
                </div>
                <label className="switch">
                  <input type="checkbox" name="VERSION_INFORMATION" checked={config.VERSION_INFORMATION !== 'off'} onChange={handleChange} />
                  <span className="slider"></span>
                </label>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '16px 0' }} />

              <h3 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>terminal</span>
                VPN Lifecycle Hooks
              </h3>

              <div style={{
                padding: '14px 16px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.22)',
                marginBottom: '12px',
              }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                  <span className="material-icons-round" style={{ color: 'var(--accent-primary)', fontSize: '24px', flexShrink: 0, lineHeight: 1 }}>info</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.01em', marginBottom: '6px' }}>
                      Shell hooks
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: 1.55 }}>
                      Gluetun runs <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>VPN_UP_COMMAND</code> when the tunnel is up and <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>VPN_DOWN_COMMAND</code> when it goes down.
                    </p>
                    <ul style={{
                      margin: 0,
                      paddingLeft: '1.1rem',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      lineHeight: 1.55,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}>
                      <li>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Placeholder</span>{' '}
                        <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>{'{{VPN_INTERFACE}}'}</code>
                        {' '}is replaced with the tunnel device name (same idea as <strong style={{ fontWeight: 600 }}>VPN interface name</strong> above, e.g.{' '}
                        <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>tun0</code>
                        ).
                      </li>
                      <li>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Multiple steps</span>{' '}
                        use one shell line per field, or wrap in <code style={{ fontSize: '11px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>/bin/sh -c &apos;…&apos;</code>.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div className="form-group">
                  <label>VPN Up Command</label>
                  <input type="text" name="VPN_UP_COMMAND" value={config.VPN_UP_COMMAND || ''} onChange={handleChange} className="text-input" placeholder="/bin/sh -c 'echo connected'" />
                </div>
                <div className="form-group">
                  <label>VPN Down Command</label>
                  <input type="text" name="VPN_DOWN_COMMAND" value={config.VPN_DOWN_COMMAND || ''} onChange={handleChange} className="text-input" placeholder="/bin/sh -c 'echo disconnected'" />
                </div>
              </div>

            </>
          )}

          <div
            style={{
              marginTop: '8px',
              paddingTop: '24px',
              borderTop: '1px solid var(--glass-border)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          >
            <p style={{ flex: '1 1 220px', margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Applies all tabs, then recreates Gluetun. <strong style={{ fontWeight: 600 }}>Save &amp; connect</strong> runs an outbound VPN check after a successful save (same as Dashboard → Test VPN connectivity).
            </p>
            <button type="button" className="btn" disabled={saving} onClick={(e) => handleSave(e)}>
              <span className="material-icons-round">save</span>
              {saving ? 'Saving…' : 'Save all changes'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={(e) => handleSaveAndConnect(e)}
              style={{ background: 'var(--success)', boxShadow: '0 4px 14px rgba(16,185,129,0.25)' }}
            >
              <span className="material-icons-round">{saving ? 'hourglass_top' : 'cable'}</span>
              {saving ? 'Saving…' : 'Save & connect'}
            </button>
          </div>

        </form>
      </div>

      {saveDiffModal.open && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => {
            if (!saving) setSaveDiffModal({ open: false, changes: [], pending: null, runVpnProbeAfter: false });
          }}
        >
          <div
            className="glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-diff-title"
            style={{ maxWidth: '640px', width: '100%', maxHeight: '80vh', overflow: 'auto', padding: '24px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="save-diff-title" style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600 }}>
              Confirm configuration changes
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Saving recreates the Gluetun container with the merged environment. Secret values are redacted below.
            </p>
            <div className="custom-scrollbar" style={{ maxHeight: '42vh', overflow: 'auto', border: '1px solid var(--glass-border)', borderRadius: '8px', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Key</th>
                    <th style={{ padding: '8px 10px' }}>Before</th>
                    <th style={{ padding: '8px 10px' }}>After</th>
                  </tr>
                </thead>
                <tbody>
                  {saveDiffModal.changes.map((row) => (
                    <tr key={row.key} style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{row.key}</td>
                      <td style={{ padding: '8px 10px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{row.before || '—'}</td>
                      <td style={{ padding: '8px 10px', wordBreak: 'break-all' }}>{row.after || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn" disabled={saving} onClick={() => setSaveDiffModal({ open: false, changes: [], pending: null, runVpnProbeAfter: false })}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={confirmSaveAfterDiff}>
                {saving ? 'Saving…' : (saveDiffModal.runVpnProbeAfter ? 'Save, apply & test VPN' : 'Save & apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
