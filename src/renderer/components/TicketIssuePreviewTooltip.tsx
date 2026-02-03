import React from 'react';
import { motion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { User, Folder, Ticket, AlertTriangle, Flag, Link2 } from 'lucide-react';
import type { TicketIssueSummary } from '../types/ticket';

type Props = {
  issue: TicketIssueSummary | null;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

const StatusPill = ({ status, isReady }: { status?: string | null; isReady?: boolean }) => {
  if (!status) return null;

  const getStatusColor = (statusName: string, ready?: boolean) => {
    const lowerStatus = statusName.toLowerCase();
    if (lowerStatus === 'closed' || lowerStatus === 'done' || lowerStatus === 'resolved') {
      return 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200';
    }
    if (
      lowerStatus === 'in_progress' ||
      lowerStatus === 'in-progress' ||
      lowerStatus === 'started'
    ) {
      return 'bg-blue-100/70 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200';
    }
    if (lowerStatus === 'blocked') {
      return 'bg-rose-100/70 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200';
    }
    if (ready) {
      return 'bg-amber-100/70 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200';
    }
    return 'bg-slate-100/70 text-slate-800 dark:bg-slate-500/10 dark:text-slate-200';
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] ${getStatusColor(status, isReady)}`}
    >
      {status}
    </span>
  );
};

const PriorityPill = ({ priority }: { priority?: string | null }) => {
  if (!priority) return null;

  const getPriorityColor = (p: string) => {
    // Strip leading P if present to get the numeric level
    const numericPart = p.startsWith('P') ? p.slice(1) : p;
    const level = parseInt(numericPart, 10);
    if (!isNaN(level)) {
      if (level === 1) return 'text-rose-600 dark:text-rose-400';
      if (level === 2) return 'text-amber-600 dark:text-amber-400';
      if (level === 3) return 'text-blue-600 dark:text-blue-400';
      return 'text-slate-500 dark:text-slate-400';
    }
    const lowerPriority = p.toLowerCase();
    if (lowerPriority === 'urgent' || lowerPriority === 'critical') {
      return 'text-rose-600 dark:text-rose-400';
    }
    if (lowerPriority === 'high') {
      return 'text-amber-600 dark:text-amber-400';
    }
    return 'text-slate-500 dark:text-slate-400';
  };

  // Display priority as-is since normalizePriority already formats it as "P#"
  return (
    <span className={`inline-flex items-center gap-1 ${getPriorityColor(priority)}`}>
      <Flag className="h-3 w-3" />
      <span>{priority}</span>
    </span>
  );
};

export const TicketIssuePreviewTooltip: React.FC<Props> = ({ issue, children, side = 'top' }) => {
  if (!issue) return children;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          className="border-0 bg-transparent p-0 shadow-none"
          style={{ zIndex: 10000 }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="min-w-[260px] max-w-sm rounded-lg border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Ticket className="h-4 w-4" />
                <span className="tracking-wide">Local Ticket</span>
                <span className="font-semibold text-muted-foreground/80">{issue.id}</span>
              </div>
              {issue.isReady && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Ready
                </span>
              )}
            </div>

            <div className="mt-1 line-clamp-2 text-sm font-semibold text-foreground">
              {issue.title || `Ticket ${issue.id}`}
            </div>

            {issue.description && (
              <div className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                {issue.description}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusPill status={issue.status} isReady={issue.isReady} />

              <PriorityPill priority={issue.priority} />

              {issue.assignee && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  <span>{issue.assignee}</span>
                </span>
              )}

              {issue.project?.name && (
                <span className="inline-flex items-center gap-1">
                  <Folder className="h-3 w-3" />
                  <span>{issue.project.name}</span>
                </span>
              )}

              {issue.type && (
                <span className="inline-flex items-center gap-1 rounded bg-slate-100/70 px-1.5 py-0.5 text-[10px] dark:bg-slate-500/10">
                  {issue.type}
                </span>
              )}
            </div>

            {(issue.deps?.length ?? 0) > 0 && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                <span>Blocked by: {issue.deps?.join(', ')}</span>
              </div>
            )}

            {(issue.links?.length ?? 0) > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 className="h-3 w-3" />
                <span>Links: {issue.links?.join(', ')}</span>
              </div>
            )}
          </motion.div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default TicketIssuePreviewTooltip;
