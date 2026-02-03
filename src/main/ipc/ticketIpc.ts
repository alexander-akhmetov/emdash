import { ipcMain } from 'electron';
import { ticketService } from '../services/TicketService';

export function registerTicketIpc() {
  ipcMain.handle('ticket:checkConnection', async () => {
    return ticketService.checkConnection();
  });

  ipcMain.handle('ticket:initialFetch', async (_event, limit?: number) => {
    try {
      const issues = await ticketService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : 50
      );
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to fetch tickets.';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('ticket:searchIssues', async (_event, searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }

    try {
      const issues = await ticketService.searchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to search tickets.';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('ticket:getDetails', async (_event, id: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: 'Ticket ID is required.' };
    }

    // Validate ID format at IPC boundary
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return { success: false, error: 'Invalid ticket ID format.' };
    }

    try {
      const issue = await ticketService.getTicketDetails(id);
      if (!issue) {
        return { success: false, error: `Ticket ${id} not found.` };
      }
      return { success: true, issue };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unable to get ticket details for ${id}.`;
      return { success: false, error: message };
    }
  });
}

export default registerTicketIpc;
