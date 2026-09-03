// PROCURAR DENTRO DA CONVERSA — a busca que faltava no módulo.
//
// ── O buraco ───────────────────────────────────────────────────────────────
// A inbox sempre soube procurar CONVERSAS. Dentro de uma, não havia nada: a
// thread abre com as últimas 60 mensagens e pagina para trás sob demanda, então
// "onde ele mandou o RG?", "quanto ficou combinado?" e "que dia era a perícia?"
// só tinham uma saída — rolar às cegas, ou perguntar de novo ao cliente uma
// coisa que o escritório já tinha perguntado. Num atendimento jurídico isso não
// é incômodo: é a informação do processo perdida dentro da própria ferramenta
// que a guardou.
//
// ── Três decisões ──────────────────────────────────────────────────────────
//
// 1. A VARREDURA É NO BANCO, não na janela carregada. Procurar só no que está
//    na tela responderia sempre "não achei" para tudo que tem mais de um dia —
//    o pior tipo de resposta, porque parece definitiva. Ver
//    `messagesApi.searchMessages`.
//
// 2. O ÁUDIO ENTRA NA BUSCA. As transcrições já existiam na coluna
//    `transcription_text` e nenhuma busca do CRM as enxergava. Metade do que um
//    cliente conta chega em áudio; sem isso, metade da conversa é invisível.
//    Um resultado que veio da transcrição diz isso na cara ("no áudio"), para
//    ninguém procurar na tela uma frase escrita que não existe.
//
// 3. O CLIQUE LEVA ATÉ A BOLHA. O resultado não é um cartão de leitura: é um
//    atalho. Clicar pagina o histórico até a mensagem e pisca nela — quem
//    procura quase sempre quer o que veio ANTES e DEPOIS, não a frase isolada.
//    A viagem inteira já existia no módulo (`openConversationAt`), usada pela
//    fila de agendadas; aqui ela ganha o segundo passageiro.
//
// ── Por que sobreposto ao cabeçalho, e não uma coluna ao lado ──────────────
// A conversa já divide a tela com a lista e com o painel do contato. Uma
// quarta coluna espremeria as três, e a busca é um MOMENTO (dura segundos),
// não um lugar. Ela cobre o cabeçalho enquanto está aberta e devolve a tela
// intacta ao fechar — a mesma escolha que o navegador faz com o Ctrl+F.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Loader2, Mic, Search, X } from 'lucide-react';
import { whatsappService, type WhatsAppMessageHit } from '../../services/whatsapp.service';
import { trechoDoAchado, textoBuscavel, type TrechoDoAchado } from './threadSearchText';
import { useThreadTermHighlight } from './hooks/useThreadTermHighlight';
import { dayLabel, maskSensitive } from './format';

export interface ThreadSearchProps {
  /** As linhas que formam a thread — a conversa e as irmãs de outro canal. */
  conversationIds: readonly string[];
  /** Nome de quem está do outro lado, para a linha dizer quem falou. */
  contactName: string;
  /** Modo privado da inbox: o trecho sai mascarado, como no resto do módulo. */
  privateMode: boolean;
  /** Levar a thread até a mensagem e piscá-la. */
  onJump: (conversationId: string, messageId: string) => void;
  onClose: () => void;
  /** O conteúdo da conversa — onde a palavra procurada fica acesa. */
  threadRef: React.RefObject<HTMLElement | null>;
  /**
   * Muda quando a conversa muda debaixo da busca (mensagem nova, bloco antigo
   * carregado, áudio transcrito). É o que manda repintar o grifo.
   */
  threadVersion: unknown;
}

interface Achado {
  hit: WhatsAppMessageHit;
  trecho: TrechoDoAchado;
  /** O acerto veio da transcrição do áudio, não de texto escrito. */
  doAudio: boolean;
  /** O acerto veio do nome do arquivo anexado. */
  doArquivo: boolean;
}

/** Rótulo curto de quem falou — "Você" mantém a mesma palavra da lista. */
const quemFalou = (direcao: string, contato: string) => (direcao === 'out' ? 'Você' : contato);

