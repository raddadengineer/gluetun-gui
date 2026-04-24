/** @param {{ details: any, variant?: 'panel'|'plain' }} p */
export default function QbittorrentWidget({ details, variant = 'plain' }) {
  const d = details || null;
  const ok = !!d?.ok;
  const enabled = d?.enabled !== false;
  const configured = enabled && d?.configured !== false;

  const shellStyle = variant === 'panel'
    ? { padding: '16px', borderRadius: '12px' }
    : null;

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {variant === 'panel' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>download</span>
            <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>qBittorrent</strong>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {ok ? 'Connected' : !d ? '—' : d.enabled === false ? 'Disabled' : d.configured === false ? 'Not configured' : 'Error'}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
      <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Status</div>
        <div style={{ marginTop: '4px', fontWeight: 700, color: ok ? 'var(--success)' : 'var(--text-primary)' }}>
          {!d ? '—' : d.enabled === false ? 'Disabled' : d.configured === false ? 'Not configured' : ok ? 'Connected' : 'Error'}
        </div>
        {!!d?.version && (ok || configured) && (
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
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Connection</div>
        <div style={{ marginTop: '4px', fontWeight: 700 }}>
          {d?.transferInfo?.connection_status || '—'}
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          DL: {Number.isFinite(Number(d?.transferInfo?.dl_info_speed)) ? `${Math.round(Number(d.transferInfo.dl_info_speed) / 1024)} KiB/s` : '—'} ·
          UL: {Number.isFinite(Number(d?.transferInfo?.up_info_speed)) ? ` ${Math.round(Number(d.transferInfo.up_info_speed) / 1024)} KiB/s` : ' —'}
        </div>
        {(Number.isFinite(Number(d?.transferInfo?.dl_info_data)) || Number.isFinite(Number(d?.transferInfo?.up_info_data))) && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            DL total: {Number.isFinite(Number(d?.transferInfo?.dl_info_data)) ? `${Math.round(Number(d.transferInfo.dl_info_data) / (1024 * 1024))} MiB` : '—'} ·
            UL total: {Number.isFinite(Number(d?.transferInfo?.up_info_data)) ? ` ${Math.round(Number(d.transferInfo.up_info_data) / (1024 * 1024))} MiB` : ' —'}
          </div>
        )}
      </div>

      <div style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Binding</div>
        <div style={{ marginTop: '4px', fontWeight: 700 }}>
          {d?.preferences?.net_interface || '—'}
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Listen port: {d?.preferences?.listen_port ?? '—'} · Forwarded: {d?.vpn?.forwardedPort ?? '—'}
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

