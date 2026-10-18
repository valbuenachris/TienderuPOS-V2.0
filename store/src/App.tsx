import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type StoreConfig } from './api';
import { useAuth } from './auth';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { MobileNav } from './components/layout/MobileNav';
import { PageSkeleton, Skeleton } from './components/ui/Skeleton';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((module) => ({ default: module.SearchPage })));
const ProductPage = lazy(() => import('./pages/ProductPage').then((module) => ({ default: module.ProductPage })));
const SellerPage = lazy(() => import('./pages/SellerPage').then((module) => ({ default: module.SellerPage })));
const CartPage = lazy(() => import('./pages/CartPage').then((module) => ({ default: module.CartPage })));
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage').then((module) => ({ default: module.CheckoutPage }))
);
const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })));
const OrdersPage = lazy(() =>
  import('./pages/OrdersPage').then((module) => ({ default: module.OrdersPage }))
);
const OrderDetailPage = lazy(() =>
  import('./pages/OrdersPage').then((module) => ({ default: module.OrderDetailPage }))
);

function RequireAuth({ children }: { children: ReactNode }) {
  const { customer, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return (
      <div className="container-page py-10">
        <Skeleton className="h-8 w-64" />
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

/** Favicon dinámico desde la marca configurada en el POS (fallback: el estático del index.html). */
function StoreFavicon() {
  const { data } = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });
  const faviconUrl = data?.branding?.favicon_url ?? null;
  useEffect(() => {
    if (!faviconUrl) return;
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    if (!existing) document.head.appendChild(link);
  }, [faviconUrl]);
  return null;
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <StoreFavicon />
      <Header />
      <main className="flex-1 pb-16 sm:pb-0">
        <Suspense fallback={<PageSkeleton />}>
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
        </Suspense>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
