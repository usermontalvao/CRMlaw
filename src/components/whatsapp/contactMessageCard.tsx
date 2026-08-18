// O cartão de contato dentro da bolha — no formato do WhatsApp.
//
// Antes era um parágrafo. O cliente mandava o contato do perito, do
// despachante, do parente que cuida do caso, e a bolha mostrava aquilo como
// texto solto: para ligar era preciso selecionar com o mouse, copiar, abrir
// outra tela e colar. Metade das vezes o número nem aparecia — o telefone se
// perdia na leitura do vCard (ver `_shared/wa-native-content.ts`), e a bolha
// dizia só "Contato / André Eletricista".
//
// O DESENHO É O DO WHATSAPP, e não por imitação: o cartão inteiro é um botão, e
// o que ele faz é o que qualquer pessoa espera de um contato recebido — abrir a
// conversa com aquela pessoa. Era isso que faltava. Um cartão com dois botões
// pequenos embaixo ("Ligar", "Vincular a cliente") obriga a ler antes de agir e
// não oferece justamente a ação óbvia; aqui o corpo do cartão leva à conversa e
// o rodapé guarda o resto, separado por um filete, como no aplicativo.
//
// As três ações, na ordem em que o escritório usa:
//   · CONVERSAR — abre (ou reabre) a thread daquele número no canal em que esta
//     conversa está. É o clique do cartão inteiro, e também o primeiro botão.
//   · LIGAR — a mesma linha de voz do resto do CRM.
//   · VINCULAR — o número entra no cadastro certo, sem redigitar.
//
// MANDAR um contato NÃO mora aqui. Morava, e estava no lugar errado: um botão
// "enviar contato" grudado num cartão RECEBIDO parece que vai encaminhar aquele
// cartão, quando na verdade abria a agenda do escritório para escolher outro
// número qualquer. Enviar é ação de compositor, e é lá que ela vive — no "+"
// ao lado do campo de texto, junto de imagem, documento e GIF. Encaminhar este
// cartão continua onde encaminhar sempre esteve: no menu da bolha.
//
// O ROSTO vem do WhatsApp, não do cadastro: quem manda um contato manda um
// número, e ver a cara de quem está do outro lado é o que diz "é este mesmo"
// antes de ligar. Quem não tem foto pública continua nas iniciais — não é falha
// da sondagem, é o que o WhatsApp devolve, e o próprio aplicativo faz igual.
// A mesma pergunta responde se o número TEM WhatsApp; quando a resposta é não,
// CONVERSAR e LIGAR saem do ar em vez de prometer o que não acontece — os dois
// passam pelo WhatsApp. Ver `contactProbes.ts`.
//
// A regra do LID vale aqui como em todo lugar: um cartão que chegou sem número
// de verdade mostra que veio sem número. Ver `contactCard.ts`.
import React, { useMemo } from 'react';
import { ChevronRight, Link2, MessageCircle, Phone, ShieldAlert } from 'lucide-react';
import { maskPhoneFull, maskName, prettyPhone } from './format';
import { parseContactMessage } from './contactCard';
import { ContactAvatar } from './contactAvatar';
import { useContactProbes } from './contactProbes';

export interface ContactCardActions {
  /** Abrir a conversa com este número. Ausente = cartão não clicável. */
  onOpenChat?: (phone: string, name: string) => void;
  /** Ligar para este número. Ausente = chamadas indisponíveis neste host. */
  onCall?: (phone: string, name: string) => void;
  /** Abrir o vínculo deste número com um cadastro de cliente. */
  onLinkClient?: (phone: string, name: string) => void;
}

/** Célula do rodapé: metade/terço da largura, filete entre uma e outra. */
const rodape = 'flex flex-1 items-center justify-center gap-1 py-2 text-[11.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Desenha o(s) contato(s) de uma mensagem do tipo `contact`.
 *
 * Um cartão pode trazer mais de uma pessoa, e uma pessoa mais de um número.
 * Com UM número, o cartão é o do WhatsApp: corpo clicável e rodapé de ações.
 * Com MAIS DE UM, cada número ganha a própria linha com as próprias ações —
 * um contato com celular e fixo precisa dizer para qual dos dois a ligação vai,
 * e um rodapé só esconderia essa escolha.
 */
