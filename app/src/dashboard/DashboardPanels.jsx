import { formatDistanceToNow, differenceInHours } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

/** @param {{ status: any, loading: boolean, piaMonitoring: any, isConnected: boolean }} p */
export function ConnectionStatusWidget({ status, loading, piaMonitoring, isConnected }) {
  return (
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
        <h3>{status?.displayProvider || status?.gui?.VPN_SERVICE_PROVIDER || status?.parsedEnv?.VPN_SERVICE_PROVIDER || (loading ? 'Loading…' : 'Unknown')}</h3>
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
            {status.currentSession.server && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-icons-round" style={{ fontSize: '14px' }}>badge</span>
                Server: {status.currentSession.server}
              </span>
            )}
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

        {status?.lastVpnConnectivityCheck?.at && (
          <div style={{
            marginTop: '10px',
            padding: '10px 12px',
            borderRadius: '8px',
            border: `1px solid ${status.lastVpnConnectivityCheck.ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
            background: status.lastVpnConnectivityCheck.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            fontSize: '12px',
            lineHeight: 1.5,
          }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: status.lastVpnConnectivityCheck.ok ? 'var(--success)' : 'var(--danger)', marginBottom: '4px' }}>
              <span className="material-icons-round" style={{ fontSize: '16px' }}>network_ping</span>
              Last VPN check ({formatDistanceToNow(new Date(status.lastVpnConnectivityCheck.at), { addSuffix: true })})
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {status.lastVpnConnectivityCheck.ok ? (
                <>
                  OK — public IP {status.lastVpnConnectivityCheck.publicIp || '—'} via {status.lastVpnConnectivityCheck.method || 'probe'}
                </>
              ) : (
                <>
                  Failed — {status.lastVpnConnectivityCheck.error || status.lastVpnConnectivityCheck.detail || 'Unknown'}
                </>
              )}
            </div>
                {status.lastVpnConnectivityCheck.ok === false
                && differenceInHours(new Date(), new Date(status.lastVpnConnectivityCheck.at)) >= 24 && (
              <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--warning)' }}>
                Result is older than 24h — run <strong style={{ fontWeight: 600 }}>Test VPN connectivity</strong> again after changes.
              </div>
            )}
          </div>
        )}

        {piaMonitoring?.portForwarding && (
          <p style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', marginTop: '6px' }}>
            <span className="material-icons-round" style={{ fontSize: '14px', color: 'var(--success)' }}>hub</span>
            Port Forwarding: <strong style={{ color: 'var(--success)' }}>{piaMonitoring.port || piaMonitoring.lastForwardedPort || 'Pending'}</strong>
          </p>
        )}
      </div>
    </div>
  );
}

/** @param {{ status: any }} p */
export function ProtocolWidget({ status }) {
  return (
    <div className="glass-panel status-card">
      <div className="status-header">
        <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
          <span className="material-icons-round">swap_vert</span>
        </div>
        <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>PROTOCOL</span>
      </div>
      <div className="status-info">
        {(() => {
          const running = (status?.parsedEnv?.VPN_TYPE || '').toUpperCase() || 'UNKNOWN';
          const configured = (status?.gui?.VPN_TYPE || '').toUpperCase() || null;
          const show = configured || running || 'UNKNOWN';
          const mismatch = configured && running && configured !== running;
          return (
            <>
              <h3 style={{ fontSize: '24px' }}>{show}</h3>
              {mismatch && (
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                  Running: <strong style={{ color: 'var(--text-primary)' }}>{running}</strong>
                </p>
              )}
            </>
          );
        })()}
        <p>
          <span className="material-icons-round" style={{ fontSize: '16px' }}>speed</span>
          Optimal MTU Settings Enforced
        </p>
      </div>
    </div>
  );
}

/** @param {{ metrics: any, formatBytes: (n: number, d?: number) => string }} p */
export function ResourcesWidget({ metrics, formatBytes }) {
  return (
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
  );
}

/** @param {{ metrics: any, formatBytes: (n: number, d?: number) => string }} p */
export function NetworkThroughputWidget({ metrics, formatBytes }) {
  return (
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
  );
}

/** @param {{ netHistory: object[], navigate: (path: string) => void }} p */
export function ThroughputChartWidget({ netHistory, navigate }) {
  return (
    <div className="glass-panel" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3><span className="material-icons-round">insights</span> Network Throughput (KB/s)</h3>
        <button
          type="button"
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
  );
}

/** @param {{ status: any, loading: boolean, toggleSetting: (k: string, v: string) => void }} p */
export function InternalNetworkWidget({ status, loading, toggleSetting }) {
  return (
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
          <span className="slider" />
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
          <span className="slider" />
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
          <span className="slider" />
        </label>
      </div>
    </div>
  );
}

/** @param {{ piaMonitoring: any }} p */
export function PiaMonitoringWidget({ piaMonitoring }) {
  if (!piaMonitoring || typeof piaMonitoring !== 'object') {
    return (
      <div className="glass-panel status-card">
        <div className="status-header">
          <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
            <span className="material-icons-round">monitor_heart</span>
          </div>
          <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>MONITOR</span>
        </div>
        <div className="status-info">
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Monitoring data not available (PIA endpoint or provider).</p>
        </div>
      </div>
    );
  }
  const lastCheckLabel = (() => {
    const raw = piaMonitoring.lastCheckAt;
    if (!raw) return '—';
    const t = new Date(raw);
    if (Number.isNaN(t.getTime())) return '—';
    return formatDistanceToNow(t, { addSuffix: true });
  })();

  const rows = [
    ['Port forwarding', piaMonitoring.portForwarding ? 'On' : 'Off'],
    ['Forwarded port', piaMonitoring.port || piaMonitoring.lastForwardedPort || '—'],
    ['Fail count (3 strikes)', typeof piaMonitoring.failCount === 'number' ? String(piaMonitoring.failCount) : '—'],
    ['Public IP (probe)', piaMonitoring.publicIp || '—'],
    ['Last check', lastCheckLabel],
  ];

  return (
    <div className="glass-panel status-card">
      <div className="status-header">
        <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
          <span className="material-icons-round">monitor_heart</span>
        </div>
        <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>MONITORING</span>
      </div>
      <div className="status-info" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
            <strong style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{v}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/** @param {{ status: any }} p */
export function ProxyPortsWidget({ status }) {
  const env = status?.parsedEnv || {};
  const httpControl = env.HTTP_CONTROL_SERVER || '8000';
  const ss = env.SHADOWSOCKS === 'on';
  const hp = env.HTTPPROXY === 'on';
  return (
    <div className="glass-panel status-card">
      <div className="status-header">
        <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
          <span className="material-icons-round">electrical_services</span>
        </div>
        <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>PORTS</span>
      </div>
      <div className="status-info" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Shadowsocks</span>
          <span><strong>8388</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>({ss ? 'on' : 'off'})</span></span>
        </div>
        <div style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>HTTP proxy</span>
          <span><strong>8888</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>({hp ? 'on' : 'off'})</span></span>
        </div>
        <div style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Gluetun control</span>
          <strong>{httpControl}</strong>
        </div>
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
          Map these ports from the host into the Gluetun container to reach services through the tunnel stack.
        </p>
      </div>
    </div>
  );
}

/** @param {{ status: any }} p */
export function DnsFirewallWidget({ status }) {
  const env = status?.parsedEnv || {};
  const line = (label, val) => (
    val ? (
      <div key={label} style={{ fontSize: '12px', display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '8px', alignItems: 'start' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ wordBreak: 'break-word', color: 'var(--text-primary)' }}>{val}</span>
      </div>
    ) : null
  );
  const blocks = [
    line('DNS address', env.DNS_ADDRESS),
    line('DNS keep address', env.DNS_KEEP_ADDR),
    line('DNS over TLS', env.DOT === 'on' || env.DOT === 'true' ? 'enabled' : env.DOT ? String(env.DOT) : ''),
    line('Firewall', env.FIREWALL),
    line('Outbound subnets', env.FIREWALL_OUTBOUND_SUBNETS),
    line('VPN input ports', env.VPN_INPUT_PORTS || env.FIREWALL_VPN_INPUT_PORTS),
  ].filter(Boolean);

  if (blocks.length === 0) {
    return (
      <div className="glass-panel status-card">
        <div className="status-header">
          <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
            <span className="material-icons-round">shield</span>
          </div>
          <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>DNS / FW</span>
        </div>
        <div className="status-info">
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No DNS or firewall fields exposed in the current status snapshot.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel status-card">
      <div className="status-header">
        <div className="status-icon-wrapper" style={{ borderColor: 'rgba(255,255,255,0.2)' }}>
          <span className="material-icons-round">shield</span>
        </div>
        <span className="status-badge" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>DNS / FW</span>
      </div>
      <div className="status-info" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {blocks}
      </div>
    </div>
  );
}
