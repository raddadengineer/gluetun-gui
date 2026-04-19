import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNotifications } from '../contexts/NotificationsContext';

export default function Logs() {
  const { notify } = useNotifications();
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [wordWrap, setWordWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logLevel, setLogLevel] = useState('info');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logStreamMode, setLogStreamMode] = useState('tail');
  const [logTail, setLogTail] = useState(100);
  const isPausedRef = useRef(isPaused);
  const bottomRef = useRef(null);
  const logsContainerRef = useRef(null);
  const logAlertRef = useRef({ lastAt: 0, lastSnippet: '' });

  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const maybeNotifyLogAlert = useCallback((line) => {
    if (!line || typeof line !== 'string') return;
    const isError = /\b(ERROR|FATAL|CRITICAL|PANIC)\b/i.test(line);
    const isWarn = /\b(WARN|WARNING)\b/i.test(line);
    if (!isError && !isWarn) return;
    const now = Date.now();
    const snippet = line.replace(/\s+/g, ' ').trim().slice(0, 160);
    const { lastAt, lastSnippet } = logAlertRef.current;
    // Throttle similar lines and overall rate
    if (now - lastAt < 5000 && snippet.slice(0, 80) === lastSnippet.slice(0, 80)) return;
    if (now - lastAt < 2000) return;
    logAlertRef.current = { lastAt: now, lastSnippet: snippet };

    notify({
      level: isError ? 'error' : 'warning',
      title: isError ? 'Log: error' : 'Log: warning',
      message: snippet,
      source: 'logs',
      dedupeKey: `log:${snippet.slice(0, 96)}`,
    });
  }, [notify]);

  useEffect(() => {
    // Fetch initial log level
    const token = localStorage.getItem('token');
    fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.LOG_LEVEL) setLogLevel(data.LOG_LEVEL);
      })
      .catch(console.error);

    const qs =
      logStreamMode === 'live'
        ? `token=${encodeURIComponent(token)}&mode=live`
        : `token=${encodeURIComponent(token)}&tail=${encodeURIComponent(String(logTail))}`;
    const eventSource = new EventSource(`/api/logs?${qs}`);

    eventSource.onmessage = (event) => {
      if (isPausedRef.current) return;
      try {
        let line = JSON.parse(event.data);
        if (line && line.trim() !== '') {
          maybeNotifyLogAlert(line);
          setLogs((prev) => {
            const newLogs = [...prev, line];
            if (newLogs.length > 2000) return newLogs.slice(newLogs.length - 2000);
            return newLogs;
          });
        }
      } catch (e) {
        // Fallback
      }
    };

    return () => eventSource.close();
  }, [maybeNotifyLogAlert, logStreamMode, logTail]);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const toggleDebugging = async () => {
    setLoadingConfig(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
      const currentConfig = await res.json();
      
      const newLevel = logLevel === 'debug' ? 'info' : 'debug';
      const updatedConfig = { ...currentConfig, LOG_LEVEL: newLevel };

      await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updatedConfig)
      });
      
      setLogLevel(newLevel);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConfig(false);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!filter) return logs;
    const lowerFilter = filter.toLowerCase();
    return logs.filter(l => l.toLowerCase().includes(lowerFilter));
  }, [logs, filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)', minHeight: 0, gap: '20px' }}>
      <header className="header" style={{ marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="header-title">
          <h2>System Logs</h2>
          <p>Real-time multiplexed output from Gluetun and the GUI</p>
        </div>
        
        <div className="toggle-switch-container" style={{
          background: 'var(--surface-2)', padding: '12px 20px', borderRadius: '12px', border: '1px solid var(--glass-border)', margin: 0, width: 'auto'
        }}>
          <div className="toggle-info" style={{ marginRight: '16px' }}>
            <strong style={{ fontSize: '14px', color: logLevel === 'debug' ? 'var(--accent-primary)' : 'inherit', marginLeft: '4px' }}>
              <span className="material-icons-round" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '6px' }}>bug_report</span>
              Verbose Debugging
            </strong>
          </div>
          <label className="switch" style={{ margin: 0 }}>
            <input 
              type="checkbox" 
              checked={logLevel === 'debug'} 
              onChange={toggleDebugging} 
              disabled={loadingConfig} 
            />
            <span className="slider"></span>
          </label>
        </div>
      </header>

      <div style={{ 
        display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap',
        background: 'var(--glass-bg)', padding: '12px 20px', borderRadius: '12px', 
        border: '1px solid var(--glass-border)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Stream
            <select
              className="select-input"
              style={{ minWidth: '140px' }}
              value={logStreamMode}
              onChange={(e) => {
                setLogs([]);
                setLogStreamMode(e.target.value);
              }}
            >
              <option value="tail">Last N lines + follow</option>
              <option value="live">From now (live only)</option>
            </select>
          </label>
          {logStreamMode === 'tail' && (
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              N
              <select
                className="select-input"
                value={String(logTail)}
                onChange={(e) => {
                  setLogs([]);
                  setLogTail(Number(e.target.value));
                }}
              >
                {[50, 100, 250, 500, 1000, 2000].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <span className="material-icons-round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', fontSize: '20px' }}>search</span>
          <input 
            type="text" 
            placeholder="Filter logs by keyword..." 
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ 
              width: '100%', padding: '10px 12px 10px 42px', borderRadius: '8px', 
              border: '1px solid var(--glass-border)', background: 'var(--input-bg)', 
              color: 'var(--text-primary)', outline: 'none', fontSize: '14px' 
            }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            Word Wrap
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} disabled={isPaused} />
            Auto-Scroll Bottom
          </label>
          <button onClick={() => setIsPaused(!isPaused)} className="btn" style={{ background: isPaused ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: isPaused ? 'var(--success)' : '#f59e0b', padding: '8px 16px', fontSize: '14px', border: `1px solid ${isPaused ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}` }}>
            <span className="material-icons-round" style={{ fontSize: '18px' }}>{isPaused ? 'play_arrow' : 'pause'}</span> {isPaused ? 'Resume Stream' : 'Pause Stream'}
          </button>
          <button onClick={() => setLogs([])} className="btn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '8px 16px', fontSize: '14px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span className="material-icons-round" style={{ fontSize: '18px' }}>delete_sweep</span> Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const lines = filteredLogs.length ? filteredLogs : logs;
              const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `gluetun-gui-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              notify({ level: 'success', title: 'Log snapshot saved', message: `${lines.length} lines`, source: 'logs', dedupeKey: 'logs_download' });
            }}
            className="btn"
            style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent-primary)', padding: '8px 16px', fontSize: '14px', border: '1px solid rgba(59, 130, 246, 0.25)' }}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>download</span> Download
          </button>
          <button
            type="button"
            onClick={async () => {
              const text = (filteredLogs.length ? filteredLogs : logs).join('\n');
              try {
                await navigator.clipboard.writeText(text);
                notify({ level: 'success', title: 'Copied', message: 'Visible log lines copied to clipboard.', source: 'logs', dedupeKey: 'logs_copy' });
              } catch {
                notify({ level: 'error', title: 'Copy failed', message: 'Clipboard permission denied or unavailable.', source: 'logs', dedupeKey: 'logs_copy_err' });
              }
            }}
            className="btn"
            style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)', padding: '8px 16px', fontSize: '14px', border: '1px solid var(--glass-border)' }}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>content_copy</span> Copy visible
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mono-bg)',
        border: '1px solid var(--glass-border)',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)',
        borderRadius: '12px'
      }}>
        <div style={{
          padding: '12px 20px',
          background: 'var(--mono-panel)',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          gap: '8px'
        }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }} />
        </div>

        <div ref={logsContainerRef} className="custom-scrollbar" style={{
          flex: 1,
          padding: '16px 0',
          overflowY: 'auto',
          fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          color: 'var(--mono-text)'
        }}>
          {filteredLogs.map((log, index) => {
            let color = 'var(--mono-text)';
            const text = log.toLowerCase();
            if (text.includes('fatal') || text.includes('panic')) color = '#ff7b72'; 
            else if (text.includes('error')) color = '#f85149';
            else if (text.includes('warn')) color = '#d29922';
            else if (text.includes('info')) color = '#58a6ff';
            else if (text.includes('debug')) color = '#bc8cff';

            // Parse multiplexer prefix
            let prefixMatch = log.match(/^\[(.*?)\]\s(.*)/);
            let source = 'SYS';
            let message = log;
            
            if (prefixMatch) {
              source = prefixMatch[1];
              message = prefixMatch[2];
            }

            return (
              <div key={index} className="log-row" style={{ 
                display: 'flex',
                padding: '2px 20px',
                whiteSpace: wordWrap ? 'pre-wrap' : 'pre', 
                wordBreak: wordWrap ? 'break-all' : 'normal',
                borderBottom: '1px solid rgba(255,255,255,0.02)'
              }}>
                <span style={{ 
                  marginRight: '16px', 
                  color: source === 'VPN' ? '#3fb950' : '#a5d6ff',
                  fontWeight: 'bold',
                  flexShrink: 0,
                  width: '45px',
                  display: 'inline-block'
                }}>
                  [{source}]
                </span>
                <span style={{ color, flex: 1, wordBreak: 'break-word' }}>{message}</span>
              </div>
            );
          })}
          {logs.length === 0 && <div style={{ color: '#8b949e', fontStyle: 'italic', padding: '16px 20px' }}>Listening for log streams...</div>}
          {logs.length > 0 && filteredLogs.length === 0 && <div style={{ color: '#8b949e', fontStyle: 'italic', padding: '16px 20px' }}>No logs match the current filter "{filter}".</div>}
          <div ref={bottomRef} style={{ height: '1px' }} />
        </div>
      </div>
    </div>
  );
}
