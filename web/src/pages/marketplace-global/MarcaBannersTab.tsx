import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Notice, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import {
  useAdminBannersQuery,
  useApiMutation,
  useMarketplaceBannersQuery,
  useMarketplaceBrandingQuery
} from '../../pos-queries';
import {
  createAdminBanner,
  createMarketplaceBanner,
  deleteAdminBanner,
  deleteMarketplaceBanner,
  updateMarketplaceBanner,
  updateMarketplaceBranding
} from '../../api';

interface BrandingFormState {
  description: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  instagram: string;
  facebook: string;
}

const EMPTY_FORM: BrandingFormState = {
  description: '',
  email: '',
  phone: '',
  whatsapp: '',
  address: '',
  instagram: '',
  facebook: ''
};

function noticeTone(message: string): 'error' | 'success' {
  return /no |error|inválid|invalid|no se|sube una imagen/i.test(message) ? 'error' : 'success';
}

export function MarcaBannersTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const branding = useMarketplaceBrandingQuery(token, tenantId);
  const smallBanners = useMarketplaceBannersQuery(token, tenantId);
  const bigBanners = useAdminBannersQuery(token, tenantId);

  const [notice, setNotice] = useState('');

  // ---------------------------------------------------------------- Marca
  const [form, setForm] = useState<BrandingFormState>(EMPTY_FORM);
  const [synced, setSynced] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);

  useEffect(() => {
    if (branding.data && !synced) {
      setForm({
        description: branding.data.footer_description ?? '',
        email: branding.data.footer_email ?? '',
        phone: branding.data.footer_phone ?? '',
        whatsapp: branding.data.footer_whatsapp ?? '',
        address: branding.data.footer_address ?? '',
        instagram: branding.data.footer_instagram ?? '',
        facebook: branding.data.footer_facebook ?? ''
      });
      setSynced(true);
    }
  }, [branding.data, synced]);

  const saveBranding = useApiMutation(() =>
    updateMarketplaceBranding({
      footer_description: form.description,
      footer_email: form.email,
      footer_phone: form.phone,
      footer_whatsapp: form.whatsapp,
      footer_address: form.address,
      footer_instagram: form.instagram,
      footer_facebook: form.facebook,
      logo: logoFile,
      favicon: faviconFile
    })
  );

  function pickLogo(file: File | null) {
    setLogoFile(file);
    setLogoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function pickFavicon(file: File | null) {
    setFaviconFile(file);
    setFaviconPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function submitBranding(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    saveBranding.mutate(undefined, {
      onSuccess: async () => {
        setNotice('Marca guardada. La tienda la mostrará en unos segundos.');
        setLogoFile(null);
        setFaviconFile(null);
        setLogoPreview(null);
        setFaviconPreview(null);
        setSynced(false);
        await queryClient.invalidateQueries({ queryKey: ['marketplace-branding'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  // ------------------------------------------------------- Banners pequeños
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerTarget, setBannerTarget] = useState('');
  const [bannerOrder, setBannerOrder] = useState('0');

  const createBanner = useApiMutation(() =>
    createMarketplaceBanner({
      file: bannerFile,
      image_url: bannerUrl.trim() === '' ? undefined : bannerUrl.trim(),
      title: bannerTitle.trim() === '' ? undefined : bannerTitle.trim(),
      target_url: bannerTarget.trim() === '' ? undefined : bannerTarget.trim(),
      sort_order: Number(bannerOrder) || 0
    })
  );

  const toggleBanner = useApiMutation((input: { id: number; active: boolean }) =>
    updateMarketplaceBanner(input.id, { active: input.active })
  );

  const removeBanner = useApiMutation((id: number) => deleteMarketplaceBanner(id));

  function pickBannerFile(file: File | null) {
    setBannerFile(file);
    setBannerPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  function submitBanner(event: FormEvent) {
    event.preventDefault();
    if (!bannerFile && bannerUrl.trim() === '') {
      setNotice('Sube una imagen o pega una URL para el banner.');
      return;
    }
    setNotice('');
    createBanner.mutate(undefined, {
      onSuccess: async () => {
        setNotice('Banner publicado en el home de tienderu.com.');
        pickBannerFile(null);
        setBannerUrl('');
        setBannerTitle('');
        setBannerTarget('');
        setBannerOrder('0');
        await queryClient.invalidateQueries({ queryKey: ['marketplace-banners'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  // ---------------------------------------------------- Banners del carrusel
  const [bigUrl, setBigUrl] = useState('');
  const createBig = useApiMutation((imageUrl: string) => createAdminBanner({ image_url: imageUrl }));
  const removeBig = useApiMutation((id: string) => deleteAdminBanner(id));

  function submitBig(event: FormEvent) {
    event.preventDefault();
    const clean = bigUrl.trim();
    if (clean === '') return;
    setNotice('');
    createBig.mutate(clean, {
      onSuccess: async () => {
        setNotice('Banner agregado al carrusel principal.');
        setBigUrl('');
        await queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <div className="stack full-width">
      {notice ? <Notice tone={noticeTone(notice)}>{notice}</Notice> : null}

      <Panel className="stack full-width">
        <h2>Marca de tienderu.com</h2>
        <p className="muted">
          Logo y favicon de la tienda (PNG, JPG, WEBP o SVG, máx 2 MB) y datos de contacto del footer.
          Si dejas un campo vacío, se muestra el valor por defecto.
        </p>
        {branding.isError ? (
          <Notice tone="error">
            No fue posible cargar la marca: ejecuta la migración v0.10.0-marketplace-branding.sql.
          </Notice>
        ) : null}
        <form className="stack" onSubmit={submitBranding}>
          <div className="brand-uploads">
            <div className="brand-upload">
              <span className="muted">Logo actual</span>
              {logoPreview || branding.data?.logo_url ? (
                <img
                  src={logoPreview ?? branding.data?.logo_url ?? ''}
                  alt="Logo de tienderu.com"
                  className="brand-logo-preview"
                />
              ) : (
                <span className="muted small">Sin logo (se usa el texto "tienderu.com")</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => pickLogo(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="brand-upload">
              <span className="muted">Favicon actual</span>
              {faviconPreview || branding.data?.favicon_url ? (
                <img
                  src={faviconPreview ?? branding.data?.favicon_url ?? ''}
                  alt="Favicon de tienderu.com"
                  className="brand-favicon-preview"
                />
              ) : (
                <span className="muted small">Sin favicon propio</span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => pickFavicon(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <Field label="Descripción del footer">
            <input
              value={form.description}
              maxLength={300}
              placeholder="Las tiendas de tu ciudad, en línea…"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="Email de contacto">
              <input
                type="email"
                value={form.email}
                maxLength={150}
                placeholder="info@tienderu.com"
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <Field label="Teléfono">
              <input
                value={form.phone}
                maxLength={30}
                placeholder="310 403 9092"
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label="WhatsApp">
              <input
                value={form.whatsapp}
                maxLength={30}
                placeholder="573104039092"
                onChange={(event) => setForm({ ...form, whatsapp: event.target.value })}
              />
            </Field>
            <Field label="Dirección">
              <input
                value={form.address}
                maxLength={200}
                placeholder="Bogotá, Colombia"
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />
            </Field>
            <Field label="Instagram (URL o @usuario)">
              <input
                value={form.instagram}
                maxLength={200}
                placeholder="@tienderu"
                onChange={(event) => setForm({ ...form, instagram: event.target.value })}
              />
            </Field>
            <Field label="Facebook (URL o usuario)">
              <input
                value={form.facebook}
                maxLength={200}
                placeholder="tienderu"
                onChange={(event) => setForm({ ...form, facebook: event.target.value })}
              />
            </Field>
          </div>
          <div>
            <button type="submit" className="primary" disabled={saveBranding.isPending}>
              {saveBranding.isPending ? 'Guardando…' : 'Guardar marca'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel className="stack full-width">
        <h2>Banners pequeños (home de tienderu.com)</h2>
        <p className="muted">
          Fila de promociones debajo del hero. Solo imagen (PNG, JPG o WEBP, máx 2 MB); si pones un
          enlace, toda la tarjeta será clicable. Se muestran hasta 6, en orden.
        </p>
        {smallBanners.isError ? (
          <Notice tone="error">
            No fue posible cargar los banners: ejecuta la migración v0.10.0-marketplace-branding.sql.
          </Notice>
        ) : null}

        <form className="stack" onSubmit={submitBanner}>
          <div className="form-grid">
            <Field label="Imagen">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => pickBannerFile(event.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="o URL de imagen">
              <input
                value={bannerUrl}
                maxLength={1000}
                placeholder="https://…"
                onChange={(event) => setBannerUrl(event.target.value)}
              />
            </Field>
            <Field label="Título (interno / accesibilidad)">
              <input
                value={bannerTitle}
                maxLength={120}
                placeholder="Ej: Envío gratis este mes"
                onChange={(event) => setBannerTitle(event.target.value)}
              />
            </Field>
            <Field label="Enlace al hacer clic (opcional)">
              <input
                value={bannerTarget}
                maxLength={500}
                placeholder="/buscar?category=Mercado o https://…"
                onChange={(event) => setBannerTarget(event.target.value)}
              />
            </Field>
            <Field label="Orden">
              <input
                type="number"
                min={0}
                value={bannerOrder}
                onChange={(event) => setBannerOrder(event.target.value)}
              />
            </Field>
          </div>
          {bannerPreview ? <img src={bannerPreview} alt="Vista previa" className="banner-preview" /> : null}
          <div>
            <button type="submit" className="primary" disabled={createBanner.isPending}>
              {createBanner.isPending ? 'Subiendo…' : 'Publicar banner'}
            </button>
          </div>
        </form>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Banner</th>
                <th>Título</th>
                <th>Enlace</th>
                <th>Orden</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(smallBanners.data ?? []).map((banner) => (
                <tr key={banner.id}>
                  <td>
                    <img src={banner.image_url} alt="" className="banner-thumb" />
                  </td>
                  <td>{banner.title || '—'}</td>
                  <td className="muted small" title={banner.target_url ?? ''}>
                    {banner.target_url || '—'}
                  </td>
                  <td>{banner.sort_order}</td>
                  <td>
                    <span className={`badge ${banner.active ? 'paid' : 'none'}`}>
                      {banner.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="quiet"
                      disabled={toggleBanner.isPending}
                      onClick={() =>
                        toggleBanner.mutate(
                          { id: banner.id, active: !banner.active },
                          {
                            onSuccess: async () => {
                              await queryClient.invalidateQueries({ queryKey: ['marketplace-banners'] });
                            },
                            onError: (error: Error) => setNotice(error.message)
                          }
                        )
                      }
                    >
                      {banner.active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={removeBanner.isPending}
                      onClick={() => {
                        if (!window.confirm('¿Eliminar este banner?')) return;
                        removeBanner.mutate(banner.id, {
                          onSuccess: async () => {
                            setNotice('Banner eliminado.');
                            await queryClient.invalidateQueries({ queryKey: ['marketplace-banners'] });
                          },
                          onError: (error: Error) => setNotice(error.message)
                        });
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {(smallBanners.data ?? []).length === 0 && !smallBanners.isPending ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Aún no hay banners pequeños.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="stack full-width">
        <h2>Banners del carrusel principal</h2>
        <p className="muted">
          El carrusel grande del home. Se agregan por URL de imagen (usa Supabase Storage u otro host
          público). <strong>Estos banners también aparecen en la app móvil de todos los tenants.</strong>
        </p>
        <form className="stack" onSubmit={submitBig}>
          <Field label="URL de la imagen">
            <input
              value={bigUrl}
              maxLength={1000}
              placeholder="https://…"
              onChange={(event) => setBigUrl(event.target.value)}
            />
          </Field>
          <div>
            <button type="submit" className="primary" disabled={createBig.isPending}>
              {createBig.isPending ? 'Agregando…' : 'Agregar al carrusel'}
            </button>
          </div>
        </form>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Banner</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(bigBanners.data ?? []).map((banner) => (
                <tr key={banner.id}>
                  <td>
                    <img src={banner.image_url} alt="" className="banner-thumb" />
                  </td>
                  <td className="muted small" title={banner.image_url}>
                    {banner.image_url}
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="quiet"
                      disabled={removeBig.isPending}
                      onClick={() => {
                        if (!window.confirm('¿Eliminar este banner del carrusel?')) return;
                        removeBig.mutate(banner.id, {
                          onSuccess: async () => {
                            setNotice('Banner del carrusel eliminado.');
                            await queryClient.invalidateQueries({ queryKey: ['admin-banners'] });
                          },
                          onError: (error: Error) => setNotice(error.message)
                        });
                      }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {(bigBanners.data ?? []).length === 0 && !bigBanners.isPending ? (
                <tr>
                  <td colSpan={3} className="empty">
                    El carrusel no tiene banners todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
