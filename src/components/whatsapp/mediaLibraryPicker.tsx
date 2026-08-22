// Biblioteca de mídias do compositor: o acervo de vídeos, áudios, imagens e
// documentos que a equipe manda TODO DIA — cadastrados uma vez, enviados
// quantas vezes for preciso.
//
// Abre acima da barra de envio, no mesmo lugar do seletor de GIF e do menu de
// anexos. Um clique no item JÁ envia: o arquivo está no servidor, então não há
// upload nem espera para justificar uma segunda confirmação.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Film, Image as ImageIcon, Loader2, Mic, Pencil, Plus, Search, Trash2, Upload, X,
} from 'lucide-react';
import { whatsappService, tipoDeMidia, MEDIA_LIBRARY_MAX_BYTES } from '../../services/whatsapp.service';
import { formatBytes } from './format';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppMediaLibraryItem, WhatsAppMediaLibraryType } from '../../types/whatsapp.types';

const ICONE: Record<WhatsAppMediaLibraryType, React.ComponentType<{ size?: number; className?: string }>> = {
  image: ImageIcon,
  video: Film,
  audio: Mic,
  document: FileText,
};

const ROTULO: Record<WhatsAppMediaLibraryType, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
};

/** Normaliza para busca sem acento — "apresentacao" acha "Apresentação". */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const MediaLibraryPicker: React.FC<{
  /** Envia a mídia escolhida (o clique JÁ é o envio). */
  onPick: (item: WhatsAppMediaLibraryItem) => void;
  onClose: () => void;
  /** No widget o módulo veste creme+laranja; no módulo cheio, o verde do WhatsApp. */
  embedded?: boolean;
}> = ({ onPick, onClose, embedded }) => {
  const toast = useToastContext();
  const acento = embedded ? '#f27a23' : '#00a884';
  const [itens, setItens] = useState<WhatsAppMediaLibraryItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  // Formulário do cadastro: `null` = lista; item = edição; 'novo' = arquivo novo.
  const [form, setForm] = useState<'novo' | WhatsAppMediaLibraryItem | null>(null);
  // Confirmação de remoção NO PRÓPRIO cartão: o painel vive colado ao
  // compositor, e um modal por cima dele tiraria o atendente da conversa.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  // Prévia que não carregou (URL vencida, arquivo removido do bucket): cai para
  // o ícone do tipo. Sem isso o cartão fica com um retângulo cinza vazio, que se
  // parece com "quebrado" e não com "esta mídia é um documento".
  const [semPrevia, setSemPrevia] = useState<Set<string>>(new Set());
  const marcarSemPrevia = useCallback((id: string) => {
    setSemPrevia(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const buscaRef = useRef<HTMLInputElement>(null);

  // Altura do corpo. No módulo cheio o painel pode respirar; no widget ele sobe
  // a partir de uma janela flutuante baixa, e passar disso faria a lista
  // transbordar por cima do cabeçalho da conversa.
  const alturaCorpo = embedded ? 'h-[19rem] max-h-[52vh]' : 'h-[27rem] max-h-[60vh]';

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro(null);
    whatsappService.listSavedMedia()
      .then(setItens)
      .catch(e => setErro(e?.message || 'Não foi possível carregar as mídias salvas.'))
      .finally(() => setCarregando(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => { buscaRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Esc no formulário volta para a lista; na lista, fecha o painel.
      if (form) setForm(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, form]);

  const filtrados = useMemo(() => {
    const q = chave(busca.trim());
    if (!q) return itens;
    return itens.filter(i => chave(`${i.name} ${i.category || ''} ${i.file_name}`).includes(q));
  }, [itens, busca]);

  const remover = async (item: WhatsAppMediaLibraryItem) => {
    setConfirmando(null);
    try {
      await whatsappService.deleteSavedMedia(item.id);
      setItens(prev => prev.filter(i => i.id !== item.id));
      toast.success('Mídia removida', `"${item.name}" saiu da biblioteca. As mensagens já enviadas continuam intactas.`);
    } catch (e: any) {
      toast.error('Não foi possível remover', e?.message || 'Tente novamente.');
    }
  };

  return (
    <div className="absolute left-2.5 sm:left-3 right-2.5 sm:right-3 bottom-full mb-2 z-30 rounded-2xl bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/5 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[#f1f0ec]">
        <Search size={15} className="text-slate-400 flex-shrink-0" />
        <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar nas mídias salvas…"
          className="flex-1 min-w-0 text-[13px] outline-none bg-transparent placeholder:text-slate-400" />
        <button onClick={() => setForm('novo')} title="Cadastrar mídia"
          style={{ color: acento }}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[12px] font-semibold hover:bg-slate-100 transition">
          <Plus size={14} /> Cadastrar
        </button>
        <button onClick={onClose} title="Fechar" className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      {form ? (
        <MediaLibraryForm
          alvo={form}
          acento={acento}
          altura={alturaCorpo}
          onCancel={() => setForm(null)}
          onSaved={(item, novo) => {
            setForm(null);
            setItens(prev => (novo ? [item, ...prev] : prev.map(i => (i.id === item.id ? { ...i, ...item } : i))));
          }}
        />
      ) : (
        <div className={`${alturaCorpo} overflow-y-auto p-2`}>
          {carregando ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-[12.5px] gap-2">
              <Loader2 size={15} className="animate-spin" /> Carregando…
            </div>
          ) : erro ? (
            <div className="h-full flex items-center justify-center px-6 text-center">
              <p className="text-[12.5px] text-slate-500">{erro}</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 text-center gap-2">
              <p className="text-[12.5px] text-slate-400">
                {itens.length === 0
                  ? 'Nenhuma mídia cadastrada ainda.'
                  : `Nada encontrado para “${busca}”.`}
              </p>
              {itens.length === 0 && (
                <button onClick={() => setForm('novo')} style={{ color: acento }}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:underline">
                  <Upload size={14} /> Cadastrar a primeira
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filtrados.map(item => {
                const Icone = ICONE[item.type];
                return (
                  <div key={item.id} className="group relative rounded-xl border border-[#e7e5df] overflow-hidden bg-white hover:shadow-md transition">
                    {/* O botão do CARTÃO é o envio. As ações de manutenção ficam
                        por cima, num canto, e param a propagação — para editar
                        não virar envio acidental para o cliente. */}
                    <button onClick={() => onPick(item)} title={`Enviar “${item.name}”`}
                      className="w-full text-left">
                      {/* 16:9 em vez de altura fixa: a miniatura acompanha a
                          largura da coluna, então ela é grande no módulo e
                          continua proporcional no widget estreito. */}
                      <div className="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
                        {item.type === 'image' && item.preview_url && !semPrevia.has(item.id) ? (
                          <img src={item.preview_url} alt="" loading="lazy"
                            onError={() => marcarSemPrevia(item.id)}
                            className="w-full h-full object-cover" />
                        ) : item.type === 'video' && item.preview_url && !semPrevia.has(item.id) ? (
                          // O `#t=0.1` é o que faz o quadro APARECER. Sem ele o
                          // Chrome carrega os metadados e deixa o retângulo preto:
                          // só desenha pixel depois de procurar um instante do
                          // vídeo, e é isso que o fragmento pede. `preload` fica em
                          // metadata para a grade não baixar os vídeos inteiros.
                          <video src={`${item.preview_url}#t=0.1`} muted playsInline preload="metadata"
                            onError={() => marcarSemPrevia(item.id)}
                            className="w-full h-full object-cover" />
                        ) : (
                          <Icone size={34} className="text-slate-400" />
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-[12.5px] font-semibold text-slate-700 truncate">{item.name}</p>
                        <p className="text-[10.5px] text-slate-400 truncate">
                          {ROTULO[item.type]}
                          {item.size_bytes ? ` · ${formatBytes(item.size_bytes)}` : ''}
                          {item.category ? ` · ${item.category}` : ''}
                        </p>
                      </div>
                    </button>
                    <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                      <button onClick={e => { e.stopPropagation(); setForm(item); }} title="Editar"
                        className="w-6 h-6 rounded-md bg-black/55 text-white hover:bg-black/75 flex items-center justify-center">
                        <Pencil size={12} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); setConfirmando(item.id); }} title="Remover da biblioteca"
                        className="w-6 h-6 rounded-md bg-black/55 text-white hover:bg-red-600 flex items-center justify-center">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {confirmando === item.id && (
                      <div className="absolute inset-0 bg-white/95 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
                        <p className="text-[11.5px] text-slate-600 leading-tight">Tirar da biblioteca?</p>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setConfirmando(null)}
                            className="px-2 py-1 rounded-md text-[11.5px] font-semibold text-slate-500 hover:bg-slate-100">
                            Cancelar
                          </button>
                          <button onClick={() => void remover(item)}
                            className="px-2 py-1 rounded-md text-[11.5px] font-semibold text-white bg-red-600 hover:bg-red-700">
                            Remover
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!form && (
        <p className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-[#f1f0ec]">
          Um clique envia. O texto escrito no compositor vai como legenda.
        </p>
      )}
    </div>
  );
};

/**
 * Cadastro e edição de uma mídia da biblioteca.
 *
 * O arquivo só é escolhido no CADASTRO: editar troca nome, pasta e legenda, não
 * o arquivo. Trocar o arquivo por baixo mudaria o que já foi enviado com aquele
 * nome — quem precisa de outro arquivo cadastra outra mídia.
 */
const MediaLibraryForm: React.FC<{
  alvo: 'novo' | WhatsAppMediaLibraryItem;
  acento: string;
  /** Mesma altura da lista: o painel não pode encolher ao abrir o cadastro. */
  altura: string;
  onCancel: () => void;
  onSaved: (item: WhatsAppMediaLibraryItem, novo: boolean) => void;
}> = ({ alvo, acento, altura, onCancel, onSaved }) => {
  const toast = useToastContext();
  const editando = alvo !== 'novo' ? alvo : null;
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nome, setNome] = useState(editando?.name || '');
  const [categoria, setCategoria] = useState(editando?.category || '');
  const [legenda, setLegenda] = useState(editando?.caption || '');
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    if (!f) return;
    if (f.size > MEDIA_LIBRARY_MAX_BYTES) {
      toast.warning('Arquivo grande demais', 'O acervo de mídias aceita até 50 MB por arquivo.');
      return;
    }
    setArquivo(f);
    // O nome do arquivo é um bom primeiro palpite, sem a extensão.
    if (!nome.trim()) setNome(f.name.replace(/\.[^.]+$/, ''));
  };

  const salvar = async () => {
    if (!editando && !arquivo) { toast.warning('Escolha o arquivo', 'Nenhum arquivo selecionado.'); return; }
    if (!nome.trim()) { toast.warning('Dê um nome', 'É por ele que a mídia é encontrada na busca.'); return; }
    setSalvando(true);
    try {
      if (editando) {
        const patch = {
          name: nome.trim(),
          category: categoria.trim() || null,
          caption: legenda.trim() || null,
        };
        await whatsappService.updateSavedMedia(editando.id, patch);
        onSaved({ ...editando, ...patch }, false);
        toast.success('Mídia atualizada', nome.trim());
      } else {
        const criado = await whatsappService.createSavedMedia(arquivo!, {
          name: nome.trim(), category: categoria.trim() || null, caption: legenda.trim() || null,
        });
        onSaved(criado, true);
        toast.success('Mídia cadastrada', `"${criado.name}" está pronta para reenvio.`);
      }
    } catch (e: any) {
      toast.error('Não foi possível salvar', e?.message || 'Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const campo = 'w-full px-2.5 py-1.5 text-[13px] rounded-lg border border-[#e7e5df] outline-none focus:border-slate-400 bg-white';

  return (
    <div className={`${altura} overflow-y-auto p-3 space-y-2.5`}>
      {!editando && (
        <>
          <input ref={fileRef} type="file" className="hidden" onChange={escolher} />
          <button onClick={() => fileRef.current?.click()}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-[#d9d6cf] hover:bg-slate-50 transition text-left">
            <span className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0" style={{ color: acento }}>
              <Upload size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-slate-700 truncate">
                {arquivo ? arquivo.name : 'Escolher arquivo'}
              </span>
              <span className="block text-[11px] text-slate-400">
                {arquivo
                  ? `${ROTULO[tipoDeMidia(arquivo.type)]} · ${formatBytes(arquivo.size)}`
                  : 'Vídeo, imagem, áudio ou documento (até 50 MB)'}
              </span>
            </span>
          </button>
        </>
      )}

      <label className="block">
        <span className="block text-[11px] font-semibold text-slate-500 mb-1">Nome</span>
        <input value={nome} onChange={e => setNome(e.target.value)} className={campo}
          placeholder="Ex.: Vídeo de apresentação do escritório" />
      </label>

      <label className="block">
        <span className="block text-[11px] font-semibold text-slate-500 mb-1">Pasta (opcional)</span>
        <input value={categoria} onChange={e => setCategoria(e.target.value)} className={campo}
          placeholder="Ex.: Apresentação, Previdenciário" />
      </label>

      <label className="block">
        <span className="block text-[11px] font-semibold text-slate-500 mb-1">Legenda padrão (opcional)</span>
        <textarea value={legenda} onChange={e => setLegenda(e.target.value)} rows={2}
          className={`${campo} resize-none`}
          placeholder="Vai junto quando o compositor estiver vazio." />
      </label>

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:bg-slate-100 transition">
          Cancelar
        </button>
        <button onClick={() => void salvar()} disabled={salvando}
          style={{ backgroundColor: acento }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-60 transition">
          {salvando ? <Loader2 size={14} className="animate-spin" /> : null}
          {editando ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </div>
  );
};

export default MediaLibraryPicker;