export const ThreadSearch: React.FC<ThreadSearchProps> = ({
  conversationIds, contactName, privateMode, onJump, onClose, threadRef, threadVersion,
}) => {
  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // A chave do grupo de linhas. Como string para não reagir à identidade do
  // array, que a inbox recalcula a cada render.
  const escopo = conversationIds.join(',');

  useEffect(() => { campo.current?.focus(); }, []);

  // ── A varredura ───────────────────────────────────────────────────────────
  // Espera a digitação parar. Sem isso, "procuração" dispara nove consultas ao
  // banco e a nona corre contra a sexta; com 220 ms, quem digita normal manda
  // uma só. `cancelado` é o que impede a resposta atrasada de uma busca
  // abandonada sobrescrever a que a pessoa está lendo.
  useEffect(() => {
    const alvo = termo.trim();
    if (alvo.length < 2) { setAchados(null); setErro(null); setBuscando(false); return; }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const ids = escopo ? escopo.split(',') : [];
        const linhas = await whatsappService.searchMessages(ids, alvo);
        if (cancelado) return;
        // O banco casa por ILIKE nas três colunas; aqui o trecho é recortado
        // sobre o texto que a tela mostraria — e isso também desfaz o falso
        // positivo da assinatura do atendente ("*Dr. Pedro:*"), que casa com
        // o nome dele em TODA mensagem que saiu daqui.
        const montados: Achado[] = [];
        for (const hit of linhas) {
          const texto = textoBuscavel(hit);
          const trecho = trechoDoAchado(texto, alvo);
          if (trecho) {
            const conteudo = (hit.content ?? '').trim();
            montados.push({
              hit,
              trecho,
              doAudio: !conteudo && !!(hit.transcription_text ?? '').trim(),
              doArquivo: !conteudo && !(hit.transcription_text ?? '').trim() && !!(hit.file_name ?? '').trim(),
            });
          }
        }
        setAchados(montados);
        setCursor(0);
        setErro(null);
      } catch (e: any) {
        if (!cancelado) { setErro(e?.message || 'Não foi possível procurar agora.'); setAchados(null); }
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 220);
    return () => { cancelado = true; clearTimeout(t); };
  }, [termo, escopo]);

  const total = achados?.length ?? 0;
  /** Há algo para escrever no canto do campo (rodinha ou "3 de 17")? */
  const mostraContador = buscando || achados !== null;

  // Acende TODA ocorrência dentro das bolhas — o último passo da busca, que até
  // aqui ficava por conta do olho. Ver `useThreadTermHighlight`: é feito pela
  // API de destaque do navegador, sem tocar no HTML da conversa.
  useThreadTermHighlight(threadRef, termo, true, threadVersion);

  /**
   * O primeiro Enter VISITA o resultado em que o cursor já está; do segundo em
   * diante ele ANDA.
   *
   * Sem essa distinção o Enter só faz sentido numa das duas pontas: ou o
   * primeiro pula o resultado 1 e leva direto ao 2, ou nenhum Enter sai do
   * lugar. É um ref e não estado porque muda no meio do próprio gesto de
   * teclado, antes de qualquer render.
   */
  const jaVisitou = useRef(false);
  useEffect(() => { jaVisitou.current = false; }, [achados]);

  const irPara = useCallback((indice: number) => {
    if (!achados || achados.length === 0) return;
    // Circular: a última leva à primeira. Chegar ao fim e o botão parar de
    // responder é o que faz a pessoa achar que a busca travou.
    const i = ((indice % achados.length) + achados.length) % achados.length;
    jaVisitou.current = true;
    setCursor(i);
    const alvo = achados[i];
    onJump(alvo.hit.conversation_id, alvo.hit.id);
  }, [achados, onJump]);

  // Mantém o resultado escolhido à vista quando a navegação é por teclado.
  useEffect(() => {
    if (!achados || achados.length === 0) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-hit="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, achados]);

  const noCampo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) irPara(cursor - 1);
      else irPara(jaVisitou.current ? cursor + 1 : cursor);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); irPara(cursor + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); irPara(cursor - 1); }
  };

  const mascarar = useCallback((s: string) => (privateMode ? maskSensitive(s) : s), [privateMode]);

  const agrupados = useMemo(() => {
    if (!achados) return [];
    // Um cabeçalho por dia, como na thread: a data é metade da pergunta
    // ("aquilo foi antes ou depois da audiência?").
    const blocos: Array<{ dia: string; itens: Array<{ a: Achado; i: number }> }> = [];
    achados.forEach((a, i) => {
      const dia = dayLabel(a.hit.wa_timestamp);
      const ultimo = blocos[blocos.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.itens.push({ a, i });
      else blocos.push({ dia, itens: [{ a, i }] });
    });
    return blocos;
  }, [achados]);

  return (
    // A BARRA COBRE O CABEÇALHO POR CONSTRUÇÃO, e não por medida.
    //
    // `absolute inset-0` dentro do próprio <header>: seja qual for a altura
    // dele (o módulo cheio, o widget e o mobile usam três), a barra tem
    // exatamente a mesma. Uma altura fixa aqui acertaria um dos três e deixaria
    // uma tira do cabeçalho aparecendo por baixo nos outros dois.
    <div className="wa-thread-search absolute inset-0 z-30 bg-white">
      <div className="flex h-full items-center gap-2 px-3">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={campo}
            value={termo}
            onChange={e => setTermo(e.target.value)}
            onKeyDown={noCampo}
            /* Curto porque tem de caber no CELULAR: a versão longa
               ("…inclusive no que foi dito em áudio") era cortada no meio da
               palavra em 375 px. O que ela ensinava passou para a dica abaixo,
               que aparece com o campo ainda vazio — é lá que a pessoa está
               olhando quando ainda não sabe o que a busca alcança. */
            placeholder="Procurar na conversa…"
            aria-label="Procurar dentro da conversa"
            /* A folga da direita é reservada só quando há contador para
               ocupá-la. Fixa, ela comia 96 px do campo mesmo vazio — e num
               celular de 375 px isso cortava o próprio texto do campo. */
            className={`w-full rounded-full border border-transparent bg-[#f4f3f0] py-2 pl-9 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#e0ddd5] focus:bg-white focus:shadow-[0_1px_3px_rgba(15,23,42,.07)] ${mostraContador ? 'pr-[76px]' : 'pr-3'}`}
          />
          {/* O contador mora DENTRO do campo, encostado na direita: é a resposta
              do que se está digitando, não um enfeite da barra. */}
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] font-semibold tabular-nums text-slate-400">
            {buscando && <Loader2 size={12} className="animate-spin" />}
            {!buscando && total > 0 && `${cursor + 1} de ${total}`}
            {!buscando && achados !== null && total === 0 && 'nenhum'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => irPara(cursor - 1)} disabled={total === 0}
            title="Ocorrência anterior (Shift+Enter)" aria-label="Ocorrência anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-[#f1f0ec] hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent">
            <ArrowUp size={16} />
          </button>
          <button type="button" onClick={() => irPara(cursor + 1)} disabled={total === 0}
            title="Próxima ocorrência (Enter)" aria-label="Próxima ocorrência"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-[#f1f0ec] hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent">
            <ArrowDown size={16} />
          </button>
          <span aria-hidden className="mx-1 h-4 w-px bg-[#e7e5df]" />
          <button type="button" onClick={onClose} title="Fechar a busca (Esc)" aria-label="Fechar a busca"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-[#f1f0ec] hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* A DICA ENSINA O QUE A BUSCA ALCANÇA, e some assim que se digita.
          Sem ela, ninguém descobre que procurar aqui encontra o que foi DITO
          num áudio — o recurso existiria e não seria usado. Fica na altura
          dos olhos de quem acabou de abrir a busca e ainda não digitou nada. */}
      {termo.trim().length < 2 && (
        <div className="absolute inset-x-0 top-full border-b border-[#e7e5df] bg-white px-4 py-2 shadow-[0_14px_28px_-18px_rgba(15,23,42,.45)]">
          <p className="flex items-center gap-1.5 text-[11.5px] leading-snug text-slate-400">
            <Mic size={11} className="shrink-0" />
            Procura no histórico inteiro — inclusive no que foi dito em áudio e no nome dos anexos.
          </p>
        </div>
      )}

      {/* Os resultados. Só existem quando há o que mostrar — com o campo vazio
          a barra é só a barra, e a conversa continua inteira embaixo dela. */}
      {(erro || achados !== null) && (
        // Pendurada NO cabeçalho, escorrendo por baixo dele: o <header> não
        // recorta os filhos, então a lista cresce sobre a conversa sem
        // empurrá-la — fechar a busca devolve a tela exatamente como estava.
        <div ref={listaRef} className="absolute inset-x-0 top-full max-h-[46vh] overflow-y-auto overscroll-contain border-b border-[#e7e5df] bg-white shadow-[0_14px_28px_-16px_rgba(15,23,42,.45)]">
          {erro && <p className="px-4 py-3 text-[12.5px] text-red-600">{erro}</p>}
          {!erro && total === 0 && !buscando && (
            <p className="px-4 py-5 text-center text-[12.5px] text-slate-400">
              Nada encontrado nesta conversa.
            </p>
          )}
          {agrupados.map(bloco => (
            <div key={bloco.dia}>
              <p className="sticky top-0 z-10 bg-[#fdfcfb]/95 px-4 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400 backdrop-blur">
                {bloco.dia}
              </p>
              {bloco.itens.map(({ a, i }) => (
                <button
                  key={a.hit.id}
                  data-hit={i}
                  type="button"
                  onClick={() => irPara(i)}
                  className={`flex w-full items-start gap-2.5 px-4 py-2 text-left transition ${
                    i === cursor ? 'bg-[#fff3e6]' : 'hover:bg-[#faf9f7]'
                  }`}
                >
                  <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    a.hit.direction === 'out' ? 'bg-emerald-500' : 'bg-slate-300'
                  }`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <span className="truncate">{quemFalou(a.hit.direction, contactName)}</span>
                      <span className="shrink-0 font-normal tabular-nums text-slate-400">
                        {new Date(a.hit.wa_timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {/* O aviso que evita a procura na tela por uma frase que
                          nunca foi escrita. */}
                      {a.doAudio && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#f1f0ec] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-slate-500">
                          <Mic size={9} /> no áudio
                        </span>
                      )}
                      {a.doArquivo && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#f1f0ec] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-slate-500">
                          <FileText size={9} /> anexo
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-600">
                      {a.trecho.cortadoAntes && '… '}
                      {mascarar(a.trecho.antes)}
                      <mark className="rounded-[3px] bg-[#ffe08a] px-px font-semibold text-slate-900">
                        {mascarar(a.trecho.achado)}
                      </mark>
                      {mascarar(a.trecho.depois)}
                      {a.trecho.cortadoDepois && ' …'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThreadSearch;
