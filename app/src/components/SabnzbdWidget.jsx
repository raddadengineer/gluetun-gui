/** @param {{ details: any, variant?: 'panel'|'plain' }} p */
export default function SabnzbdWidget({ details, variant = 'plain' }) {
  const d = details || null;
  const ok = !!d?.ok;

  const shellStyle = variant === 'panel'
    ? { padding: '16px', borderRadius: '12px' }
    : null;

  const kbps = Number.isFinite(Number(d?.queue?.kbpersec)) ? Number(d.queue.kbpersec) : null;

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {variant === 'panel' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>download</span>
            <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>SABnzbd</strong>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {ok ? (d?.queue?.paused ? 'Paused' : 'Running') : !d ? '—' : d.enabled === false ? 'Disabled' : d.configured === false ? 'Not configured' : 'Error'}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Status</div>
          <div style={{ marginTop: '4px', fontWeight: 700, color: ok ? 'var(--success)' : 'var(--text-primary)' }}>
            {!d ? '—' : d.enabled === false ? 'Disabled' : d.configured === false ? 'Not configured' : ok ? 'Connected' : 'Error'}
          </div>
          {!!d?.version && (ok || d?.configured) && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              v{d.version}
            </div>
          )}
          {!!d?.error && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--danger)', lineHeight: 1.35 }}>
              {d.error}
            </div>
          )}
        </div>

        <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Queue</div>
          <div style={{ marginTop: '4px', fontWeight: 700 }}>
            {d?.queue?.nzoCount != null ? `${d.queue.nzoCount} item(s)` : '—'}
          </div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Left: {d?.queue?.sizeLeft || '—'} · ETA: {d?.queue?.timeLeft || '—'}
          </div>
        </div>

        <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Speed</div>
          <div style={{ marginTop: '4px', fontWeight: 700 }}>
            {kbps == null ? '—' : `${Math.round(kbps)} KB/s`}
          </div>
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            {d?.queue?.paused ? 'Paused' : (d?.queue?.status || '—')}
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="glass-panel" style={shellStyle}>
        {content}
      </div>
    );
  }

  return content;
}

