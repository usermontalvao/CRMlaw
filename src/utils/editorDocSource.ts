/**
 * Fonte externa de um documento aberto no EDITOR PRINCIPAL (PetitionEditorModule).
 *
 * Descreve DE ONDE o .docx foi carregado e PARA ONDE o "Salvar" grava de volta.
 * É reconstruível apenas a partir de IDs (sem closures), de propósito: o editor
 * abre numa JANELA NOVA (contexto separado), e o payload viaja por token no
 * localStorage — então load/save precisam ser refeitos a partir de IDs.
 *
 * ➕ Para adicionar uma nova origem: acrescente uma variante ao union e trate-a
 *    em load/save/label abaixo. É o ÚNICO lugar do editor que precisa mudar.
 *    Os pontos que ABREM o editor com essa origem estão listados na memória
 *    [[editor-usage-map]].
 */
import { documentTemplateService } from '../services/documentTemplate.service';
import { standardPetitionService } from '../services/standardPetition.service';
import { announceEditorDocSourceSaved } from './editorDocSourceEvents';
import { blobContentsEqual } from './blobIntegrity';

export type EditorDocSource =
  | { type: 'template-main'; templateId: string }      // documento principal de um DocumentTemplate
  | { type: 'template-file'; fileId: string }          // anexo de um DocumentTemplate
  | { type: 'standard-petition'; petitionId: string }; // arquivo de uma Petição Padrão

/**
 * Chave estável e serializável da origem ("template-file:<id>").
 * Usada para escopar rascunho local, posição do cursor e deduplicar a
 * importação inicial — nunca para reconstruir a origem.
 */
export function editorDocSourceKey(src: EditorDocSource): string {
  switch (src.type) {
    case 'template-main':
      return `template-main:${src.templateId}`;
    case 'template-file':
      return `template-file:${src.fileId}`;
    case 'standard-petition':
      return `standard-petition:${src.petitionId}`;
  }
}

/** Baixa o .docx da origem. */
export async function loadEditorDocSource(src: EditorDocSource): Promise<Blob> {
  switch (src.type) {
    case 'template-file':
      return documentTemplateService.downloadTemplateFileById(src.fileId);
    case 'template-main': {
      const tpl = await documentTemplateService.getTemplate(src.templateId);
      if (!tpl) throw new Error('Template não encontrado.');
      return documentTemplateService.downloadTemplateFile(tpl);
    }
    case 'standard-petition': {
      const p = await standardPetitionService.getPetition(src.petitionId);
      if (!p) throw new Error('Petição padrão não encontrada.');
      return standardPetitionService.downloadPetitionFile(p);
    }
  }
}

/**
 * Grava o .docx de volta na origem e só resolve após a persistência confirmar.
 *
 * Depois de gravar, RELÊ o documento exatamente como o "reabrir" faria (registro
 * no banco → objeto no storage) e compara byte a byte. É essa releitura que
 * impede o pior dos cenários: dizer "Template salvo" enquanto a origem continua
 * entregando a versão anterior — foi assim que edições a partir da 2ª pareciam
 * não ter sido salvas.
 */
export async function saveEditorDocSource(src: EditorDocSource, blob: Blob, fileName: string): Promise<void> {
  switch (src.type) {
    case 'template-file': {
      await documentTemplateService.replaceTemplateFileContent(src.fileId, blob, fileName);
      break;
    }
    case 'template-main': {
      const tpl = await documentTemplateService.getTemplate(src.templateId);
      if (!tpl) throw new Error('Template não encontrado para salvar.');
      await documentTemplateService.replaceTemplateContent(tpl, blob);
      break;
    }
    case 'standard-petition': {
      const p = await standardPetitionService.getPetition(src.petitionId);
      if (!p) throw new Error('Petição padrão não encontrada para salvar.');
      await standardPetitionService.replacePetitionContent(p, blob);
      break;
    }
  }

  const stored = await loadEditorDocSource(src);
  if (!(await blobContentsEqual(blob, stored))) {
    throw new Error(
      'O documento foi gravado, mas ao reler a origem ainda veio a versão anterior. Feche e reabra o documento antes de continuar editando.',
    );
  }

  announceEditorDocSourceSaved(src);
}

/** Mensagem de sucesso ("Template salvo", etc.). */
export function editorDocSourceSavedLabel(src: EditorDocSource): string {
  switch (src.type) {
    case 'template-main':
    case 'template-file':
      return 'Template salvo';
    case 'standard-petition':
      return 'Petição padrão salva';
  }
}
