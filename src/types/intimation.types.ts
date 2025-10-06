export interface Intimation {
  id: string;
  process_id: string;
  diary_name: string;
  publication_date: string;
  content: string;
  raw_data: any;
  status: 'pending' | 'read' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface ProcessTracking {
  id: string;
  process_id: string;
  last_check_date: string;
  next_check_date: string | null;
  check_frequency_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IntimationFilters {
  process_id?: string;
  status?: 'pending' | 'read' | 'archived';
  date_from?: string;
  date_to?: string;
  search?: string;
}
