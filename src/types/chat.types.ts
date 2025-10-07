// Chat Module Types
// Para remover: delete este arquivo

export type MessageType = 'text' | 'image' | 'file' | 'audio' | 'video';
export type CallType = 'audio' | 'video';
export type CallStatus = 'initiated' | 'ringing' | 'answered' | 'ended' | 'missed' | 'rejected';

export interface Conversation {
  id: string;
  name: string | null;
  is_group: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  message_type: MessageType;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  reply_to: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface CallSession {
  id: string;
  conversation_id: string;
  caller_id: string;
  call_type: CallType;
  status: CallStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

// DTOs para criação
export interface CreateConversationDTO {
  name?: string | null;
  is_group?: boolean;
  participant_ids: string[]; // IDs dos usuários participantes
}

export interface CreateMessageDTO {
  conversation_id: string;
  content?: string | null;
  message_type?: MessageType;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  reply_to?: string | null;
}

export interface UpdateMessageDTO {
  content?: string;
  is_edited?: boolean;
}

export interface CreateCallSessionDTO {
  conversation_id: string;
  call_type: CallType;
}

export interface UpdateCallSessionDTO {
  status?: CallStatus;
  ended_at?: string;
  duration_seconds?: number;
}

// Extended types com dados relacionados
export interface ConversationWithParticipants extends Conversation {
  participants?: ConversationParticipant[];
  last_message?: Message;
  unread_count?: number;
}

export interface MessageWithSender extends Message {
  sender_name?: string;
  sender_avatar?: string;
  read_by?: MessageRead[];
}

// WebRTC signaling types
export interface RTCSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-end';
  from: string;
  to: string;
  conversation_id: string;
  call_session_id?: string;
  data?: any;
}

export interface CallState {
  active: boolean;
  type: CallType | null;
  conversation_id: string | null;
  call_session_id: string | null;
  is_caller: boolean;
  remote_user_id: string | null;
}
