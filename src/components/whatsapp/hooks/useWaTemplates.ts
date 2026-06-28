// Domínio de modelos/atalho "/" do compositor do WhatsApp: carrega os templates
// ativos e os "kits" de preenchimento/assinatura (permalinks de document
// templates), faz o matching do slash command, monta o contexto de renderização
// das variáveis ({{cliente.nome}}, {{saudacao}}…) e aplica o modelo escolhido no
// rascunho — incluindo o mint anti-duplicação do link de kit. Extraído do
// WhatsAppModule para isolar o domínio de templates da UI da thread. Vive DEPOIS
// de useWaComposer na ordem de hooks, pois lê/escreve `draft`/`editing`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { whatsappService, renderTemplate } from '../../../services/whatsapp.service';
import { agentLabel, greetingByHour, prettyPhone } from '../format';
import { documentTemplateService } from '../../../services/documentTemplate.service';
import { templateFillPermalinkService } from '../../../services/templateFillPermalink.service';
import { buildWaPreviewUrl } from '../../../utils/publicAppUrl';
import { useToastContext } from '../../../contexts/ToastContext';
import type { StaffOption } from '../../../services/whatsapp.service';
import type { WhatsAppConversation, WhatsAppMessage, WhatsAppTemplate } from '../../../types/whatsapp.types';
import type { DocumentTemplate } from '../../../types/document.types';

export type SlashKitItem = {
  kind: 'kit';
  id: string;
  name: string;
  description: string | undefined;
  slug: string;
};

export type SlashResultItem =
  | { kind: 'template'; id: string; name: string; description?: string; body: string; template: WhatsAppTemplate }
  | SlashKitItem;

/** Contexto para expandir variáveis dos modelos ({{cliente.nome}}, {{saudacao}}…). */
export interface TemplateCtx {
  clientName: string | null;
  clientPhone: string | null;
  agentName: string | null;
  greeting: string;
}

interface WaTemplatesArgs {
  selected: WhatsAppConversation | null;
  selectedId: string | null;
  user: { id: string } | null;
  staffById: Map<string, StaffOption>;
  draft: string;
  editing: WhatsAppMessage | null;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
}

export interface WaTemplatesApi {
  /** Recarrega os templates ativos (após editar no TemplatePickerModal). */
  reloadTemplates: () => void;
  templateCtx: TemplateCtx;
  /** Match do comando "/" no rascunho (null quando não é um slash). */
  slashMatch: RegExpExecArray | null;
  slashResults: SlashResultItem[];
  slashActive: boolean;
  slashIdx: number;
  setSlashIndex: React.Dispatch<React.SetStateAction<number>>;
  applyTemplate: (item: SlashResultItem) => Promise<void>;
}

/**
 * Gerencia o atalho "/" do compositor: lista de modelos + kits, filtro por nome,
 * navegação do dropdown e aplicação no rascunho. Carrega os dados uma vez e
 * mantém o comportamento (anti-duplicação do mint de kit) que vivia inline.
 */
