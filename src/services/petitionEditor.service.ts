// Service para Editor de Petições
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
  LegalArea,
  CreateLegalAreaDTO,
  UpdateLegalAreaDTO,
  PetitionStandardType,
  CreatePetitionStandardTypeDTO,
  UpdatePetitionStandardTypeDTO,
  PetitionStandardTypeBlock,
} from '../types/petitionEditor.types';

class PetitionEditorService {
  private blocksTable = 'petition_blocks';
  private petitionsTable = 'saved_petitions';
  private blockCategoriesTable = 'petition_block_categories';
  private legalAreasTable = 'legal_areas';
  private standardTypesTable = 'petition_standard_types';
  private standardTypeBlocksTable = 'petition_standard_type_blocks';

  private orderColumn = '"order"';

  private documentTypeSupported: boolean | null = null;

  private isMissingDocumentTypeColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    // PostgREST pode retornar PGRST204 quando a coluna não existe
    if (String(error?.code || '').toUpperCase() === 'PGRST204') return true;
    // Alguns cenários retornam 400 com mensagem de coluna inexistente
    if (msg.includes('document_type') && msg.includes('column')) return true;
    if (details.includes('document_type') && details.includes('column')) return true;
    return msg.includes('document_type') || details.includes('document_type');
  }

  private isMissingOrderColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    
    // PostgREST pode retornar PGRST204 quando a coluna não existe
    if (code === 'PGRST204') return msg.includes('order') || details.includes('order');
    
    // Alguns cenários retornam 400 com mensagem de coluna inexistente
    if (msg.includes('order') && msg.includes('column')) return true;
    if (details.includes('order') && details.includes('column')) return true;
    
    // Verificar se a mensagem menciona a coluna order especificamente
    return msg.includes('"order"') || details.includes('"order"') || 
           msg.includes('column "order"') || details.includes('column "order"');
  }

  private async requireUserId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const id = data.user?.id;
    if (!id) throw new Error('Usuário não autenticado');
    return id;
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

  // ==================== MODELO PADRÃO ====================

  async saveDefaultTemplate(name: string, dataBase64: string): Promise<void> {
    const userId = await this.requireUserId();

    const { error } = await supabase.from('petition_default_templates').upsert(
      {
        user_id: userId,
        name,
        data_base64: dataBase64,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) throw error;
  }

  async getDefaultTemplate(): Promise<{ name: string; dataBase64: string } | null> {
    const userId = await this.requireUserId();

    const { data, error } = await supabase
      .from('petition_default_templates')
      .select('name, data_base64')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { name: data.name, dataBase64: data.data_base64 };
  }

  // ==================== BLOCOS ====================

  async listBlocks(documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withOrder: boolean, withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*');
      
      if (withOrder) {
        q = q.order(this.orderColumn, { ascending: true });
      } else {
        // Fallback: ordenar por created_at se order não existir
        q = q.order('created_at', { ascending: true });
      }
      
      if (documentType && withFilter && this.shouldUseDocumentType()) {
        q = q.eq('document_type', documentType);
      }
      return q;
    };

    // Tentar primeiro com order e document_type
    const { data, error } = await run(true, true);
    if (!error) return data ?? [];
    
    // Se erro for relacionado à coluna order, tentar sem order
    if (this.isMissingOrderColumn(error)) {
      const retry = await run(false, true);
      const { data: data2, error: error2 } = await retry;
      if (!error2) return data2 ?? [];
      
      // Se ainda falhar e for relacionado a document_type, tentar sem document_type
      if (documentType && this.isMissingDocumentTypeColumn(error2)) {
        this.markDocumentTypeUnsupported();
        const retry2 = await run(false, false);
        const { data: data3, error: error3 } = await retry2;
        if (!error3) return data3 ?? [];
        throw new Error(error3.message);
      }
      throw new Error(error2.message);
    }
    
    // Se erro for relacionado a document_type, tentar sem document_type
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(true, false);
      const { data: data2, error: error2 } = await retry;
      if (!error2) return data2 ?? [];
      throw new Error(error2.message);
    }
    
    throw new Error(error.message);
  }

  async listActiveBlocks(documentType?: DocumentType): Promise<PetitionBlock[]> {
    const run = async (withOrder: boolean, withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .eq('is_active', true);
      
      if (withOrder) {
        q = q.order(this.orderColumn, { ascending: true });
      } else {
        // Fallback: ordenar por created_at se order não existir
        q = q.order('created_at', { ascending: true });
      }
      
      if (documentType && withFilter && this.shouldUseDocumentType()) {
        q = q.eq('document_type', documentType);
      }
      return q;
    };

    // Tentar primeiro com order e document_type
    const { data, error } = await run(true, true);
    if (!error) return data ?? [];
    
    // Se erro for relacionado à coluna order, tentar sem order
    if (this.isMissingOrderColumn(error)) {
      const retry = await run(false, true);
      const { data: data2, error: error2 } = await retry;
      if (!error2) return data2 ?? [];
      
      // Se ainda falhar e for relacionado a document_type, tentar sem document_type
      if (documentType && this.isMissingDocumentTypeColumn(error2)) {
        this.markDocumentTypeUnsupported();
        const retry2 = await run(false, false);
        const { data: data3, error: error3 } = await retry2;
        if (!error3) return data3 ?? [];
        throw new Error(error3.message);
      }
      throw new Error(error2.message);
    }
    
    // Se erro for relacionado a document_type, tentar sem document_type
    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(true, false);
      const { data: data2, error: error2 } = await retry;
      if (!error2) return data2 ?? [];
      throw new Error(error2.message);
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

  async getBlockStandardTypeId(blockId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from(this.standardTypeBlocksTable)
      .select('standard_type_id')
      .eq('block_id', blockId)
      .order(this.orderColumn, { ascending: true })
      .limit(1);

    if (error) throw new Error(error.message);
    const id = data?.[0]?.standard_type_id;
    return id ? String(id) : null;
  }

  async setBlockStandardType(blockId: string, standardTypeId: string | null): Promise<void> {
    const { error: delError } = await supabase
      .from(this.standardTypeBlocksTable)
      .delete()
      .eq('block_id', blockId);
    if (delError) throw new Error(delError.message);
    if (!standardTypeId) return;
    await this.addBlockToStandardType(standardTypeId, blockId, true);
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

  async deleteAllPetitions(): Promise<void> {
    // PostgREST exige um filtro para delete; como id é UUID, "neq('', ...)" efetivamente atinge todas as linhas visíveis via RLS.
    const { error } = await supabase
      .from(this.petitionsTable)
      .delete()
      .neq('id', '');

    if (error) throw new Error(error.message);
  }

  async deleteOrphanPetitions(): Promise<void> {
    const { error } = await supabase
      .from(this.petitionsTable)
      .delete()
      .is('client_id', null);

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

  // ==================== ÁREAS JURÍDICAS ====================

  async listLegalAreas(includeInactive = false): Promise<LegalArea[]> {
    let query = supabase
      .from(this.legalAreasTable)
      .select('*')
      .order(this.orderColumn, { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      // Se a tabela não existir, retornar array vazio
      const code = String(error?.code || '').toUpperCase();
      if (code === '42P01' || code === 'PGRST204') return [];
      throw new Error(error.message);
    }
    return data ?? [];
  }

  async getLegalArea(id: string): Promise<LegalArea | null> {
    const { data, error } = await supabase
      .from(this.legalAreasTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // not found
      throw new Error(error.message);
    }
    return data;
  }

  async createLegalArea(dto: CreateLegalAreaDTO): Promise<LegalArea> {
    // Obter próxima ordem
    const areas = await this.listLegalAreas(true);
    const maxOrder = areas.reduce((max, a) => Math.max(max, a.order ?? 0), -1);

    const payload = {
      name: dto.name,
      description: dto.description ?? null,
      color: dto.color ?? '#f97316',
      icon: dto.icon ?? 'scale',
      order: dto.order ?? maxOrder + 1,
      is_active: dto.is_active ?? true,
    };

    const { data, error } = await supabase
      .from(this.legalAreasTable)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateLegalArea(id: string, dto: UpdateLegalAreaDTO): Promise<LegalArea> {
    const payload: Record<string, any> = {};
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.description !== undefined) payload.description = dto.description;
    if (dto.color !== undefined) payload.color = dto.color;
    if (dto.icon !== undefined) payload.icon = dto.icon;
    if (dto.order !== undefined) payload.order = dto.order;
    if (dto.is_active !== undefined) payload.is_active = dto.is_active;

    const { data, error } = await supabase
      .from(this.legalAreasTable)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteLegalArea(id: string): Promise<void> {
    // Soft delete - apenas desativa
    const { error } = await supabase
      .from(this.legalAreasTable)
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async reorderLegalAreas(orderedIds: string[]): Promise<void> {
    // Atualizar ordem de cada área
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from(this.legalAreasTable)
        .update({ order: i })
        .eq('id', orderedIds[i]);

      if (error) throw new Error(error.message);
    }
  }

  // ==================== BLOCOS POR ÁREA ====================

  async listBlocksByLegalArea(legalAreaId: string | null, documentType?: DocumentType): Promise<PetitionBlock[]> {
    // Regra: blocos são separados por área.
    // Se legalAreaId for string => retorna apenas blocos daquela área.
    // Se legalAreaId for null => retorna apenas blocos sem área.
    const run = async (withFilter: boolean) => {
      let q = supabase
        .from(this.blocksTable)
        .select('*')
        .eq('is_active', true)
        .order(this.orderColumn, { ascending: true });

      if (legalAreaId) q = q.eq('legal_area_id', legalAreaId);
      else q = q.is('legal_area_id', null);

      if (documentType && withFilter && this.shouldUseDocumentType()) {
        q = q.eq('document_type', documentType);
      }
      return q;
    };

    const { data, error } = await run(true);
    if (!error) return data ?? [];

    // Se coluna não existir, fazer fallback para listagem normal
    if (this.isMissingLegalAreaColumn(error)) {
      return this.listBlocks(documentType);
    }

    if (documentType && this.isMissingDocumentTypeColumn(error)) {
      this.markDocumentTypeUnsupported();
      const retry = await run(false);
      const { data: data2, error: error2 } = await retry;
      if (error2) throw new Error(error2.message);
      return data2 ?? [];
    }

    throw new Error(error.message);
  }

  private isMissingLegalAreaColumn(error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    return msg.includes('legal_area_id') || details.includes('legal_area_id');
  }

  // ==================== PETIÇÕES PADRÕES (STANDARD TYPES) ====================

  async listStandardTypes(legalAreaId?: string | null, includeInactive = false): Promise<PetitionStandardType[]> {
    let query = supabase
      .from(this.standardTypesTable)
      .select('*')
      .order(this.orderColumn, { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    if (legalAreaId) {
      query = query.eq('legal_area_id', legalAreaId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getStandardType(id: string): Promise<PetitionStandardType | null> {
    const { data, error } = await supabase
      .from(this.standardTypesTable)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async createStandardType(payload: CreatePetitionStandardTypeDTO): Promise<PetitionStandardType> {
    // Get max order for this area
    const { data: maxData } = await supabase
      .from(this.standardTypesTable)
      .select('order')
      .eq('legal_area_id', payload.legal_area_id)
      .order('order', { ascending: false })
      .limit(1);

    const maxOrder = maxData?.[0]?.order ?? -1;

    const { data, error } = await supabase
      .from(this.standardTypesTable)
      .insert({
        ...payload,
        order: payload.order ?? maxOrder + 1,
        is_active: payload.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateStandardType(id: string, payload: UpdatePetitionStandardTypeDTO): Promise<PetitionStandardType> {
    const { data, error } = await supabase
      .from(this.standardTypesTable)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteStandardType(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.standardTypesTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ==================== VÍNCULO PETIÇÃO PADRÃO → BLOCOS ====================

  async listStandardTypeBlocks(standardTypeId: string): Promise<PetitionStandardTypeBlock[]> {
    const { data, error } = await supabase
      .from(this.standardTypeBlocksTable)
      .select('*')
      .eq('standard_type_id', standardTypeId)
      .order(this.orderColumn, { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listBlocksByStandardType(standardTypeId: string): Promise<PetitionBlock[]> {
    // Buscar IDs dos blocos vinculados ao tipo
    const { data: links, error: linksError } = await supabase
      .from(this.standardTypeBlocksTable)
      .select('block_id, "order"')
      .eq('standard_type_id', standardTypeId)
      .order(this.orderColumn, { ascending: true });

    if (linksError) throw new Error(linksError.message);
    if (!links || links.length === 0) return [];

    const blockIds = links.map((l) => l.block_id);

    const { data: blocks, error: blocksError } = await supabase
      .from(this.blocksTable)
      .select('*')
      .in('id', blockIds)
      .eq('is_active', true);

    if (blocksError) throw new Error(blocksError.message);

    // Ordenar conforme a ordem do vínculo
    const orderMap = new Map(links.map((l) => [l.block_id, l.order]));
    return (blocks ?? []).sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  }

  async addBlockToStandardType(standardTypeId: string, blockId: string, isDefaultVisible = true): Promise<PetitionStandardTypeBlock> {
    // Get max order
    const { data: maxData } = await supabase
      .from(this.standardTypeBlocksTable)
      .select('order')
      .eq('standard_type_id', standardTypeId)
      .order('order', { ascending: false })
      .limit(1);

    const maxOrder = maxData?.[0]?.order ?? -1;

    const { data, error } = await supabase
      .from(this.standardTypeBlocksTable)
      .insert({
        standard_type_id: standardTypeId,
        block_id: blockId,
        order: maxOrder + 1,
        is_default_visible: isDefaultVisible,
      })
      .select()
      .single();

    if (error) {
      const anyErr: any = error as any;
      if (anyErr?.code === '23505') {
        const { data: existing, error: existingError } = await supabase
          .from(this.standardTypeBlocksTable)
          .select('*')
          .eq('standard_type_id', standardTypeId)
          .eq('block_id', blockId)
          .single();
        if (existingError) throw new Error(existingError.message);
        return existing;
      }
      throw new Error(error.message);
    }
    return data;
  }

  async removeBlockFromStandardType(standardTypeId: string, blockId: string): Promise<void> {
    const { error } = await supabase
      .from(this.standardTypeBlocksTable)
      .delete()
      .eq('standard_type_id', standardTypeId)
      .eq('block_id', blockId);

    if (error) throw new Error(error.message);
  }

  async setStandardTypeBlocks(standardTypeId: string, blockIds: string[]): Promise<void> {
    // Remove all existing links
    await supabase
      .from(this.standardTypeBlocksTable)
      .delete()
      .eq('standard_type_id', standardTypeId);

    // Insert new links
    if (blockIds.length === 0) return;

    const payload = blockIds.map((blockId, index) => ({
      standard_type_id: standardTypeId,
      block_id: blockId,
      order: index,
      is_default_visible: true,
    }));

    const { error } = await supabase
      .from(this.standardTypeBlocksTable)
      .insert(payload);

    if (error) throw new Error(error.message);
  }
}

export const petitionEditorService = new PetitionEditorService();
