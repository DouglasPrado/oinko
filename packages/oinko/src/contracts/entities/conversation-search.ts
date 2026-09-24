/** Speakers whose messages are searchable. Tool output and system text never are. */
export type ConversationSearchRole = 'user' | 'assistant';

export interface ConversationSearchQuery {
  /**
   * Plain words, already cleaned by the caller. Stores match them as literals,
   * never as query syntax. Empty means "no text filter": list by time.
   */
  terms: readonly string[];
  /** Every term must appear, or any of them. */
  match: 'all' | 'any';
  roles: readonly ConversationSearchRole[];
  /** Epoch ms, inclusive. */
  after?: number;
  /** Epoch ms, exclusive. */
  before?: number;
  limit: number;
  offset: number;
  /** Size of the excerpt around the match, in characters. */
  snippetChars: number;
}

export interface ConversationSearchHit {
  /** Stays with the host: the search tool never shows it to the model. */
  threadId: string;
  role: ConversationSearchRole;
  createdAt: number;
  /** A short excerpt, matched words between « and ». */
  snippet: string;
}

export interface ConversationSearchPage {
  hits: ConversationSearchHit[];
  hasMore: boolean;
}

/**
 * The threads a turn may read, given the thread it runs in — which comes from
 * the executor, never from the model. Default: that thread alone.
 */
export type ConversationSearchScope = (threadId: string) => readonly string[];
