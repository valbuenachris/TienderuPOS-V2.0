import { useEffect } from 'react';

function setMeta(attr: 'name' | 'property', key: string, value: string | null | undefined): void {
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) {
    if (existing) existing.remove();
    return;
  }
  const tag = existing ?? document.createElement('meta');
  tag.setAttribute(attr, key);
  tag.setAttribute('content', value);
  if (!existing) document.head.appendChild(tag);
}

/**
 * Título/meta/Open Graph por página (v0.11.2). Los crawlers que no ejecutan JS
 * (WhatsApp/Facebook) siguen viendo el HTML base; Google sí procesa estos tags.
 */
export function useDocumentMeta(meta: {
  title: string;
  description?: string | null;
  image?: string | null;
  url?: string;
}): void {
  useEffect(() => {
    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:image', meta.image);
    setMeta('property', 'og:url', meta.url ?? window.location.href);
    setMeta('property', 'og:type', 'website');
  }, [meta.title, meta.description, meta.image, meta.url]);
}
