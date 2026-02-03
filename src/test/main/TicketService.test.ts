import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'util';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecOptions = Record<string, unknown>;
type ExecFileCallback = (
  error: Error | null,
  stdout: string | Buffer,
  stderr: string | Buffer
) => void;

const mockTickets = [
  {
    id: 'emd-abc1',
    status: 'open',
    priority: '2',
    title: '[emdash] Test ticket one',
    deps: [],
    links: [],
  },
  {
    id: 'emd-xyz2',
    status: 'in_progress',
    priority: '1',
    title: '[emdash] Test ticket two',
    deps: ['emd-abc1'],
    links: [],
  },
  {
    id: 'other-123',
    status: 'open',
    priority: '3',
    title: '[other-project] Another ticket',
    deps: [],
    links: ['emd-abc1'],
  },
];

const mockReadyOutput = `emd-abc1 [P2][open] - [emdash] Test ticket one\n`;

const mockShowOutput = `---
id: emd-abc1
status: open
priority: 2
deps: []
links: []
created: 2026-02-01T10:00:00Z
type: feature
assignee: Alexander
---
# [emdash] Test ticket one

This is the ticket description.

## Details
More information here.
`;

const execCalls: string[] = [];
let ticketCLIExists = true;
let ticketQueryFails = false;

vi.mock('child_process', () => {
  const execImpl = (
    command: string,
    options?: ExecOptions | ExecCallback,
    callback?: ExecCallback
  ) => {
    const cb = typeof options === 'function' ? options : callback;
    execCalls.push(command);

    const respond = (stdout: string, error: Error | null = null) => {
      setImmediate(() => {
        cb?.(error, stdout, '');
      });
    };

    if (command === 'which ticket') {
      if (ticketCLIExists) {
        respond('/usr/local/bin/ticket');
      } else {
        respond('', new Error('not found'));
      }
    } else if (command === 'ticket query') {
      if (ticketQueryFails) {
        respond('', new Error('CLI error'));
      } else {
        respond(mockTickets.map((t) => JSON.stringify(t)).join('\n'));
      }
    } else if (command === 'ticket ready') {
      respond(mockReadyOutput);
    } else if (command.startsWith('ticket show ')) {
      const id = command.replace('ticket show ', '').trim();
      if (id === 'emd-abc1') {
        respond(mockShowOutput);
      } else {
        respond('', new Error(`ticket ${id} not found`));
      }
    } else {
      respond('');
    }

    return { kill: vi.fn() };
  };

  (
    execImpl as unknown as {
      [key: symbol]: (
        command: string,
        options?: ExecOptions
      ) => Promise<{ stdout: string; stderr: string }>;
    }
  )[promisify.custom] = (command: string, options?: ExecOptions) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execImpl(command, options, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };

  // Mock execFile for secure command execution (used by getTicketDetails)
  const execFileImpl = (
    file: string,
    args?: string[] | ExecFileCallback,
    options?: ExecOptions | ExecFileCallback,
    callback?: ExecFileCallback
  ) => {
    const actualArgs = Array.isArray(args) ? args : [];
    const cb =
      typeof args === 'function' ? args : typeof options === 'function' ? options : callback;
    const command = `${file} ${actualArgs.join(' ')}`.trim();
    execCalls.push(command);

    const respond = (stdout: string, error: Error | null = null) => {
      setImmediate(() => {
        cb?.(error, stdout, '');
      });
    };

    if (file === 'ticket' && actualArgs[0] === 'show') {
      const id = actualArgs[1];
      if (id === 'emd-abc1') {
        respond(mockShowOutput);
      } else {
        respond('', new Error(`ticket ${id} not found`));
      }
    } else {
      respond('');
    }

    return { kill: vi.fn() };
  };

  (
    execFileImpl as unknown as {
      [key: symbol]: (
        file: string,
        args?: string[],
        options?: ExecOptions
      ) => Promise<{ stdout: string; stderr: string }>;
    }
  )[promisify.custom] = (file: string, args?: string[], _options?: ExecOptions) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileImpl(
        file,
        args,
        (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      );
    });
  };

  return {
    exec: execImpl,
    execFile: execFileImpl,
  };
});

