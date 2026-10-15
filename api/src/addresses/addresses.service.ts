import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateAddressDto, UpdateAddressDto } from './addresses.dto';

export type AddressRow = {
  id: number;
  customer_id: number;
  label: string;
  street_address: string;
  neighborhood: string | null;
  city: string | null;
  phone: string | null;
  additional_notes: string | null;
  is_default: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type AddressOwnerRow = {
  id: number;
  customer_id: number;
  is_default: boolean | null;
};

type IdRow = { id: number };

const PROBE_CACHE_MS = 60_000;
const DEFAULT_CITY = 'Bogotá';
const MIGRATION_HINT = 'Las direcciones no están disponibles: ejecuta la migración v0.3.69-customer-addresses.sql';

const ADDRESS_FIELDS = `id, customer_id, label, street_address, neighborhood, city, phone,
                        additional_notes, is_default, created_at, updated_at`;

function normalizeOptional(value?: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function normalizePhone(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

@Injectable()
export class AddressesService {
  private probe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, customerId: number): Promise<AddressRow[]> {
    await this.assertCustomer(tenantId, customerId);
    if (!(await this.tableExists())) return [];
    const result = await this.database.query<AddressRow>(
      `SELECT ${ADDRESS_FIELDS}
       FROM public.customer_addresses
       WHERE customer_id = $1
       ORDER BY is_default DESC, created_at ASC, id ASC`,
      [customerId]
    );
    return result.rows;
  }

  async create(tenantId: string, customerId: number, input: CreateAddressDto): Promise<AddressRow> {
    await this.assertCustomer(tenantId, customerId);
    if (!(await this.tableExists())) throw new ServiceUnavailableException(MIGRATION_HINT);

    return this.database.transaction(async (client) => {
      const countResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count
         FROM public.customer_addresses
         WHERE customer_id = $1`,
        [customerId]
      );
      const isFirst = (countResult.rows[0]?.count ?? 0) === 0;
      const isDefault = input.is_default === true || isFirst;

      if (isDefault) {
        await client.query(
          `UPDATE public.customer_addresses
           SET is_default = false, updated_at = NOW()
           WHERE customer_id = $1 AND is_default = true`,
          [customerId]
        );
      }

      const result = await client.query<AddressRow>(
        `INSERT INTO public.customer_addresses
           (customer_id, label, street_address, neighborhood, city, phone, additional_notes, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${ADDRESS_FIELDS}`,
        [
          customerId,
          input.label,
          input.street_address.trim(),
          normalizeOptional(input.neighborhood),
          normalizeOptional(input.city) ?? DEFAULT_CITY,
          normalizePhone(input.phone),
          normalizeOptional(input.additional_notes),
          isDefault
        ]
      );
      return result.rows[0];
    });
  }

  async update(tenantId: string, customerId: number, addressId: number, input: UpdateAddressDto): Promise<AddressRow> {
    await this.assertCustomer(tenantId, customerId);
    if (!(await this.tableExists())) throw new ServiceUnavailableException(MIGRATION_HINT);

    return this.database.transaction(async (client) => {
      const existing = await client.query<AddressOwnerRow>(
        `SELECT id, customer_id, is_default
         FROM public.customer_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1
         FOR UPDATE`,
        [addressId, customerId]
      );
      if (!existing.rows[0]) throw new NotFoundException('Address not found');

      const sets: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [addressId, customerId];
      if (input.label !== undefined) {
        values.push(input.label);
        sets.push(`label = $${values.length}`);
      }
      if (input.street_address !== undefined) {
        values.push(input.street_address.trim());
        sets.push(`street_address = $${values.length}`);
      }
      if (input.neighborhood !== undefined) {
        values.push(normalizeOptional(input.neighborhood));
        sets.push(`neighborhood = $${values.length}`);
      }
      if (input.city !== undefined) {
        values.push(normalizeOptional(input.city) ?? DEFAULT_CITY);
        sets.push(`city = $${values.length}`);
      }
      if (input.phone !== undefined) {
        values.push(normalizePhone(input.phone));
        sets.push(`phone = $${values.length}`);
      }
      if (input.additional_notes !== undefined) {
        values.push(normalizeOptional(input.additional_notes));
        sets.push(`additional_notes = $${values.length}`);
      }
      if (input.is_default === true) {
        await client.query(
          `UPDATE public.customer_addresses
           SET is_default = false, updated_at = NOW()
           WHERE customer_id = $1 AND id <> $2 AND is_default = true`,
          [customerId, addressId]
        );
        sets.push('is_default = true');
      }

      const result = await client.query<AddressRow>(
        `UPDATE public.customer_addresses
         SET ${sets.join(', ')}
         WHERE id = $1 AND customer_id = $2
         RETURNING ${ADDRESS_FIELDS}`,
        values
      );
      return result.rows[0];
    });
  }

  async setDefault(tenantId: string, customerId: number, addressId: number): Promise<AddressRow> {
    await this.assertCustomer(tenantId, customerId);
    if (!(await this.tableExists())) throw new ServiceUnavailableException(MIGRATION_HINT);

    return this.database.transaction(async (client) => {
      const existing = await client.query<IdRow>(
        `SELECT id FROM public.customer_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1
         FOR UPDATE`,
        [addressId, customerId]
      );
      if (!existing.rows[0]) throw new NotFoundException('Address not found');

      await client.query(
        `UPDATE public.customer_addresses
         SET is_default = false, updated_at = NOW()
         WHERE customer_id = $1 AND id <> $2 AND is_default = true`,
        [customerId, addressId]
      );
      const result = await client.query<AddressRow>(
        `UPDATE public.customer_addresses
         SET is_default = true, updated_at = NOW()
         WHERE id = $1 AND customer_id = $2
         RETURNING ${ADDRESS_FIELDS}`,
        [addressId, customerId]
      );
      return result.rows[0];
    });
  }

  async remove(tenantId: string, customerId: number, addressId: number) {
    await this.assertCustomer(tenantId, customerId);
    if (!(await this.tableExists())) throw new ServiceUnavailableException(MIGRATION_HINT);

    return this.database.transaction(async (client) => {
      const existing = await client.query<AddressOwnerRow>(
        `SELECT id, customer_id, is_default
         FROM public.customer_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1
         FOR UPDATE`,
        [addressId, customerId]
      );
      const address = existing.rows[0];
      if (!address) throw new NotFoundException('Address not found');

      await client.query(
        'DELETE FROM public.customer_addresses WHERE id = $1 AND customer_id = $2',
        [addressId, customerId]
      );

      // Mantener la invariante: si se borró la predeterminada, promover la más antigua.
      if (address.is_default === true) {
        const fallback = await client.query<IdRow>(
          `SELECT id FROM public.customer_addresses
           WHERE customer_id = $1
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
          [customerId]
        );
        const next = fallback.rows[0];
        if (next) {
          await client.query(
            `UPDATE public.customer_addresses
             SET is_default = true, updated_at = NOW()
             WHERE id = $1`,
            [next.id]
          );
        }
      }

      return { id: addressId, deleted: true };
    });
  }

  private async assertCustomer(tenantId: string, customerId: number): Promise<void> {
    const result = await this.database.query<IdRow>(
      `SELECT id FROM public.tec_customers
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, customerId]
    );
    if (result.rowCount !== 1) throw new NotFoundException('Customer not found');
  }

  private async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.customer_addresses')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }
}
