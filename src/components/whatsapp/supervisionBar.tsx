// A faixa do Modo supervisão — o aviso de que você está na conversa de outra
// pessoa, e o seletor do que pretende fazer nela.
//
// Ela aparece SÓ quando há supervisão de verdade (`acoes.supervisionando`):
// na própria conversa, na conversa da fila e na que foi transferida para você,
// não há faixa nenhuma — a operação normal não pode ganhar um passo a mais.
//
// O padrão é "Apenas acompanhar" e isso é o ponto principal: sem ele, abrir a
// conversa de um colega já zerava o não-lido dele e escondia a pendência da
// tela de quem tinha de agir. Olhar deixou de mexer.
import React from 'react';
import { Eye, MessageSquare, ShieldCheck, UserCheck, Users } from 'lucide-react';

import {
  EXPLICACAO_MODO,
  ROTULO_MODO,
  type WaModoSupervisao,
} from '../../services/whatsapp/waPermissions';

const ICONE: Record<WaModoSupervisao, React.ComponentType<{ size?: number }>> = {
  acompanhar: Eye,
  responder: MessageSquare,
  assumir: UserCheck,
  redistribuir: Users,
};

export const SupervisionBar: React.FC<{
  modos: readonly WaModoSupervisao[];
  modo: WaModoSupervisao;
  onModo: (modo: WaModoSupervisao) => void;
  /** Nome de quem responde pelo atendimento agora — o "de quem é isto". */
  responsavelNome: string | null;
  /** Administrador vê o rótulo de administrador; supervisor, o de supervisor. */
  ehAdmin: boolean;
}> = ({ modos, modo, onModo, responsavelNome, ehAdmin }) => {
  if (modos.length === 0) return null;

  return (
    <div
      style={{
        background: '#eef2ff',
        borderBottom: '1px solid #c7d2fe',
        padding: '8px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <ShieldCheck size={14} style={{ color: '#4338ca', flexShrink: 0 }} />
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#3730a3' }}>
          {ehAdmin ? 'Modo administrador' : 'Modo supervisão'}
        </span>
        {responsavelNome && (
          <span style={{ fontSize: '12px', color: '#4338ca' }}>
            · atendimento de <strong>{responsavelNome}</strong>
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '7px' }}>
        {modos.map(m => {
          const Icone = ICONE[m];
          const ativo = m === modo;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onModo(m)}
              title={EXPLICACAO_MODO[m]}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                fontSize: '12px', fontWeight: ativo ? 700 : 500,
                padding: '5px 10px', borderRadius: '999px',
                cursor: 'pointer',
                background: ativo ? '#4338ca' : '#ffffff',
                color: ativo ? '#ffffff' : '#3730a3',
                border: `1px solid ${ativo ? '#4338ca' : '#c7d2fe'}`,
              }}
            >
              <Icone size={12} />
              {ROTULO_MODO[m]}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: '11.5px', color: '#4c1d95', marginTop: '6px' }}>
        {EXPLICACAO_MODO[modo]}
      </div>
    </div>
  );
};

export default SupervisionBar;
