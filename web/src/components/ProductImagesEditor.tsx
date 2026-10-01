import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice } from './ui';
import { deleteProductImage, uploadProductImage } from '../api';
import type { ManagedProduct } from '../api';

type Slot = 1 | 2 | 3;

const SLOTS: Array<{ slot: Slot; label: string; field: 'image' | 'image_2' | 'image_3' }> = [
  { slot: 1, label: 'Imagen 1', field: 'image' },
  { slot: 2, label: 'Imagen 2', field: 'image_2' },
  { slot: 3, label: 'Imagen 3', field: 'image_3' }
];

export default function ProductImagesEditor({ product }: { product: ManagedProduct }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [targetSlot, setTargetSlot] = useState<Slot>(1);
  const [busySlot, setBusySlot] = useState<Slot | null>(null);
  const [dragSlot, setDragSlot] = useState<Slot | null>(null);
  const [brokenUrls, setBrokenUrls] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['managed-products'] });
  }

  async function upload(slot: Slot, file: File) {
    setBusySlot(slot);
    setNotice('');
    setError('');
    try {
      await uploadProductImage(product.id, slot, file);
      setNotice(`Imagen ${slot} actualizada.`);
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'No fue posible subir la imagen');
    } finally {
      setBusySlot(null);
    }
  }

  async function remove(slot: Slot) {
    setBusySlot(slot);
    setNotice('');
    setError('');
    try {
      await deleteProductImage(product.id, slot);
      setNotice(`Imagen ${slot} eliminada.`);
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'No fue posible eliminar la imagen');
    } finally {
      setBusySlot(null);
    }
  }

  function pick(slot: Slot) {
    setTargetSlot(slot);
    inputRef.current?.click();
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void upload(targetSlot, file);
  }

  function onDrop(slot: Slot, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragSlot(null);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(slot, file);
  }

  return (
    <div className="image-editor">
      <p className="eyebrow">IMÁGENES DEL PRODUCTO</p>
      <div className="image-gallery-grid">
        {SLOTS.map(({ slot, label, field }) => {
          const url = product[field];
          const broken = url !== null && brokenUrls[url] === true;
          const showImage = Boolean(url) && !broken;
          const busy = busySlot === slot;
          return (
            <div className="image-field" key={slot}>
              <span className="image-slot-label">{label}</span>
              <div
                className={`image-slot ${showImage ? 'filled' : 'empty'} ${dragSlot === slot ? 'drag' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragSlot(slot);
                }}
                onDragLeave={() => setDragSlot((current) => (current === slot ? null : current))}
                onDrop={(event) => onDrop(slot, event)}
              >
                {showImage && url ? (
                  <>
                    <img
                      src={url}
                      alt={`${product.name || 'Producto'} · ${label}`}
                      loading="lazy"
                      onError={() => setBrokenUrls((current) => ({ ...current, [url]: true }))}
                    />
                    <button
                      className="action-btn delete"
                      type="button"
                      onClick={() => void remove(slot)}
                      disabled={busySlot !== null}
                      aria-label={`Eliminar ${label}`}
                      title="Eliminar"
                    >
                      🗑️
                    </button>
                    <button
                      className="action-btn change"
                      type="button"
                      onClick={() => pick(slot)}
                      disabled={busySlot !== null}
                      aria-label={`Cambiar ${label}`}
                      title="Cambiar imagen"
                    >
                      📷
                    </button>
                  </>
                ) : (
                  <button className="image-empty" type="button" onClick={() => pick(slot)} disabled={busySlot !== null}>
                    <span aria-hidden>+</span>
                    <small>{broken ? 'Imagen no disponible · Reemplazar' : 'Agregar imagen'}</small>
                  </button>
                )}
                {busy ? (
                  <div className="image-loading" aria-label="Subiendo imagen">
                    <span className="spinner" />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <div className="image-field">
          <span className="image-slot-label">Imagen 4</span>
          <div className="image-slot disabled" aria-hidden>
            <div className="image-empty disabled">
              <span>+</span>
              <small>Espacio disponible</small>
            </div>
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden-file"
        onChange={onFileChange}
      />
      <p className="image-help">JPG, PNG o WEBP · máximo 2 MB. Arrastra una imagen a una ranura o usa el ícono de cámara.</p>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
