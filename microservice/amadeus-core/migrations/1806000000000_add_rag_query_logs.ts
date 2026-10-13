import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('rag_query_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_query: { type: 'text', notNull: true },
    search_query: { type: 'text', notNull: true },
    chunks: { type: 'jsonb', notNull: true, default: "'[]'" },
    top_similarity: { type: 'real' },
    confident: { type: 'boolean', notNull: true, default: false },
    reranked: { type: 'boolean', notNull: true, default: false },
    decomposed: { type: 'jsonb' },
    multi_hop_query: { type: 'text' },
    feedback: { type: 'smallint' },  // -1 bad, 0 neutral, 1 good
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('rag_query_logs', ['created_at']);
  pgm.createIndex('rag_query_logs', ['feedback'], { where: 'feedback IS NOT NULL' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('rag_query_logs');
}
