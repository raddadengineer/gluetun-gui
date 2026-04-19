export default function About() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '900px' }}>
      <header className="header">
        <div className="header-title">
          <h2>About</h2>
          <p>Gluetun-GUI — a companion UI for the Gluetun VPN container</p>
        </div>
      </header>

      <div className="glass-panel" style={{ padding: '28px 32px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>vpn_key</span>
          What this is
        </h3>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
          Gluetun-GUI runs as its own container (or Node process) with access to Docker. It edits{' '}
          <code style={{ fontSize: '12px', background: 'var(--code-bg)', padding: '2px 6px', borderRadius: '4px' }}>gui-config.env</code>,{' '}
          talks to the <strong style={{ fontWeight: 600 }}>Gluetun</strong> engine for status, logs, and recreates, and serves the React app.
          It is not a VPN by itself — Gluetun remains the tunnel.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '28px 32px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>widgets</span>
          Highlights
        </h3>
        <ul style={{
          margin: 0,
          paddingLeft: '1.25rem',
          fontSize: '14px',
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <li>Dashboard, network stats, multiplexed logs, and tabbed settings aligned with Gluetun env vars.</li>
          <li>PIA helpers: WireGuard key generation, OpenVPN region lists, port-forward-aware choices where applicable.</li>
          <li>Config export/import, themes, in-app notifications, JWT auth.</li>
        </ul>
      </div>

      <div className="glass-panel" style={{ padding: '28px 32px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: 600, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="material-icons-round" style={{ color: 'var(--accent-primary)' }}>link</span>
          Links
        </h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { href: 'https://github.com/qdm12/gluetun', label: 'Gluetun (VPN client)', sub: 'Upstream project' },
            { href: 'https://github.com/qdm12/gluetun-wiki', label: 'Gluetun wiki', sub: 'Setup and FAQ' },
            { href: 'https://hub.docker.com/r/raddadengineer/gluetun-gui', label: 'Docker Hub — gluetun-gui', sub: 'Published image' },
          ].map(({ href, label, sub }) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--accent-primary)',
                  textDecoration: 'none',
                }}
              >
                {label}
              </a>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sub}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
