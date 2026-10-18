import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Footer, Header } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { AuthPage } from './pages/AuthPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { HomePage } from './pages/HomePage';
import { OrderDetailPage, OrdersPage } from './pages/OrdersPage';
import { ProductPage } from './pages/ProductPage';
import { SearchPage } from './pages/SearchPage';
import { SellerPage } from './pages/SellerPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { customer, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="page">
        <div className="skeleton-line skeleton" />
      </div>
    );
  }
  if (!customer) {
    return <Navigate to={`/ingresar?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  return null;
}

export function App() {
  return (
    <div className="app-shell">
      <ScrollToTop />
      <Header />
      <main className="site-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/buscar" element={<SearchPage />} />
          <Route path="/producto/:id" element={<ProductPage />} />
          <Route path="/vendedor/:tenantId" element={<SellerPage />} />
          <Route path="/carrito" element={<CartPage />} />
          <Route path="/ingresar" element={<AuthPage mode="login" />} />
          <Route path="/registro" element={<AuthPage mode="register" />} />
          <Route
            path="/checkout"
            element={
              <RequireAuth>
                <CheckoutPage />
              </RequireAuth>
            }
          />
          <Route
            path="/cuenta"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route
            path="/pedidos"
            element={
              <RequireAuth>
                <OrdersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/pedidos/:id"
            element={
              <RequireAuth>
                <OrderDetailPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
