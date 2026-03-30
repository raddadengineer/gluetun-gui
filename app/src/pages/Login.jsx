import { useState } from 'react';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('token', data.token);
        window.location.href = '/'; // Full reload to initialize protected state smoothly
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection to server failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}>
      <div className="glass-panel" style={{ padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: '24px' }}>
          <span className="material-icons-round" style={{ fontSize: '48px', color: 'var(--accent-primary)' }}>vpn_key</span>
          <h2 style={{ marginTop: '12px', fontSize: '24px', fontWeight: '600' }}>Gluetun Control Panel</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Please enter your access password</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="form-group" style={{ textAlign: 'left', marginBottom: '24px' }}>
            <label>Master Password</label>
            <input 
              type="password" 
              className="text-input" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter GUI Password"
              required 
            />
          </div>
          
          {error && <div style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '16px', background: 'rgba(239,68,68,0.1)', padding: '10px', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px' }}>{error}</div>}
          
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '16px' }} disabled={loading}>
            {loading ? 'Authenticating...' : 'Secure Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
