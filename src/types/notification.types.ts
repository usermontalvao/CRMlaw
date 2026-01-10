export type NotificationCategory =
  | 'deadline'
  | 'hearing'
  | 'djen'
  | 'intimation'
  | 'system'
  | 'mention'
  | 'feed';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  description?: string;
  createdAt: string;
  read: boolean;
  metadata?: Record<string, unknown>;
}
