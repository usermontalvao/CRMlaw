/**
 * A janela de cadastro do colaborador (Configurações › Equipe).
 *
 * Ela era feita À MÃO: um `position: fixed` com estilos inline, cartão branco,
 * sombra própria, campos com borda inventada e os botões soltos no fim do
 * conteúdo. Duas consequências:
 *
 *  · abria DENTRO do painel de Configurações, porque `position: fixed` só é
 *    relativo à janela quando nenhum ancestral cria bloco de contenção — e ali
 *    há ancestrais com `animation`/`transform`;
 *  · não parecia o CRM. O sistema inteiro usa `components/ui/Modal`, com
 *    cabeçalho, rodapé fixo, tamanhos, trava de rolagem, foco preso, Esc em
 *    pilha e camada certa. Esta era a única tela que reimplementava tudo isso,
 *    pior.
 *
 * Agora é o `Modal` da casa, e os campos usam as mesmas classes do formulário
 * de criar usuário, que fica a dois cliques daqui.
 *
 * Mora em arquivo próprio para caber na bancada (`?equipepreview=1`): sem isso,
 * conferir um ajuste desta janela exige sessão autenticada e um colaborador de
 * verdade na lista.
 */
import React from 'react';
import { Loader2, KeyRound } from 'lucide-react';
import { Modal, ModalBody } from '../ui';
import { LAYER } from '../../styles/layers';

export interface CargoDisponivel {
  value: string;
  label: string;
  description: string;
  icon: string;
}

export interface CadastroDaEquipe {
  name: string;
  phone: string;
  cpf: string;
  oab: string;
  location: string;
  bio: string;
  lawyerFullName: string;
}

export interface PinDoColaborador {
  has_pin?: boolean;
  pin_required_setup?: boolean;
  pin_set_at?: string | null;
  locked_until?: string | null;
}

const CAMPO =
  'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 ' +
  'focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 ' +
  'h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';

const ROTULO = 'block text-[13px] font-medium text-slate-700 dark:text-zinc-300 mb-1';

const SECAO =
  'text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-zinc-500';

const Campo: React.FC<{
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'tel' | 'numeric';
  className?: string;
}> = ({ rotulo, valor, aoMudar, placeholder, inputMode, className }) => (
  <div className={className}>
    <label className={ROTULO}>{rotulo}</label>
    <input
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className={CAMPO}
    />
  </div>
);

