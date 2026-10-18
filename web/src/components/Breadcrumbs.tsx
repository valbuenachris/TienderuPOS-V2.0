import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../app/session';

const LABELS: Record<string, string> = {
  pos: 'Punto de venta',
  dashboard: 'Dashboard',
  global: 'Dashboard global',
  ventas: 'Ventas',
  'cuentas-abiertas': 'Cuentas abiertas',
  asistente: 'Asistente IA',
  productos: 'Productos',
  categorias: 'Categorías',
  inventario: 'Inventario',
  clientes: 'Clientes',
  'tienda-virtual': 'Tienda Virtual',
  proveedores: 'Proveedores',
  compras: 'Compras',
  reportes: 'Reportes',
  'ventas-diarias': 'Ventas diarias',
  'ventas-mensuales': 'Ventas mensuales',
  gastos: 'Gastos',
  caja: 'Cierre de caja',
  usuarios: 'Usuarios',
  config: 'Configuración',
  tenants: 'Datos de tenants',
  'tenant-management': 'Gestión de tenants',
  plans: 'Planes',
  payments: 'Pagos de tenants'
};

function isOpaqueId(segment: string): boolean {
  return /^\d+$/.test(segment) || (segment.length > 16 && segment.includes('-'));
}

/** Migas de pan globales (v0.3.89): Inicio › Sección › Subsección según la ruta. */
export default function Breadcrumbs() {
  const { pathname } = useLocation();
  const { isSuperAdmin, selectedTenantId } = useSession();
  const segments = pathname.split('/').filter(Boolean);
  const home = isSuperAdmin && selectedTenantId === null ? '/dashboard/global' : '/pos';

  if (segments.length === 0 || pathname === home) return null;

  const items = [
    { to: home, label: 'Inicio' },
    ...segments.map((segment, index) => ({
      to: `/${segments.slice(0, index + 1).join('/')}`,
      label: LABELS[segment] ?? (isOpaqueId(segment) ? 'Detalle' : segment)
    }))
  ];

  return (
    <nav className="breadcrumb" aria-label="Ruta de navegación">
      {items.map((item, index) => (
        <span key={item.to}>
          {index > 0 ? ' › ' : null}
          {index === items.length - 1
            ? <span className="breadcrumb-current">{item.label}</span>
            : <Link to={item.to}>{item.label}</Link>}
        </span>
      ))}
    </nav>
  );
}
