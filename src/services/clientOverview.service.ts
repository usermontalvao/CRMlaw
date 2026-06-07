/**
 * clientOverview.service.ts
 *
 * Aggregator para a ficha 360 do cliente.
 * Concentra todas as queries do ClientDetails num único ponto,
 * substituindo carregamento espalhado e queries globais sem filtro.
 *
 * Queries corrigidas:
 *  - calendar_events: era global (load all → filter client-side)
 *    → agora usa RPC get_client_calendar_events(client_id)
 *  - saved_petitions: era global (load all → filter client-side)
 *    → agora filtra por client_id direto
 */
import { supabase } from '../config/supabase';
import type { SignatureRequestWithSigners } from '../types/signature.types';
import type { CloudFolder } from '../types/cloud.types';
import type { Deadline } from '../types/deadline.types';
import type { Agreement } from '../types/financial.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { SavedPetition } from '../types/petitionEditor.types';
import type { ChatRoom } from '../types/chat.types';
import { signatureService } from './signature.service';
import { cloudService } from './cloud.service';
import { deadlineService } from './deadline.service';
import { financialService } from './financial.service';

export interface PortalUserSummary {
  id: string;
  auth_user_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  notifications_last_seen_at: string | null;
  created_at: string;
}

export interface ProfileUpdateReq {
  id: string;
  changes: Record<string, string>;
  status: string;
  rejection_reason?: string | null;
  requested_at: string;
}

export interface ClientOverviewData {
  signatures: SignatureRequestWithSigners[];
  petitions: SavedPetition[];
  cloudFolders: CloudFolder[];
  deadlines: Deadline[];
  agreements: Agreement[];
  calendarEvents: CalendarEvent[];
  profileReqs: ProfileUpdateReq[];
  portalUser: PortalUserSummary | null;
  chatRooms: ChatRoom[];
  pushActive: boolean;
  pendingUploadsCount: number;
}

class ClientOverviewService {
  /**
   * Carrega todos os dados da ficha do cliente em paralelo.
   * Usa Promise.allSettled para que uma query com falha não impeça
   * o restante de carregar.
   */
  async load(clientId: string): Promise<ClientOverviewData> {
    const [
      signaturesResult,
      petitionsResult,
      cloudResult,
      deadlinesResult,
      agreementsResult,
      calendarResult,
      profileReqsResult,
      portalResult,
      pendingUploadsResult,
    ] = await Promise.allSettled([
      signatureService.listRequestsWithSigners({ client_id: clientId }),
      this.listPetitions(clientId),
      cloudService.listClientRootFolders(clientId, true),
      deadlineService.listDeadlines({ client_id: clientId }),
      financialService.listAgreements({ client_id: clientId }),
      this.listCalendarEvents(clientId),
      this.listProfileRequests(clientId),
      this.loadPortalData(clientId),
      this.countPendingUploads(clientId),
    ]);

    const portal = portalResult.status === 'fulfilled' ? portalResult.value : null;

    return {
      signatures:          signaturesResult.status     === 'fulfilled' ? signaturesResult.value      : [],
      petitions:           petitionsResult.status      === 'fulfilled' ? petitionsResult.value       : [],
      cloudFolders:        cloudResult.status          === 'fulfilled' ? cloudResult.value           : [],
      deadlines:           deadlinesResult.status      === 'fulfilled' ? deadlinesResult.value       : [],
      agreements:          agreementsResult.status     === 'fulfilled' ? agreementsResult.value      : [],
      calendarEvents:      calendarResult.status       === 'fulfilled' ? calendarResult.value        : [],
      profileReqs:         profileReqsResult.status    === 'fulfilled' ? profileReqsResult.value     : [],
      portalUser:          portal?.portalUser ?? null,
      chatRooms:           portal?.chatRooms ?? [],
      pushActive:          portal?.pushActive ?? false,
      pendingUploadsCount: pendingUploadsResult.status === 'fulfilled' ? pendingUploadsResult.value  : 0,
    };
  }

  private async listPetitions(clientId: string): Promise<SavedPetition[]> {
    const { data, error } = await supabase
      .from('saved_petitions')
      .select('id, title, client_id, client_name, process_id, process_number, blocks_used, created_by, created_at, updated_at')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as SavedPetition[];
  }

  private async listCalendarEvents(clientId: string): Promise<CalendarEvent[]> {
    const { data, error } = await supabase.rpc('get_client_calendar_events', { p_client_id: clientId });
    if (error) throw new Error(error.message);
    return (data ?? []) as CalendarEvent[];
  }

  private async listProfileRequests(clientId: string): Promise<ProfileUpdateReq[]> {
    const { data } = await supabase.rpc('admin_list_profile_update_requests', {
      p_client_id: clientId,
      p_status: null,
    });
    return Array.isArray(data) ? (data as ProfileUpdateReq[]) : [];
  }

  private async loadPortalData(clientId: string): Promise<{
    portalUser: PortalUserSummary | null;
    chatRooms: ChatRoom[];
    pushActive: boolean;
  }> {
    const { data: cpu } = await supabase
      .from('client_portal_users')
      .select('id, auth_user_id, is_active, last_login_at, notifications_last_seen_at, created_at')
      .eq('client_id', clientId)
      .maybeSingle();

    if (!cpu) return { portalUser: null, chatRooms: [], pushActive: false };

    const [{ data: rooms }, { data: pushResult }] = await Promise.all([
      supabase
        .from('chat_rooms')
        .select('id, name, type, is_public, created_by, created_at, last_message_at, portal_client_id, session_start_at, accepted_by')
        .eq('type', 'portal_client')
        .eq('portal_client_id', (cpu as PortalUserSummary).id)
        .order('last_message_at', { ascending: false, nullsFirst: false }),
      supabase.rpc('admin_portal_push_active', { p_client_id: clientId }),
    ]);

    return {
      portalUser: cpu as PortalUserSummary,
      chatRooms:  (rooms as ChatRoom[]) ?? [],
      pushActive: pushResult === true,
    };
  }

  private async countPendingUploads(clientId: string): Promise<number> {
    const { count } = await supabase
      .from('document_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('review_status', 'pending')
      .eq('processing_status', 'ready');
    return count ?? 0;
  }
}

export const clientOverviewService = new ClientOverviewService();
