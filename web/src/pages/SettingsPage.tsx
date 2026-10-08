import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useApiMutation, useCustomersQuery, useManagedSettingsQuery } from '../pos-queries';
import { deleteSettingsLogo, updateSettings, uploadSettingsLogo } from '../api';
import type { PosSettings, UpdateSettingsPayload } from '../api';
import BillingTab from './settings/BillingTab';

const CURRENCIES = ['COP', 'USD', 'EUR', 'MXN', 'PEN', 'CLP', 'ARS', 'BRL'];
const TIMEZONES = [
  'America/Bogota',
  'America/Mexico_City',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
  'America/New_York',
  'Europe/Madrid',
  'UTC'
];
const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' }
];

interface SettingsForm {
  site_name: string;
  address: string;
  phone: string;
  email: string;
  nit: string;
  currency_prefix: string;
  timezone: string;
  language: string;
  default_customer: string;
  default_tax: string;
  decimal_digits: string;
  thank_you_message: string;
  return_policy: string;
  show_qr_on_ticket: boolean;
  printer_width: '58mm' | '80mm';
}

function toForm(settings: PosSettings | null): SettingsForm {
  return {
    site_name: settings?.site_name ?? '',
    address: settings?.address ?? '',
    phone: settings?.phone ?? '',
    email: settings?.email ?? '',
    nit: settings?.nit ?? '',
    currency_prefix: settings?.currency_prefix ?? 'COP',
    timezone: settings?.timezone ?? 'America/Bogota',
    language: settings?.language ?? 'es',
    default_customer: settings?.default_customer === null || settings?.default_customer === undefined
      ? ''
      : String(settings.default_customer),
    default_tax: settings?.default_tax === null || settings?.default_tax === undefined ? '' : String(settings.default_tax),
    decimal_digits: settings?.decimal_digits === null || settings?.decimal_digits === undefined
      ? '2'
      : String(settings.decimal_digits),
    thank_you_message: settings?.thank_you_message ?? '¡Gracias por su compra!',
    return_policy: settings?.return_policy ?? '',
    show_qr_on_ticket: settings?.show_qr_on_ticket ?? true,
    printer_width: settings?.printer_width === '80mm' ? '80mm' : '58mm'
  };
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, stores } = useSession();
  const settingsQuery = useManagedSettingsQuery(token, tenantId);
  const current = settingsQuery.data ?? null;
  const storeId = stores[0]?.id ?? null;
  const customersQuery = useCustomersQuery(token, tenantId, storeId);
  const customers = customersQuery.data ?? [];

  const [form, setForm] = useState<SettingsForm>(() => toForm(current));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'general' | 'billing'>('general');

  const saveMutation = useApiMutation((payload: UpdateSettingsPayload) => updateSettings(payload));
  const logoMutation = useApiMutation((file: File) => uploadSettingsLogo(file));
  const removeLogoMutation = useApiMutation(() => deleteSettingsLogo());

  useEffect(() => {
    if (!current || dirty) return;
    setForm(toForm(current));
    setLogoBroken(false);
  }, [current, dirty]);

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const supported = current?.supported;
  const isSupported = (field: string) => !supported || supported.includes(field);
  const previewUrl = logoPreview ?? (logoRemoved ? null : current?.logo_url ?? null);

  function patch(value: Partial<SettingsForm>) {
    setDirty(true);
    setForm((existing) => ({ ...existing, ...value }));
  }

  function cancel() {
    setForm(toForm(current));
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
    setLogoRemoved(false);
    setLogoBroken(false);
    setDirty(false);
    setNotice('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.site_name.trim()) {
      setNotice('El nombre del sitio es obligatorio.');
      return;
    }
    if (!/^[A-Za-z]{1,3}$/.test(form.currency_prefix.trim())) {
      setNotice('El prefijo de moneda debe tener de 1 a 3 letras.');
      return;
    }
    const email = form.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setNotice('El correo no tiene un formato válido.');
      return;
    }

    const payload: UpdateSettingsPayload = {
      site_name: form.site_name.trim(),
      currency_prefix: form.currency_prefix.trim().toUpperCase(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: email || null,
      nit: form.nit.trim() || null,
      timezone: form.timezone,
      language: form.language,
      default_customer: form.default_customer.trim() === '' ? null : Number(form.default_customer),
      default_tax: form.default_tax.trim() === '' ? null : Number(form.default_tax),
      decimal_digits: form.decimal_digits.trim() === '' ? null : Number(form.decimal_digits),
      thank_you_message: form.thank_you_message.trim() || null,
      return_policy: form.return_policy.trim() || null,
      show_qr_on_ticket: form.show_qr_on_ticket,
      printer_width: form.printer_width
    };

    setSaving(true);
    try {
      await saveMutation.mutateAsync(payload);
      if (logoFile) {
        await logoMutation.mutateAsync(logoFile);
      } else if (logoRemoved) {
        await removeLogoMutation.mutateAsync(undefined);
      }
      setNotice(logoFile
        ? 'Configuración y logo guardados.'
        : logoRemoved
          ? 'Configuración guardada y logo eliminado.'
          : 'Configuración guardada.');
      setDirty(false);
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoFile(null);
      setLogoPreview(null);
      setLogoRemoved(false);
      setLogoBroken(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['global-pos-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['global-pos-settings-manage'] })
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No fue posible guardar la configuración.');
    } finally {
      setSaving(false);
    }
  }

  function onLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      setNotice('Formato no permitido: usa PNG, JPG, WEBP o SVG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice('El logo debe pesar 2 MB o menos.');
      return;
    }
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setLogoRemoved(false);
    setLogoBroken(false);
    setDirty(true);
    setNotice('');
  }

  function removeLogo() {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
    setLogoRemoved(true);
    setLogoBroken(false);
    setDirty(true);
    setNotice('');
  }

  return (
    <>
      <PageHeader eyebrow="SISTEMA" title="Configuración" />
      {settingsQuery.isError ? (
        <Notice tone="error">No fue posible cargar la configuración.</Notice>
      ) : null}
      {notice ? <Notice tone={/error|inválid|invalid|obligatorio|no existe|formato/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}

      <div className="tabs">
        <button type="button" className={`tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
          General
        </button>
        <button type="button" className={`tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>
          Facturación
        </button>
      </div>

      {tab === 'general' ? (
      <Panel className="stack full-width">
        <form className="settings-form" onSubmit={submit}>
          <section className="settings-section">
            <h2>Información del negocio</h2>
            <div className="field-row">
              <label>Nombre del sitio
                <input value={form.site_name} onChange={(event) => patch({ site_name: event.target.value })} maxLength={100} required />
              </label>
              <label>NIT
                <input value={form.nit} onChange={(event) => patch({ nit: event.target.value })} maxLength={30} disabled={!isSupported('nit')} />
              </label>
            </div>
            <label>Dirección
              <input value={form.address} onChange={(event) => patch({ address: event.target.value })} maxLength={255} disabled={!isSupported('address')} />
            </label>
            <div className="field-row">
              <label>Teléfono
                <input value={form.phone} onChange={(event) => patch({ phone: event.target.value })} maxLength={30} disabled={!isSupported('phone')} />
              </label>
              <label>Email
                <input type="email" value={form.email} onChange={(event) => patch({ email: event.target.value })} maxLength={100} disabled={!isSupported('email')} />
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h2>Marca / Logo</h2>
            {isSupported('logo_url') ? (
              <div className="settings-logo">
                {previewUrl && !logoBroken ? (
                  <img src={previewUrl} alt="Logo" onError={() => setLogoBroken(true)} />
                ) : (
                  <div className="settings-logo-placeholder">Sin logo</div>
                )}
                <div className="settings-logo-actions">
                  <label className="button-like">
                    {saving && logoFile ? 'Guardando…' : 'Subir logo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={onLogoChange}
                      disabled={saving}
                      hidden
                    />
                  </label>
                  {previewUrl || logoFile ? (
                    <button className="quiet" type="button" onClick={removeLogo} disabled={saving}>Eliminar</button>
                  ) : null}
                </div>
                <small className="muted">PNG, JPG, WEBP o SVG · máx. 2 MB. El logo se guarda al pulsar “Guardar cambios”.</small>
              </div>
            ) : (
              <Notice>Requiere la columna <code>logo_url</code>; ejecuta las sentencias ALTER TABLE del README.</Notice>
            )}
          </section>

          <section className="settings-section">
            <h2>Localización</h2>
            <div className="field-row">
              <label>Moneda
                <select value={form.currency_prefix} onChange={(event) => patch({ currency_prefix: event.target.value })}>
                  {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                </select>
              </label>
              <label>Zona horaria
                <select value={form.timezone} onChange={(event) => patch({ timezone: event.target.value })} disabled={!isSupported('timezone')}>
                  {TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                </select>
              </label>
            </div>
            <label>Idioma
              <select value={form.language} onChange={(event) => patch({ language: event.target.value })} disabled={!isSupported('language')}>
                {LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h2>Operación</h2>
            <div className="field-row">
              <label>Cliente predeterminado
                <select
                  value={form.default_customer}
                  onChange={(event) => patch({ default_customer: event.target.value })}
                  disabled={!isSupported('default_customer')}
                >
                  <option value="">Sin predeterminado</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name || `Cliente #${customer.id}`}</option>
                  ))}
                </select>
              </label>
              <label>Impuesto predeterminado %
                <input
                  value={form.default_tax}
                  onChange={(event) => patch({ default_tax: event.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!isSupported('default_tax')}
                />
              </label>
            </div>
            <label>Dígitos decimales
              <input
                value={form.decimal_digits}
                onChange={(event) => patch({ decimal_digits: event.target.value })}
                inputMode="numeric"
                placeholder="2"
                disabled={!isSupported('decimal_digits')}
              />
            </label>
          </section>

          <section className="settings-section">
            <h2>Ticket / Impresión</h2>
            <label>Mensaje de agradecimiento
              <input
                value={form.thank_you_message}
                onChange={(event) => patch({ thank_you_message: event.target.value })}
                maxLength={255}
                disabled={!isSupported('thank_you_message')}
              />
            </label>
            <label>Política de cambios
              <textarea
                value={form.return_policy}
                onChange={(event) => patch({ return_policy: event.target.value.slice(0, 1000) })}
                rows={3}
                maxLength={1000}
                disabled={!isSupported('return_policy')}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.show_qr_on_ticket}
                onChange={(event) => patch({ show_qr_on_ticket: event.target.checked })}
                disabled={!isSupported('show_qr_on_ticket')}
              />
              Mostrar QR en el ticket
            </label>
            <label>Ancho de impresora
              <select
                value={form.printer_width}
                onChange={(event) => patch({ printer_width: event.target.value === '80mm' ? '80mm' : '58mm' })}
                disabled={!isSupported('printer_width')}
              >
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
              </select>
            </label>
          </section>

          {supported ? (
            <p className="muted">
              Columnas habilitadas: {supported.join(', ') || 'ninguna'}. Las deshabilitadas requieren las sentencias
              ALTER TABLE documentadas en el README.
            </p>
          ) : null}

          <div className="modal-actions">
            <button className="quiet" type="button" onClick={cancel} disabled={!dirty || saving}>Cancelar</button>
            <button className="primary" type="submit" disabled={!dirty || saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Panel>
      ) : (
        <BillingTab />
      )}
    </>
  );
}
