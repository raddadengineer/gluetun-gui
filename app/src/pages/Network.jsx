import { useEffect, useState, useRef, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';

// ─── Formatters ────────────────────────────────────────────────────────────────
const formatBytes = (bytes = 0, decimals = 1) => {
  if (!+bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
};
const formatBps = (bps) => `${formatBytes(bps)}/s`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Tooltip ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(10,12,18,0.96)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '10px', padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
    }}>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', marginBottom: '8px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: '13px', fontWeight: 600, marginBottom: '3px' }}>
          {p.name}: {formatBytes(p.value * 1024)}
        </p>
      ))}
    </div>
  );
};

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ icon, label, value, sub, color = 'var(--accent-primary)' }) => (
  <div className="glass-panel" style={{
    padding: '18px 22px', display: 'flex', alignItems: 'center', gap: '16px',
    borderLeft: `3px solid ${color}`
  }}>
    <div style={{
      width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
      background: `${color}18`, border: `1px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <span className="material-icons-round" style={{ color, fontSize: '22px' }}>{icon}</span>
    </div>
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</p>
      <p style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{sub}</p>}
    </div>
  </div>
);

// ─── Interface tag ────────────────────────────────────────────────────────────
const IFACE_META = {
  tun0:  { label: 'VPN Tunnel',   color: '#10b981', icon: 'vpn_lock',   badge: 'VPN' },
  eth0:  { label: 'LAN / Docker', color: '#6366f1', icon: 'lan',        badge: 'LAN' },
};
const ifaceMeta = (name) => IFACE_META[name] || { label: name, color: '#8b92a5', icon: 'cable', badge: name.toUpperCase() };

const HISTORY_MAX = 90;

export default function Network() {
  const [history, setHistory]         = useState([]);    // { time, tun0_dl, tun0_ul, eth0_dl, eth0_ul }
  const [liveIfaces, setLiveIfaces]   = useState({});    // current raw bytes per iface
  const [speeds, setSpeeds]           = useState({});    // bytes/s per iface { tun0: { rx, tx }, eth0: { rx, tx } }
  const [peaks, setPeaks]             = useState({});
  const [timeRange, setTimeRange]     = useState(30);
  const [activeTab, setActiveTab]     = useState('live'); // 'live' | 'sessions'
  const [sessions, setSessions]       = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionPage, setSessionPage] = useState(0);
  const SESSION_PAGE_SIZE = 8;

  const prevRef = useRef({});

  // ─── Fetch live metrics ──────────────────────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/metrics', { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) return;
      const stats = await res.json();
      if (!stats.networks) return;

      const nets = stats.networks;
      const now = Date.now();
      const newSpeeds = {};

      Object.entries(nets).forEach(([name, net]) => {
        const prev = prevRef.current[name];
        const timeDiff = prev ? Math.max((now - prev.time) / 1000, 0.1) : 1;
        newSpeeds[name] = {
          rx: prev?.rx > 0 ? Math.max(0, (net.rx_bytes - prev.rx) / timeDiff) : 0,
          tx: prev?.tx > 0 ? Math.max(0, (net.tx_bytes - prev.tx) / timeDiff) : 0,
        };
        prevRef.current[name] = { rx: net.rx_bytes, tx: net.tx_bytes, time: now };
      });

      setSpeeds(newSpeeds);
      setLiveIfaces(nets);
      setPeaks(prev => {
        const updated = { ...prev };
        Object.entries(newSpeeds).forEach(([name, s]) => {
          updated[name] = {
            rx: Math.max(prev[name]?.rx || 0, s.rx),
            tx: Math.max(prev[name]?.tx || 0, s.tx),
          };
        });
        return updated;
      });

      const label = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const point = { time: label };
      Object.entries(newSpeeds).forEach(([name, s]) => {
        point[`${name}_dl`] = s.rx / 1024;
        point[`${name}_ul`] = s.tx / 1024;
      });
      setHistory(h => [...h, point].slice(-HISTORY_MAX));
    } catch (e) { console.error(e); }
  }, []);

  // ─── Fetch sessions ──────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sessions', { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) setSessions(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoadingSessions(false); }
  }, []);

  const deleteSession = async (id) => {
    const token = localStorage.getItem('token');
    await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchSessions();
  };

  const clearHistory = async () => {
    const token = localStorage.getItem('token');
    await fetch('/api/sessions', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    fetchSessions();
  };

  useEffect(() => {
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 1500);
    return () => clearInterval(iv);
  }, [fetchMetrics]);

  useEffect(() => {
    if (activeTab === 'sessions') fetchSessions();
  }, [activeTab, fetchSessions]);

  const display = history.slice(-timeRange);
  const ifaceNames = Object.keys(liveIfaces);

  // ─── Calculate VPN vs LAN split chart data ───────────────────────────────────
  const splitData = display.map(d => ({
    time: d.time,
    'VPN ↓ (tun0)':  d['tun0_dl'] || 0,
    'VPN ↑ (tun0)':  d['tun0_ul'] || 0,
    'LAN ↓ (eth0)':  d['eth0_dl'] || 0,
    'LAN ↑ (eth0)':  d['eth0_ul'] || 0,
  }));

  const pagedSessions = sessions.slice(sessionPage * SESSION_PAGE_SIZE, (sessionPage + 1) * SESSION_PAGE_SIZE);
  const totalPages = Math.ceil(sessions.length / SESSION_PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* ── Header ── */}
      <header className="header">
        <div className="header-title">
          <h2>Network Monitor</h2>
          <p>VPN tunnel vs LAN traffic · Per-session bandwidth history</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {[15, 30, 60, 90].map(r => (
            <button key={r} onClick={() => setTimeRange(r)} className="btn" style={{
              padding: '8px 14px', fontSize: '13px',
              background: timeRange === r ? 'var(--accent-primary)' : 'var(--glass-bg)',
              color: timeRange === r ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${timeRange === r ? 'var(--accent-primary)' : 'var(--glass-border)'}`,
              boxShadow: timeRange === r ? '0 0 12px var(--accent-glow)' : 'none'
            }}>{r}s</button>
          ))}
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="tabs-container" style={{ marginBottom: 0 }}>
        <button className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
          <span className="material-icons-round">sensors</span> Live Traffic
        </button>
        <button className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`} onClick={() => setActiveTab('sessions')}>
          <span className="material-icons-round">history</span> Session History
        </button>
      </div>

      {/* ══════════════ LIVE TAB ══════════════ */}
      {activeTab === 'live' && (
        <>
          {/* ── Speed stat cards per interface ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {ifaceNames.map(name => {
              const meta = ifaceMeta(name);
              const s = speeds[name] || { rx: 0, tx: 0 };
              const p = peaks[name]  || { rx: 0, tx: 0 };
              return (
                <StatCard
                  key={name}
                  icon={meta.icon}
                  label={`${meta.badge} · Download`}
                  value={formatBps(s.rx)}
                  sub={`↑ ${formatBps(s.tx)}  ·  Peak ↓ ${formatBps(p.rx)}`}
                  color={meta.color}
                />
              );
            })}
          </div>

          {/* ── VPN vs LAN split dual-area chart ── */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 600 }}>
                <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>compare_arrows</span>
                VPN Tunnel vs LAN — Throughput
              </h3>
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {[['#10b981','VPN ↓'],['#6ee7b7','VPN ↑'],['#6366f1','LAN ↓'],['#a5b4fc','LAN ↑']].map(([c,l]) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: c }}>
                    <span style={{ width: '10px', height: '3px', background: c, borderRadius: '2px', display: 'inline-block' }} />{l}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ height: '240px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={splitData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    {[['tun_dl','#10b981'],['tun_ul','#6ee7b7'],['lan_dl','#6366f1'],['lan_ul','#a5b4fc']].map(([id,c]) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={c} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={c} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={11} tick={{ fill: 'rgba(255,255,255,0.4)' }} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tick={{ fill: 'rgba(255,255,255,0.4)' }} tickFormatter={v => `${v.toFixed(0)} KB`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="VPN ↓ (tun0)" stroke="#10b981" strokeWidth={2} fill="url(#tun_dl)" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="VPN ↑ (tun0)" stroke="#6ee7b7" strokeWidth={1.5} fill="url(#tun_ul)" dot={false} isAnimationActive={false} strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="LAN ↓ (eth0)" stroke="#6366f1" strokeWidth={2} fill="url(#lan_dl)" dot={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="LAN ↑ (eth0)" stroke="#a5b4fc" strokeWidth={1.5} fill="url(#lan_ul)" dot={false} isAnimationActive={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Per-interface breakdown ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
            {ifaceNames.map(name => {
              const meta = ifaceMeta(name);
              const net  = liveIfaces[name] || { rx_bytes: 0, tx_bytes: 0 };
              const s    = speeds[name]     || { rx: 0, tx: 0 };
              const p    = peaks[name]      || { rx: 0, tx: 0 };
              const total = net.rx_bytes + net.tx_bytes;
              const rxPct = total > 0 ? (net.rx_bytes / total) * 100 : 50;

              return (
                <div key={name} className="glass-panel" style={{ padding: '20px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="material-icons-round" style={{ color: meta.color, fontSize: '22px' }}>{meta.icon}</span>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: '15px' }}>{name}</p>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{meta.label}</p>
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '10px', background: `${meta.color}20`, color: meta.color, border: `1px solid ${meta.color}40`, fontWeight: 600 }}>
                      {meta.badge}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                    {[
                      { label: 'Download', value: formatBps(s.rx), total: formatBytes(net.rx_bytes), pk: formatBps(p.rx), color: '#3b82f6', icon: 'arrow_downward' },
                      { label: 'Upload',   value: formatBps(s.tx), total: formatBytes(net.tx_bytes), pk: formatBps(p.tx), color: '#f59e0b', icon: 'arrow_upward'   },
                    ].map(row => (
                      <div key={row.label} style={{ padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="material-icons-round" style={{ fontSize: '14px', color: row.color }}>{row.icon}</span>{row.label}
                        </p>
                        <p style={{ fontSize: '18px', fontWeight: 700, color: row.color }}>{row.value}</p>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{row.total} total</p>
                        <p style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Peak {row.pk}</p>
                      </div>
                    ))}
                  </div>

                  {/* Rx/Tx ratio bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      <span style={{ color: '#3b82f6' }}>↓ {rxPct.toFixed(0)}% RX</span>
                      <span style={{ color: '#f59e0b' }}>TX {(100 - rxPct).toFixed(0)}% ↑</span>
                    </div>
                    <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${rxPct}%`, background: `linear-gradient(90deg, #3b82f6, ${meta.color})`, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══════════════ SESSIONS TAB ══════════════ */}
      {activeTab === 'sessions' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded · sorted newest first
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={fetchSessions} className="btn" style={{ padding: '8px 14px', fontSize: '13px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>refresh</span> Refresh
              </button>
              <button onClick={clearHistory} className="btn" style={{ padding: '8px 14px', fontSize: '13px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <span className="material-icons-round" style={{ fontSize: '16px' }}>delete_sweep</span> Clear History
              </button>
            </div>
          </div>

          {loadingSessions ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <span className="material-icons-round" style={{ fontSize: '32px', marginBottom: '8px', display: 'block', opacity: 0.4 }}>hourglass_top</span>
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center' }}>
              <span className="material-icons-round" style={{ fontSize: '48px', display: 'block', color: 'var(--text-secondary)', marginBottom: '12px', opacity: 0.4 }}>history_toggle_off</span>
              <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>No sessions recorded yet.</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '6px' }}>Sessions are created automatically when Gluetun starts or restarts.</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {pagedSessions.map(sess => {
                  const vpn = sess.interfaces?.tun0 || sess.interfaces?.eth0 || {};
                  const lan = sess.interfaces?.eth0 || {};
                  const totalRx = Object.values(sess.interfaces || {}).reduce((a, i) => a + (i.rx || 0), 0);
                  const totalTx = Object.values(sess.interfaces || {}).reduce((a, i) => a + (i.tx || 0), 0);
                  const started = new Date(sess.startedAt);
                  const ended   = sess.endedAt ? new Date(sess.endedAt) : null;
                  const duration = ended ? Math.round((ended - started) / 1000) : Math.round((Date.now() - started) / 1000);
                  const hours   = Math.floor(duration / 3600);
                  const mins    = Math.floor((duration % 3600) / 60);
                  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

                  return (
                    <div key={sess.id} className="glass-panel" style={{
                      padding: '20px 24px', borderLeft: `3px solid ${sess.active ? 'var(--success)' : 'var(--glass-border)'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                              background: sess.active ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                              color: sess.active ? 'var(--success)' : 'var(--text-secondary)',
                              border: `1px solid ${sess.active ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`
                            }}>
                              {sess.active ? '● ACTIVE' : 'ENDED'}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: '15px' }}>{sess.provider}</span>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 8px', background: 'rgba(59,130,246,0.1)', borderRadius: '6px', color: 'var(--accent-primary)' }}>
                              {sess.vpnType}
                            </span>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <p>
                              <span className="material-icons-round" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px', color: sess.publicIp ? '#10b981' : 'inherit' }}>my_location</span>
                              {sess.publicIp ? `${sess.publicIp} • ${sess.location}` : `Configured: ${sess.region}`}
                              <span style={{ margin: '0 10px', opacity: 0.3 }}>|</span>
                              <span className="material-icons-round" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>dns</span>
                              Node: {sess.serverIp || 'Unknown'}
                            </p>
                            <p>
                              <span className="material-icons-round" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>schedule</span>
                              Started {fmtDate(sess.startedAt)}
                              {sess.endedAt && <> · ended {fmtDate(sess.endedAt)}</>}
                            </p>
                          </div>
                        </div>
                        {!sess.active && (
                          <button onClick={() => deleteSession(sess.id)} className="btn" style={{ padding: '6px 12px', fontSize: '12px', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)', flexShrink: 0 }}>
                            <span className="material-icons-round" style={{ fontSize: '16px' }}>delete</span>
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginTop: '16px' }}>
                        {[
                          { label: 'Duration',     value: durationStr,         icon: 'timer',          color: 'var(--text-secondary)' },
                          { label: 'VPN ↓',        value: formatBytes(vpn.rx), icon: 'arrow_downward', color: '#10b981' },
                          { label: 'VPN ↑',        value: formatBytes(vpn.tx), icon: 'arrow_upward',   color: '#6ee7b7' },
                          { label: 'LAN ↓',        value: formatBytes(lan.rx), icon: 'arrow_downward', color: '#6366f1' },
                          { label: 'LAN ↑',        value: formatBytes(lan.tx), icon: 'arrow_upward',   color: '#a5b4fc' },
                          { label: 'Total',         value: formatBytes(totalRx + totalTx), icon: 'data_usage', color: 'var(--accent-primary)' },
                        ].map(({ label, value, icon, color }) => (
                          <div key={label} style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                            <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span className="material-icons-round" style={{ fontSize: '12px', color }}>{icon}</span>
                              {label}
                            </p>
                            <p style={{ fontSize: '16px', fontWeight: 700, color }}>{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <button onClick={() => setSessionPage(p => Math.max(0, p - 1))} disabled={sessionPage === 0} className="btn" style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                    ← Prev
                  </button>
                  <span style={{ padding: '8px 14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {sessionPage + 1} / {totalPages}
                  </span>
                  <button onClick={() => setSessionPage(p => Math.min(totalPages - 1, p + 1))} disabled={sessionPage >= totalPages - 1} className="btn" style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
