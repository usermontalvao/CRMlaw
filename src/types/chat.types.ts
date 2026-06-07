export type ChatRoomType = 'team' | 'dm' | 'portal_client';
export type ChatRoomMemberRole = 'member' | 'admin';

export interface ChatRoom {
  id: string;
  name: string;
  type: ChatRoomType;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message_preview?: string | null;
  portal_client_id?: string | null;
  session_start_at?: string | null;
  accepted_by?: string | null;
}

export interface PortalChatMessage {
  id: string;
  content: string;
  created_at: string;
  from_client: boolean;
  is_system?: boolean;
  sender_name?: string | null;
}

export interface ChatRoomMember {
  room_id: string;
  user_id: string;
  role: ChatRoomMemberRole;
  joined_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  reply_to: string | null;
  deleted_at: string | null;
  is_system?: boolean;
}

export interface ChatReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}
