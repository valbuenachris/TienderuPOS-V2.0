import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { SaleResult } from '../api';
import { paymentMethodLabel, saleStatusLabel } from '../payments';
import { formatDate, formatMoney } from '../format';
import { buildTicketText, buildWhatsAppUrl } from '../utils/ticketFormatter';
import { downloadTicketPdf } from '../utils/pdfGenerator';

interface SaleTicketProps {
  sale: SaleResult;
  currency: string;
  siteName?: string;
  storeName?: string;
  cashierName?: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  nit?: string | null;
  thankYouMessage?: string | null;
  returnPolicy?: string | null;
  showQr?: boolean;
  printerWidth?: '58mm' | '80mm' | null;
  preview?: boolean;
}

function buildQrPayload(sale: SaleResult, storeName: string): string {
  const items = sale.items.map((item) => ({
    code: item.code ?? String(item.product_id),
    name: item.name ?? '',
    qty: Number(item.quantity),
    price: Number(item.unit_price),
    subtotal: Number(item.subtotal)
  }));
  if (items.length > 8) {
    return [
      `Ticket: #${sale.id}`,
      `Fecha: ${sale.created_at ? new Date(sale.created_at).toLocaleString('es-CO') : ''}`,
      `Tienda: ${storeName}`,
      `Items: ${items.length}`,
      `Total: ${Number(sale.grand_total).toFixed(2)}`
    ].join('\n');
  }
  return JSON.stringify({
    ticket: sale.id,
    date: sale.created_at,
    store: storeName,
    customer: sale.customer_name || 'Cliente ocasional',
    items,
    subtotal: Number(sale.total),
    tax: Number(sale.tax_total),
    total: Number(sale.grand_total),
    payment: sale.paid_by ? paymentMethodLabel(sale.paid_by) : 'pendiente',
    received: sale.amount_received === undefined || sale.amount_received === null ? null : Number(sale.amount_received),
    change: sale.change_amount === undefined || sale.change_amount === null ? null : Number(sale.change_amount)
  });
}

