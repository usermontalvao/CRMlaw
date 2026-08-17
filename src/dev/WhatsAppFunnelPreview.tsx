import React, { useState } from 'react';
import { GitBranch } from 'lucide-react';
import ChannelFunnelManager from '../components/whatsapp/ChannelFunnelManager';
import type { StaffOption } from '../services/whatsapp.service';
import type { WhatsAppChannel, WhatsAppChannelFunnelStage, WhatsAppDepartment } from '../types/whatsapp.types';

const channelSeed: WhatsAppChannel[] = [
  {
    id: 'channel-commercial', instance_name: 'comercial', name: 'Comercial', color: '#ea6c00',
    phone_number: '(65) 99999-0101', status: 'connected', last_qr: null, profile_pic_url: null,
    webhook_token: null, is_active: true, connected_at: new Date().toISOString(), absence_message: null,
    absence_enabled: false, timezone: 'America/Cuiaba', visibility_mode: 'restricted',
    funnel_enabled: true, funnel_initial_stage: 'novo_contato',
    auto_close_enabled: false, auto_close_minutes: 1440, auto_close_message: null, auto_close_business_hours_only: true,
  },
  {
    id: 'channel-pedro', instance_name: 'pedro', name: 'Pedro', color: '#2563eb',
    phone_number: '(65) 99999-0202', status: 'connected', last_qr: null, profile_pic_url: null,
    webhook_token: null, is_active: true, connected_at: new Date().toISOString(), absence_message: null,
    absence_enabled: false, timezone: 'America/Cuiaba', visibility_mode: 'all',
    funnel_enabled: true, funnel_initial_stage: 'entrada',
    auto_close_enabled: false, auto_close_minutes: 1440, auto_close_message: null, auto_close_business_hours_only: true,
  },
];

const stage = (
  channelId: string, key: string, label: string, color: string, position: number,
  labels: string[], isDefault = false, description = '',
): WhatsAppChannelFunnelStage => ({
  id: `${channelId}-${key}`, channel_id: channelId, stage_key: key, label, description,
  color, labels, position, is_active: true, is_default: isDefault,
  entry_actions: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

const stages: WhatsAppChannelFunnelStage[] = [
  stage('channel-commercial', 'novo_contato', 'Novo contato', '#64748b', 0, ['Novo lead'], true, 'Primeiro contato recebido pelo número comercial.'),
  stage('channel-commercial', 'triagem', 'Triagem', '#3b82f6', 1, ['Em triagem', 'Aguardando retorno']),
  stage('channel-commercial', 'proposta', 'Proposta', '#8b5cf6', 2, ['Proposta enviada']),
  stage('channel-commercial', 'contratado', 'Contratado', '#10b981', 3, ['Contrato assinado']),
  stage('channel-pedro', 'entrada', 'Entrada', '#06b6d4', 0, ['Novo atendimento'], true),
  stage('channel-pedro', 'analise_juridica', 'Análise jurídica', '#f59e0b', 1, ['Em análise', 'Aguardando documentos']),
  stage('channel-pedro', 'orientado', 'Orientado', '#10b981', 2, ['Orientação concluída']),
];

const departments: WhatsAppDepartment[] = [
  { id: 'department-commercial', name: 'Comercial', color: '#8b5cf6', is_active: true },
  { id: 'department-legal', name: 'Jurídico', color: '#2563eb', is_active: true },
];

const staff: StaffOption[] = [
  { user_id: 'user-pedro', name: 'Pedro Montalvão' },
  { user_id: 'user-jacqueline', name: 'Jacqueline Pereira' },
];

const WhatsAppFunnelPreview: React.FC = () => {
  const [channels, setChannels] = useState(channelSeed);
  return (
    <main className="min-h-screen bg-[#f5f5f3] p-4 sm:p-8">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white"><GitBranch size={20} /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · Gestão</p>
            <h1 className="text-base font-semibold text-slate-900">Funis por canal</h1>
            <p className="text-xs text-slate-500">Prévia visual: Comercial e Pedro seguem fluxos independentes</p>
          </div>
        </header>
        <ChannelFunnelManager channels={channels} departments={departments} staff={staff}
          initialStages={stages} onChannelsChange={setChannels} />
      </div>
    </main>
  );
};

export default WhatsAppFunnelPreview;
