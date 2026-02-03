export interface TicketProjectRef {
  name?: string | null;
  key?: string | null;
}

export interface TicketIssueSummary {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  project?: TicketProjectRef | null;
  assignee?: string | null;
  createdAt?: string | null;
  type?: string | null;
  isReady?: boolean;
  deps?: string[];
  links?: string[];
}
