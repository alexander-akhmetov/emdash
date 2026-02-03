import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';
import { Search, Ticket } from 'lucide-react';
import { type TicketIssueSummary } from '../types/ticket';
import { Separator } from './ui/separator';
import { Spinner } from './ui/spinner';
import { TicketIssuePreviewTooltip } from './TicketIssuePreviewTooltip';

interface Props {
  selectedIssue: TicketIssueSummary | null;
  onIssueChange: (issue: TicketIssueSummary | null) => void;
  isOpen?: boolean;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

const TicketIssueSelector: React.FC<Props> = ({
  selectedIssue,
  onIssueChange,
  isOpen = false,
  className = '',
  disabled = false,
  placeholder: customPlaceholder,
}) => {
  const [availableIssues, setAvailableIssues] = useState<TicketIssueSummary[]>([]);
  const [isLoadingIssues, setIsLoadingIssues] = useState(false);
  const [issueListError, setIssueListError] = useState<string | null>(null);
  const [hasRequestedIssues, setHasRequestedIssues] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<TicketIssueSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const isMountedRef = useRef(true);
  const searchRequestIdRef = useRef(0);
  const [visibleCount, setVisibleCount] = useState(10);

  const canList = typeof window !== 'undefined' && !!window.electronAPI?.ticketInitialFetch;
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const isDisabled =
    disabled ||
    isConnected !== true ||
    isLoadingIssues ||
    !!issueListError;

  useEffect(() => () => void (isMountedRef.current = false), []);

  useEffect(() => {
    if (!isOpen) {
      setAvailableIssues([]);
      setHasRequestedIssues(false);
      setIssueListError(null);
      setIsLoadingIssues(false);
      setSearchTerm('');
      setSearchResults([]);
      setIsSearching(false);
      onIssueChange(null);
      setVisibleCount(10);
    }
  }, [isOpen, onIssueChange]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const api = window.electronAPI;
        const res = await api?.ticketCheckConnection?.();
        if (!cancel) setIsConnected(!!res?.connected);
      } catch {
        if (!cancel) setIsConnected(null);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const loadIssues = useCallback(async () => {
    if (!canList) return;
    const api = window.electronAPI;
    if (!api?.ticketInitialFetch) {
      setAvailableIssues([]);
      setIssueListError('Local ticket CLI unavailable.');
      setHasRequestedIssues(true);
      return;
    }
    setIsLoadingIssues(true);
    try {
      const result = await api.ticketInitialFetch(50);
      if (!isMountedRef.current) return;
      if (!result?.success) throw new Error(result?.error || 'Failed to load tickets.');
      setAvailableIssues(result.issues ?? []);
      setIssueListError(null);
    } catch (error) {
      if (!isMountedRef.current) return;
      setAvailableIssues([]);
      setIssueListError(error instanceof Error ? error.message : 'Failed to load tickets.');
    } finally {
      if (!isMountedRef.current) return;
      setIsLoadingIssues(false);
      setHasRequestedIssues(true);
    }
  }, [canList]);

  useEffect(() => {
    if (!isOpen || !canList || isLoadingIssues || hasRequestedIssues) return;
    loadIssues();
  }, [isOpen, canList, isLoadingIssues, hasRequestedIssues, loadIssues]);

  const searchIssues = useCallback(async (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const api = window.electronAPI;
    if (!api?.ticketSearchIssues) return;

    // Increment request ID to track this search request
    const requestId = ++searchRequestIdRef.current;
    setIsSearching(true);

    try {
      const result = await api.ticketSearchIssues(term.trim(), 20);
      // Only apply results if this is still the latest request
      if (!isMountedRef.current || requestId !== searchRequestIdRef.current) return;
      setSearchResults(result?.success ? (result.issues ?? []) : []);
      if (result?.success) {
        void (async () => {
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('ticket_issues_searched');
        })();
      }
    } catch {
      if (isMountedRef.current && requestId === searchRequestIdRef.current) {
        setSearchResults([]);
      }
    } finally {
      if (isMountedRef.current && requestId === searchRequestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void searchIssues(searchTerm), 250);
    return () => clearTimeout(t);
  }, [searchTerm, searchIssues]);

  const showIssues = useMemo(() => {
    const source = searchTerm.trim() ? searchResults : availableIssues;
    return source.slice(0, visibleCount);
  }, [availableIssues, searchResults, searchTerm, visibleCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) {
      setVisibleCount((c) =>
        Math.min(c + 10, (searchTerm.trim() ? searchResults : availableIssues).length)
      );
    }
  };

  const handleIssueSelect = (id: string) => {
    if (id === '__clear__') {
      onIssueChange(null);
      return;
    }
    const all = searchTerm.trim() ? searchResults : availableIssues;
    const issue = all.find((i) => i.id === id) || null;
    if (issue) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('ticket_issue_selected');
      })();
    }
    onIssueChange(issue);
  };

