import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../lib/logger';
import type { TicketIssueSummary } from '../../renderer/types/ticket';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Validate ticket ID format to prevent command injection.
 * Ticket IDs should be alphanumeric with dashes/underscores only.
 */
function isValidTicketId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export interface TicketConnectionStatus {
  connected: boolean;
  error?: string;
}

interface RawTicket {
  id: string;
  status?: string;
  priority?: string;
  title?: string;
  deps?: string[];
  links?: string[];
  created?: string;
  type?: string;
  assignee?: string;
}

export class TicketService {
  /**
   * Check if the ticket CLI is installed
   */
  async checkConnection(): Promise<TicketConnectionStatus> {
    try {
      const cmd = process.platform === 'win32' ? 'where ticket' : 'which ticket';
      await execAsync(cmd);
      return { connected: true };
    } catch {
      return { connected: false, error: 'ticket CLI not found' };
    }
  }

  /**
   * Parse NDJSON output from `ticket query` into an array of raw ticket objects
   */
  parseNDJSON(output: string): RawTicket[] {
    const lines = output.trim().split('\n').filter(Boolean);
    const tickets: RawTicket[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RawTicket;
        if (parsed && parsed.id) {
          tickets.push(parsed);
        }
      } catch (e) {
        log.debug(`Failed to parse ticket NDJSON line: ${line}`);
      }
    }
    return tickets;
  }

  /**
   * Parse `ticket ready` output to extract IDs of ready (unblocked) tickets
   * Format: "ID [P#][status] - [project] Title"
   */
  parseReadyIds(output: string): Set<string> {
    const ids = new Set<string>();
    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      // Each line starts with the ticket ID
      const match = line.match(/^(\S+)\s+/);
      if (match) {
        ids.add(match[1]);
      }
    }
    return ids;
  }

  /**
   * Extract project name from [project] prefix in title
   */
  extractProject(title: string): { project: string | null; cleanTitle: string } {
    const match = title.match(/^\[([^\]]+)\]\s*/);
    if (match) {
      return {
        project: match[1],
        cleanTitle: title.slice(match[0].length),
      };
    }
    return { project: null, cleanTitle: title };
  }

  /**
   * Normalize priority from "2" to "P2" format
   */
  normalizePriority(priority: string | undefined): string | null {
    if (!priority) return null;
    const num = parseInt(priority, 10);
    if (!isNaN(num) && num >= 0 && num <= 4) {
      return `P${num}`;
    }
    // If already in P# format
    if (/^P\d$/.test(priority)) {
      return priority;
    }
    return priority;
  }

  /**
   * Convert a raw ticket to TicketIssueSummary format
   */
  normalize(raw: RawTicket, readyIds: Set<string>): TicketIssueSummary {
    const { project, cleanTitle } = this.extractProject(raw.title || '');
    return {
      id: raw.id,
      title: cleanTitle,
      status: raw.status || null,
      priority: this.normalizePriority(raw.priority),
      project: project ? { name: project, key: project } : null,
      assignee: raw.assignee || null,
      createdAt: raw.created || null,
      type: raw.type || null,
      isReady: readyIds.has(raw.id),
      deps: raw.deps || [],
      links: raw.links || [],
    };
  }

  /**
   * Fetch tickets, marking ready ones first
   */
  async initialFetch(limit = 50): Promise<TicketIssueSummary[]> {
    try {
      const [queryResult, readyResult] = await Promise.all([
        execAsync('ticket query'),
        execAsync('ticket ready').catch(() => ({ stdout: '' })),
      ]);

      const readyIds = this.parseReadyIds(readyResult.stdout);
      const rawTickets = this.parseNDJSON(queryResult.stdout);
      const normalized = rawTickets.map((t) => this.normalize(t, readyIds));

      // Sort: ready tickets first, then by creation date (newest first)
      normalized.sort((a, b) => {
        if (a.isReady && !b.isReady) return -1;
        if (!a.isReady && b.isReady) return 1;
        // Secondary sort by creation date (descending)
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });

      return normalized.slice(0, limit);
    } catch (error) {
      log.error('Failed to fetch tickets:', error);
      throw error;
    }
  }

  /**
   * Search tickets by ID, project, or title
   */
  async searchIssues(searchTerm: string, limit = 20): Promise<TicketIssueSummary[]> {
    const term = (searchTerm || '').trim().toLowerCase();
    if (!term) return [];

    try {
      const tickets = await this.initialFetch(200); // Fetch more for local filtering
      const filtered = tickets.filter((ticket) => {
        // Search in ID
        if (ticket.id.toLowerCase().includes(term)) return true;
        // Search in title
        if (ticket.title.toLowerCase().includes(term)) return true;
        // Search in project name
        if (ticket.project?.name?.toLowerCase().includes(term)) return true;
        // Search in assignee
        if (ticket.assignee?.toLowerCase().includes(term)) return true;
        return false;
      });

      return filtered.slice(0, limit);
    } catch (error) {
      log.error('Failed to search tickets:', error);
      return [];
    }
  }

  /**
   * Get detailed ticket information by ID
   * Parses the YAML frontmatter from `ticket show` output
   */
  async getTicketDetails(id: string): Promise<TicketIssueSummary | null> {
    if (!isValidTicketId(id)) {
      log.error(`Invalid ticket ID format: ${id}`);
      return null;
    }

    try {
      const { stdout } = await execFileAsync('ticket', ['show', id]);
      return this.parseTicketShow(id, stdout);
    } catch (error) {
      log.error(`Failed to get ticket details for ${id}:`, error);
      return null;
    }
  }

  /**
   * Parse `ticket show` output which contains YAML frontmatter and markdown body
   */
  parseTicketShow(id: string, output: string): TicketIssueSummary | null {
    if (!output.trim()) return null;

    const lines = output.split('\n');
    let inFrontmatter = false;
    const frontmatterLines: string[] = [];
    const bodyLines: string[] = [];
    let pastFrontmatter = false;

    for (const line of lines) {
      if (line.trim() === '---') {
        if (!inFrontmatter && !pastFrontmatter) {
          inFrontmatter = true;
          continue;
        } else if (inFrontmatter) {
          inFrontmatter = false;
          pastFrontmatter = true;
          continue;
        }
      }
      if (inFrontmatter) {
        frontmatterLines.push(line);
      } else if (pastFrontmatter) {
        bodyLines.push(line);
      }
    }

    // Parse frontmatter (simple YAML-like parsing)
    const data: Record<string, string | string[]> = {};
    for (const line of frontmatterLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        // Handle array values like "deps: []" or "deps: [a, b]"
        if (value.startsWith('[') && value.endsWith(']')) {
          const inner = value.slice(1, -1).trim();
          data[key] = inner ? inner.split(',').map((s) => s.trim()) : [];
        } else {
          data[key] = value;
        }
      }
    }

    // Extract title from first non-empty body line (usually "# [project] Title")
    let title = '';
    let description = '';
    for (const line of bodyLines) {
      const trimmed = line.trim();
      if (!title && trimmed.startsWith('# ')) {
        title = trimmed.slice(2).trim();
      } else if (title && trimmed) {
        description += (description ? '\n' : '') + trimmed;
      }
    }

    const { project, cleanTitle } = this.extractProject(title);

    return {
      id,
      title: cleanTitle || title,
      description: description || null,
      status: (data.status as string) || null,
      priority: this.normalizePriority(data.priority as string),
      project: project ? { name: project, key: project } : null,
      assignee: (data.assignee as string) || null,
      createdAt: (data.created as string) || null,
      type: (data.type as string) || null,
      isReady: false, // Will be determined separately if needed
      deps: Array.isArray(data.deps) ? data.deps : [],
      links: Array.isArray(data.links) ? data.links : [],
    };
  }
}

export const ticketService = new TicketService();
