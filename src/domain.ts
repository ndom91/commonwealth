export type Role = "reader" | "writer" | "reviewer" | "admin";
export type Actor = { id: string; workspaceId: string; name: string; role: Role; autoApprove: boolean };
export type Authority = "canonical" | "approved" | "unverified";
export type SourceType = "note" | "upload";

export type SearchInput = {
  query: string;
  tags: string[];
  limit: number;
  sourceType?: SourceType;
  authority?: Authority;
  authorId?: string;
  updatedAfter?: string;
  explain: boolean;
};