  if (!canList) {
    return (
      <div className={className}>
        <Input value="" placeholder="Local ticket CLI unavailable" disabled />
        <p className="mt-2 text-xs text-muted-foreground">
          Install the ticket CLI to browse local tickets.
        </p>
      </div>
    );
  }

  const issuePlaceholder =
    customPlaceholder ??
    (isLoadingIssues
      ? 'Loading…'
      : issueListError
        ? 'Install ticket CLI'
        : 'Select a local ticket');

  return (
    <div className={`min-w-0 max-w-full overflow-hidden ${className}`} style={{ maxWidth: '100%' }}>
      <Select
        value={selectedIssue?.id || undefined}
        onValueChange={handleIssueSelect}
        disabled={isDisabled}
      >
        <SelectTrigger
          className="h-9 w-full overflow-hidden border-none bg-muted"
          style={{ maxWidth: '100%' }}
        >
          <div className="flex w-full items-center gap-2 overflow-hidden text-left text-foreground">
            {selectedIssue ? (
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <TicketIssuePreviewTooltip issue={selectedIssue}>
                  <span
                    className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Ticket className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="text-[11px] font-medium text-foreground">
                      {selectedIssue.id}
                    </span>
                  </span>
                </TicketIssuePreviewTooltip>
                {selectedIssue.title ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    <span className="text-foreground">-</span>
                    <span className="truncate text-muted-foreground">{selectedIssue.title}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <Ticket className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="truncate text-muted-foreground">{issuePlaceholder}</span>
              </>
            )}
          </div>
        </SelectTrigger>
        <SelectContent side="top" className="z-[120] w-full max-w-[480px]">
          <div className="relative px-3 py-2">
            <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by ID, project, or title"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={disabled}
              className="h-7 w-full border-none bg-transparent pl-9 pr-3 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto overflow-x-hidden py-1" onScroll={handleScroll}>
            <SelectItem value="__clear__">
              <span className="text-sm text-muted-foreground">None</span>
            </SelectItem>
            <Separator className="my-1" />
            {showIssues.length > 0 ? (
              showIssues.map((issue) => (
                <TicketIssuePreviewTooltip key={issue.id} issue={issue} side="left">
                  <SelectItem value={issue.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-muted px-1.5 py-0.5 dark:border-border dark:bg-card">
                        <Ticket className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-[11px] font-medium text-foreground">{issue.id}</span>
                        {issue.isReady && (
                          <span className="ml-0.5 rounded bg-emerald-100/70 px-1 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                            Ready
                          </span>
                        )}
                      </span>
                      {issue.title ? (
                        <span className="truncate text-foreground">{issue.title}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                </TicketIssuePreviewTooltip>
              ))
            ) : searchTerm.trim() ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {isSearching ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span>Searching…</span>
                  </div>
                ) : (
                  `No tickets found for "${searchTerm}"`
                )}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">No tickets available</div>
            )}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
};

export default TicketIssueSelector;
