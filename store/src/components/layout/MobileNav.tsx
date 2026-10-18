import { NavLink } from 'react-router-dom';
import { useCart } from '../../cart';
import { Icon, type IconName } from '../ui/Icon';

const ITEMS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/buscar', label: 'Buscar', icon: 'search' },
  { to: '/carrito', label: 'Carrito', icon: 'cart' },
  { to: '/pedidos', label: 'Pedidos', icon: 'package' }
];

export function MobileNav() {
  const cart = useCart();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-navy-900 text-white sm:hidden"
      aria-label="Navegación inferior"
    >
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `relative flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              isActive ? 'text-accent-400' : 'text-white/80 hover:text-white'
            }`
          }
        >
          <span className="relative">
            <Icon name={item.icon} className="h-5 w-5" />
            {item.to === '/carrito' && cart.count > 0 ? (
              <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-400 px-1 text-[10px] font-bold text-navy-900">
                {cart.count}
              </span>
            ) : null}
          </span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
