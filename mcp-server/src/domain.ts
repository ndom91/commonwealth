export type Role = 'reader' | 'writer' | 'reviewer' | 'admin';
export type Actor = {
  id: string;
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  role: Role;
  autoApprove: boolean;
};
export type Authority = 'canonical' | 'approved' | 'unverified';

export type SearchInput = {
  query: string;
  tags: string[];
  limit: number;
  authority?: Authority;
  authorId?: string;
  updatedAfter?: string;
  explain: boolean;
};
