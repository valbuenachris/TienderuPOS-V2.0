import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useAiSettingsQuery, useApiMutation } from '../pos-queries';
import { sendAiChat } from '../api';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  '¿Cuánto vendí los últimos 3 días?',
  '¿Cuál es mi producto más vendido este mes?',
  '¿Qué cliente compra más este mes?',
  '¿Cuánto tengo por cobrar en cuentas abiertas?',
  '¿Qué productos no se venden hace 30 días?',
  '¿Qué me sugieres pedir esta semana?'
];

export default function AiAssistantPage() {
  const { token, tenantId } = useSession();
  const settingsQuery = useAiSettingsQuery(token, tenantId);
  const settings = settingsQuery.data ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const chatMutation = useApiMutation((history: ChatMessage[]) => sendAiChat(history));

  const sending = chatMutation.isPending;
  const configured = settings?.has_api_key === true;
  const canSend = configured && !sending;

  function scrollToBottom() {
    window.setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, 50);
  }

  function send(text: string) {
    const content = text.trim();
    if (content === '' || !canSend) return;
    setError('');
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    scrollToBottom();
    chatMutation.mutate(next.slice(-20), {
      onSuccess: (result) => {
        setMessages((current) => [...current, { role: 'assistant', content: result.reply }]);
        scrollToBottom();
      },
      onError: (mutationError) => setError(mutationError.message)
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRACIÓN"
        title="Asistente IA"
        actions={(
          <button
            className="quiet"
            type="button"
            onClick={() => { setMessages([]); setError(''); }}
            disabled={sending || messages.length === 0}
          >
            Nueva conversación
          </button>
        )}
      />
      <Panel className="stack full-width">
        {!configured && !settingsQuery.isPending ? (
          <Notice tone="error">El asistente no está disponible: falta OPENROUTER_API_KEY en el servidor (.env).</Notice>
        ) : null}
        {settingsQuery.isError ? <Notice tone="error">No fue posible cargar la configuración del asistente.</Notice> : null}

        <div className="chat-window" ref={listRef} aria-live="polite">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>Pregúntame por tus ventas, productos más vendidos, ganancias o qué pedir. Respondo con datos reales de tu tienda.</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    className="quiet"
                    onClick={() => send(question)}
                    disabled={!canSend}
                  >
                    {question}
                  </button>
                ))}
              </div>
              <details className="chat-capabilities">
                <summary>¿Qué puedo consultar?</summary>
                <ul>
                  <li>Ventas, compras, gastos y ganancia por rango de fechas</li>
                  <li>Ventas por día, mes, hora del día y categoría</li>
                  <li>Productos: más vendidos, margen, stock bajo y sin movimiento</li>
                  <li>Clientes: ranking por compras, búsqueda, puntos y deuda pendiente</li>
                  <li>Cuentas abiertas por cobrar</li>
                </ul>
              </details>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                <span className="chat-role">{message.role === 'user' ? 'Tú' : 'Asistente'}</span>
                <p>{message.content}</p>
              </div>
            ))
          )}
          {sending ? (
            <div className="chat-bubble assistant">
              <span className="chat-role">Asistente</span>
              <p className="muted">Pensando…</p>
            </div>
          ) : null}
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <form className="chat-input" onSubmit={submit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escribe tu pregunta…"
            maxLength={2000}
            disabled={sending}
            aria-label="Pregunta para el asistente"
          />
          <button className="primary" type="submit" disabled={!canSend || input.trim() === ''}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
        <p className="muted">
          Respuestas generadas con IA sobre métricas agregadas de tu tienda (sin datos personales de clientes).
          El modelo lo administra la plataforma; contrasta cifras clave en Reportes.
        </p>
      </Panel>
    </>
  );
}
