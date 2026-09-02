// ── PAINEL "COMUNICAR O CLIENTE" ────────────────────────────────────────────
//
// Mora nos detalhes do compromisso, na Agenda. Componente próprio e não mais um
// bloco dentro de `CalendarModule` (que já passa de cinco mil linhas) porque
// ele tem estado, carrega a biblioteca de mídia e grava sozinho.
//
// A regra do que sai e quando sai NÃO está aqui: está em
// `utils/comunicacaoCompromisso`, compartilhada com a Edge Function que envia.
// A prévia desta tela e a mensagem que chega ao cliente são montadas pela mesma
// função — divergir seria o escritório prometer uma coisa e mandar outra.
//
// SÃO DOIS USOS, e por isso o arquivo exporta duas coisas:
//
//   • `ClientNoticeFields` — os campos, controlados por quem os monta. É o que
//     o formulário de "Novo Compromisso" usa: ali o compromisso ainda não tem
//     `id`, não há linha para gravar, e a escolha viaja junto com o resto do
//     formulário até o INSERT.
//   • `ClientNoticePanel` — os mesmos campos com estado próprio e botão de
//     salvar, para os detalhes de um compromisso que já existe.
//
// A primeira versão só tinha o painel, e o resultado era um vaivém: criar,
// salvar, fechar, clicar de novo no evento e só então ligar a comunicação.
import React, { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, Check, AlertTriangle, Image as ImageIcon, Video, FileText, Mic, UserPlus } from 'lucide-react';
import { calendarService } from '../../services/calendar.service';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import {
  ANTECEDENCIAS_DA_COMUNICACAO,
  ANTECEDENCIA_PADRAO_MINUTOS,
  MENSAGEM_PADRAO_DA_COMUNICACAO,
  VARIAVEIS_DA_COMUNICACAO,
  momentoDoEnvio,
  montarMensagemDaComunicacao,
  mensagemSugerida,
  nomeApresentavel,
  primeiroNomeApresentavel,
} from '../../utils/comunicacaoCompromisso';
import type { CalendarEvent } from '../../types/calendar.types';
import type { WhatsAppMediaLibraryItem, WhatsAppMediaLibraryType } from '../../types/whatsapp.types';

/** O que as duas pontas trocam. Tudo que a comunicação precisa saber. */
export interface ValorDaComunicacao {
  ligada: boolean;
  minutos: number;
  mensagem: string;
  midiaId: string | null;
  /**
   * A mensagem foi escrita à mão?
   *
   * Enquanto for `false`, o texto ACOMPANHA o formulário: trocar o tipo de
   * Reunião para Audiência, ou a modalidade para Presencial, reescreve a
   * sugestão. No instante em que alguém digita no campo, vira `true` e o texto
   * para de mudar sozinho — sobrescrever o que a pessoa escreveu porque ela
   * mexeu num seletor acima seria perder trabalho dela.
   *
   * Não vai para o banco: um compromisso já salvo tem o texto que tem, e ao
   * reabrir ele é sempre tratado como escrito à mão.
   */
  mensagemEditada: boolean;
}

/** O ponto de partida de um compromisso novo: desligado, com o texto sugerido. */
export const COMUNICACAO_VAZIA: ValorDaComunicacao = {
  ligada: false,
  minutos: ANTECEDENCIA_PADRAO_MINUTOS,
  mensagem: MENSAGEM_PADRAO_DA_COMUNICACAO,
  midiaId: null,
  mensagemEditada: false,
};

/** Lê o valor de um compromisso já salvo, para semear a edição. */
export function comunicacaoDoEvento(ev: Partial<CalendarEvent> | null | undefined): ValorDaComunicacao {
  if (!ev) return { ...COMUNICACAO_VAZIA };
  return {
    ligada: !!ev.client_notify_enabled,
    minutos: ev.client_notify_minutes_before ?? ANTECEDENCIA_PADRAO_MINUTOS,
    mensagem: ev.client_notify_message ?? MENSAGEM_PADRAO_DA_COMUNICACAO,
    midiaId: ev.client_notify_media_id ?? null,
    // Compromisso já salvo: o texto que está lá é o que vale, venha ele de uma
    // sugestão ou da mão de alguém. Reescrevê-lo ao reabrir seria trocar a
    // decisão de quem salvou pela sugestão do momento.
    mensagemEditada: true,
  };
}

/** O que o formulário manda ao banco. Desligada, os campos voltam a nulo. */
export function payloadDaComunicacao(v: ValorDaComunicacao) {
  return {
    client_notify_enabled: v.ligada,
    client_notify_minutes_before: v.ligada ? v.minutos : null,
    client_notify_message: v.ligada ? v.mensagem.trim() : null,
    client_notify_media_id: v.ligada ? v.midiaId : null,
  };
}

