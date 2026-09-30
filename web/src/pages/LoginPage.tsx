import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Notice } from '../components/ui';
import { useSession } from '../app/session';

export default function LoginPage() {
  const { token, user, loading, login, loggingIn, sessionError } = useSession();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');

  if (loading) return <main className="loading-shell">Validando sesión…</main>;
  if (token && user) return <Navigate to="/pos" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    try {
      await login(identity, password);
      navigate('/pos', { replace: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No fue posible iniciar sesión');
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">P</div>
        <p className="eyebrow">POS · ACCESO</p>
        <h1>Iniciar sesión</h1>
        <p className="muted">Ingresa con tu cuenta de administrador o cajero.</p>
        {notice ? <Notice tone="error">{notice}</Notice> : null}
        {sessionError ? <Notice tone="error">La sesión venció. Inicia sesión otra vez.</Notice> : null}
        <label>
          Usuario o correo
          <input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="primary full" disabled={loggingIn}>{loggingIn ? 'Validando…' : 'Entrar al POS'}</button>
      </form>
    </main>
  );
}
