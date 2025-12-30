// Service para Editor de Petições Trabalhistas
// Módulo isolado - pode ser removido sem afetar outros módulos

import { supabase } from '../config/supabase';
import type {
  PetitionBlock,
  CreatePetitionBlockDTO,
  UpdatePetitionBlockDTO,
  PetitionBlockCategory,
  SavedPetition,
  CreateSavedPetitionDTO,
  UpdateSavedPetitionDTO,
  DocumentType,
} from '../types/petitionEditor.types';

class PetitionEditorService {
  private blocksTable = 'petition_blocks';
  private petitionsTable = 'saved_petitions';
  private blockCategoriesTable = 'petition_block_categories';

  private orderColumn = '"order"';

  private documentTypeSupported: boolean | null = null;

  private isMissingDocumentTypeColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    // PostgREST pode retornar PGRST204 quando a coluna não existe
    if (String(error?.code || '').toUpperCase() === 'PGRST204') return true;
    return msg.includes('document_type') || details.includes('document_type');
  }

  private shouldUseDocumentType(): boolean {
    return this.documentTypeSupported !== false;
  }

  private markDocumentTypeUnsupported(): void {
    this.documentTypeSupported = false;
  }

  private isMissingCategoriesTable(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    if (code === '42P01') return true; // undefined_table
    if (code === 'PGRST204') return msg.includes(this.blockCategoriesTable) || details.includes(this.blockCategoriesTable);
    return msg.includes(this.blockCategoriesTable) || details.includes(this.blockCategoriesTable);
  }

  // ==================== CATEGORIAS DE BLOCOS ====================

  async listBlockCategories(documentType: DocumentType): Promise<PetitionBlockCategory[]> {
    const { data, error } = await supabase
      .from(this.blockCategoriesTable)
      .select('*')
      .eq('document_type', documentType)
      .eq('is_active', true)
      .order(this.orderColumn, { ascending: true });

    if (error) {
      if (this.isMissingCategoriesTable(error)) return [];
      throw new Error(error.message);
    }
    return data ?? [];
  }

  async upsertBlockCategories(
    documentType: DocumentType,
    categories: { id?: string; key: string; label: string; order: number; is_active?: boolean }[],
    existing?: PetitionBlockCategory[]
  ): Promise<void> {
    // Upsert active
    const payload = categories.map((c) => ({
      id: c.id,
      document_type: documentType,
      key: c.key,
      label: c.label,
      order: c.order,
      is_active: c.is_active ?? true,
    }));

    const { error } = await supabase
      .from(this.blockCategoriesTable)
      .upsert(payload, { onConflict: 'document_type,key' } as any);

    if (error) {
      if (this.isMissingCategoriesTable(error)) return;
      throw new Error(error.message);
    }

    // Deactivate removed keys
    const prev = existing || (await this.listBlockCategories(documentType));
    const currentKeys = new Set(categories.map((c) => c.key));
    const removed = prev.filter((p) => p.is_active && !currentKeys.has(p.key));
    if (!removed.length) return;

    const { error: error2 } = await supabase
      .from(this.blockCategoriesTable)
      .update({ is_active: false })
      .eq('document_type', documentType)
      .in('key', removed.map((r) => r.key));

    if (error2) {
      if (this.isMissingCategoriesTable(error2)) return;
      throw new Error(error2.message);
    }
  }

  // ==================== BLOCOS ====================

  async listBlocks(documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .order(this.orderColumn, { ascending: true });
      if (documentType && withFilter && this.shouldUseDocumentType()) q = q.eq('document_type', documentType);
      return q;
    };

    const { data, error } = await run(true);
    if (!error) return data ?? [];
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(false);
      const { data: data2, error: error2 } = await retry;
      if (error2) throw new Error(error2.message);
      return data2 ?? [];
    }
    throw new Error(error.message);
  }

  async listActiveBlocks(documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .eq('is_active', true)
        .order(this.orderColumn, { ascending: true });
      if (documentType && withFilter && this.shouldUseDocumentType()) q = q.eq('document_type', documentType);
      return q;
    };

    const { data, error } = await run(true);
    if (!error) return data ?? [];
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(false);
      const { data: data2, error: error2 } = await retry;
      if (error2) throw new Error(error2.message);
      return data2 ?? [];
    }
    throw new Error(error.message);
  }

  async listDefaultBlocks(documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .eq('is_active', true)
        .eq('is_default', true)
        .order(this.orderColumn, { ascending: true });
      if (documentType && withFilter && this.shouldUseDocumentType()) q = q.eq('document_type', documentType);
      return q;
    };

    const { data, error } = await run(true);
    if (!error) return data ?? [];
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(false);
      const { data: data2, error: error2 } = await retry;
      if (error2) throw new Error(error2.message);
      return data2 ?? [];
    }
    throw new Error(error.message);
  }

  async listBlocksByCategory(category: string, documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .eq('category', category)
        .eq('is_active', true)
        .order(this.orderColumn, { ascending: true });
      if (documentType && withFilter && this.shouldUseDocumentType()) q = q.eq('document_type', documentType);
      return q;
    };

    const { data, error } = await run(true);
    if (!error) return data ?? [];
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(false);
      const { data: data2, error: error2 } = await retry;
      if (error2) throw new Error(error2.message);
      return data2 ?? [];
    }
    throw new Error(error.message);
  }

  async getBlock(id: string): Promise<PetitionBlock | null> {
    const { data, error } = await supabase
      .from(this.blocksTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  async createBlock(payload: CreatePetitionBlockDTO): Promise<PetitionBlock> {
    const dt = payload.document_type ?? (payload as any).documentType ?? 'petition';

    // Get max order (prefer scoped by document_type, but fallback if column doesn't exist)
    const maxOrder = await (async () => {
      const run = async (withFilter: boolean) => {
        let q = supabase
          .from(this.blocksTable)
          .select('order')
          .order('order', { ascending: false })
          .limit(1);
        if (withFilter && this.shouldUseDocumentType()) q = q.eq('document_type', dt);
        return q;
      };

      const { data, error } = await run(true);
      if (!error) return data?.[0]?.order ?? -1;
      if (this.isMissingDocumentTypeColumn(error)) {
        this.markDocumentTypeUnsupported();
        const retry = await run(false);
        const { data: data2, error: error2 } = await retry;
        if (error2) throw new Error(error2.message);
        return data2?.[0]?.order ?? -1;
      }
      throw new Error(error.message);
    })();

    // Insert (prefer including document_type, but fallback if column doesn't exist)
    const insertWithDocType = async () => {
      return supabase
        .from(this.blocksTable)
        .insert({
          ...payload,
          document_type: dt,
          order: payload.order ?? maxOrder + 1,
          is_default: payload.is_default ?? false,
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
    };

    const insertWithoutDocType = async () => {
      // ensure we don't send document_type to PostgREST when column doesn't exist
      const rest: any = { ...(payload as any) };
      delete rest.document_type;
      delete rest.documentType;
      return supabase
        .from(this.blocksTable)
        .insert({
          ...rest,
          order: payload.order ?? maxOrder + 1,
          is_default: payload.is_default ?? false,
          is_active: payload.is_active ?? true,
        })
        .select()
        .single();
    };

    let data: PetitionBlock | null = null;
    let error: any = null;

    if (this.shouldUseDocumentType()) {
      const res1 = await insertWithDocType();
      data = res1.data ?? null;
      error = res1.error ?? null;
    }

    if (!data && (error && this.isMissingDocumentTypeColumn(error))) {
      this.markDocumentTypeUnsupported();
    }

    if (!data && (!error || this.documentTypeSupported === false)) {
      const res2 = await insertWithoutDocType();
      data = res2.data ?? null;
      error = res2.error ?? null;
    }

    if (error) {
      console.error('Supabase createBlock error:', error);
      throw new Error(
        [
          error.message,
          error.code ? `code=${error.code}` : '',
          error.details ? `details=${error.details}` : '',
          error.hint ? `hint=${error.hint}` : '',
        ]
          .filter(Boolean)
          .join(' | ')
      );
    }
    if (!data) throw new Error('Falha ao criar bloco (resposta vazia do Supabase)');
    return data;
  }

  async updateBlock(id: string, payload: UpdatePetitionBlockDTO): Promise<PetitionBlock> {
    const { data, error } = await supabase
      .from(this.blocksTable)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase updateBlock error:', error);
      throw new Error(
        [
          error.message,
          error.code ? `code=${error.code}` : '',
          error.details ? `details=${error.details}` : '',
          error.hint ? `hint=${error.hint}` : '',
        ]
          .filter(Boolean)
          .join(' | ')
      );
    }
    return data;
  }

  async deleteBlock(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.blocksTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async reorderBlocks(blockIds: string[]): Promise<void> {
    for (let i = 0; i < blockIds.length; i++) {
      await supabase
        .from(this.blocksTable)
        .update({ order: i })
        .eq('id', blockIds[i]);
    }
  }

  async toggleBlockDefault(id: string): Promise<PetitionBlock> {
    const block = await this.getBlock(id);
    if (!block) throw new Error('Bloco não encontrado');

    return this.updateBlock(id, { is_default: !block.is_default });
  }

  async toggleBlockActive(id: string): Promise<PetitionBlock> {
    const block = await this.getBlock(id);
    if (!block) throw new Error('Bloco não encontrado');

    return this.updateBlock(id, { is_active: !block.is_active });
  }

  // ==================== PETIÇÕES SALVAS ====================

  async listPetitions(): Promise<SavedPetition[]> {
    const { data, error } = await supabase
      .from(this.petitionsTable)
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getPetition(id: string): Promise<SavedPetition | null> {
    const { data, error } = await supabase
      .from(this.petitionsTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  async createPetition(payload: CreateSavedPetitionDTO): Promise<SavedPetition> {
    const { data, error } = await supabase
      .from(this.petitionsTable)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updatePetition(id: string, payload: UpdateSavedPetitionDTO): Promise<SavedPetition> {
    const { data, error } = await supabase
      .from(this.petitionsTable)
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data;

    // Fallback: alguns ambientes retornam 406 quando não há representação no update
    const refreshed = await this.getPetition(id);
    if (!refreshed) throw new Error('Petição não encontrada');
    return refreshed;
  }

  async deletePetition(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.petitionsTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ==================== EXPORTAÇÃO ====================

  generateDocxContent(content: string, title: string): string {
    // Gera HTML formatado para conversão em DOCX
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page {
      size: A4;
      margin: 3cm 3cm 2cm 3cm;
    }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      text-align: justify;
    }
    .paragrafo {
      margin-left: 4cm;
      text-indent: 0;
      text-align: justify;
      margin-bottom: 12pt;
    }
    .citacao {
      margin-left: 6cm;
      text-indent: 0;
      text-align: justify;
      font-style: italic;
      font-size: 11pt;
      margin-bottom: 12pt;
    }
    .titulo {
      text-align: center;
      font-weight: bold;
      font-size: 14pt;
      text-transform: uppercase;
      margin-bottom: 24pt;
    }
    .subtitulo {
      text-align: left;
      font-weight: bold;
      font-size: 12pt;
      margin-top: 18pt;
      margin-bottom: 12pt;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`;
  }
}

export const petitionEditorService = new PetitionEditorService();
