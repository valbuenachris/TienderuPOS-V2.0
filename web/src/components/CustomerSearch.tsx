import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useCustomerSearchQuery } from '../pos-queries';
import type { Customer } from '../api';

const MAX_RESULTS = 10;

interface CustomerSearchProps {
  token: string | null;
  tenantId: string | null;
  storeId: number | null;
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  disabled?: boolean;
  label?: string;
}

export default function CustomerSearch({
  token,
  tenantId,
  storeId,
  value,
  onChange,
  disabled = false,
  label = 'Cliente'
}: CustomerSearchProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastNotifiedRef = useRef<Customer | null>(value);
  const inputId = useId();
  const listId = `${inputId}-list`;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (value === lastNotifiedRef.current) return;
    lastNotifiedRef.current = value;
    setQuery(value?.name ?? '');
    setDebouncedQuery('');
    setOpen(false);
  }, [value]);

  const trimmed = debouncedQuery.trim();
  const searchQuery = useCustomerSearchQuery(token, tenantId, storeId, trimmed);
  const results = (searchQuery.data ?? []).slice(0, MAX_RESULTS);
  const activeIndex = results.length === 0 ? -1 : Math.min(highlight, results.length - 1);

  function emit(nextValue: Customer | null) {
    lastNotifiedRef.current = nextValue;
    onChange(nextValue);
  }

  function selectCustomer(customer: Customer) {
    emit(customer);
    setQuery(customer.name ?? '');
    setDebouncedQuery('');
    setOpen(false);
  }

  function clearSelection() {
    emit(null);
    setQuery('');
    setDebouncedQuery('');
    setHighlight(0);
    setOpen(false);
  }

  function handleInputChange(next: string) {
    setQuery(next);
    setHighlight(0);
    setOpen(true);
    if (value !== null && next !== (value.name ?? '')) emit(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlight(0);
        return;
      }
      setHighlight((current) => (results.length === 0 ? 0 : Math.min(current + 1, results.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && results[activeIndex]) {
        event.preventDefault();
        selectCustomer(results[activeIndex]);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const searching = open && trimmed.length > 0;
  const showHint = open && trimmed.length === 0;
  const showEmpty = searching && !searchQuery.isPending && results.length === 0;
  const showOccasional = value === null && !focused && query === '';

  return (
    <div className="customer-search" ref={containerRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className="customer-search-control">
        <input
          id={inputId}
          className={`customer-search-input ${showOccasional ? 'occasional' : ''}`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-label={label}
          placeholder={showOccasional ? 'Cliente ocasional' : 'Buscar cliente...'}
          value={query}
          disabled={disabled}
          autoComplete="off"
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
        />
        {value !== null || query !== '' ? (
          <button
            type="button"
            className="customer-search-clear"
            title="Quitar cliente seleccionado"
            aria-label="Quitar cliente seleccionado"
            onClick={clearSelection}
            disabled={disabled}
          >
            ✕
          </button>
        ) : null}
        {open ? (
          <ul className="customer-search-list" role="listbox" id={listId} aria-label="Resultados de clientes">
            {showHint ? (
              <li className="customer-search-empty">Escribe para buscar por nombre, correo o teléfono.</li>
            ) : null}
            {searching && searchQuery.isPending ? (
              <li className="customer-search-empty">Buscando…</li>
            ) : null}
            {showEmpty ? (
              <li className="customer-search-empty">No se encontraron clientes</li>
            ) : null}
            {results.map((customer, index) => (
              <li
                key={customer.id}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={value?.id === customer.id}
                className={`customer-search-option ${index === activeIndex ? 'active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => selectCustomer(customer)}
              >
                <strong>{customer.name || `Cliente #${customer.id}`}</strong>
                <small>{[customer.email, customer.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
