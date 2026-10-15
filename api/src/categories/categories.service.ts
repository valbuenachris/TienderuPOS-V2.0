import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
  created_at: string | null;
};

type CategoryIdRow = { id: string };
type CountRow = { count: number };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code?: unknown }).code) === '23505';
}

@Injectable()
export class CategoriesService {
  private imageProbe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<CategoryRow[]> {
    const imageExpr = await this.imageColumnExpr('c');
    const result = await this.database.query<CategoryRow>(
      `SELECT c.id::text AS id, c.name, c.description, c.created_at,
              ${imageExpr} AS image_url,
              (SELECT COUNT(*) FROM public.tec_products p
                WHERE p.tenant_id = c.tenant_id AND p.category_id = c.id)::integer AS product_count
       FROM public.tec_categories c
       WHERE c.tenant_id = $1
       ORDER BY c.name`,
      [tenantId]
    );
    return result.rows;
  }

  private async imageColumnExists(): Promise<boolean> {
    const now = Date.now();
    if (this.imageProbe && now - this.imageProbe.at < 60_000) return this.imageProbe.exists;
    const result = await this.database.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'tec_categories'
           AND column_name = 'image_url'
       ) AS exists`
    );
    const exists = result.rows[0]?.exists === true;
    this.imageProbe = { exists, at: now };
    return exists;
  }

  private async imageColumnExpr(alias: string): Promise<string> {
    return (await this.imageColumnExists()) ? `${alias}.image_url` : 'NULL::text';
  }

  async create(tenantId: string, input: CreateCategoryDto): Promise<CategoryRow> {
    try {
      const result = await this.database.query<CategoryRow>(
        `INSERT INTO public.tec_categories (tenant_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id::text AS id, name, description, created_at`,
        [tenantId, input.name.trim(), input.description?.trim() || null]
      );
      return { ...result.rows[0], product_count: 0, image_url: null };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new BadRequestException('Ya existe una categoría con ese nombre');
      throw error;
    }
  }

  async update(tenantId: string, categoryId: string, input: UpdateCategoryDto): Promise<CategoryRow> {
    const existing = await this.database.query<CategoryIdRow>(
      'SELECT id::text AS id FROM public.tec_categories WHERE tenant_id = $1 AND id::text = $2 LIMIT 1',
      [tenantId, categoryId]
    );
    if (existing.rowCount !== 1) throw new NotFoundException('Category not found');

    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [tenantId, categoryId];
    if (input.name !== undefined) {
      values.push(input.name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description === null ? null : (input.description.trim() || null));
      sets.push(`description = $${values.length}`);
    }
    try {
      await this.database.query(
        `UPDATE public.tec_categories SET ${sets.join(', ')} WHERE tenant_id = $1 AND id::text = $2`,
        values
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new BadRequestException('Ya existe una categoría con ese nombre');
      throw error;
    }

    const imageExpr = await this.imageColumnExpr('c');
    const result = await this.database.query<CategoryRow>(
      `SELECT c.id::text AS id, c.name, c.description, c.created_at,
              ${imageExpr} AS image_url,
              (SELECT COUNT(*) FROM public.tec_products p
                WHERE p.tenant_id = c.tenant_id AND p.category_id = c.id)::integer AS product_count
       FROM public.tec_categories c
       WHERE c.tenant_id = $1 AND c.id::text = $2
       LIMIT 1`,
      [tenantId, categoryId]
    );
    const category = result.rows[0];
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async remove(tenantId: string, categoryId: string): Promise<void> {
    const existing = await this.database.query<CategoryIdRow>(
      'SELECT id::text AS id FROM public.tec_categories WHERE tenant_id = $1 AND id::text = $2 LIMIT 1',
      [tenantId, categoryId]
    );
    if (existing.rowCount !== 1) throw new NotFoundException('Category not found');

    const linked = await this.database.query<CountRow>(
      'SELECT COUNT(*)::integer AS count FROM public.tec_products WHERE tenant_id = $1 AND category_id::text = $2',
      [tenantId, categoryId]
    );
    const count = linked.rows[0]?.count ?? 0;
    if (count > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${count} producto(s) tienen esta categoría asignada`
      );
    }
    await this.database.query(
      'DELETE FROM public.tec_categories WHERE tenant_id = $1 AND id::text = $2',
      [tenantId, categoryId]
    );
  }
}
