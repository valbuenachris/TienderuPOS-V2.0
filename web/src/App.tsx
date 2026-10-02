import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import AppLayout from './app/AppLayout';
import { SessionProvider, useSession } from './app/session';
import DashboardPage from './pages/DashboardPage';
import CashRegisterPage from './pages/CashRegisterPage';
import CustomersPage from './pages/CustomersPage';
import DailySalesReport from './pages/DailySalesReport';
import ExpensesPage from './pages/ExpensesPage';
import InventoryPage from './pages/InventoryPage';
import LoginPage from './pages/LoginPage';
import MonthlySalesReport from './pages/MonthlySalesReport';
import PosPage from './pages/PosPage';
import ProductsPage from './pages/ProductsPage';
import PurchasesPage from './pages/PurchasesPage';
import ReportsPage from './pages/ReportsPage';
import SalesHistoryPage from './pages/SalesHistoryPage';
import SettingsPage from './pages/SettingsPage';
import SuppliersPage from './pages/SuppliersPage';
import UsersPage from './pages/UsersPage';

function RequireAuth() {
  const { token, user, loading, sessionError } = useSession();
  const location = useLocation();

  if (loading) return <main className="loading-shell">Conectando con el POS…</main>;
  if (!token || !user || sessionError) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function AdminOnly({ children }: { children: ReactElement }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <Navigate to="/pos" replace />;
  return children;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/pos" replace />} />
            <Route path="/pos" element={<PosPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/ventas" element={<SalesHistoryPage />} />
            <Route path="/productos" element={<AdminOnly><ProductsPage /></AdminOnly>} />
            <Route path="/inventario" element={<AdminOnly><InventoryPage /></AdminOnly>} />
            <Route path="/clientes" element={<AdminOnly><CustomersPage /></AdminOnly>} />
            <Route path="/proveedores" element={<AdminOnly><SuppliersPage /></AdminOnly>} />
            <Route path="/compras" element={<AdminOnly><PurchasesPage /></AdminOnly>} />
            <Route path="/reportes" element={<AdminOnly><ReportsPage /></AdminOnly>} />
            <Route path="/reportes/ventas-diarias" element={<AdminOnly><DailySalesReport /></AdminOnly>} />
            <Route path="/reportes/ventas-mensuales" element={<AdminOnly><MonthlySalesReport /></AdminOnly>} />
            <Route path="/gastos" element={<AdminOnly><ExpensesPage /></AdminOnly>} />
            <Route path="/caja" element={<CashRegisterPage />} />
            <Route path="/usuarios" element={<AdminOnly><UsersPage /></AdminOnly>} />
            <Route path="/config" element={<AdminOnly><SettingsPage /></AdminOnly>} />
            <Route path="*" element={<Navigate to="/pos" replace />} />
          </Route>
        </Route>
      </Routes>
    </SessionProvider>
  );
}
