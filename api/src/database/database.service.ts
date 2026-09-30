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
