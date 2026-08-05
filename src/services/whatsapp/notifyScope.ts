// O que o usuário está OLHANDO no WhatsApp, agora. É a informação que faltava
// para o aviso de mensagem nova se comportar como o WhatsApp de verdade: lá o
// toque muda conforme a conversa está aberta, está na lista atrás, ou o app nem
// está na frente. Aqui o notificador global (que vive no App, fora do módulo)
// não tem como saber qual conversa está na tela — então cada tela de WhatsApp
// publica isso neste store de escopo de módulo.
//
// Duas espécies de tela, com regras diferentes de "está à vista":
// - 'full'     = o módulo WhatsApp em tela cheia. Fica MONTADO mesmo escondido
//                (keep-alive do App), então só conta quando ele é a tela ativa.
// - 'embedded' = aba WhatsApp do widget flutuante ou janela flutuante do
//                módulo. Só existe enquanto está aberta, então a própria
//                montagem já significa "está à vista".
//
// O registro é por INSTÂNCIA, não por espécie: dá para ter o widget e uma
// janela flutuante abertos ao mesmo tempo, e uma não pode apagar o registro da
// outra ao desmontar.

export type NotifySurfaceKind = 'full' | 'embedded';

/** Camada do aviso — a mesma nomenclatura dos toques em `notificationSound`. */
export type NotifyTier = 'global' | 'inbox' | 'in-chat';

interface Surface {
  kind: NotifySurfaceKind;
  /** Thread aberta: o mesmo contato pode ter uma linha por canal do escritório. */
  threadIds: readonly string[];
}

const surfaces = new Map<string, Surface>();

export const notifyScope = {
  /** Registra/atualiza uma tela de WhatsApp aberta. */
  publish(surfaceId: string, surface: Surface): void {
    surfaces.set(surfaceId, surface);
  },

  /** Tela desmontada. */
  clear(surfaceId: string): void {
    surfaces.delete(surfaceId);
  },

  /**
   * Em que camada esta mensagem deve avisar.
   *
   * Com a aba escondida nada disso importa: a pessoa não está vendo tela
   * nenhuma, então vale sempre o aviso mais forte.
   */
  tierFor(
    conversationId: string,
    opts: { inModule: boolean; documentVisible: boolean },
  ): NotifyTier {
    if (!opts.documentVisible) return 'global';

    const aVista = [...surfaces.values()].filter(s => s.kind === 'embedded' || opts.inModule);
    if (aVista.length === 0) return 'global';
    if (aVista.some(s => s.threadIds.includes(conversationId))) return 'in-chat';
    return 'inbox';
  },
};
