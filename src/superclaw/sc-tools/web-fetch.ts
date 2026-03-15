// @ts-nocheck
/**
 * Web Fetch Tool - URL Content Extraction
 * SuperClaw Phase 2 implementation
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
// @ts-expect-error - Post-Merge Reconciliation
import TurndownService from 'turndown';
import type { AgentContext } from '../standalone/agent/executor';

export interface WebFetchResponse {
  success: boolean;
  content?: string;
  title?: string;
  url?: string;
  content_type?: string;
  length?: number;
  error?: string;
}

export interface WebFetchArgs {
  url: string;
  extract_mode?: 'markdown' | 'text';
  max_chars?: number;
  timeout?: number;
}

export class WebFetchTool {
  name = 'web_fetch';
  description = 'Fetch and extract readable content from a URL';
  parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
      extract_mode: { 
        type: 'string', 
        description: 'Content extraction mode', 
        enum: ['markdown', 'text'], 
        default: 'markdown' 
      },
      max_chars: { 
        type: 'number', 
        description: 'Maximum characters to return (truncates when exceeded)', 
        default: 50000,
        maximum: 200000
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in seconds',
        default: 15,
        maximum: 60
      }
    },
    required: ['url']
  };

  private turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });
    
    // Remove script and style elements
    this.turndown.remove(['script', 'style', 'nav', 'header', 'footer', 'aside']);
  }

  async execute(args: WebFetchArgs, context: AgentContext): Promise<WebFetchResponse> {
    try {
      const { 
        url, 
        extract_mode = 'markdown', 
        max_chars = 50000,
        timeout = 15
      } = args;

      // Validate URL
      if (!this.isValidUrl(url)) {
        throw new Error('Invalid URL format');
      }

      // Fetch the URL with proper headers
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'SuperClaw/0.2.0 (Web Fetch Tool; +https://github.com/dlhiwig/superclaw)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive'
        }
        // Note: node-fetch doesn't support timeout in the options, would need AbortController for timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      
      // Check if it's HTML content
      if (!contentType.includes('text/html')) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const html = await response.text();
      
      // Parse with Cheerio
      const $ = cheerio.load(html);
      
      // Extract title
      const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';
      
      // Remove unwanted elements
      $('script, style, nav, header, footer, aside, .nav, .navigation, .menu, .sidebar, .ads, .advertisement').remove();
      $('[class*="nav"], [class*="menu"], [class*="sidebar"], [class*="ad"], [id*="nav"], [id*="menu"]').remove();
      
      // Get main content - try various selectors
      let contentElement = $('main, article, .content, .post, .entry, #content, #main').first();
      if (!contentElement.length) {
        contentElement = $('body');
      }

      let content = '';
      
      if (extract_mode === 'markdown') {
        // Convert to markdown
        const htmlContent = contentElement.html() || '';
        content = this.turndown.turndown(htmlContent);
        
        // Clean up markdown
        content = content
          .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
          .replace(/^\s+|\s+$/g, '') // Trim whitespace
          .replace(/\[(\s*)\]/g, '') // Remove empty links
          .trim();
        
      } else {
        // Extract plain text
        content = contentElement.text()
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/\n\s*\n/g, '\n') // Remove empty lines
          .trim();
      }

      // Truncate if too long
      if (content.length > max_chars) {
        content = content.substring(0, max_chars) + '\n\n[Content truncated...]';
      }

      return {
        success: true,
        content,
        title,
        url: response.url, // Final URL after redirects
        content_type: contentType,
        length: content.length
      };

    } catch (error: unknown) {
      console.error('Web fetch error:', error);
      return {
        success: false,
        error: error instanceof Error ? (error).message : 'Unknown fetch error'
      };
    }
  }

  private isValidUrl(string: string): boolean {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}