export function useWaTemplates({
  selected, selectedId, user, staffById, draft, editing, setDraft,
}: WaTemplatesArgs): WaTemplatesApi {
  const toast = useToastContext();

  // Templates carregados uma vez para o atalho "/" no compositor (estilo WhatsApp).
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [kitTemplates, setKitTemplates] = useState<SlashKitItem[]>([]);
  const reloadTemplates = useCallback(() => {
    whatsappService.listTemplates({ activeOnly: true }).then(setTemplates).catch(() => {});
  }, []);
  useEffect(() => { reloadTemplates(); }, [reloadTemplates]);
  useEffect(() => {
    const isRequirementsMsTemplate = (template: DocumentTemplate) => {
      const norm = (value?: string) => (value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      return norm(template.name).startsWith('MODELO MS (REQUERIMENTOS)') || norm(template.description).includes('[REQUERIMENTOS_MS]');
    };

    let alive = true;
    documentTemplateService.listTemplates()
      .then(async (allTemplates) => {
        const visibleTemplates = allTemplates.filter(t => !isRequirementsMsTemplate(t));
        const permalinkChecks = await Promise.all(
          visibleTemplates.map(async (template) => {
            try {
              const permalinks = await templateFillPermalinkService.listPermalinks(template.id);
              const active = permalinks.find((p: any) => p.is_active) ?? permalinks[0];
              if (!active?.slug) return null;
              return {
                kind: 'kit' as const,
                id: template.id,
                name: template.name,
                description: template.description,
                slug: active.slug,
              };
            } catch {
              return null;
            }
          }),
        );
        if (alive) setKitTemplates(permalinkChecks.filter((t): t is NonNullable<typeof t> => !!t));
      })
      .catch(() => { if (alive) setKitTemplates([]); });
    return () => { alive = false; };
  }, []);
  const [slashIndex, setSlashIndex] = useState(0); // item destacado no dropdown do "/"

  // Contexto para expandir variáveis dos modelos ({{cliente.nome}}, {{saudacao}}…).
  const templateCtx = useMemo<TemplateCtx>(() => ({
    clientName: selected?.contact_name ?? null,
    clientPhone: selected ? prettyPhone(selected.contact_phone) : null,
    agentName: agentLabel(user ? staffById.get(user.id) : null),
    greeting: greetingByHour(),
  }), [selected, user, staffById]);

  // Atalho "/" do compositor (estilo WhatsApp): quando o texto é só "/algo" (sem
  // espaço), abre um menu de modelos filtrados pelo nome; selecionar insere o corpo.
  // Permite espaços na busca ("/kit tr" → continua filtrando) — só fecha o menu
  // se o usuário pular de linha (mensagem multilinha de verdade, não comando).
  const slashMatch = !editing ? /^\/([^\n]*)$/.exec(draft) : null;
  const slashQuery = slashMatch?.[1].toLowerCase() ?? '';
  const slashResults = slashMatch
    ? [
        ...templates.map((t) => ({
          kind: 'template' as const,
          id: t.id,
          name: t.name,
          description: t.category || undefined,
          body: t.body,
          template: t,
        })),
        ...kitTemplates,
      ].filter((item) => item.name.toLowerCase().includes(slashQuery)).slice(0, 6)
    : [];
  const slashActive = slashResults.length > 0;
  const slashIdx = Math.min(slashIndex, Math.max(0, slashResults.length - 1));
  // Trava anti-duplicação do mint de kit: o menu fica clicável durante o await
  // (mint ~200ms), então duplo-clique / clique+Enter geravam DOIS links. Ignora
  // chamada concorrente (inFlight) e repetição do mesmo kit dentro de 1,5s.
  const kitMintRef = useRef<{ inFlight: boolean; lastSlug: string; lastAt: number }>({ inFlight: false, lastSlug: '', lastAt: 0 });
  const applyTemplate = useCallback(async (item: SlashResultItem) => {
    if (item.kind === 'kit') {
      const guard = kitMintRef.current;
      const nowTs = Date.now();
      if (guard.inFlight) return;
      if (guard.lastSlug === item.slug && nowTs - guard.lastAt < 1500) return;
      guard.inFlight = true;
      try {
        const result = await templateFillPermalinkService.mintToken(item.slug, {
          clientId: selected?.client_id ?? null,
          conversationId: selectedId,
        });
        if (!result.success || !result.token) {
          throw new Error(result.error || 'Não foi possível gerar o link de preenchimento.');
        }
        guard.lastSlug = item.slug;
        guard.lastAt = Date.now();
        const url = buildWaPreviewUrl('preencher', result.token);
        setDraft(`Segue o link para preencher e assinar seus documentos:\n\n${url}`);
        setSlashIndex(0);
      } catch (e: any) {
        toast.error('Falha ao gerar link do kit', e?.message || 'Não foi possível gerar o link de preenchimento.');
      } finally {
        guard.inFlight = false;
      }
      return;
    }
    setDraft(renderTemplate(item.body, templateCtx));
    setSlashIndex(0);
  }, [selected?.client_id, selectedId, templateCtx, toast, setDraft]);

  return {
    reloadTemplates, templateCtx,
    slashMatch, slashResults, slashActive, slashIdx, setSlashIndex,
    applyTemplate,
  };
}
