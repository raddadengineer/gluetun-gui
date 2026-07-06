import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Component } from 'react';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './contexts/ToastContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Dashboard from './pages/Dashboard';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Network from './pages/Network';
import About from './pages/About';

// ── API fetch utility ─────────────────────────────────────────────────────
// Use this instead of bare fetch() for all API calls so that 401/403
// responses cleanly log the user out without monkey-patching window.fetch.
export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  if ((response.status === 401 || response.status === 403) && localStorage.getItem('token')) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  return response;
}

// ── JWT expiry check ─────────────────────────────────────────────────────
function isTokenValid(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Reject token if it expires within the next 10 seconds
    return payload.exp && Date.now() / 1000 < payload.exp - 10;
  } catch {
    return false;
  }
}

// ── Error Boundary ─────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: '16px',
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
        }}>
          <span className="material-icons-round" style={{ fontSize: '64px', color: 'var(--danger)' }}>error_outline</span>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button className="btn btn-primary" onClick={this.handleReset}>Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Route protection ─────────────────────────────────────────────────────
const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!isTokenValid(token)) {
    if (token) localStorage.removeItem('token'); // clear stale token
    return <Navigate to="/login" replace />;
  }
  return children;
};

const Layout = () => (
  <ProtectedRoute>
    <div className="layout" style={{ display: 'flex', alignItems: 'stretch', width: '100%', minHeight: '100vh' }}>
      <Sidebar />
      <main className="main-content">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  </ProtectedRoute>
);

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={
                <ErrorBoundary><Login /></ErrorBoundary>
              } />
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/network" element={<Network />} />
                <Route path="/about" element={<About />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </NotificationsProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