export default function SaleTicket({
  sale,
  currency,
  siteName,
  storeName,
  cashierName,
  logoUrl,
  address,
  phone,
  email,
  nit,
  thankYouMessage,
  returnPolicy,
  showQr = true,
  printerWidth,
  preview = false
}: SaleTicketProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [logoBroken, setLogoBroken] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const ticketRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showQr) {
      setQrDataUrl('');
      return;
    }
    let active = true;
    const payload = buildQrPayload(sale, storeName || siteName || 'POS');
    QRCode.toDataURL(payload, { width: 256, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url); })
      .catch(() => { if (active) setQrDataUrl(''); });
    return () => { active = false; };
  }, [sale, storeName, siteName, showQr]);

  useEffect(() => {
    if (printerWidth !== '80mm') return;
    const style = document.createElement('style');
    style.textContent = '@page { size: 80mm auto; margin: 3mm 2mm; }';
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, [printerWidth]);

  const isCash = sale.paid_by === 'cash';
  const received = sale.amount_received;
  const change = sale.change_amount;
  const dueAmount = Math.max(0, Number(sale.grand_total ?? 0) - Number(sale.paid ?? 0));
  const showDue = dueAmount > 0;
  const points = Number(sale.total_reward_points ?? 0);
  const showCustomer = Boolean(sale.customer_name) && sale.customer_name !== 'Cliente ocasional';

  function handleWhatsApp() {
    const text = buildTicketText({ sale, currency, siteName, thankYouMessage, address, nit });
    window.open(buildWhatsAppUrl(text, sale.customer_phone), '_blank', 'noopener');
  }

  async function handlePdf() {
    if (!ticketRef.current || pdfBusy) return;
    setPdfBusy(true);
    setPdfError('');
    try {
      await downloadTicketPdf(ticketRef.current, `ticket-${sale.id}.pdf`);
    } catch (_error: unknown) {
      setPdfError('No fue posible generar el PDF. Intenta de nuevo.');
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <div ref={ticketRef} className={`sale-ticket ${preview ? 'sale-ticket-preview' : 'print-receipt'} ${printerWidth === '80mm' ? 'sale-ticket--wide' : ''}`.trim()}>
      <div className="ticket-header">
        {logoUrl && !logoBroken ? (
          <img
            className="ticket-logo-img"
            src={logoUrl}
            alt={siteName || 'Logo'}
            onError={() => setLogoBroken(true)}
          />
        ) : null}
        <div className="ticket-logo">{siteName || 'TIENDERU POS'}</div>
        {address ? <div className="ticket-meta-line">{address}</div> : null}
        {phone || nit ? (
          <div className="ticket-meta-line">
            {[phone, nit ? `NIT ${nit}` : ''].filter(Boolean).join(' · ')}
          </div>
        ) : null}
        <div className="ticket-ticket-no">Ticket #{sale.id}</div>
        <div className="ticket-meta-line">{formatDate(sale.created_at)}</div>
        {cashierName ? <div className="ticket-meta-line">Cajero: {cashierName}</div> : null}
        {showCustomer ? <div className="ticket-meta-line">Cliente: {sale.customer_name}</div> : null}
      </div>

      <div className="ticket-rule" />

      <div className="ticket-items-head"><span>Descripción</span><span>Importe</span></div>
      <div className="ticket-items">
        {sale.items.map((item, index) => (
          <div className="ticket-item" key={`${item.product_id}-${index}`}>
            <div className="ticket-item-main">
              <span className="ticket-item-name">{item.name || item.code || `#${item.product_id}`}</span>
              <span className="ticket-item-amount">{formatMoney(item.subtotal, currency)}</span>
            </div>
            <div className="ticket-item-sub">
              {item.code ? `Cód. ${item.code} · ` : ''}{Number(item.quantity)} x {formatMoney(item.unit_price, currency)}
            </div>
          </div>
        ))}
      </div>

      <div className="ticket-rule" />

      <div className="ticket-totals">
        <div><span>Subtotal</span><span>{formatMoney(sale.total, currency)}</span></div>
        <div><span>Impuestos</span><span>{formatMoney(sale.tax_total, currency)}</span></div>
        {Number(sale.total_discount ?? 0) > 0 ? (
          <div className="ticket-discount">
            <span>Descuento {sale.order_discount_id ? `(${sale.order_discount_id})` : ''}</span>
            <span>-{formatMoney(sale.total_discount, currency)}</span>
          </div>
        ) : null}
        <div className="ticket-grand-total"><span>TOTAL</span><span>{formatMoney(sale.grand_total, currency)}</span></div>
      </div>

      <div className="ticket-rule" />

      <div className="ticket-payment">
        <div><span>Pago</span><span>{sale.paid_by ? paymentMethodLabel(sale.paid_by) : 'Cuenta pendiente'}</span></div>
        {isCash && received ? <div><span>Recibido</span><span>{formatMoney(received, currency)}</span></div> : null}
        {showDue ? (
          <div className="ticket-due-row">
            <span>Debido</span>
            <span>{formatMoney(dueAmount, currency)}</span>
          </div>
        ) : null}
        {isCash && received ? <div><span>Cambio</span><span>{formatMoney(change ?? '0', currency)}</span></div> : null}
        <div><span>Estado</span><span>{saleStatusLabel(sale.status)}</span></div>
      </div>

      {points > 0 ? <div className="ticket-points">Puntos ganados: {points}</div> : null}

      <div className="ticket-rule" />

      <div className="ticket-footer">
        {showQr ? (
          <div className="ticket-qr-container">
            {qrDataUrl ? <img className="ticket-qr" src={qrDataUrl} alt="QR del ticket" /> : <div className="ticket-qr placeholder">QR</div>}
          </div>
        ) : null}
        {showQr ? <div className="ticket-qr-label">Escanea para ver detalles</div> : null}
        <div className="ticket-thanks">{thankYouMessage?.trim() || '¡Gracias por su compra!'}</div>
        {returnPolicy?.trim() ? <div className="ticket-legal">{returnPolicy}</div> : null}
        <div className="ticket-legal">Comprobante de venta · {siteName || 'Tienderu POS'}</div>
        <div className="ticket-branding">
          <div className="ticket-branding-line">Facturado con Tienderu POS</div>
          <div className="ticket-branding-contact">
            {email?.trim() || 'info@tienderu.com'} - {phone?.trim() || '3104039092'}
          </div>
        </div>
      </div>
      </div>
      {preview ? (
        <div className="ticket-actions">
          <button type="button" className="btn-whatsapp" onClick={handleWhatsApp}>📱 Enviar por WhatsApp</button>
          <button type="button" className="btn-pdf" onClick={handlePdf} disabled={pdfBusy}>
            {pdfBusy ? 'Generando…' : '📄 Generar PDF'}
          </button>
          <button type="button" className="primary" onClick={() => window.print()}>🖨️ Imprimir</button>
        </div>
      ) : null}
      {preview && pdfError ? <div className="ticket-action-error">{pdfError}</div> : null}
    </>
  );
}
