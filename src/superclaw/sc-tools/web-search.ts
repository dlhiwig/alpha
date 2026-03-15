/**
 * Web Search Tool - Brave Search API Integration
 * SuperClaw Phase 2 implementation
 */

import fetch from 'node-fetch';
import type { AgentContext } from '../standalone/agent/executor';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
}

export interface WebSearchResponse {
  success: boolean;
  results?: WebSearchResult[];
  error?: string;
  query?: string;
  count?: number;
  total_results?: number;
}

export interface WebSearchArgs {
  query: string;
  count?: number;
  country?: string;
  freshness?: string;
}

export class WebSearchTool {
  name = 'web_search';
  description = 'Search the web using Brave Search API';
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      count: { 
        type: 'number', 
        description: 'Number of results (1-10)', 
        default: 5, 
        minimum: 1, 
        maximum: 10 
      },
      country: { 
        type: 'string', 
        description: 'Country code for region-specific results (e.g., US, DE, ALL)', 
        default: 'US' 
      },
      freshness: {
        type: 'string',
        description: 'Filter by discovery time: pd (past day), pw (past week), pm (past month), py (past year)',
        enum: ['pd', 'pw', 'pm', 'py']
      }
    },
    required: ['query']
  };

  private readonly apiKey = 'BSA3vtICKAiQcIsJr79JKhuhrVRWymz';
  private readonly baseUrl = 'https://api.search.brave.com/res/v1/web/search';

  async execute(args: WebSearchArgs, context: AgentContext): Promise<WebSearchResponse> {
    try {
      const { query, count = 5, country = 'US', freshness } = args;

      // Build search URL with parameters
      const params = new URLSearchParams({
        q: query,
        count: Math.min(Math.max(count, 1), 10).toString(),
        country,
        safesearch: 'moderate',
        search_lang: 'en',
        ui_lang: 'en-US'
      });

      if (freshness) {
        params.append('freshness', freshness);
      }

      const url = `${this.baseUrl}?${params}`;

      // Make API request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
          'User-Agent': 'SuperClaw/0.2.0 (Web Search Tool)'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Brave API error ${response.status}: ${errorText}`);
      }

      const data = await response.json() as any;

      // Extract results from Brave API response
      const webResults = data.web?.results || [];
      const results: WebSearchResult[] = webResults.map((item: any) => ({
        title: item.title || 'No title',
        url: item.url || '',
        snippet: item.description || '',
        published_date: item.published_date || undefined
      }));

      return {
        success: true,
        results,
        query,
        count: results.length,
        total_results: data.web?.total_results || results.length
      };

    } catch (error: unknown) {
      console.error('Web search error:', error);
      return {
        success: false,
        error: error instanceof Error ? (error).message : 'Unknown search error'
      };
    }
  }
}