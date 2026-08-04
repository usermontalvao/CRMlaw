// DEV-ONLY: vitrine dos modais do WhatsApp (?wamodalspreview=1). Serve para
// conferir a linguagem visual (cabeçalho, campos, rodapé) sem precisar de uma
// conversa real — os modais reais só diferem no que fazem ao confirmar.
import React, { useState } from 'react';
import { ArrowRightLeft, Ban, CalendarClock, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  WaDialog, WaDialogBody, WaDialogActions, WaField, WaFieldStack,
  waInput, waTextarea, waSelect, waSelectStyle, waBtnGhost, waBtnPrimary, waBtnDanger,
} from '../components/whatsapp/ui';

type Demo = 'transfer' | 'close' | 'block' | 'hold' | 'schedule';

const WhatsAppModalsPreview: React.FC = () => {
  const [open, setOpen] = useState<Demo | null>('transfer');

  const botoes: { id: Demo; label: string }[] = [
    { id: 'transfer', label: 'Transferir conversa' },
    { id: 'close', label: 'Encerrar atendimento' },
    { id: 'block', label: 'Bloquear contato' },
    { id: 'hold', label: 'Guarda jurídica' },
    { id: 'schedule', label: 'Agendar mensagem' },
  ];

  return (
    <main className="min-h-screen bg-[#f5f5f3] p-6 sm:p-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · UI</p>
        <h1 className="text-lg font-semibold text-slate-900">Modais do atendimento</h1>
        <p className="mb-5 text-xs text-slate-500">Clique para abrir cada um e conferir cabeçalho, campos e rodapé.</p>
        <div className="flex flex-wrap gap-2">
          {botoes.map(b => (
            <button key={b.id} onClick={() => setOpen(b.id)} className={waBtnGhost}>{b.label}</button>
          ))}
        </div>
      </div>

      {open === 'transfer' && (
        <WaDialog title="Transferir conversa" subtitle="Isabel Maria" icon={<ArrowRightLeft size={18} />}
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><ArrowRightLeft size={14} /> Transferir</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <WaFieldStack>
              <WaField label="Departamento">
                <select className={waSelect} style={waSelectStyle}>
                  <option>Nenhum</option><option>Previdenciário</option><option>Financeiro</option>
                </select>
              </WaField>
              <WaField label="Responsável">
                <select className={waSelect} style={waSelectStyle}>
                  <option>Ninguém</option><option>Pedro Rodrigues</option>
                </select>
              </WaField>
              <WaField label="Motivo da transferência" optional="(opcional, interno)"
                hint="O motivo fica só no histórico interno. O cliente recebe um aviso automático de encaminhamento.">
                <textarea rows={2} placeholder="Ex: cliente quer falar com o financeiro" className={waTextarea} />
              </WaField>
            </WaFieldStack>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'close' && (
        <WaDialog title="Encerrar atendimento" subtitle="itamar" icon={<CheckCircle2 size={18} />} tone="success"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><CheckCircle2 size={14} /> Encerrar</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
              A conversa sai da fila ativa e reabre sozinha se o cliente voltar a falar.
            </p>
            <WaFieldStack>
              <WaField label="Motivo do encerramento" optional="(interno, opcional)">
                <textarea rows={2} placeholder="Ex: dúvida resolvida" className={waTextarea} />
              </WaField>
              <WaField label="Mensagem ao cliente" optional="(deixe vazio para não enviar)"
                hint="Enviada no WhatsApp antes de encerrar.">
                <textarea rows={2} defaultValue="Foi um prazer atender você! Qualquer dúvida, é só chamar." className={waTextarea} />
              </WaField>
            </WaFieldStack>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'block' && (
        <WaDialog title="Bloquear contato" subtitle="+55 (66) 9609-8800" icon={<Ban size={18} />} tone="danger"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnDanger}><Ban size={14} /> Bloquear</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-800">
              O contato sai da fila normal de atendimento. A ação fica registrada.
            </p>
            <WaField label="Motivo do bloqueio" optional="(obrigatório)">
              <textarea rows={3} placeholder="Ex: spam, número trote, contato indevido" className={waTextarea} />
            </WaField>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'hold' && (
        <WaDialog title="Ativar guarda jurídica" subtitle="Robiane Aguiar" icon={<ShieldCheck size={18} />} tone="info"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><ShieldCheck size={14} /> Ativar guarda</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
              A conversa fica protegida da política de retenção (não é purgada). Você pode registrar um motivo.
            </p>
            <WaField label="Motivo da guarda jurídica" optional="(opcional, interno)">
              <textarea rows={3} placeholder="Ex: processo em andamento, ordem judicial" className={waTextarea} />
            </WaField>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'schedule' && (
        <WaDialog title="Agendar mensagem" icon={<CalendarClock size={18} />}
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><CalendarClock size={14} /> Agendar</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <WaFieldStack>
              <WaField label="Mensagem">
                <textarea rows={3} placeholder="Texto a enviar…" className={waTextarea} />
              </WaField>
              <WaField label="Data e hora" hint="Precisa ser pelo menos 1 minuto no futuro.">
                <input type="datetime-local" className={waInput} />
              </WaField>
            </WaFieldStack>
          </WaDialogBody>
        </WaDialog>
      )}
    </main>
  );
};

export default WhatsAppModalsPreview;