// eslint-disable-next-line import/first
import { TicketService } from '../../main/services/TicketService';

describe('TicketService', () => {
  let service: TicketService;

  beforeEach(() => {
    execCalls.length = 0;
    ticketCLIExists = true;
    ticketQueryFails = false;
    service = new TicketService();
  });

  describe('checkConnection', () => {
    it('returns connected=true when ticket CLI exists', async () => {
      const result = await service.checkConnection();

      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();
      expect(execCalls).toContain('which ticket');
    });

    it('returns connected=false when ticket CLI does not exist', async () => {
      ticketCLIExists = false;
      const result = await service.checkConnection();

      expect(result.connected).toBe(false);
      expect(result.error).toBe('ticket CLI not found');
    });
  });

  describe('parseNDJSON', () => {
    it('parses valid NDJSON output', () => {
      const input = '{"id":"t1","title":"Test"}\n{"id":"t2","title":"Test 2"}\n';
      const result = service.parseNDJSON(input);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('t1');
      expect(result[1].id).toBe('t2');
    });

    it('skips invalid JSON lines', () => {
      const input = '{"id":"t1","title":"Test"}\ninvalid-json\n{"id":"t2","title":"Test 2"}';
      const result = service.parseNDJSON(input);

      expect(result).toHaveLength(2);
    });

    it('handles empty input', () => {
      const result = service.parseNDJSON('');
      expect(result).toHaveLength(0);
    });
  });

  describe('parseReadyIds', () => {
    it('extracts IDs from ticket ready output', () => {
      const input = 'emd-abc1 [P2][open] - Title\nemd-xyz2 [P1][open] - Title 2\n';
      const result = service.parseReadyIds(input);

      expect(result.has('emd-abc1')).toBe(true);
      expect(result.has('emd-xyz2')).toBe(true);
      expect(result.size).toBe(2);
    });

    it('handles empty input', () => {
      const result = service.parseReadyIds('');
      expect(result.size).toBe(0);
    });
  });

  describe('extractProject', () => {
    it('extracts project from [project] prefix', () => {
      const result = service.extractProject('[emdash] Test title');

      expect(result.project).toBe('emdash');
      expect(result.cleanTitle).toBe('Test title');
    });

    it('returns null project when no prefix', () => {
      const result = service.extractProject('Test title without project');

      expect(result.project).toBeNull();
      expect(result.cleanTitle).toBe('Test title without project');
    });
  });

  describe('normalizePriority', () => {
    it('converts numeric priority to P# format', () => {
      expect(service.normalizePriority('2')).toBe('P2');
      expect(service.normalizePriority('1')).toBe('P1');
    });

    it('returns null for undefined', () => {
      expect(service.normalizePriority(undefined)).toBeNull();
    });

    it('returns P# format as-is', () => {
      expect(service.normalizePriority('P3')).toBe('P3');
    });

    it('returns raw string for invalid priority values', () => {
      expect(service.normalizePriority('invalid')).toBe('invalid');
      expect(service.normalizePriority('-1')).toBe('-1');
      expect(service.normalizePriority('P99')).toBe('P99');
    });

    it('returns null for empty string', () => {
      expect(service.normalizePriority('')).toBeNull();
    });

    it('only converts valid priorities 0-4', () => {
      expect(service.normalizePriority('0')).toBe('P0');
      expect(service.normalizePriority('4')).toBe('P4');
      expect(service.normalizePriority('5')).toBe('5');
      expect(service.normalizePriority('10')).toBe('10');
    });
  });

  describe('normalize', () => {
    it('converts raw ticket to TicketIssueSummary', () => {
      const raw = { id: 'emd-abc1', status: 'open', priority: '2', title: '[emdash] Test ticket' };
      const readyIds = new Set(['emd-abc1']);

      const result = service.normalize(raw, readyIds);

      expect(result.id).toBe('emd-abc1');
      expect(result.title).toBe('Test ticket');
      expect(result.project?.name).toBe('emdash');
      expect(result.status).toBe('open');
      expect(result.priority).toBe('P2');
      expect(result.isReady).toBe(true);
    });

    it('sets isReady=false when not in readyIds', () => {
      const raw = { id: 'emd-xyz2', status: 'blocked', title: 'Test' };
      const readyIds = new Set(['emd-abc1']);

      const result = service.normalize(raw, readyIds);

      expect(result.isReady).toBe(false);
    });
  });

  describe('initialFetch', () => {
    it('fetches and sorts tickets with ready first', async () => {
      const result = await service.initialFetch(50);

      expect(result).toHaveLength(3);
      // First ticket should be the "ready" one (emd-abc1)
      expect(result[0].id).toBe('emd-abc1');
      expect(result[0].isReady).toBe(true);
      // Non-ready tickets follow
      expect(result[1].isReady).toBe(false);
      expect(result[2].isReady).toBe(false);
    });

    it('respects limit parameter', async () => {
      const result = await service.initialFetch(2);

      expect(result).toHaveLength(2);
    });

    it('throws error when CLI fails', async () => {
      ticketQueryFails = true;

      await expect(service.initialFetch(50)).rejects.toThrow('CLI error');
    });
  });

  describe('searchIssues', () => {
    it('searches by ID', async () => {
      const result = await service.searchIssues('emd-abc1');

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((t) => t.id === 'emd-abc1')).toBe(true);
    });

    it('searches by project name', async () => {
      const result = await service.searchIssues('emdash');

      expect(result.length).toBe(2);
      expect(result.every((t) => t.project?.name === 'emdash')).toBe(true);
    });

    it('returns empty array for empty search term', async () => {
      const result = await service.searchIssues('');

      expect(result).toHaveLength(0);
    });

    it('returns empty array for no matches', async () => {
      const result = await service.searchIssues('nonexistent-query-xyz');

      expect(result).toHaveLength(0);
    });

    it('returns empty array when CLI fails', async () => {
      ticketQueryFails = true;

      const result = await service.searchIssues('emd-abc1');

      expect(result).toHaveLength(0);
    });
  });

  describe('getTicketDetails', () => {
    it('parses ticket show output correctly', async () => {
      const result = await service.getTicketDetails('emd-abc1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('emd-abc1');
      expect(result?.title).toBe('Test ticket one');
      expect(result?.project?.name).toBe('emdash');
      expect(result?.status).toBe('open');
      expect(result?.priority).toBe('P2');
      expect(result?.assignee).toBe('Alexander');
      expect(result?.type).toBe('feature');
      expect(result?.description).toContain('ticket description');
    });

    it('sets isReady to false since ready status is determined separately', async () => {
      const result = await service.getTicketDetails('emd-abc1');

      expect(result).not.toBeNull();
      expect(result?.isReady).toBe(false);
    });

    it('returns null for non-existent ticket', async () => {
      const result = await service.getTicketDetails('nonexistent-id');

      expect(result).toBeNull();
    });

    it('returns null for invalid ticket ID format (command injection attempt)', async () => {
      const result = await service.getTicketDetails('foo; rm -rf /');

      expect(result).toBeNull();
    });

    it('returns null for ticket ID with shell metacharacters', async () => {
      const result = await service.getTicketDetails('$(whoami)');

      expect(result).toBeNull();
    });

    it('accepts valid alphanumeric IDs with dashes and underscores', async () => {
      // Valid format but non-existent - should return null from CLI, not from validation
      const result = await service.getTicketDetails('valid_id-123');

      // This will return null because the ticket doesn't exist, but it passed validation
      expect(result).toBeNull();
    });
  });

  describe('parseTicketShow', () => {
    it('handles empty output', () => {
      const result = service.parseTicketShow('test-id', '');

      expect(result).toBeNull();
    });

    it('parses array fields correctly', () => {
      const output = `---
id: test
deps: [a, b, c]
links: []
---
# Test
`;
      const result = service.parseTicketShow('test', output);

      expect(result?.deps).toEqual(['a', 'b', 'c']);
      expect(result?.links).toEqual([]);
    });
  });
});

