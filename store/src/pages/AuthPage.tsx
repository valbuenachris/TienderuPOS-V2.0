import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Icon } from '../components/ui/Icon';
import { useDocumentMeta } from '../use-document-meta';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  useDocumentMeta({ title: mode === 'login' ? 'Iniciar sesión — Tienderu.com' : 'Crear cuenta — Tienderu.com' });
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register({
          name: name.trim(),
          email: email.trim(),
          ...(phone.trim() !== '' ? { phone: phone.trim() } : {}),
          password
        });
      }
      navigate(next, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos completar la operación. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page py-8">
      <div className="mx-auto grid max-w-4xl overflow-hidden rounded-card bg-white shadow-card lg:grid-cols-[1fr_1.1fr]">
        <aside className="hidden flex-col justify-between bg-navy-900 p-8 text-white lg:flex">
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent-400 text-2xl font-extrabold lowercase text-navy-900">
              t
            </span>
            <h2 className="mt-6 text-2xl font-bold leading-snug">
              Una sola cuenta para todas las tiendas de tienderu.com
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Compra local, sigue tus pedidos y recibe en casa. Pago seguro con tarjetas y PSE.
            </p>
          </div>
          <ul className="mt-8 flex flex-col gap-3 text-sm text-white/85">
            <li className="flex items-center gap-2">
              <Icon name="shield" className="h-4 w-4 text-accent-400" /> Pago 100% seguro con Bold
            </li>
            <li className="flex items-center gap-2">
              <Icon name="truck" className="h-4 w-4 text-accent-400" /> Envío coordinado con cada tienda
            </li>
            <li className="flex items-center gap-2">
              <Icon name="package" className="h-4 w-4 text-accent-400" /> Seguimiento por sub-pedido
            </li>
          </ul>
        </aside>

        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-ink">
            {mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {mode === 'login'
              ? 'Compra en todas las tiendas con una sola cuenta.'
              : 'Una sola cuenta para comprarle a todas las tiendas.'}
          </p>

          {error ? (
            <div className="mt-4 rounded-md border border-deal-600/25 bg-red-50 px-3 py-2 text-sm text-price">
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            {mode === 'register' ? (
              <Field label="Nombre completo" required>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                />
              </Field>
            ) : null}
            <Field label="Correo electrónico" required>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </Field>
            {mode === 'register' ? (
              <Field label="Teléfono (opcional)">
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  maxLength={30}
                  autoComplete="tel"
                />
              </Field>
            ) : null}
            <Field label="Contraseña" required>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
                maxLength={72}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </Field>
            <Button type="submit" size="lg" full disabled={busy}>
              {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear mi cuenta'}
            </Button>
          </form>

          <p className="mt-5 text-sm text-ink-soft">
            {mode === 'login' ? (
              <>
                ¿Nuevo en tienderu.com?{' '}
                <Link to={`/registro?next=${encodeURIComponent(next)}`} className="font-semibold text-link-600 hover:underline">
                  Crea tu cuenta
                </Link>
              </>
            ) : (
              <>
                ¿Ya tienes cuenta?{' '}
                <Link to={`/ingresar?next=${encodeURIComponent(next)}`} className="font-semibold text-link-600 hover:underline">
                  Inicia sesión
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
