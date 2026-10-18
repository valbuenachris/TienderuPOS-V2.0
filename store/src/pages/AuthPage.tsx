import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
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
    <div className="page auth-page">
      <div className="auth-card">
        <h1>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Compra en todas las tiendas de tienderu.com con una sola cuenta.'
            : 'Una sola cuenta para comprarle a todas las tiendas de tienderu.com.'}
        </p>

        {error && <div className="notice error">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Nombre completo
              <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} />
            </label>
          )}
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          {mode === 'register' && (
            <label>
              Teléfono (opcional)
              <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
            </label>
          )}
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
              maxLength={72}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
          <button type="submit" className="btn-buy full" disabled={busy}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear mi cuenta'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              ¿Nuevo en tienderu.com? <Link to={`/registro?next=${encodeURIComponent(next)}`}>Crea tu cuenta</Link>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta? <Link to={`/ingresar?next=${encodeURIComponent(next)}`}>Inicia sesión</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
