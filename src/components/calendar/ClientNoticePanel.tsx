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
} from '../../utils/comunicacaoCompromisso';
import type { CalendarEvent } from '../../types/calendar.types';
import type { WhatsAppMediaLibraryItem, WhatsAppMediaLibraryType } from '../../types/whatsapp.types';

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

const ICONE_DA_MIDIA: Record<WhatsAppMediaLibraryType, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
};

const ROTULO_DA_MIDIA: Record<WhatsAppMediaLibraryType, string> = {
  image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento',
};

export const ClientNoticePanel: React.FC<Props> = ({
  evento, clienteNome, clienteTelefone, processoCodigo, onVincularCliente, onSalvo,
}) => {
  const toast = useToastContext();

  const jaEnviada = !!evento.client_notify_sent_at;
  const temCliente = !!evento.client_id;

  const [ligada, setLigada]       = useState(!!evento.client_notify_enabled);
  const [minutos, setMinutos]     = useState<number>(
    evento.client_notify_minutes_before ?? ANTECEDENCIA_PADRAO_MINUTOS);
  const [mensagem, setMensagem]   = useState(
    evento.client_notify_message ?? MENSAGEM_PADRAO_DA_COMUNICACAO);
  const [midiaId, setMidiaId]     = useState<string | null>(evento.client_notify_media_id ?? null);
  const [midias, setMidias]       = useState<WhatsAppMediaLibraryItem[]>([]);
  const [salvando, setSalvando]   = useState(false);

  // A biblioteca só é buscada quando o painel é ligado: quem nunca usa a
  // comunicação não paga a consulta ao abrir os detalhes de um compromisso.
  useEffect(() => {
    if (!ligada || midias.length > 0) return;
    let vivo = true;
    void whatsappService.listSavedMedia({ activeOnly: true })
      .then(itens => { if (vivo) setMidias(itens); })
      .catch(() => { /* sem biblioteca o painel segue: a mídia é opcional */ });
    return () => { vivo = false; };
  }, [ligada, midias.length]);

  const inicio = useMemo(() => new Date(evento.start_at), [evento.start_at]);

  /** A prévia usa a MESMA função do envio — ver o cabeçalho do arquivo. */
  const previa = useMemo(() => montarMensagemDaComunicacao(mensagem, {
    primeiro_nome: (clienteNome || '').trim().split(/\s+/)[0] ?? '',
    cliente: clienteNome ?? '',
    titulo: evento.title ?? '',
    data: inicio.toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' }),
    hora: inicio.toLocaleTimeString('pt-BR', { timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit' }),
    detalhes: evento.description ?? '',
    modalidade: evento.event_mode ?? '',
    processo: processoCodigo ?? '',
  }), [mensagem, clienteNome, evento.title, evento.description, evento.event_mode, processoCodigo, inicio]);

  const saiEm = useMemo(() => momentoDoEnvio(inicio, minutos), [inicio, minutos]);
  const jaPassouDaHora = saiEm.getTime() <= Date.now();

  const salvar = async () => {
    setSalvando(true);
    try {
      const atualizado = await calendarService.saveClientNotice(evento.id, {
        enabled: ligada,
        minutesBefore: ligada ? minutos : null,
        message: ligada ? mensagem.trim() : null,
        mediaId: ligada ? midiaId : null,
      });
      toast.success(
        ligada ? 'Comunicação agendada' : 'Comunicação cancelada',
        ligada
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

  // ── Sem cliente vinculado: explica e leva para lá ────────────────────────
  if (!temCliente) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Comunicar o cliente</p>
        <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
          Este compromisso não tem cliente vinculado, então não há para quem enviar.
          Vincule um cliente e a comunicação por WhatsApp fica disponível aqui.
        </p>
        {onVincularCliente && (
          <button
            type="button"
            onClick={onVincularCliente}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            <UserPlus className="h-3.5 w-3.5 text-slate-400" />
            Vincular cliente
          </button>
        )}
      </div>
    );
  }

  // ── Já enviada: vira registro, não formulário ────────────────────────────
  if (jaEnviada) {
    const quando = new Date(evento.client_notify_sent_at!);
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

  // ── O painel ─────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      {/* Interruptor */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Comunicar o cliente</p>
          <p className="mt-0.5 text-xs text-slate-600">Avisar por WhatsApp antes do compromisso</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ligada}
          aria-label="Comunicar o cliente por WhatsApp"
          onClick={() => setLigada(v => !v)}
          className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${ligada ? 'bg-orange-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-all ${ligada ? 'left-[18px]' : 'left-[2px]'}`} />
        </button>
      </div>

      {ligada && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {/* Para quem vai */}
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
              {(clienteNome || '?').trim().slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">{clienteNome || 'Cliente vinculado'}</p>
              <p className="truncate font-mono text-[10px] text-slate-500">
                {clienteTelefone || 'sem telefone no cadastro'} · vinculado
              </p>
            </div>
          </div>

          {/* Sem telefone o envio morre lá na frente; avisa aqui, antes de salvar. */}
          {!clienteTelefone && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              O cadastro deste cliente não tem telefone. A comunicação fica agendada, mas só sai depois
              que houver uma conversa de WhatsApp aberta com ele.
            </p>
          )}

          {/* Antecedência */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Quanto tempo antes</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ANTECEDENCIAS_DA_COMUNICACAO.map(op => (
                <button
                  key={op.minutos}
                  type="button"
                  onClick={() => setMinutos(op.minutos)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition ${
                    minutos === op.minutos
                      ? 'border-transparent bg-orange-500 font-semibold text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {op.rotulo}
                </button>
              ))}
            </div>
            <p className={`mt-1.5 text-[10px] ${jaPassouDaHora ? 'text-amber-700' : 'text-slate-400'}`}>
              {jaPassouDaHora
                ? 'Essa antecedência já passou — o cliente não será avisado. Escolha uma menor.'
                : `Sai em ${saiEm.toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })}, no horário de atendimento do canal.`}
            </p>
          </div>

          {/* Mensagem */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Mensagem</p>
            <textarea
              value={mensagem}
              onChange={e => setMensagem(e.target.value)}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-orange-400"
              placeholder="O que o cliente vai ler…"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {VARIAVEIS_DA_COMUNICACAO.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMensagem(m => `${m}{${v}}`)}
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
                  const escolhida = midiaId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      // Clicar na escolhida DESMARCA: sem isso, quem anexa por
                      // engano não tem como voltar a mandar só o texto.
                      onClick={() => setMidiaId(escolhida ? null : m.id)}
                      className={`overflow-hidden rounded-lg border text-left transition ${
                        escolhida ? 'border-orange-400 ring-2 ring-orange-200' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="grid h-12 place-items-center bg-slate-100">
                        {m.preview_url
                          ? <img src={m.preview_url} alt="" className="h-full w-full object-cover" />
                          : <Icone className="h-4 w-4 text-slate-400" />}
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

          {evento.client_notify_error && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-700">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              {evento.client_notify_error}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando || (ligada && !mensagem.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {ligada ? 'Salvar comunicação' : 'Salvar'}
        </button>
      </div>
    </div>
  );
};

export default ClientNoticePanel;
