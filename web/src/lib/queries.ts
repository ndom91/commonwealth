import { queryOptions } from '@tanstack/react-query';
import { listConcepts, searchConcepts } from './concepts.js';

export type ConceptFilters = {
  authority?: 'unverified' | 'approved' | 'canonical';
  query?: string;
  type?: string;
};

export function conceptQueryKey(project: string) {
  return ['projects', project, 'concepts'] as const;
}

export function conceptRegisterQuery(project: string, filters: ConceptFilters) {
  return queryOptions({
    queryKey: [...conceptQueryKey(project), filters],
    // MCP writes bypass the browser, so refresh the active register whenever
    // its reader returns to this window, even inside the normal stale window.
    refetchOnWindowFocus: 'always',
    queryFn: () =>
      filters.query
        ? searchConcepts({
            data: {
              project,
              authority: filters.authority,
              type: filters.type,
              query: filters.query,
            },
          })
        : listConcepts({
            data: { project, authority: filters.authority, type: filters.type },
          }),
  });
}
