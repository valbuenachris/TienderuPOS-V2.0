import { useState } from 'react';
import { PageHeader } from '../../components/ui';
import AppOrdersTab from './AppOrdersTab';
import AppCustomersTab from './AppCustomersTab';
import ReviewsTab from './ReviewsTab';
import BannersTab from './BannersTab';

type Tab = 'orders' | 'customers' | 'reviews' | 'banners';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'orders', label: 'Pedidos App' },
  { value: 'customers', label: 'Clientes App' },
  { value: 'reviews', label: 'Reseñas' },
  { value: 'banners', label: 'Banners' }
];

export default function TiendaVirtualPage() {
  const [tab, setTab] = useState<Tab>('orders');

  return (
    <>
      <PageHeader eyebrow="APP MÓVIL" title="Tienda Virtual" />
      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`tab ${tab === item.value ? 'active' : ''}`}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'orders' ? <AppOrdersTab /> : null}
      {tab === 'customers' ? <AppCustomersTab /> : null}
      {tab === 'reviews' ? <ReviewsTab /> : null}
      {tab === 'banners' ? <BannersTab /> : null}
    </>
  );
}
