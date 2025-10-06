import { supabase } from '../config/supabase';
import { profileService } from './profile.service';
import type { Task, CreateTaskDTO, UpdateTaskDTO } from '../types/task.types';

export const taskService = {
  async listTasks(): Promise<Task[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .order('position', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getTask(id: string): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  async createTask(task: CreateTaskDTO): Promise<Task> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    // Remove campos vazios de UUIDs e timestamps
    const profile = await profileService.getProfile(user.id).catch(() => null);
    const creatorName =
      profile?.name?.trim() || user.user_metadata?.full_name?.trim() || user.email || 'usuário';
    const status = task.status ?? 'pending';
    const completionNameSource =
      profile?.name?.trim() || user.user_metadata?.full_name?.trim() || user.email || 'usuário';

    const cleanTask: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'user_id'> & { user_id: string } = {
      title: task.title,
      description: task.description || null,
      due_date: task.due_date && task.due_date.trim() !== '' ? task.due_date : null,
      priority: task.priority || 'medium',
      status,
      client_id: task.client_id && task.client_id.trim() !== '' ? task.client_id : null,
      process_id: task.process_id && task.process_id.trim() !== '' ? task.process_id : null,
      position: task.position ?? null,
      completed_at:
        status === 'completed'
          ? task.completed_at ?? new Date().toISOString()
          : null,
      completed_by: status === 'completed' ? task.completed_by ?? user.id : null,
      completed_by_name:
        status === 'completed'
          ? task.completed_by_name ?? completionNameSource
          : null,
      created_by_name: task.created_by_name ?? creatorName,
      user_id: user.id,
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        ...cleanTask,
        position: cleanTask.position ?? Date.now(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateTask(id: string, updates: UpdateTaskDTO): Promise<Task> {
    // Remove campos vazios de UUIDs
    const cleanUpdates: UpdateTaskDTO = {
      ...updates,
      description: updates.description !== undefined ? updates.description || null : undefined,
      due_date: updates.due_date !== undefined
        ? (updates.due_date && updates.due_date.trim() !== '' ? updates.due_date : null)
        : undefined,
      client_id: updates.client_id !== undefined 
        ? (updates.client_id && updates.client_id.trim() !== '' ? updates.client_id : null)
        : undefined,
      process_id: updates.process_id !== undefined
        ? (updates.process_id && updates.process_id.trim() !== '' ? updates.process_id : null)
        : undefined,
      completed_at: updates.completed_at !== undefined ? updates.completed_at || null : undefined,
      position: updates.position ?? undefined,
      completed_by: updates.completed_by ?? undefined,
      completed_by_name: updates.completed_by_name ?? undefined,
    };

    const { data, error } = await supabase
      .from('tasks')
      .update(cleanUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async toggleTaskStatus(id: string): Promise<Task> {
    const task = await this.getTask(id);
    if (!task) throw new Error('Tarefa não encontrada');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');
    const profile = await profileService.getProfile(user.id).catch(() => null);
    const completionNameSource =
      profile?.name?.trim() || user.user_metadata?.full_name?.trim() || user.email || 'usuário';

    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    const updates: UpdateTaskDTO = {
      status: newStatus,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
      position: newStatus === 'completed' ? null : task.position ?? Date.now(),
      completed_by: newStatus === 'completed' ? user.id : null,
      completed_by_name:
        newStatus === 'completed'
          ? completionNameSource
          : null,
    };

    return this.updateTask(id, updates);
  },

  async deleteTask(id: string): Promise<void> {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async updateTaskPositions(updates: { id: string; position: number }[]): Promise<void> {
    if (updates.length === 0) return;

    const { error } = await supabase
      .from('tasks')
      .upsert(updates, { onConflict: 'id' });

    if (error) throw error;
  },
};
