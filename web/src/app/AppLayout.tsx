import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from './session';
import { useTenantsQuery } from '../pos-queries';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  admin?: boolean;
  superAdmin?: boolean;
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
  { to: '/config', label: 'Configuración', icon: '⚙️', admin: true },
  { to: '/tenants', label: 'Tenants', icon: '🏢', superAdmin: true }
];

const COLLAPSE_KEY = 'pos-gres-v2-sidebar-collapsed';

export default function AppLayout() {
  const { token, tenantId, isAdmin, isSuperAdmin, settings, switchTenant, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [tenantError, setTenantError] = useState('');
  const tenantsQuery = useTenantsQuery(token, tenantId, isSuperAdmin);
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

  const items = NAV_ITEMS.filter((item) => (!item.admin || isAdmin) && (!item.superAdmin || isSuperAdmin));

  async function handleTenantChange(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === tenantId || switchingTenant) return;
    setTenantError('');
    setSwitchingTenant(true);
    try {
      await switchTenant(nextTenantId);
    } catch (error) {
      setTenantError(error instanceof Error ? error.message : 'No fue posible cambiar de tenant');
    } finally {
      setSwitchingTenant(false);
    }
  }

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

        {isSuperAdmin ? (
          <div className="tenant-switcher">
            <label>
              <span className="nav-label">Tenant activo</span>
              <select
                value={tenantId ?? ''}
                onChange={(event) => { void handleTenantChange(event.target.value); }}
                disabled={switchingTenant || tenantsQuery.isPending}
                aria-label="Cambiar de tenant"
              >
                {(tenantsQuery.data ?? []).map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}{tenant.status !== 'active' ? ' (inactivo)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {switchingTenant ? <small className="muted">Cambiando…</small> : null}
            {tenantError ? <small className="tenant-switcher-error">{tenantError}</small> : null}
          </div>
        ) : null}

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