/** Os dados do compromisso que a prévia precisa — venham eles do formulário ou da linha. */
export interface ContextoDaComunicacao {
  inicio: Date | null;
  titulo: string;
  /** Tipo do evento (`hearing`, `pericia`, `meeting`…) — decide o texto sugerido. */
  tipo: string;
  /** Onde acontece, dos presenciais. */
  local: string;
  detalhes: string;
  modalidade: string;
  clienteNome: string | null;
  clienteTelefone: string | null;
  processoCodigo: string | null;
  temCliente: boolean;
}

const ICONE_DA_MIDIA: Record<WhatsAppMediaLibraryType, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
};

const ROTULO_DA_MIDIA: Record<WhatsAppMediaLibraryType, string> = {
  image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento',
};

// ── OS CAMPOS ───────────────────────────────────────────────────────────────
// Controlados: não guardam nada, não gravam nada. Quem os monta é dono do
// valor. É o que permite o mesmo bloco servir ao formulário de criação (onde o
// compromisso ainda não existe) e ao painel dos detalhes.

interface CamposProps {
  valor: ValorDaComunicacao;
  onChange: (v: ValorDaComunicacao) => void;
  contexto: ContextoDaComunicacao;
  /** Abre a edição do compromisso, para vincular um cliente. */
  onVincularCliente?: () => void;
  /** No formulário de criação o cliente ainda pode ser escolhido logo acima. */
  textoSemCliente?: string;
}

