import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactGridLayout, { WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useNotifications } from '../contexts/NotificationsContext';
import { useToast } from '../contexts/ToastContext';
import { useDashboardWidgets } from '../hooks/useDashboardWidgets';
import {
  ConnectionStatusWidget,
  ProtocolWidget,
  ResourcesWidget,
  NetworkThroughputWidget,
  ThroughputChartWidget,
  InternalNetworkWidget,
  PiaMonitoringWidget,
  ProxyPortsWidget,
  DnsFirewallWidget,
  QbittorrentDashboardWidget,
  SabnzbdDashboardWidget,
} from '../dashboard/DashboardPanels';

const DashboardGridLayout = WidthProvider(ReactGridLayout);

export default function Dashboard() {
  const navigate = useNavigate();
  const { notify } = useNotifications();
  const addToast = useToast();
  const {
    layout,
    setLayout,
    visibleOrderedIds,
    layoutEditMode,
    setLayoutEditMode,
    persistAndLockLayout,
  } = useDashboardWidgets();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [vpnTestBusy, setVpnTestBusy] = useState(false);
  const [piaMonitoring, setPiaMonitoring] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const netPrevRef = useRef({ rx: 0, tx: 0, time: Date.now() });
  const [netHistory, setNetHistory] = useState([]);
  const piaMonitorNotifySig = useRef('');

  const formatBytes = (bytes, decimals = 1) => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = Math.max(0, decimals);
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const envMap = {};
        if (data.env) {
          data.env.forEach(e => {
            const [k, v] = e.split('=');
            envMap[k] = v;
          });
        }
        data.parsedEnv = envMap;
        setStatus(data);
      } else {
        setStatus({ error: true });
      }
    } catch {
      setStatus({ error: true });
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/metrics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const stats = await res.json();

        let cpuPercent = 0;
        if (stats.cpu_stats && stats.precpu_stats) {
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
          const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
          if (systemDelta > 0 && cpuDelta > 0) {
            cpuPercent = (cpuDelta / systemDelta) * (stats.cpu_stats.online_cpus || 1) * 100.0;
          }
        }

        let ramUsage = 0;
        if (stats.memory_stats) {
          ramUsage = stats.memory_stats.usage || 0;
        }

        let rx_bytes = 0;
        let tx_bytes = 0;
        if (stats.networks) {
          const net = stats.networks.tun0 || stats.networks.eth0 || { rx_bytes: 0, tx_bytes: 0 };
          rx_bytes = net.rx_bytes;
          tx_bytes = net.tx_bytes;
        }

        const prev = netPrevRef.current;
        const now = Date.now();
        const timeDiff = (now - prev.time) / 1000;
        let rxSpeed = 0;
        let txSpeed = 0;
        if (timeDiff > 0 && prev.rx > 0) {
          rxSpeed = Math.max(0, (rx_bytes - prev.rx) / timeDiff);
          txSpeed = Math.max(0, (tx_bytes - prev.tx) / timeDiff);
        }
        netPrevRef.current = { rx: rx_bytes, tx: tx_bytes, time: now };

        setMetrics({
          cpu: cpuPercent.toFixed(1),
          ramUsageBytes: ramUsage,
          rxSpeed,
          txSpeed,
          totalRx: rx_bytes,
          totalTx: tx_bytes,
        });

        setNetHistory((prevHist) => {
          const histItem = {
            time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            Incoming: rxSpeed / 1024,
            Outgoing: txSpeed / 1024,
          };
          const newHist = [...prevHist, histItem];
          return newHist.slice(Math.max(newHist.length - 15, 0));
        });
      }
    } catch (err) {
      console.error("Error fetching metrics", err);
    }
  };

  const fetchPiaMonitoring = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/pia/monitoring', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setPiaMonitoring(data);
    } catch {
      // silent
    }
  };

  // Notifications from monitoring — only when meaningful fields change (poll returns new object each time)
  useEffect(() => {
    if (!piaMonitoring) return;
    const sig = [
      piaMonitoring.failCount ?? '',
      piaMonitoring.port ?? '',
      piaMonitoring.lastForwardedPort ?? '',
      piaMonitoring.publicIp ?? '',
      piaMonitoring.portForwarding ? '1' : '0',
    ].join('|');
    if (sig === piaMonitorNotifySig.current) return;
    piaMonitorNotifySig.current = sig;

    if (typeof piaMonitoring.failCount === 'number' && piaMonitoring.failCount > 0) {
      notify({
        level: 'warning',
        title: `VPN connectivity issues (${piaMonitoring.failCount}/3)`,
        message: piaMonitoring.publicIp ? `Public IP: ${piaMonitoring.publicIp}` : 'Monitoring detected connectivity problems.',
        source: 'monitor',
        dedupeKey: 'monitor_connectivity',
      });
    }
    if (piaMonitoring.portForwarding && (piaMonitoring.port || piaMonitoring.lastForwardedPort)) {
      const p = piaMonitoring.port || piaMonitoring.lastForwardedPort;
      notify({
        level: 'success',
        title: 'Port forwarding active',
        message: `Forwarded port: ${p}`,
        source: 'monitor',
        dedupeKey: 'monitor_pf_active',
      });
    }
  }, [notify, piaMonitoring]);

  useEffect(() => {
    fetchStatus();
    fetchMetrics();
    fetchPiaMonitoring();
    const statusInterval = setInterval(fetchStatus, 3000);
    const metricsInterval = setInterval(fetchMetrics, 1500);
    const piaMonInterval = setInterval(fetchPiaMonitoring, 10000);
    return () => {
      clearInterval(statusInterval);
      clearInterval(metricsInterval);
      clearInterval(piaMonInterval);
    };
  }, []);

  const toggleSetting = useCallback(async (key, currentValue) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      // 1. Fetch current full config to avoid overwriting other settings
      const res = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
      const currentConfig = await res.json();
      
      // 2. Toggle value
      const newValue = currentValue === 'on' ? 'off' : 'on';
      const updatedConfig = { ...currentConfig, [key]: newValue };

      // 3. Save new config
      const saveRes = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updatedConfig)
      });

      // 4. Refresh status to update UI
      await fetchStatus();
      if (saveRes.ok) {
        notify({
          level: 'success',
          title: 'Setting updated',
          message: `${key} is now ${newValue}`,
          source: 'dashboard',
          dedupeKey: `toggle_${key}`,
        });
      } else {
        const errData = await saveRes.json().catch(() => ({}));
        notify({
          level: 'error',
          title: 'Setting update failed',
          message: errData.error || `HTTP ${saveRes.status}`,
          source: 'dashboard',
          dedupeKey: `toggle_err_${key}`,
        });
      }
    } catch (err) {
      console.error("Error toggling setting:", err);
      notify({ level: 'error', title: 'Setting update failed', message: err.message, source: 'dashboard', dedupeKey: 'toggle_exc' });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const handleRestart = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/restart', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
      if (res.ok) {
        notify({ level: 'success', title: 'Gluetun restarted', message: 'VPN container restart completed.', source: 'dashboard', dedupeKey: 'gluetun_restart' });
      } else {
        const err = await res.json().catch(() => ({}));
        notify({ level: 'error', title: 'Restart failed', message: err.error || `HTTP ${res.status}`, source: 'dashboard', dedupeKey: 'gluetun_restart_err' });
      }
    } catch (e) {
      console.error(e);
      notify({ level: 'error', title: 'Restart failed', message: e.message, source: 'dashboard', dedupeKey: 'gluetun_restart_exc' });
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/stop', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
      if (res.ok) {
        notify({ level: 'warning', title: 'Gluetun stopped', message: 'VPN container was stopped.', source: 'dashboard', dedupeKey: 'gluetun_stop' });
      } else {
        const err = await res.json().catch(() => ({}));
        notify({ level: 'error', title: 'Stop failed', message: err.error || `HTTP ${res.status}`, source: 'dashboard', dedupeKey: 'gluetun_stop_err' });
      }
    } catch (e) {
      console.error(e);
      notify({ level: 'error', title: 'Stop failed', message: e.message, source: 'dashboard', dedupeKey: 'gluetun_stop_exc' });
      setLoading(false);
    }
  };

  const handleConnectivityTest = async () => {
    setMenuOpen(false);
    setVpnTestBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/vpn/connectivity-test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        notify({
          level: 'success',
          title: 'VPN connectivity OK',
          message: `Public IP: ${data.publicIp || '—'} (${data.method || 'probe'})`,
          source: 'dashboard',
          dedupeKey: 'vpn_connectivity_ok',
        });
      } else {
        notify({
          level: 'error',
          title: 'VPN connectivity check failed',
          message: (data.detail || data.error || res.statusText || 'No response from tunnel').slice(0, 240),
          source: 'dashboard',
          dedupeKey: 'vpn_connectivity_fail',
        });
      }
    } catch (e) {
      notify({
        level: 'error',
        title: 'VPN connectivity check failed',
        message: e.message,
        source: 'dashboard',
        dedupeKey: 'vpn_connectivity_exc',
      });
    } finally {
      setVpnTestBusy(false);
    }
  };

  const handleTestFailover = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/test-failover', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        notify({
          level: 'success',
          title: 'Failover rotation run',
          message: (data.message || 'Region rotation executed.').slice(0, 200),
          source: 'dashboard',
          dedupeKey: 'test_failover_ok',
        });
      } else {
        const err = await res.json().catch(() => ({}));
        notify({ level: 'error', title: 'Failover failed', message: err.error || `HTTP ${res.status}`, source: 'dashboard', dedupeKey: 'test_failover_err' });
      }
    } catch (e) {
      console.error(e);
      notify({ level: 'error', title: 'Failover failed', message: e.message, source: 'dashboard', dedupeKey: 'test_failover_exc' });
    } finally {
      setLoading(false);
    }
  };

  const isConnected = status && status.status === 'running';

  const qbitDashboardAllowed = useMemo(() => {
    const gui = status?.gui || {};
    return gui.GUI_QBITTORRENT_ENABLED === 'on' && gui.GUI_QBITTORRENT_DASHBOARD_WIDGET === 'on';
  }, [status]);

  const sabDashboardAllowed = useMemo(() => {
    const gui = status?.gui || {};
    return gui.GUI_SABNZBD_ENABLED === 'on' && gui.GUI_SABNZBD_DASHBOARD_WIDGET === 'on';
  }, [status]);

  const onGridLayoutChange = useCallback((newLayout) => {
    setLayout(newLayout.map((it) => ({ ...it })));
  }, [setLayout]);

  const gridLayout = useMemo(() => {
    const filtered = visibleOrderedIds
      .filter((id) => id !== 'qbittorrent' || qbitDashboardAllowed)
      .filter((id) => id !== 'sabnzbd' || sabDashboardAllowed);
    const vis = new Set(filtered);
    return layout.filter((l) => vis.has(l.i));
  }, [layout, visibleOrderedIds, qbitDashboardAllowed, sabDashboardAllowed]);

  const renderWidget = useCallback((id) => {
    switch (id) {
      case 'connection':
        return <ConnectionStatusWidget status={status} loading={loading} piaMonitoring={piaMonitoring} isConnected={isConnected} />;
      case 'protocol':
        return <ProtocolWidget status={status} />;
      case 'resources':
        return <ResourcesWidget metrics={metrics} formatBytes={formatBytes} />;
      case 'network':
        return <NetworkThroughputWidget metrics={metrics} formatBytes={formatBytes} />;
      case 'throughputChart':
        return <ThroughputChartWidget netHistory={netHistory} navigate={navigate} />;
      case 'internalNetwork':
        return <InternalNetworkWidget status={status} loading={loading} toggleSetting={toggleSetting} />;
      case 'monitoring':
        return <PiaMonitoringWidget piaMonitoring={piaMonitoring} />;
      case 'proxyPorts':
        return <ProxyPortsWidget status={status} />;
      case 'dnsFirewall':
        return <DnsFirewallWidget status={status} />;
      case 'qbittorrent':
        return <QbittorrentDashboardWidget addToast={addToast} />;
      case 'sabnzbd':
        return <SabnzbdDashboardWidget addToast={addToast} />;
      default:
        return null;
    }
  }, [status, loading, piaMonitoring, isConnected, metrics, netHistory, navigate, toggleSetting]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header className="header">
        <div className="header-title">
          <h2>Overview</h2>
          <p>Manage your VPN connections and proxy settings instantly</p>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', maxWidth: '560px' }}>
            {layoutEditMode ? (
              <>
                <strong style={{ fontWeight: 600 }}>Edit mode:</strong> drag the grip on each tile or resize from edges and corners. Turn off <strong style={{ fontWeight: 600 }}>Edit layout</strong> in <strong style={{ fontWeight: 600 }}>Quick Actions</strong> when done to lock and save.
              </>
            ) : (
              <>
                Layout is <strong style={{ fontWeight: 600 }}>locked</strong>. Open <strong style={{ fontWeight: 600 }}>Quick Actions</strong> to turn on <strong style={{ fontWeight: 600 }}>Edit layout</strong> or open <strong style={{ fontWeight: 600 }}>Widgets</strong> in Settings.
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn btn-primary" style={{ color: '#ffffff' }} onClick={() => setMenuOpen(!menuOpen)}>
              <span className="material-icons-round">settings</span>
              Quick Actions
              <span className="material-icons-round" style={{ fontSize: '18px', margin: 0 }}>arrow_drop_down</span>
            </button>

            {menuOpen && (
              <div className="dropdown-menu">
                <div
                  className="dropdown-menu-section"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="toggle-switch-container"
                    style={{
                      padding: '8px 0',
                      margin: 0,
                      background: 'transparent',
                      gap: '12px',
                    }}
                  >
                    <div className="toggle-info" style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--accent-primary)' }}>
                          {layoutEditMode ? 'edit' : 'lock'}
                        </span>
                        Edit layout
                      </strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {layoutEditMode ? 'Unlocked — save when you lock' : 'Locked — layout saved in this browser'}
                      </span>
                    </div>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={layoutEditMode}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setLayoutEditMode(true);
                          } else {
                            persistAndLockLayout();
                            addToast('Layout saved and locked', 'success', { dedupeKey: 'dashboard-layout-locked' });
                          }
                        }}
                        aria-label={layoutEditMode ? 'Lock dashboard layout' : 'Unlock dashboard layout'}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/settings', { state: { settingsTab: 'application', settingsAppSub: 'dashboard', scrollTo: 'dashboard-widgets' } });
                  }}
                >
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>tune</span>
                  Widgets
                </button>
                <div className="dropdown-menu-divider" role="separator" />
                <button type="button" className="dropdown-item" onClick={() => { setMenuOpen(false); handleRestart(); }} disabled={loading}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>autorenew</span>
                  {loading ? 'Waiting...' : 'Restart Engine'}
                </button>
                <button type="button" className="dropdown-item" onClick={() => { handleConnectivityTest(); }} disabled={loading || vpnTestBusy}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>network_ping</span>
                  {vpnTestBusy ? 'Testing…' : 'Test VPN connectivity'}
                </button>
                <button type="button" className="dropdown-item" onClick={() => { setMenuOpen(false); handleTestFailover(); }} disabled={loading}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>rotate_right</span>
                  {loading ? 'Waiting...' : 'Test Auto-Failover'}
                </button>
                <button type="button" className="dropdown-item danger" onClick={() => { setMenuOpen(false); handleStop(); }} disabled={loading}>
                  <span className="material-icons-round" style={{ fontSize: '18px' }}>power_settings_new</span>
                  {loading ? 'Waiting...' : 'Kill VPN'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {visibleOrderedIds
        .filter((id) => id !== 'qbittorrent' || qbitDashboardAllowed)
        .filter((id) => id !== 'sabnzbd' || sabDashboardAllowed).length === 0 ? (
        <div className="glass-panel" style={{ padding: '32px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>All dashboard widgets are hidden.</p>
          <Link to="/settings" state={{ settingsTab: 'application', settingsAppSub: 'dashboard', scrollTo: 'dashboard-widgets' }} className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-flex' }}>
            Configure in Settings
          </Link>
        </div>
      ) : (
        <DashboardGridLayout
          className={`dashboard-rgl${layoutEditMode ? '' : ' dashboard-rgl--locked'}`}
          layout={gridLayout}
          cols={12}
          rowHeight={22}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          onLayoutChange={layoutEditMode ? onGridLayoutChange : () => {}}
          draggableHandle=".dashboard-widget-drag"
          compactType="vertical"
          preventCollision={false}
          isDraggable={layoutEditMode}
          isResizable={layoutEditMode}
          resizeHandles={['se', 'sw', 'ne', 'nw', 's', 'n', 'e', 'w']}
        >
          {visibleOrderedIds
            .filter((id) => id !== 'qbittorrent' || qbitDashboardAllowed)
            .filter((id) => id !== 'sabnzbd' || sabDashboardAllowed)
            .map((id) => (
            <div key={id}>
              <div className="dashboard-widget-shell">
                {layoutEditMode && (
                  <div className="dashboard-widget-chrome">
                    <button type="button" className="dashboard-widget-drag" aria-label={`Move ${id} widget`}>
                      <span className="material-icons-round">drag_indicator</span>
                    </button>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Move · resize</span>
                  </div>
                )}
                <div className={`dashboard-widget-body${layoutEditMode ? '' : ' dashboard-widget-body--full'}`}>
                  {renderWidget(id)}
                </div>
              </div>
            </div>
          ))}
        </DashboardGridLayout>
      )}
    </div>
  );
}
