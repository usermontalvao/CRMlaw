// O cartão de contato dentro da bolha — com rosto, número à vista e o que fazer.
//
// Antes era um parágrafo. O cliente mandava o contato do perito, do
// despachante, do parente que cuida do caso, e a bolha mostrava aquilo como
// texto solto: para ligar era preciso selecionar com o mouse, copiar, abrir
// outra tela e colar. Metade das vezes o número nem aparecia — o telefone se
// perdia na leitura do vCard (ver `_shared/wa-native-content.ts`), e a bolha
// dizia só "Contato / André Eletricista".
//
// Aqui o número é um dado de primeira classe e leva duas ações, que são o que o
// escritório de fato faz com um contato recebido:
//   · LIGAR — a mesma linha de voz do resto do CRM;
//   · VINCULAR A CLIENTE — o número entra no cadastro certo, sem redigitar.
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
// antes de ligar. A mesma pergunta responde se o número TEM WhatsApp — e
// quando a resposta é não, o cartão diz isso em vez de deixar o atendente
// descobrir depois de tentar. Ver `contactProbes.ts`.
//
// A regra do LID vale aqui como em todo lugar: um cartão que chegou sem número
// de verdade mostra que veio sem número. Ver `contactCard.ts`.
import React, { useMemo } from 'react';
import { Link2, Phone, ShieldAlert } from 'lucide-react';
import { maskPhoneFull, maskName, prettyPhone } from './format';
import { parseContactMessage } from './contactCard';
import { ContactAvatar } from './contactAvatar';
import { useContactProbes } from './contactProbes';

export interface ContactCardActions {
  /** Ligar para este número. Ausente = chamadas indisponíveis neste host. */
  onCall?: (phone: string, name: string) => void;
  /** Abrir o vínculo deste número com um cadastro de cliente. */
  onLinkClient?: (phone: string, name: string) => void;
}

const acao = 'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition';

/**
 * Desenha o(s) contato(s) de uma mensagem do tipo `contact`.
 *
 * As ações ficam sob CADA número, não sob o cartão: um contato com celular e
 * fixo precisa dizer para qual dos dois a ligação vai.
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

  return (
    <div className="mt-1 space-y-2">
      {entries.map((entry, i) => {
        // O rosto é o do primeiro número que tiver um — um contato com celular
        // e fixo tem foto no celular, e o cartão mostra a pessoa, não a linha.
        const comFoto = entry.phones.find(p => probes.get(p)?.avatarUrl);
        const semWhatsApp = entry.phones.length > 0
          && entry.phones.every(p => probes.get(p)?.hasWhatsApp === false);
        const nome = privateMode ? maskName(entry.name) : entry.name;

        return (
          <div key={`${entry.name}-${i}`}
            className={`rounded-xl px-2.5 py-2 ${out ? 'bg-black/[0.05]' : 'bg-slate-100'}`}>
            <div className="flex items-center gap-2">
              <ContactAvatar
                name={entry.name}
                url={privateMode ? null : (comFoto ? probes.get(comFoto)!.avatarUrl : null)}
                semWhats={semWhatsApp}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[13.5px] font-bold leading-tight text-slate-800">{nome}</p>
                {semWhatsApp && (
                  <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-red-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-500">
                    <ShieldAlert size={9} /> sem WhatsApp
                  </span>
                )}
              </div>
            </div>

            {entry.phones.length === 0 ? (
              // Um cartão pode chegar sem telefone de verdade (só com o
              // identificador interno do WhatsApp, ou só com e-mail). Dizer isso é
              // informação; mostrar um número inventado no lugar é o defeito.
              <p className="mt-1 text-[11.5px] italic text-slate-400">
                O cartão veio sem número de telefone.
              </p>
            ) : entry.phones.map(phone => (
              <div key={phone} className="mt-1.5">
                <p className="text-[12.5px] tabular-nums text-slate-600">
                  {privateMode ? maskPhoneFull() : prettyPhone(phone)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {actions?.onCall && (
                    <button type="button" onClick={() => actions.onCall!(phone, entry.name)}
                      className={`${acao} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      <Phone size={12} /> Ligar
                    </button>
                  )}
                  {actions?.onLinkClient && (
                    <button type="button" onClick={() => actions.onLinkClient!(phone, entry.name)}
                      className={`${acao} ${out ? 'bg-white/70 text-slate-700 hover:bg-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
                      <Link2 size={12} /> Vincular a cliente
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default WaContactCard;
