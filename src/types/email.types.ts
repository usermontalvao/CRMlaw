export type EmailDirection = 'inbound' | 'outbound';

export type EmailFolder = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash';

export interface EmailAttachmentMeta {
  filename?: string;
  content_type?: string;
  size?: number;
  path?: string;
}

export interface EmailMessage {
  id: string;
  direction: EmailDirection;
  mailbox: string;
  message_id: string;
  in_reply_to: string | null;
  email_references: string | null;
  thread_key: string | null;
  subject: string | null;
  from_address: string | null;
  from_text: string | null;
  to_text: string | null;
  cc_text: string | null;
  bcc_text: string | null;
  is_draft: boolean;
  body_text: string | null;
  body_html: string | null;
  attachments: EmailAttachmentMeta[];
  sent_at: string | null;
  client_id: string | null;
  sender_user_id: string | null;
  assigned_user_id: string | null;
  is_read: boolean;
  is_spam: boolean;
  is_trash: boolean;
  spam_score: number | null;
  spam_reason: string | null;
  spam_checked: boolean;
  created_at: string;
}

export interface EmailSignature {
  user_id: string;
  name: string | null;
  signature_text: string | null;
  signature_html: string | null;
  use_html: boolean;
  updated_at?: string;
}

export type SpamRuleKind = 'whitelist' | 'blocklist';
export type SpamRuleMatch = 'address' | 'domain' | 'from_regex' | 'subject_regex' | 'body_regex';

export interface EmailSpamRule {
  id: string;
  kind: SpamRuleKind;
  match_type: SpamRuleMatch;
  value: string;
  enabled: boolean;
  note: string | null;
  created_at: string;
}

export interface SendAttachment {
  filename: string;
  content: string; // base64
  contentType?: string;
}

export interface SendEmailDTO {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  threadKey?: string;
  clientId?: string;
  attachments?: SendAttachment[];
}
