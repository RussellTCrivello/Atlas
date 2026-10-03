// Search for the command palette: tasks and projects by full-text index, people by name.
import type { ServiceContext } from './context'

export class SearchService {
  constructor(private ctx: ServiceContext) {}

  search(query: string, limit = 8) {
    const hits = this.ctx.repos.search.search(query, Math.min(Math.max(1, limit), 25))
    return { query, hits }
  }
}
