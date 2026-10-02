import { BadRequestException } from '@nestjs/common';

export interface PaginationQuery {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

function parsePositive(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`${field} is outside the allowed range`);
  }
  return parsed;
}

/**
 * Offset-based pagination over the existing tec_* schema (SELECT + LIMIT/OFFSET/COUNT).
 * High OFFSET values may degrade performance on large tables; keyset pagination is the
 * future evolution and requires no schema changes.
 */
export function parsePagination(
  page: unknown,
  limit: unknown,
  defaultLimit = 20,
  maxLimit = 100
): PaginationQuery {
  const parsedPage = parsePositive(page, 'page', 1, 1000000);
  const parsedLimit = parsePositive(limit, 'limit', defaultLimit, maxLimit);
  return { page: parsedPage, limit: parsedLimit, offset: (parsedPage - 1) * parsedLimit };
}

export function buildPaginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit)
    }
  };
}
