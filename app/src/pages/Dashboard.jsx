import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Dashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [prevNet, setPrevNet] = useState({ rx: 0, tx: 0, time: Date.now() });
  const [netHistory, setNetHistory] = useState([]);

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
    } catch (err) {
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

        setPrevNet(prev => {
          const now = Date.now();
          const timeDiff = (now - prev.time) / 1000;
          let rxSpeed = 0;
          let txSpeed = 0;
          if (timeDiff > 0 && prev.rx > 0) {
            rxSpeed = Math.max(0, (rx_bytes - prev.rx) / timeDiff);
            txSpeed = Math.max(0, (tx_bytes - prev.tx) / timeDiff);
          }

          setMetrics({
            cpu: cpuPercent.toFixed(1),
            ramUsageBytes: ramUsage,
            rxSpeed,
            txSpeed,
            totalRx: rx_bytes,
            totalTx: tx_bytes
          });

          setNetHistory(prevHist => {
            const histItem = {
              time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              Incoming: rxSpeed / 1024, // KB
              Outgoing: txSpeed / 1024, // KB
            };
            const newHist = [...prevHist, histItem];
            return newHist.slice(Math.max(newHist.length - 15, 0));
          });

          return { rx: rx_bytes, tx: tx_bytes, time: now };
        });
      }
    } catch (err) {
      console.error("Error fetching metrics", err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchMetrics();
    const statusInterval = setInterval(fetchStatus, 3000);
    const metricsInterval = setInterval(fetchMetrics, 1500);
    return () => {
      clearInterval(statusInterval);
      clearInterval(metricsInterval);
    };
  }, []);

  const toggleSetting = async (key, currentValue) => {
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
      await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updatedConfig)
      });

      // 4. Refresh status to update UI
      await fetchStatus();
    } catch (err) {
      console.error("Error toggling setting:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/restart', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/stop', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleTestFailover = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/test-failover', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      await fetchStatus();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const isConnected = status && status.status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <header className="header">
        <div className="header-title">
          <h2>Overview</h2>
          <p>Manage your VPN connections and proxy settings instantly</p>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-primary" style={{ color: '#ffffff' }} onClick={() => setMenuOpen(!menuOpen)}>
            <span className="material-icons-round">settings</span>
            Quick Actions
            <span className="material-icons-round" style={{ fontSize: '18px', margin: 0 }}>arrow_drop_down</span>
          </button>

          {menuOpen && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={() => { setMenuOpen(false); handleRestart(); }} disabled={loading}>
                <span className="material-icons-round" style={{ fontSize: '18px' }}>autorenew</span>
                {loading ? "Waiting..." : "Restart Engine"}
              </button>
              <button className="dropdown-item" onClick={() => { setMenuOpen(false); handleTestFailover(); }} disabled={loading}>
                <span className="material-icons-round" style={{ fontSize: '18px' }}>rotate_right</span>
                {loading ? "Waiting..." : "Test Auto-Failover"}
              </button>
              <button className="dropdown-item danger" onClick={() => { setMenuOpen(false); handleStop(); }} disabled={loading}>
                <span className="material-icons-round" style={{ fontSize: '18px' }}>power_settings_new</span>
                {loading ? "Waiting..." : "Kill VPN"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="dashboard-grid">
        <div className={`glass-panel status-card ${isConnected ? 'connected' : 'error'}`}>
          <div className="status-header">
            <div className="status-icon-wrapper">
              <span className="material-icons-round">{isConnected ? 'public' : 'warning'}</span>
            </div>
            <span className={`status-badge ${isConnected ? 'online' : 'offline'}`}>
              {isConnected ? 'PROTECTED' : 'OFFLINE'}
            </span>
          </div>

          <div className="status-info">
            <h3>{status?.parsedEnv?.VPN_SERVICE_PROVIDER || 'Mullvad'}</h3>
            {status?.currentSession?.publicIp ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '6px 0 8px 0' }}>
                <span style={{ fontSize: '14px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
                  <span className="material-icons-round" style={{ fontSize: '16px' }}>my_location</span>
                  {status.currentSession.publicIp} • {status.currentSession.location}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-icons-round" style={{ fontSize: '14px' }}>dns</span>
                  Active Node: {status.currentSession.serverIp || 'Resolving...'}
                </span>
              </div>
            ) : isConnected && (
              <div style={{ margin: '6px 0 8px 0', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-icons-round" style={{ fontSize: '14px', animation: 'spin 1s linear infinite' }}>refresh</span> 
                Acquiring Connection Details...
              </div>
            )}
            <p style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-secondary)' }}>
              <span className="material-icons-round" style={{ fontSize: '14px' }}>schedule</span>
              {status?.startedAt ? `Connected ${formatDistanceToNow(new Date(status.startedAt))} ago` : 'Uptime Unknown'}
            </p>
          </div>
        </div>

        <div className="glass-panel status-card">
          <div className="status-header">
            <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
              <span className="material-icons-round">swap_vert</span>
            </div>
            <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>PROTOCOL</span>
          </div>
          <div className="status-info">
            <h3 style={{ fontSize: '24px' }}>{status?.parsedEnv?.VPN_TYPE?.toUpperCase() || 'WIREGUARD'}</h3>
            <p>
              <span className="material-icons-round" style={{ fontSize: '16px' }}>speed</span>
              Optimal MTU Settings Enforced
            </p>
          </div>
        </div>

        <div className="glass-panel status-card">
          <div className="status-header">
            <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
              <span className="material-icons-round">memory</span>
            </div>
            <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>RESOURCES</span>
          </div>
          <div className="status-info">
            <h3 style={{ fontSize: '24px' }}>{metrics?.cpu || '0.0'}% CPU</h3>
            <p>
              <span className="material-icons-round" style={{ fontSize: '16px', position: 'relative', top: '3px', marginRight: '4px' }}>storage</span>
              {metrics ? formatBytes(metrics.ramUsageBytes) : '0 MB'} RAM
            </p>
          </div>
        </div>

        <div className="glass-panel status-card">
          <div className="status-header">
            <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
              <span className="material-icons-round">swap_calls</span>
            </div>
            <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>NETWORK</span>
          </div>
          <div className="status-info">
            <h3 style={{ fontSize: '24px' }}>&#8595; {metrics ? formatBytes(metrics.rxSpeed) : '0 B'}/s</h3>
            <p style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>&#8593; {metrics ? formatBytes(metrics.txSpeed) : '0 B'}/s</span> &bull; {metrics ? formatBytes(metrics.totalRx, 0) : '0 B'} Total
            </p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid glass-panel" style={{ marginTop: '24px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3><span className="material-icons-round">insights</span> Network Throughput (KB/s)</h3>
          <button
            className="btn"
            onClick={() => navigate('/network')}
            style={{ padding: '8px 16px', fontSize: '13px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(59,130,246,0.2)' }}
          >
            <span className="material-icons-round" style={{ fontSize: '16px' }}>open_in_full</span>
            Full Analysis
          </button>
        </div>
        <div style={{ height: '250px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={netHistory} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} />
              <Tooltip 
                contentStyle={{ background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} 
              />
              <Line type="monotone" dataKey="Incoming" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Outgoing" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="dashboard-grid" style={{ marginTop: '24px' }}>
        <div className="glass-panel control-section">
          <h3><span className="material-icons-round">router</span> Internal Network</h3>
          <div className="toggle-switch-container">
            <div className="toggle-info">
              <strong>Shadowsocks Proxy</strong>
              <span>Port 8388 • SOCKS5</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={status?.parsedEnv?.SHADOWSOCKS === 'on'} 
                onChange={() => toggleSetting('SHADOWSOCKS', status?.parsedEnv?.SHADOWSOCKS || 'off')} 
                disabled={loading} 
              />
              <span className="slider"></span>
            </label>
          </div>
          <div className="toggle-switch-container">
            <div className="toggle-info">
              <strong>HTTP Proxy</strong>
              <span>Port 8888 • HTTP Tunnelling</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={status?.parsedEnv?.HTTPPROXY === 'on'} 
                onChange={() => toggleSetting('HTTPPROXY', status?.parsedEnv?.HTTPPROXY || 'off')} 
                disabled={loading} 
              />
              <span className="slider"></span>
            </label>
          </div>
          <div className="toggle-switch-container">
            <div className="toggle-info">
              <strong>Adblock Guard</strong>
              <span>DNS Blocklists Enabled</span>
            </div>
            <label className="switch">
              <input 
                type="checkbox" 
                checked={status?.parsedEnv?.BLOCK_ADS === 'on'} 
                onChange={() => toggleSetting('BLOCK_ADS', status?.parsedEnv?.BLOCK_ADS || 'off')} 
                disabled={loading} 
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
