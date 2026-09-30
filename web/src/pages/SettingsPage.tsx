import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';

export default function SettingsPage() {
  const { settings, settingsLoading } = useSession();

  return (
    <>
      <PageHeader eyebrow="SISTEMA" title="Configuración" />
      {!settingsLoading && settings === null ? <Notice tone="error">No fue posible cargar la configuración global.</Notice> : null}
      <Panel className="stack">
        <p className="muted">Configuración global compartida (`tec_settings`). Es de solo lectura en esta versión; los campos SMTP nunca se exponen.</p>
        <div className="stat-grid">
          <article className="stat-card"><span>Nombre del sitio</span><strong>{settings?.site_name || '—'}</strong></article>
          <article className="stat-card"><span>Prefijo de moneda</span><strong>{settings?.currency_prefix || '—'}</strong></article>
          <article className="stat-card"><span>Cliente predeterminado</span><strong>{settings?.default_customer ?? '—'}</strong></article>
        </div>
      </Panel>
    </>
  );
}