// IPC Handler Tests
describe('ticketIpc handlers', () => {
  let mockIpcMain: {
    handle: ReturnType<typeof vi.fn>;
    handlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  };

  beforeEach(() => {
    execCalls.length = 0;
    ticketCLIExists = true;
    ticketQueryFails = false;

    // Create a mock ipcMain that captures handlers
    mockIpcMain = {
      handlers: new Map(),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        mockIpcMain.handlers.set(channel, handler);
      }),
    };

    // Mock electron module
    vi.doMock('electron', () => ({
      ipcMain: mockIpcMain,
    }));
  });

  async function getIpcHandler(channel: string) {
    // Clear module cache to get fresh registration
    vi.resetModules();

    // Re-mock child_process for fresh import
    vi.doMock('child_process', () => {
      const execImpl = (
        command: string,
        options?: ExecOptions | ExecCallback,
        callback?: ExecCallback
      ) => {
        const cb = typeof options === 'function' ? options : callback;
        execCalls.push(command);

        const respond = (stdout: string, error: Error | null = null) => {
          setImmediate(() => {
            cb?.(error, stdout, '');
          });
        };

        if (command === 'which ticket' || command === 'where ticket') {
          if (ticketCLIExists) {
            respond('/usr/local/bin/ticket');
          } else {
            respond('', new Error('not found'));
          }
        } else if (command === 'ticket query') {
          if (ticketQueryFails) {
            respond('', new Error('CLI error'));
          } else {
            respond(mockTickets.map((t) => JSON.stringify(t)).join('\n'));
          }
        } else if (command === 'ticket ready') {
          respond(mockReadyOutput);
        } else {
          respond('');
        }

        return { kill: vi.fn() };
      };

      (
        execImpl as unknown as {
          [key: symbol]: (
            command: string,
            options?: ExecOptions
          ) => Promise<{ stdout: string; stderr: string }>;
        }
      )[promisify.custom] = (command: string, options?: ExecOptions) => {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execImpl(command, options, (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
      };

      const execFileImpl = (
        file: string,
        args?: string[] | ExecFileCallback,
        options?: ExecOptions | ExecFileCallback,
        callback?: ExecFileCallback
      ) => {
        const actualArgs = Array.isArray(args) ? args : [];
        const cb =
          typeof args === 'function' ? args : typeof options === 'function' ? options : callback;
        const command = `${file} ${actualArgs.join(' ')}`.trim();
        execCalls.push(command);

        const respond = (stdout: string, error: Error | null = null) => {
          setImmediate(() => {
            cb?.(error, stdout, '');
          });
        };

        if (file === 'ticket' && actualArgs[0] === 'show') {
          const id = actualArgs[1];
          if (id === 'emd-abc1') {
            respond(mockShowOutput);
          } else {
            respond('', new Error(`ticket ${id} not found`));
          }
        } else {
          respond('');
        }

        return { kill: vi.fn() };
      };

      (
        execFileImpl as unknown as {
          [key: symbol]: (
            file: string,
            args?: string[],
            options?: ExecOptions
          ) => Promise<{ stdout: string; stderr: string }>;
        }
      )[promisify.custom] = (file: string, args?: string[], _options?: ExecOptions) => {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execFileImpl(
            file,
            args,
            (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
              if (err) reject(err);
              else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
            }
          );
        });
      };

      return { exec: execImpl, execFile: execFileImpl };
    });

    // Re-mock electron
    vi.doMock('electron', () => ({
      ipcMain: mockIpcMain,
    }));

    // Import and register
    const { registerTicketIpc } = await import('../../main/ipc/ticketIpc');
    registerTicketIpc();

    return mockIpcMain.handlers.get(channel);
  }

  describe('ticket:checkConnection', () => {
    it('returns connected status', async () => {
      const handler = await getIpcHandler('ticket:checkConnection');
      const result = await handler?.({});

      expect(result).toEqual({ connected: true });
    });

    it('returns disconnected when CLI not found', async () => {
      ticketCLIExists = false;
      const handler = await getIpcHandler('ticket:checkConnection');
      const result = await handler?.({});

      expect(result).toEqual({ connected: false, error: 'ticket CLI not found' });
    });
  });

  describe('ticket:initialFetch', () => {
    it('returns issues on success', async () => {
      const handler = await getIpcHandler('ticket:initialFetch');
      const result = (await handler?.({}, 50)) as { success: boolean; issues?: unknown[] };

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(3);
    });

    it('uses default limit when not provided', async () => {
      const handler = await getIpcHandler('ticket:initialFetch');
      const result = (await handler?.({}, undefined)) as { success: boolean; issues?: unknown[] };

      expect(result.success).toBe(true);
    });

    it('handles invalid limit gracefully', async () => {
      const handler = await getIpcHandler('ticket:initialFetch');
      const result = (await handler?.({}, NaN)) as { success: boolean; issues?: unknown[] };

      expect(result.success).toBe(true);
    });

    it('returns error when CLI fails', async () => {
      ticketQueryFails = true;
      const handler = await getIpcHandler('ticket:initialFetch');
      const result = (await handler?.({}, 50)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('CLI error');
    });
  });

  describe('ticket:searchIssues', () => {
    it('returns matching issues', async () => {
      const handler = await getIpcHandler('ticket:searchIssues');
      const result = (await handler?.({}, 'emdash', 20)) as {
        success: boolean;
        issues?: unknown[];
      };

      expect(result.success).toBe(true);
      expect(result.issues?.length).toBeGreaterThan(0);
    });

    it('returns error for null search term', async () => {
      const handler = await getIpcHandler('ticket:searchIssues');
      const result = (await handler?.({}, null, 20)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search term is required.');
    });

    it('returns error for undefined search term', async () => {
      const handler = await getIpcHandler('ticket:searchIssues');
      const result = (await handler?.({}, undefined, 20)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search term is required.');
    });

    it('returns error for empty string search term', async () => {
      const handler = await getIpcHandler('ticket:searchIssues');
      const result = (await handler?.({}, '', 20)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search term is required.');
    });

    it('returns error for non-string search term', async () => {
      const handler = await getIpcHandler('ticket:searchIssues');
      const result = (await handler?.({}, 123, 20)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search term is required.');
    });
  });

  describe('ticket:getDetails', () => {
    it('returns ticket details for valid ID', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, 'emd-abc1')) as {
        success: boolean;
        issue?: { id: string };
      };

      expect(result.success).toBe(true);
      expect(result.issue?.id).toBe('emd-abc1');
    });

    it('returns error for null ID', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, null)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket ID is required.');
    });

    it('returns error for undefined ID', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, undefined)) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket ID is required.');
    });

    it('returns error for invalid ID format (command injection)', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, 'foo; rm -rf /')) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid ticket ID format.');
    });

    it('returns error for ID with shell metacharacters', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, '$(whoami)')) as { success: boolean; error?: string };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid ticket ID format.');
    });

    it('returns error for non-existent ticket', async () => {
      const handler = await getIpcHandler('ticket:getDetails');
      const result = (await handler?.({}, 'nonexistent-id')) as {
        success: boolean;
        error?: string;
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ticket nonexistent-id not found.');
    });
  });
});
