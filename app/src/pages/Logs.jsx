import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNotifications } from '../contexts/NotificationsContext';

export default function Logs() {
  const { notify } = useNotifications();
  const [logs, setLogs] = useState([]); // [{ raw, source, level, lower }]
  const [filter, setFilter] = useState('');
  const [wordWrap, setWordWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logLevel, setLogLevel] = useState('info');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logStreamMode, setLogStreamMode] = useState('tail');
  const [logTail, setLogTail] = useState(100);
  const [renderLimit, setRenderLimit] = useState(800);
  const [sourceFilters, setSourceFilters] = useState({ VPN: true, GUI: true, SYS: true });
  const [levelFilters, setLevelFilters] = useState({ error: true, warning: true, info: true, debug: true, other: true });
  const [pausedCount, setPausedCount] = useState(0);
  const [newWhileNotFollowing, setNewWhileNotFollowing] = useState(0);
  const isPausedRef = useRef(isPaused);
  const pausedBufferRef = useRef([]);
  const bottomRef = useRef(null);
  const logsContainerRef = useRef(null);
  const logsPageRef = useRef(null);
  const logAlertRef = useRef({ lastAt: 0, lastSnippet: '' });

  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const parseLogLine = useCallback((rawLine) => {
    const raw = String(rawLine ?? '');
    const lower = raw.toLowerCase();
    let level = 'other';
    if (/\b(fatal|panic|critical)\b/i.test(raw) || /\berror\b/i.test(raw)) level = 'error';
    else if (/\bwarn(ing)?\b/i.test(raw)) level = 'warning';
    else if (/\binfo\b/i.test(raw)) level = 'info';
    else if (/\bdebug\b/i.test(raw)) level = 'debug';

    // Parse multiplexer prefix
    let source = 'SYS';
    const m = raw.match(/^\[(.*?)\]\s(.*)/);
    if (m) source = String(m[1] || 'SYS').trim() || 'SYS';
    if (source !== 'VPN' && source !== 'GUI') source = 'SYS';

    return { raw, source, level, lower };
  }, []);

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
      try {
        const line = JSON.parse(event.data);
        if (!line || String(line).trim() === '') return;
        maybeNotifyLogAlert(line);
        const row = parseLogLine(line);
        if (isPausedRef.current) {
          pausedBufferRef.current.push(row);
          setPausedCount((c) => c + 1);
          return;
        }
        setLogs((prev) => {
          const next = [...prev, row];
          if (next.length > 5000) return next.slice(next.length - 5000);
          return next;
        });
      } catch {
        // Fallback
      }
    };

    return () => eventSource.close();
  }, [maybeNotifyLogAlert, logStreamMode, logTail, parseLogLine]);

  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
      setNewWhileNotFollowing(0);
      return;
    }
    // If not auto-following, increment a counter when new logs arrive and user isn't at bottom.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom) setNewWhileNotFollowing((c) => c + 1);
  }, [logs, autoScroll]);

  useEffect(() => {
    if (isPaused) return;
    if (pausedCount === 0) return;
    // Flush buffer on resume (keep last 5000 overall)
    const buf = pausedBufferRef.current;
    pausedBufferRef.current = [];
    setPausedCount(0);
    setLogs((prev) => {
      const next = [...prev, ...buf];
      if (next.length > 5000) return next.slice(next.length - 5000);
      return next;
    });
  }, [isPaused, pausedCount]);

  // Keep page scroll fixed while Logs is mounted; scroll should happen in the log window.
  useEffect(() => {
    const root = logsPageRef.current;
    const main = root ? root.closest('.main-content') : null;
    if (!main) return undefined;
    const prevOverflowY = main.style.overflowY;
    const prevOverflowX = main.style.overflowX;
    const prevOverscroll = main.style.overscrollBehavior;
    main.style.overflowY = 'hidden';
    main.style.overflowX = 'hidden';
    main.style.overscrollBehavior = 'contain';
    return () => {
      main.style.overflowY = prevOverflowY;
      main.style.overflowX = prevOverflowX;
      main.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

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
    const lowerFilter = filter.trim().toLowerCase();
    const out = logs.filter((r) => {
      if (!sourceFilters[r.source]) return false;
      if (!levelFilters[r.level]) return false;
      if (!lowerFilter) return true;
      return r.lower.includes(lowerFilter);
    });
    return out;
  }, [logs, filter, sourceFilters, levelFilters]);

  const visibleLogs = useMemo(() => {
    if (renderLimit <= 0) return filteredLogs;
    if (filteredLogs.length <= renderLimit) return filteredLogs;
    return filteredLogs.slice(filteredLogs.length - renderLimit);
  }, [filteredLogs, renderLimit]);

  function MultiSelectDropdown({ label, options, selected, onChange, minWidth = 160 }) {
    const [open, setOpen] = useState(false);
    const hostRef = useRef(null);

    useEffect(() => {
      if (!open) return;
      const onDoc = (e) => {
        const el = hostRef.current;
        if (!el) return;
        if (!el.contains(e.target)) setOpen(false);
      };
      document.addEventListener('mousedown', onDoc);
      return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const selectedLabel = selected.length === 0 ? 'None' : selected.join(', ');

    return (
      <div ref={hostRef} style={{ position: 'relative', minWidth }}>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen((o) => !o)}
          style={{
            width: '100%',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-secondary)',
            fontSize: '13px',
          }}
          aria-expanded={open}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedLabel}
            </span>
          </span>
          <span className="material-icons-round" style={{ fontSize: '18px', color: 'var(--text-secondary)' }}>
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              right: 0,
              zIndex: 200,
              background: 'var(--bg-color)',
              border: '1px solid var(--glass-border)',
              borderRadius: '12px',
              padding: '10px',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '240px',
              overflow: 'auto',
            }}
            className="custom-scrollbar"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    background: checked ? 'rgba(59,130,246,0.10)' : 'transparent',
                    border: `1px solid ${checked ? 'rgba(59,130,246,0.22)' : 'transparent'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selected, opt.value]
                        : selected.filter((v) => v !== opt.value);
                      onChange(next);
                    }}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>{opt.label}</span>
                </label>
              );
            })}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => onChange(options.map((o) => o.value))}
                style={{ padding: '8px 10px', fontSize: '12px', flex: 1, justifyContent: 'center' }}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onChange([])}
                style={{ padding: '8px 10px', fontSize: '12px', flex: 1, justifyContent: 'center' }}
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={logsPageRef} className="logs-page" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '20px', overflow: 'hidden' }}>
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
                pausedBufferRef.current = [];
                setPausedCount(0);
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
                  pausedBufferRef.current = [];
                  setPausedCount(0);
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
        <MultiSelectDropdown
          label="Sources"
          minWidth={200}
          options={[
            { value: 'VPN', label: 'VPN' },
            { value: 'GUI', label: 'GUI' },
            { value: 'SYS', label: 'SYS' },
          ]}
          selected={['VPN', 'GUI', 'SYS'].filter((k) => sourceFilters[k])}
          onChange={(next) => {
            const set = new Set(next);
            setSourceFilters({ VPN: set.has('VPN'), GUI: set.has('GUI'), SYS: set.has('SYS') });
          }}
        />
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
        
        <MultiSelectDropdown
          label="Level"
          minWidth={240}
          options={[
            { value: 'error', label: 'Error' },
            { value: 'warning', label: 'Warning' },
            { value: 'info', label: 'Info' },
            { value: 'debug', label: 'Debug' },
            { value: 'other', label: 'Other' },
          ]}
          selected={['error', 'warning', 'info', 'debug', 'other'].filter((k) => levelFilters[k])}
          onChange={(next) => {
            const set = new Set(next);
            setLevelFilters({
              error: set.has('error'),
              warning: set.has('warning'),
              info: set.has('info'),
              debug: set.has('debug'),
              other: set.has('other'),
            });
          }}
        />
        
        <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Render
          <select
            className="select-input"
            value={String(renderLimit)}
            onChange={(e) => setRenderLimit(Number(e.target.value))}
            title="Limit rendered rows for performance"
          >
            {[200, 500, 800, 1200, 2000].map((n) => (
              <option key={n} value={n}>last {n}</option>
            ))}
          </select>
        </label>
        
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            Word Wrap
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} disabled={isPaused} />
            Auto-Scroll Bottom
          </label>
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            className="btn"
            style={{
              background: isPaused ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
              color: isPaused ? 'var(--success)' : 'var(--warning)',
              padding: '8px 16px',
              fontSize: '14px',
              border: `1px solid ${isPaused ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span className="material-icons-round" style={{ fontSize: '18px' }}>{isPaused ? 'play_arrow' : 'pause'}</span>
            {isPaused ? 'Resume' : 'Pause'}
            {isPaused && pausedCount > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>({pausedCount} buffered)</span>
            )}
          </button>
          <button onClick={() => setLogs([])} className="btn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '8px 16px', fontSize: '14px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span className="material-icons-round" style={{ fontSize: '18px' }}>delete_sweep</span> Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const rows = filteredLogs.length ? filteredLogs : logs;
              const lines = rows.map((r) => r.raw);
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
              const rows = (filteredLogs.length ? filteredLogs : logs);
              const text = rows.map((r) => r.raw).join('\n');
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

      <div className="glass-panel logs-terminal-panel" style={{
        width: '100%',
        height: '620px',
        minHeight: '620px',
        maxHeight: '620px',
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
          overscrollBehavior: 'contain',
          fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          color: 'var(--mono-text)'
        }}>
          {!autoScroll && newWhileNotFollowing > 0 && (
            <div style={{ padding: '0 20px 10px 20px' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAutoScroll(true);
                  const el = logsContainerRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  background: 'rgba(59,130,246,0.14)',
                  border: '1px solid rgba(59,130,246,0.28)',
                  color: 'var(--accent-primary)',
                }}
              >
                Jump to bottom ({newWhileNotFollowing} new)
              </button>
            </div>
          )}

          {visibleLogs.map((row, index) => {
            let color = 'var(--mono-text)';
            if (row.level === 'error') color = '#f85149';
            else if (row.level === 'warning') color = '#d29922';
            else if (row.level === 'info') color = '#58a6ff';
            else if (row.level === 'debug') color = '#bc8cff';

            const log = row.raw;
            const prefixMatch = log.match(/^\[(.*?)\]\s(.*)/);
            const source = row.source;
            const message = prefixMatch ? prefixMatch[2] : log;

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
          {logs.length > 0 && filteredLogs.length === 0 && <div style={{ color: '#8b949e', fontStyle: 'italic', padding: '16px 20px' }}>No logs match the current filter “{filter}”.</div>}
          <div ref={bottomRef} style={{ height: '1px' }} />
        </div>
      </div>
    </div>
  );
}
