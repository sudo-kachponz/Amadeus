import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns('rag_documents', {
    doc_title: { type: 'text' },
    doc_type: { type: 'text' },
    section: { type: 'text' },
    heading: { type: 'text' },
    start_page: { type: 'integer' },
    end_page: { type: 'integer' },
    chunk_index: { type: 'integer', notNull: true, default: 0 },
    metadata: { type: 'jsonb', notNull: true, default: "'{}'" },
  });

  pgm.createIndex('rag_documents', ['file_id', 'chunk_index']);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('rag_documents', ['file_id', 'chunk_index']);
  pgm.dropColumns('rag_documents', [
    'doc_title', 'doc_type', 'section', 'heading',
    'start_page', 'end_page', 'chunk_index', 'metadata',
  ]);
}
