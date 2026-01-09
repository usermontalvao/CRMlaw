export type ChatRoomType = 'team' | 'dm';
export type ChatRoomMemberRole = 'member' | 'admin';

export interface ChatRoom {
  id: string;
  name: string;
  type: ChatRoomType;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
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
}
