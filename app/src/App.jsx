import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './contexts/ToastContext';
import Dashboard from './pages/Dashboard';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Login from './pages/Login';

// Global fetch wrapper to handle JWT expiration seamlessly
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401 || response.status === 403) {
    if (localStorage.getItem('token')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
  }
  return response;
};

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const Layout = () => (
  <ProtectedRoute>
    <div className="layout" style={{ display: 'flex', width: '100vw', minHeight: '100vh' }}>
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  </ProtectedRoute>
);

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
