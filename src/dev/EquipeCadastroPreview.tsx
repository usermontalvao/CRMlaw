/**
 * Bancada da janela de cadastro da Equipe (`?equipepreview=1`).
 *
 * A tela real fica atrás de login, em Configurações › Administração › Equipe, e
 * só aparece com um colaborador de verdade selecionado — conferir um ajuste de
 * espaçamento ali significava entrar no sistema e abrir a ficha de alguém.
 *
 * Aqui ela roda com dados de mentira e com os interruptores que mudam o que a
 * janela mostra: editar a si mesmo trava o cargo, e o estado do PIN muda a
 * etiqueta e habilita (ou não) o botão de resetar.
 */
import React, { useState } from 'react';
import ModalDeCadastroDaEquipe, {
  type CadastroDaEquipe,
  type PinDoColaborador,
} from '../components/settings/ModalDeCadastroDaEquipe';
import { formatPhone, maskCpfInput } from '../utils/formatters';

const CARGOS = [
  { value: 'Administrador', label: 'Administrador', description: 'Acesso total ao sistema', icon: '👑' },
  { value: 'Advogado', label: 'Advogado', description: 'Acesso completo aos módulos jurídicos', icon: '⚖️' },
  { value: 'Auxiliar', label: 'Auxiliar', description: 'Suporte administrativo', icon: '📋' },
  { value: 'Secretária', label: 'Secretária', description: 'Agenda, clientes e comunicados', icon: '📞' },
  { value: 'Financeiro', label: 'Financeiro', description: 'Controle do módulo financeiro', icon: '💰' },
  { value: 'Estagiário', label: 'Estagiário', description: 'Perfil supervisionado', icon: '📚' },
];

const PINS: Record<string, PinDoColaborador | null> = {
  configurado: { has_pin: true, pin_set_at: '2026-07-14T12:00:00Z' },
  sem: { has_pin: false, pin_required_setup: true },
  carregando: null,
};

const EquipeCadastroPreview: React.FC = () => {
  const [cadastro, setCadastro] = useState<CadastroDaEquipe>({
    name: 'Anna Vittoria Cerqueira do Nascimento',
    phone: '(65) 99999-1200',
    cpf: '123.456.789-09',
    oab: '30.021/MT',
    location: 'Cuiabá/MT',
    bio: '',
    lawyerFullName: '',
  });
  const [cargo, setCargo] = useState('Advogado');
  const [genero, setGenero] = useState('female');
  const [siMesmo, setSiMesmo] = useState(false);
  const [estadoDoPin, setEstadoDoPin] = useState<keyof typeof PINS>('configurado');

  return (
    <div style={{ minHeight: '100dvh', background: '#eef1f5' }}>
      <ModalDeCadastroDaEquipe
        aberto
        aoFechar={() => {}}
        email="annanascimento.contato09@gmail.com"
        editandoSiMesmo={siMesmo}
        cadastro={cadastro}
        aoMudarCadastro={(m) => setCadastro((c) => ({ ...c, ...m }))}
        formatarTelefone={formatPhone}
        formatarCpf={maskCpfInput}
        cargos={CARGOS}
        cargo={cargo}
        aoMudarCargo={setCargo}
        genero={genero}
        aoMudarGenero={setGenero}
        cargoUsaTratamento={cargo === 'Advogado'}
        pin={PINS[estadoDoPin]}
        resetandoPin={false}
        aoResetarPin={() => {}}
        salvando={false}
        semMudanca={false}
        aoSalvar={() => {}}
      />

      <div
        style={{
          position: 'fixed', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 999999,
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'center',
          padding: '8px 10px', borderRadius: 14, maxWidth: 'calc(100vw - 20px)',
          background: 'rgba(15,23,42,.92)', backdropFilter: 'blur(8px)',
          boxShadow: '0 18px 40px -18px rgba(0,0,0,.7)',
          font: '500 11px ui-monospace, SFMono-Regular, Menlo, monospace', color: '#cbd5e1',
        }}
      >
        <Botao ativo={siMesmo} onClick={() => setSiMesmo((v) => !v)}>editando a si mesmo</Botao>
        <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,.15)', margin: '0 3px' }} />
        {(Object.keys(PINS) as (keyof typeof PINS)[]).map((chave) => (
          <Botao key={chave} ativo={estadoDoPin === chave} onClick={() => setEstadoDoPin(chave)}>
            pin: {chave}
          </Botao>
        ))}
      </div>
    </div>
  );
};

const Botao: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({
  ativo, onClick, children,
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '5px 10px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
      border: `1px solid ${ativo ? '#f97316' : 'rgba(255,255,255,.15)'}`,
      background: ativo ? 'rgba(249,115,22,.18)' : 'transparent',
      color: ativo ? '#fdba74' : '#94a3b8',
    }}
  >
    {children}
  </button>
);

export default EquipeCadastroPreview;