export const ClientNoticeFields: React.FC<CamposProps> = ({
  valor, onChange, contexto, onVincularCliente, textoSemCliente,
}) => {
  const [midias, setMidias] = useState<WhatsAppMediaLibraryItem[]>([]);
  const set = (parcial: Partial<ValorDaComunicacao>) => onChange({ ...valor, ...parcial });

  // ── O TEXTO ACOMPANHA O CONTEXTO ──────────────────────────────────────────
  //
  // Marcar "Audiência" + "Presencial" e receber "Seu compromisso está marcado"
  // é a mensagem certa para nenhum caso. Enquanto ninguém tiver escrito no
  // campo, a sugestão é refeita a cada mudança de tipo, modalidade ou endereço.
  //
  // A guarda do `mensagemEditada` é o que separa "ajudar" de "atrapalhar":
  // depois que a pessoa digita, trocar a modalidade não pode apagar o que ela
  // escreveu. E a comparação com o texto atual evita um `setState` por render.
  const sugestao = mensagemSugerida(contexto.tipo, contexto.modalidade, !!contexto.local.trim());
  useEffect(() => {
    if (valor.mensagemEditada) return;
    if (valor.mensagem === sugestao) return;
    onChange({ ...valor, mensagem: sugestao });
    // `valor`/`onChange` ficam fora das dependências de propósito: o efeito
    // reage à SUGESTÃO, e incluir o objeto que ele mesmo troca reentraria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugestao, valor.mensagemEditada]);

  // A biblioteca só é buscada quando a comunicação é ligada: quem nunca usa não
  // paga a consulta ao abrir um compromisso.
  useEffect(() => {
    if (!valor.ligada || midias.length > 0) return;
    let vivo = true;
    void whatsappService.listSavedMedia({ activeOnly: true })
      .then(itens => { if (vivo) setMidias(itens); })
      .catch(() => { /* sem biblioteca o bloco segue: a mídia é opcional */ });
    return () => { vivo = false; };
  }, [valor.ligada, midias.length]);

  /**
   * A prévia usa a MESMA função do envio — ver o cabeçalho do arquivo.
   *
   * A única diferença é o nome: no formulário o cliente pode ainda não ter sido
   * escolhido, e substituir por vazio produzia "Bom dia, . Seu compromisso…".
   * O marcador deixa claro que ali entra um nome, em vez de parecer defeito.
   * No envio de verdade o nome sempre existe — sem cliente não há envio.
   */
  const previa = useMemo(() => {
    const nome = (contexto.clienteNome || '').trim();
    const nomeNaPrevia = nome || '[nome do cliente]';
    return montarMensagemDaComunicacao(valor.mensagem, {
    primeiro_nome: nome ? primeiroNomeApresentavel(nome) : nomeNaPrevia,
    cliente: nome ? nomeApresentavel(nome) : nomeNaPrevia,
    titulo: contexto.titulo,
    data: contexto.inicio?.toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' }) ?? '—',
    hora: contexto.inicio?.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit' }) ?? '—',
    local: contexto.local,
    detalhes: contexto.detalhes,
    modalidade: contexto.modalidade,
    processo: contexto.processoCodigo ?? '',
    });
  }, [valor.mensagem, contexto]);

  const saiEm = contexto.inicio ? momentoDoEnvio(contexto.inicio, valor.minutos) : null;
  const jaPassouDaHora = !!saiEm && saiEm.getTime() <= Date.now();

  return (
    <div>
      {/* Interruptor */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Comunicar o cliente</p>
          <p className="mt-0.5 text-xs text-slate-600">Avisar por WhatsApp antes do compromisso</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={valor.ligada}
          aria-label="Comunicar o cliente por WhatsApp"
          onClick={() => set({ ligada: !valor.ligada })}
          className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${valor.ligada ? 'bg-orange-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all ${valor.ligada ? 'left-[18px]' : 'left-[2px]'}`} />
        </button>
      </div>

      {valor.ligada && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {/* Para quem vai — ou o aviso de que ainda não há para quem */}
          {contexto.temCliente ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                {(contexto.clienteNome || '?').trim().slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{contexto.clienteNome || 'Cliente vinculado'}</p>
                <p className="truncate font-mono text-[10px] text-slate-500">
                  {contexto.clienteTelefone || 'sem telefone no cadastro'} · vinculado
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                {textoSemCliente
                  ?? 'Este compromisso ainda não tem cliente vinculado — sem isso não há para quem enviar.'}
              </p>
              {onVincularCliente && (
                <button
                  type="button"
                  onClick={onVincularCliente}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
                >
                  <UserPlus className="h-3 w-3" />
                  Vincular cliente
                </button>
              )}
            </div>
          )}

          {/* Antecedência */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Quanto tempo antes</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ANTECEDENCIAS_DA_COMUNICACAO.map(op => (
                <button
                  key={op.minutos}
                  type="button"
                  onClick={() => set({ minutos: op.minutos })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition ${
                    valor.minutos === op.minutos
                      ? 'border-transparent bg-orange-500 font-semibold text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {op.rotulo}
                </button>
              ))}
            </div>
            <p className={`mt-1.5 text-[10px] ${jaPassouDaHora ? 'text-amber-700' : 'text-slate-400'}`}>
              {!saiEm
                ? 'Escolha a data e a hora do compromisso para saber quando a mensagem sai.'
                : jaPassouDaHora
                  ? 'Essa antecedência já passou — o cliente não será avisado. Escolha uma menor.'
                  : `Sai em ${saiEm.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })}, no horário de atendimento do canal.`}
            </p>
          </div>

          {/* Mensagem */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mensagem</p>
            <textarea
              value={valor.mensagem}
              onChange={e => set({ mensagem: e.target.value, mensagemEditada: true })}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-orange-400"
              placeholder="O que o cliente vai ler…"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {VARIAVEIS_DA_COMUNICACAO.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set({ mensagem: `${valor.mensagem}{${v}}`, mensagemEditada: true })}
                  title={`Inserir {${v}}`}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Mídia da biblioteca */}
          {midias.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Anexar da biblioteca <span className="font-normal normal-case tracking-normal">— opcional</span>
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {midias.map(m => {
                  const Icone = ICONE_DA_MIDIA[m.type] ?? FileText;
                  const escolhida = valor.midiaId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      // Clicar na escolhida DESMARCA: sem isso, quem anexa por
                      // engano não tem como voltar a mandar só o texto.
                      onClick={() => set({ midiaId: escolhida ? null : m.id })}
                      className={`overflow-hidden rounded-lg border text-left transition ${
                        escolhida ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {/* A miniatura é `relative` + filho `absolute` de propósito:
                          `h-full` dentro de um `grid` deixava a imagem crescer e
                          passar POR CIMA do nome e do tipo. E vídeo precisa de
                          <video>, não de <img> — a URL assinada aponta para um
                          .mp4, e o <img> só sabia mostrar ícone de quebrado. */}
                      <span className="relative block h-12 w-full overflow-hidden bg-slate-100">
                        {m.preview_url && m.type === 'image' ? (
                          <img
                            src={m.preview_url}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : m.preview_url && m.type === 'video' ? (
                          <video
                            src={m.preview_url}
                            muted
                            playsInline
                            // `metadata` traz o primeiro quadro sem baixar o
                            // vídeo inteiro — a lista tem várias miniaturas.
                            preload="metadata"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : null}
                        {/* Fica ATRÁS da mídia: quando ela não carrega (URL
                            expirada, formato que o navegador recusa), o ícone
                            aparece sozinho em vez de um retângulo vazio. */}
                        <span className="absolute inset-0 -z-10 grid place-items-center">
                          <Icone className="h-4 w-4 text-slate-400" />
                        </span>
                      </span>
                      <span className="block px-1.5 pt-1 text-[10px] font-semibold leading-tight text-slate-700 line-clamp-2">
                        {m.name}
                      </span>
                      <span className="block px-1.5 pb-1.5 font-mono text-[9px] uppercase tracking-wide text-slate-400">
                        {ROTULO_DA_MIDIA[m.type]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Prévia */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">O que o cliente recebe</p>
            <p className="mt-1.5 whitespace-pre-line rounded-r-lg border border-l-[3px] border-slate-200 border-l-emerald-500 bg-emerald-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-slate-800">
              {previa.trim() || 'Escreva a mensagem acima.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ── O PAINEL DOS DETALHES ───────────────────────────────────────────────────
// Os mesmos campos, com estado próprio e botão de salvar, para um compromisso
// que já existe.

interface Props {
  evento: CalendarEvent;
  /** Nome do cliente vinculado, para a prévia e o cabeçalho. */
  clienteNome?: string | null;
  /** Telefone, só para mostrar a quem a mensagem vai. */
  clienteTelefone?: string | null;
  /** Número do processo, se houver — alimenta `{processo}`. */
  processoCodigo?: string | null;
  /** Abre a edição do compromisso, para vincular um cliente. */
  onVincularCliente?: () => void;
  /** Avisa a Agenda que a linha mudou, para a lista recarregar. */
  onSalvo?: (evento: CalendarEvent) => void;
}

export const ClientNoticePanel: React.FC<Props> = ({
  evento, clienteNome, clienteTelefone, processoCodigo, onVincularCliente, onSalvo,
}) => {
  const toast = useToastContext();
  const [valor, setValor] = useState<ValorDaComunicacao>(() => comunicacaoDoEvento(evento));
  const [salvando, setSalvando] = useState(false);

  const inicio = useMemo(() => new Date(evento.start_at), [evento.start_at]);
  const saiEm = useMemo(() => momentoDoEnvio(inicio, valor.minutos), [inicio, valor.minutos]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const atualizado = await calendarService.saveClientNotice(evento.id, {
        enabled: valor.ligada,
        minutesBefore: valor.ligada ? valor.minutos : null,
        message: valor.ligada ? valor.mensagem.trim() : null,
        mediaId: valor.ligada ? valor.midiaId : null,
      });
      toast.success(
        valor.ligada ? 'Comunicação agendada' : 'Comunicação cancelada',
        valor.ligada
          ? `O cliente será avisado em ${saiEm.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })}.`
          : 'Nada será enviado ao cliente.',
      );
      onSalvo?.(atualizado);
    } catch (err: any) {
      toast.error('Não foi possível salvar', err?.message ?? 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  // ── Já enviada: vira registro, não formulário ────────────────────────────
  if (evento.client_notify_sent_at) {
    const quando = new Date(evento.client_notify_sent_at);
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Comunicação enviada</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Check className="h-3.5 w-3.5 shrink-0" />
          {clienteNome || 'Cliente'} foi avisado em{' '}
          {quando.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })}
        </p>
        {evento.client_notify_message && (
          <p className="mt-2 whitespace-pre-line rounded-lg border-l-2 border-emerald-400 bg-white/70 px-2.5 py-2 text-[11px] leading-relaxed text-slate-700">
            {evento.client_notify_message}
          </p>
        )}
        {evento.client_notify_error && (
          <p className="mt-2 text-[11px] text-amber-700">{evento.client_notify_error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <ClientNoticeFields
        valor={valor}
        onChange={setValor}
        onVincularCliente={onVincularCliente}
        textoSemCliente="Este compromisso não tem cliente vinculado, então não há para quem enviar."
        contexto={{
          inicio,
          titulo: evento.title ?? '',
          tipo: evento.event_type ?? '',
          local: evento.location ?? '',
          detalhes: evento.description ?? '',
          modalidade: evento.event_mode ?? '',
          clienteNome: clienteNome ?? null,
          clienteTelefone: clienteTelefone ?? null,
          processoCodigo: processoCodigo ?? null,
          temCliente: !!evento.client_id,
        }}
      />

      {evento.client_notify_error && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-red-700">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {evento.client_notify_error}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || (valor.ligada && !valor.mensagem.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {valor.ligada ? 'Salvar comunicação' : 'Salvar'}
        </button>
      </div>
    </div>
  );
};

export default ClientNoticePanel;
