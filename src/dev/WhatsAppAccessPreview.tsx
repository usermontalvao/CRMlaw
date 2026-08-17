import React from 'react';
import { GitBranch, MessageCircle } from 'lucide-react';
import ChannelAccessManager from '../components/whatsapp/ChannelAccessManager';
import type { StaffOption } from '../services/whatsapp.service';
import type { WhatsAppChannel } from '../types/whatsapp.types';

const channels: WhatsAppChannel[] = [
  {
    id: 'channel-commercial',
    instance_name: 'comercial',
    name: 'Comercial',
    color: '#ea6c00',
    phone_number: '(65) 99999-0101',
    status: 'connected',
    last_qr: null,
    profile_pic_url: null,
    webhook_token: null,
    is_active: true,
    connected_at: new Date().toISOString(),
    absence_message: null,
    absence_enabled: false,
    timezone: 'America/Cuiaba',
    visibility_mode: 'restricted',
    funnel_enabled: true,
    funnel_initial_stage: 'novo',
    auto_close_enabled: false, auto_close_minutes: 1440, auto_close_message: null, auto_close_business_hours_only: true,
  },
  {
    id: 'channel-pedro',
    instance_name: 'pedro',
    name: 'Pedro',
    color: '#2563eb',
    phone_number: '(65) 99999-0202',
    status: 'connected',
    last_qr: null,
    profile_pic_url: null,
    webhook_token: null,
    is_active: true,
    connected_at: new Date().toISOString(),
    absence_message: null,
    absence_enabled: false,
    timezone: 'America/Cuiaba',
    visibility_mode: 'all',
    funnel_enabled: true,
    funnel_initial_stage: 'novo',
    auto_close_enabled: false, auto_close_minutes: 1440, auto_close_message: null, auto_close_business_hours_only: true,
  },
];

const staff: StaffOption[] = [
  { user_id: 'admin', name: 'Pedro Rodrigues', role: 'Administrador' },
  { user_id: 'ana', name: 'Ana Beatriz', role: 'Advogado' },
  { user_id: 'carla', name: 'Carla Mendes', role: 'Secretária' },
  { user_id: 'joao', name: 'João Lucas', role: 'Auxiliar' },
];

const WhatsAppAccessPreview: React.FC = () => (
  <main className="min-h-screen bg-[#f5f5f3] p-4 sm:p-8">
    <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white">
          <MessageCircle size={20} />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · Gestão</p>
          <h1 className="text-base font-semibold text-slate-900">Acessos aos canais</h1>
          <p className="text-xs text-slate-500">Prévia visual do fluxo unificado com Leads</p>
        </div>
        <a href="/?wafunnelpreview=1" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          <GitBranch size={14} /> Ver funis por canal
        </a>
      </header>
      <ChannelAccessManager
        channels={channels}
        staff={staff}
        initialMemberships={[
          { channel_id: 'channel-commercial', user_id: 'ana' },
          { channel_id: 'channel-commercial', user_id: 'carla' },
        ]}
      />
    </div>
  </main>
);

export default WhatsAppAccessPreview;
