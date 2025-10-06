export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed';

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  client_id?: string | null;
  process_id?: string | null;
  user_id: string;
  position: number | null;
  completed_at?: string | null;
  completed_by?: string | null;
  completed_by_name?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskDTO {
  title: string;
  description?: string;
  due_date?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  client_id?: string;
  process_id?: string;
  position?: number;
  completed_at?: string;
  completed_by?: string | null;
  completed_by_name?: string | null;
  created_by_name?: string | null;
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string | null;
  due_date?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  client_id?: string | null;
  process_id?: string | null;
  completed_at?: string | null;
  position?: number | null;
  completed_by?: string | null;
  completed_by_name?: string | null;
  created_by_name?: string | null;
}