export const WaContactCard: React.FC<{
  content: string | null;
  out: boolean;
  /**
   * Modo privado (tela à vista de quem passa). Esconde nome, número e ROSTO na
   * EXIBIÇÃO, e não na leitura: os botões continuam funcionando, porque
   * mascarar o texto não é o mesmo que perder o dado — foi por parsear o texto
   * já mascarado que o cartão diria "veio sem número" para um cartão que tem.
   */
  privateMode?: boolean;
  actions?: ContactCardActions;
}> = ({ content, out, privateMode, actions }) => {
  const entries = useMemo(() => parseContactMessage(content), [content]);

  // Um cartão pode trazer mais de uma pessoa e mais de um número por pessoa; a
  // sondagem é de todos de uma vez, porque é uma pergunta só para o lote.
  const todosOsNumeros = useMemo(() => entries.flatMap(e => e.phones), [entries]);
  const probes = useContactProbes(todosOsNumeros);

  if (entries.length === 0) return null;

  /** `false` só quando a Evolution JÁ respondeu que não tem. Sem resposta, segue. */
  const temWhats = (phone: string) => probes.get(phone)?.hasWhatsApp !== false;

  return (
    <div className="mt-1 space-y-2">
      {entries.map((entry, i) => {
        // O rosto é o do primeiro número que tiver um — um contato com celular
        // e fixo tem foto no celular, e o cartão mostra a pessoa, não a linha.
        const comFoto = entry.phones.find(p => probes.get(p)?.avatarUrl);
        const semWhatsApp = entry.phones.length > 0
          && entry.phones.every(p => probes.get(p)?.hasWhatsApp === false);
        const nome = privateMode ? maskName(entry.name) : entry.name;
        // O número que o cartão representa: o primeiro com WhatsApp, senão o
        // primeiro que veio. É ele que o corpo clicável e o rodapé usam.
        const principal = entry.phones.find(temWhats) || entry.phones[0] || '';
        const varios = entry.phones.length > 1;
        const abrirConversa = actions?.onOpenChat && principal && !semWhatsApp
          ? () => actions.onOpenChat!(principal, entry.name)
          : undefined;

        // CORPO — o cartão inteiro leva à conversa, como no WhatsApp. Só que
        // vira <div> quando não há para onde ir (sem número, sem WhatsApp ou
        // sem host que saiba abrir conversa): botão que não faz nada é pior do
        // que não ter botão.
        const corpo = (
          <>
            <ContactAvatar
              name={entry.name}
              url={privateMode ? null : (comFoto ? probes.get(comFoto)!.avatarUrl : null)}
              semWhats={semWhatsApp}
              size={42}
            />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[13.5px] font-bold leading-tight text-slate-800">{nome}</p>
              {/* Com vários números, o subtítulo conta quantos são: a lista
                  logo abaixo mostra cada um, e repetir o primeiro aqui
                  faria parecer que é o único. */}
              <p className="mt-0.5 truncate text-[12px] tabular-nums leading-tight text-slate-500">
                {entry.phones.length === 0
                  ? 'sem número de telefone'
                  : varios
                    ? `${entry.phones.length} números`
                    : (privateMode ? maskPhoneFull() : prettyPhone(principal))}
              </p>
              {semWhatsApp && (
                <span className="mt-1 inline-flex items-center gap-0.5 rounded bg-red-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-500">
                  <ShieldAlert size={9} /> sem WhatsApp
                </span>
              )}
            </div>
            {abrirConversa && <ChevronRight size={16} className="flex-shrink-0 text-slate-400" />}
          </>
        );
        const corpoClasses = 'flex w-full items-center gap-2.5 px-2.5 py-2 text-left';

        return (
          <div key={`${entry.name}-${i}`}
            className={`overflow-hidden rounded-xl ${out ? 'bg-black/[0.05]' : 'bg-slate-100'}`}>
            {abrirConversa ? (
              <button type="button" onClick={abrirConversa}
                className={`${corpoClasses} transition hover:bg-black/[0.04] active:bg-black/[0.07]`}>
                {corpo}
              </button>
            ) : (
              <div className={corpoClasses}>{corpo}</div>
            )}

            {/* Um cartão pode chegar sem telefone de verdade (só com o
                identificador interno do WhatsApp, ou só com e-mail). Dizer isso
                é informação; mostrar um número inventado no lugar é o defeito. */}
            {entry.phones.length === 0 && (
              <p className="px-2.5 pb-2 text-[11.5px] italic text-slate-400">
                O cartão veio sem número de telefone.
              </p>
            )}

            {/* VÁRIOS NÚMEROS: uma linha por número, com as ações da linha. */}
            {varios && entry.phones.map(phone => (
              <div key={phone}
                className={`flex items-center gap-1 border-t px-2.5 py-1.5 ${out ? 'border-black/5' : 'border-white/70'}`}>
                <span className="min-w-0 flex-1 truncate text-[12.5px] tabular-nums text-slate-600">
                  {privateMode ? maskPhoneFull() : prettyPhone(phone)}
                </span>
                {actions?.onOpenChat && (
                  <button type="button" title="Conversar" disabled={!temWhats(phone)}
                    onClick={() => actions.onOpenChat!(phone, entry.name)}
                    className="rounded-md p-1.5 text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
                    <MessageCircle size={13} />
                  </button>
                )}
                {actions?.onCall && (
                  <button type="button" title="Ligar" disabled={!temWhats(phone)}
                    onClick={() => actions.onCall!(phone, entry.name)}
                    className="rounded-md p-1.5 text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent">
                    <Phone size={13} />
                  </button>
                )}
                {actions?.onLinkClient && (
                  <button type="button" title="Vincular a cliente"
                    onClick={() => actions.onLinkClient!(phone, entry.name)}
                    className="rounded-md p-1.5 text-slate-500 transition hover:bg-white hover:text-slate-700">
                    <Link2 size={13} />
                  </button>
                )}
              </div>
            ))}

            {/* RODAPÉ — só no cartão de um número. É a faixa do WhatsApp: filete
                em cima, células de largura igual, sem cor de fundo puxando a
                atenção para longe do nome. */}
            {!varios && principal && (
              <div className={`flex border-t ${out ? 'divide-black/5 border-black/5' : 'divide-white/70 border-white/70'} divide-x`}>
                {actions?.onOpenChat && (
                  <button type="button" onClick={() => actions.onOpenChat!(principal, entry.name)}
                    disabled={semWhatsApp}
                    title={semWhatsApp ? 'Este número não tem WhatsApp' : undefined}
                    className={`${rodape} text-emerald-700 hover:bg-emerald-50 disabled:hover:bg-transparent`}>
                    <MessageCircle size={13} /> Conversar
                  </button>
                )}
                {actions?.onCall && (
                  <button type="button" onClick={() => actions.onCall!(principal, entry.name)}
                    disabled={semWhatsApp}
                    title={semWhatsApp ? 'Este número não tem WhatsApp' : 'Ligar'}
                    className={`${rodape} text-emerald-700 hover:bg-emerald-50 disabled:hover:bg-transparent`}>
                    <Phone size={13} /> Ligar
                  </button>
                )}
                {actions?.onLinkClient && (
                  <button type="button" onClick={() => actions.onLinkClient!(principal, entry.name)}
                    title="Vincular a cliente"
                    className={`${rodape} text-slate-600 hover:bg-white`}>
                    <Link2 size={13} /> Vincular
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default WaContactCard;
