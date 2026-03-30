import { useEffect, useState, useRef } from 'react';

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [wordWrap, setWordWrap] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const eventSource = new EventSource(`/api/logs?token=${token}`);

    eventSource.onmessage = (event) => {
      // Data from SSE arrives as escaped string, parse to unescape
      try {
        const line = JSON.parse(event.data);
        if (line && line.trim() !== '') {
          setLogs((prev) => {
            const newLogs = [...prev, line];
            // Keep performance smooth by retaining only the last 1500 lines
            if (newLogs.length > 1500) return newLogs.slice(newLogs.length - 1500);
            return newLogs;
          });
        }
      } catch (e) {
        // Fallback if parsing fails
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView();
    }
  }, [logs, autoScroll]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="header-title">
          <h2>Container Logs</h2>
          <p>Real-time stdout/stderr from the Gluetun Engine</p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={wordWrap} onChange={(e) => setWordWrap(e.target.checked)} />
            Word Wrap
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-Scroll Bottom
          </label>
        </div>
      </header>

      <div className="glass-panel" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(5, 5, 8, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          gap: '8px'
        }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }} />
        </div>

        <div style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto',
          fontFamily: '"Fira Code", "JetBrains Mono", Consolas, monospace',
          fontSize: '13px',
          color: '#e2e8f0',
          lineHeight: '1.5'
        }}>
          {logs.map((log, index) => {
            // Apply log severity color coding
            let color = '#e2e8f0';
            const text = log.toLowerCase();
            if (text.includes('fatal') || text.includes('panic')) color = '#dc2626'; // deeper red
            else if (text.includes('error')) color = '#ef4444';
            else if (text.includes('warn')) color = '#f59e0b';
            else if (text.includes('info')) color = '#3b82f6';
            else if (text.includes('debug')) color = '#a855f7'; // purple

            return (
              <div key={index} style={{ whiteSpace: wordWrap ? 'pre-wrap' : 'pre', wordBreak: wordWrap ? 'break-all' : 'normal', color }}>
                {log}
              </div>
            );
          })}
          {logs.length === 0 && <div style={{ color: '#8b92a5', fontStyle: 'italic' }}>Waiting for log stream... Is Gluetun running?</div>}
          <div ref={bottomRef} style={{ height: '1px' }} />
        </div>
      </div>
    </div>
  );
}
