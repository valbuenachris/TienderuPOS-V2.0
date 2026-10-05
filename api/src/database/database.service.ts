import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export interface SqlResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface SqlExecutor {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<SqlResult<Row>>;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('DATABASE_URL is required');

    const parsed = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('DATABASE_URL must use PostgreSQL');
    }

    this.pool = new Pool({
      connectionString,
      max: Number(config.get('PG_POOL_MAX') ?? 15),
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      ssl: config.get('DATABASE_SSL') === 'true' ? { rejectUnauthorized: true } : undefined
    });

    this.pool.on('error', (error: NodeJS.ErrnoException) => {
      this.logger.error(`Idle PostgreSQL connection error (${error.code ?? 'UNKNOWN'})`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.query('SELECT 1');
    await this.warnAboutInventoryTriggers();
  }

  private async warnAboutInventoryTriggers(): Promise<void> {
    try {
      const result = await this.query<{ table_name: string; trigger_name: string }>(
        `SELECT c.relname AS table_name, t.tgname AS trigger_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE NOT t.tgisinternal
           AND n.nspname = 'public'
           AND t.tgenabled <> 'D'
           AND c.relname IN (
             'tec_sales', 'tec_sale_items', 'tec_product_store_qty', 'tec_products',
             'tec_purchases', 'tec_purchase_items'
           )`
      );
      if (result.rows.length > 0) {
        const list = result.rows.map((row) => `${row.table_name}.${row.trigger_name}`).join(', ');
        this.logger.error(
          `Inventory triggers detected (${list}); the API updates stock itself, so enabled triggers double-apply stock changes. Review and drop/disable them.`
        );
      }
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'UNKNOWN';
      this.logger.warn(`Could not inspect inventory triggers (${code})`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlResult<Row>> {
    const result = await this.pool.query(text, [...values] as never[]);
    return result as unknown as SqlResult<Row>;
  }

  async transaction<T>(work: (client: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let started = false;
    try {
      await client.query('BEGIN');
      started = true;
      const executor: SqlExecutor = {
        query: async <Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []) => {
          const result = await client.query(text, [...values] as never[]);
          return result as unknown as SqlResult<Row>;
        }
      };
      const result = await work(executor);
      await client.query('COMMIT');
      started = false;
      return result;
    } catch (error: unknown) {
      if (started) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackError: unknown) {
          // Preserve the original exception; response details stay sanitized.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