const ModalDeCadastroDaEquipe: React.FC<{
  aberto: boolean;
  aoFechar: () => void;
  /** E-mail do colaborador — vai no eyebrow, e não é editável (ver abaixo). */
  email: string;
  /** Editando a si mesmo: o cargo trava, o resto não. */
  editandoSiMesmo: boolean;

  cadastro: CadastroDaEquipe;
  aoMudarCadastro: (mudanca: Partial<CadastroDaEquipe>) => void;
  formatarTelefone: (valor: string) => string;
  formatarCpf: (valor: string) => string;

  cargos: CargoDisponivel[];
  cargo: string;
  aoMudarCargo: (valor: string) => void;
  genero: string;
  aoMudarGenero: (valor: string) => void;
  /** Só advogado usa o tratamento Dr./Dra. no atendimento. */
  cargoUsaTratamento: boolean;

  pin: PinDoColaborador | null;
  resetandoPin: boolean;
  aoResetarPin: () => void;

  salvando: boolean;
  semMudanca: boolean;
  aoSalvar: () => void;
}> = ({
  aberto, aoFechar, email, editandoSiMesmo,
  cadastro, aoMudarCadastro, formatarTelefone, formatarCpf,
  cargos, cargo, aoMudarCargo, genero, aoMudarGenero, cargoUsaTratamento,
  pin, resetandoPin, aoResetarPin,
  salvando, semMudanca, aoSalvar,
}) => (
  <Modal
    open={aberto}
    onClose={aoFechar}
    title="Editar cadastro"
    eyebrow={email}
    size="md"
    zIndex={LAYER.MODAL}
    footer={
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={aoFechar}
          disabled={salvando}
          className="px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 rounded transition disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={aoSalvar}
          disabled={salvando || semMudanca}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-semibold bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors disabled:opacity-50"
        >
          {salvando && <Loader2 size={13} className="animate-spin" />}
          Salvar
        </button>
      </div>
    }
  >
    <ModalBody className="px-5 py-4">
      <div className="space-y-5">

        {/* ── Dados pessoais ── */}
        <section>
          <p className={SECAO}>Dados pessoais</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo
              className="sm:col-span-2"
              rotulo="Nome"
              valor={cadastro.name}
              aoMudar={(v) => aoMudarCadastro({ name: v })}
              placeholder="Nome do colaborador"
            />
            <Campo
              rotulo="Telefone"
              valor={cadastro.phone}
              aoMudar={(v) => aoMudarCadastro({ phone: formatarTelefone(v) })}
              placeholder="(65) 99999-0000"
              inputMode="tel"
            />
            <Campo
              rotulo="CPF"
              valor={cadastro.cpf}
              aoMudar={(v) => aoMudarCadastro({ cpf: formatarCpf(v) })}
              placeholder="000.000.000-00"
              inputMode="numeric"
            />
            <Campo
              rotulo="OAB"
              valor={cadastro.oab}
              aoMudar={(v) => aoMudarCadastro({ oab: v })}
              placeholder="30.021/MT"
            />
            <Campo
              rotulo="Local"
              valor={cadastro.location}
              aoMudar={(v) => aoMudarCadastro({ location: v })}
              placeholder="Cuiabá/MT"
            />
            <Campo
              className="sm:col-span-2"
              rotulo="Nome completo para petições"
              valor={cadastro.lawyerFullName}
              aoMudar={(v) => aoMudarCadastro({ lawyerFullName: v })}
              placeholder="Como o nome assina nas peças"
            />
            <div className="sm:col-span-2">
              <label className={ROTULO}>Observações</label>
              <textarea
                value={cadastro.bio}
                onChange={(e) => aoMudarCadastro({ bio: e.target.value })}
                rows={2}
                className={`${CAMPO} h-auto resize-y py-2 leading-relaxed`}
                placeholder="Anotações internas sobre o colaborador"
              />
            </div>
            <div>
              <label className={ROTULO}>Gênero</label>
              <select
                value={genero}
                onChange={(e) => aoMudarGenero(e.target.value)}
                className={`${CAMPO} cursor-pointer`}
              >
                <option value="">Não informar</option>
                <option value="male">Masculino</option>
                <option value="female">Feminino</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-slate-400 dark:text-zinc-500">
            {cargoUsaTratamento
              ? 'O gênero define o tratamento (Dr./Dra.) no atendimento por WhatsApp.'
              : 'O tratamento Dr./Dra. vale apenas para advogados.'}
            {' '}O e-mail é a credencial de acesso e não muda por aqui.
          </p>
        </section>

        {/* ── Cargo ── */}
        <section>
          <p className={SECAO}>Cargo</p>
          {editandoSiMesmo && (
            <p className="mt-2 text-[12px] text-slate-500 dark:text-zinc-400">
              Você não pode alterar o próprio cargo. Outro administrador precisa fazer isso.
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cargos.map((item) => {
              const escolhido = cargo === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={editandoSiMesmo}
                  onClick={() => { if (!editandoSiMesmo) aoMudarCargo(item.value); }}
                  className={`flex items-center gap-2.5 rounded border px-3 py-2 text-left transition ${
                    escolhido
                      ? 'border-orange-400 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-zinc-700 dark:bg-zinc-800'
                  } ${editandoSiMesmo && !escolhido ? 'opacity-50' : ''} ${
                    editandoSiMesmo ? 'cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <span className="text-[15px] leading-none">{item.icon}</span>
                  <span className="min-w-0">
                    <span className={`block text-[12.5px] font-semibold ${escolhido ? 'text-orange-700 dark:text-orange-300' : 'text-slate-800 dark:text-zinc-100'}`}>
                      {item.label}
                    </span>
                    <span className="block truncate text-[11px] text-slate-400 dark:text-zinc-500">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── PIN ── */}
        <section className="border-t border-slate-200 pt-4 dark:border-zinc-700">
          <div className="flex items-center justify-between gap-3">
            <p className={SECAO}>PIN de segurança</p>
            {pin !== null && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${
                  pin.has_pin
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
              >
                {pin.has_pin ? 'Configurado' : pin.pin_required_setup ? 'Aguarda configuração' : 'Não configurado'}
              </span>
            )}
          </div>

          {pin?.locked_until && new Date(pin.locked_until) > new Date() && (
            <p className="mt-2 text-[12px] font-medium text-red-600">
              Bloqueado até {new Date(pin.locked_until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {pin?.pin_set_at && pin.has_pin && (
            <p className="mt-2 text-[12px] text-slate-500 dark:text-zinc-400">
              Configurado em {new Date(pin.pin_set_at).toLocaleDateString('pt-BR')}
            </p>
          )}

          <button
            type="button"
            onClick={aoResetarPin}
            disabled={resetandoPin || !pin?.has_pin}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-red-200 px-3 py-1.5 text-[12.5px] font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resetandoPin ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
            Resetar PIN
          </button>
          {!pin?.has_pin && (
            <p className="mt-2 text-[11.5px] text-slate-400 dark:text-zinc-500">
              {pin === null ? 'Carregando…' : 'Este colaborador ainda não configurou um PIN.'}
            </p>
          )}
        </section>

      </div>
    </ModalBody>
  </Modal>
);

export default ModalDeCadastroDaEquipe;
