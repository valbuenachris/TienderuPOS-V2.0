import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from './session';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  admin?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/pos', label: 'Punto de venta', icon: '🛒' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/ventas', label: 'Ventas', icon: '🧾' },
  { to: '/productos', label: 'Productos', icon: '📦', admin: true },
  { to: '/inventario', label: 'Inventario', icon: '🏷️', admin: true },
  { to: '/clientes', label: 'Clientes', icon: '👥' },
  { to: '/proveedores', label: 'Proveedores', icon: '🚚', admin: true },
  { to: '/compras', label: 'Compras', icon: '🛍️', admin: true },
  { to: '/reportes', label: 'Reportes', icon: '📈', admin: true },
  { to: '/gastos', label: 'Gastos', icon: '💵', admin: true },
  { to: '/caja', label: 'Cierre de caja', icon: '🔒' },
  { to: '/usuarios', label: 'Usuarios', icon: '🧑‍💼', admin: true },
  { to: '/config', label: 'Configuración', icon: '⚙️', admin: true }
];

const COLLAPSE_KEY = 'pos-gres-v2-sidebar-collapsed';

export default function AppLayout() {
  const { isAdmin, settings, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch (_error) {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch (_error) {
      // El navegador puede bloquear localStorage; el estado sigue funcionando en memoria.
    }
  }, [collapsed]);

  const items = NAV_ITEMS.filter((item) => !item.admin || isAdmin);

  return (
    <div className={`app-frame ${collapsed ? 'collapsed' : ''} ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="sidebar-brand">
            <span className="brand-mark small">P</span>
            <strong>{settings?.site_name || 'POS'}</strong>
          </div>
          <button
            className="sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-icon" aria-hidden>{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item nav-logout" onClick={logout} title="Cerrar sesión">
            <span className="nav-icon" aria-hidden>🚪</span>
            <span className="nav-label">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <div className="app-body">
        <button className="mobile-nav-toggle" onClick={() => setMenuOpen(true)} aria-label="Abrir menú">
          ☰
        </button>
        <main className="page">
          <Outlet />
        </main>
      </div>

      {menuOpen ? <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
