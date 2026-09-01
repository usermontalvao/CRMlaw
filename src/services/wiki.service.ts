import { supabase } from '../config/supabase';

export type WikiNoteType = 'info' | 'warning' | 'success' | 'danger';

export interface WikiLink {
  label: string;
  href: string;
  description?: string;
}

export interface WikiStep {
  title: string;
  description: string;
  action?: string;
  expected?: string;
  links?: WikiLink[];
}

export interface WikiCommand {
  label: string;
  value: string;
  expected?: string;
}

export interface WikiNote {
  type: WikiNoteType;
  title: string;
  text: string;
}

export interface WikiArticleSection {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: WikiStep[];
  checklist?: string[];
  commands?: WikiCommand[];
  notes?: WikiNote[];
  links?: WikiLink[];
}

export interface WikiArticleBody {
  version: number;
  introduction?: string;
  prerequisites?: string[];
  sections: WikiArticleSection[];
}

export interface WikiCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  sort_order: number;
}

export interface WikiArticleSummary {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  difficulty: string;
  estimated_minutes: number;
  tags: string[];
  sort_order: number;
  updated_at: string;
}

export interface WikiArticle extends WikiArticleSummary {
  body: WikiArticleBody;
}

const throwIfError = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'Não foi possível carregar a Central de ajuda.');
};

export const wikiService = {
  async listCategories(): Promise<WikiCategory[]> {
    const { data, error } = await supabase
      .from('wiki_categories')
      .select('id, slug, name, description, icon_key, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    throwIfError(error);
    return (data ?? []) as WikiCategory[];
  },

  async listArticles(): Promise<WikiArticleSummary[]> {
    const { data, error } = await supabase
      .from('wiki_articles')
      .select('id, category_id, slug, title, summary, audience, difficulty, estimated_minutes, tags, sort_order, updated_at')
      .eq('is_published', true)
      .order('sort_order', { ascending: true });
    throwIfError(error);
    return (data ?? []) as WikiArticleSummary[];
  },

  async getArticle(slug: string): Promise<WikiArticle> {
    const { data, error } = await supabase
      .from('wiki_articles')
      .select('id, category_id, slug, title, summary, audience, difficulty, estimated_minutes, tags, sort_order, updated_at, body')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();
    throwIfError(error);
    return data as WikiArticle;
  },
};

