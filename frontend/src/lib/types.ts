export type ProspectStatus = 'new' | 'contacted' | 'responded' | 'converted' | 'rejected' | 'inactive';
export type Channel = 'email' | 'form' | 'sns_twitter' | 'sns_linkedin';
export type OutreachStatus = 'sent' | 'failed';
export type Sentiment = 'positive' | 'neutral' | 'negative';
export type ResponseType = 'reply' | 'auto_reply' | 'bounce' | 'meeting_request' | 'rejection';
export type OutboundMode = 'send' | 'draft';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnsAccounts {
  x?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
}

export interface Prospect {
  ppId: number;
  prospectId: number;
  name: string;
  contactName: string | null;
  overview: string;
  industry: string | null;
  websiteUrl: string;
  email: string | null;
  contactFormUrl: string | null;
  formType: string | null;
  snsAccounts: SnsAccounts | null;
  doNotContact: boolean;
  notes: string | null;
  matchReason: string;
  priority: number;
  status: ProspectStatus;
  organizationId: number;
  organizationName: string;
  createdAt: string;
}

export interface OutreachLog {
  id: number;
  prospectId: number;
  channel: Channel;
  subject: string | null;
  body: string;
  status: OutreachStatus;
  sentAt: string;
  errorMessage: string | null;
}

export interface ResponseRecord {
  id: number;
  channel: Channel;
  content: string;
  sentiment: Sentiment;
  responseType: ResponseType;
  receivedAt: string;
  prospectId: number;
  prospectName: string;
  outreachSubject: string | null;
}

export interface EvaluationMetrics {
  totalOutreach: number;
  channelCounts: Array<{ channel: string; count: number }>;
  responseCounts: { totalResponses: number; uniqueResponders: number };
  sentimentBreakdown: Array<{ sentiment: string; responseType: string; count: number }>;
  priorityResponseRate: Array<{ priority: number; total: number; responses: number; rate: number }>;
  statusCounts: Array<{ status: string; count: number }>;
  channelResponseRate: Array<{ channel: string; total: number; responses: number; rate: number }>;
}

export interface Evaluation {
  id: number;
  evaluationDate: string;
  findings: string;
  improvements: string;
}

export interface DocumentSummary {
  slug: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: number;
  slug?: string;
  content: string;
  createdAt: string;
}

export interface ProjectStats {
  metrics: EvaluationMetrics;
  respondedMessages: Array<Record<string, unknown>>;
  noResponseSample: Array<Record<string, unknown>>;
  dataSufficiency: { sufficient: boolean; totalSent: number; daysSinceLastSend: number | null };
}

export type PlanTier = 'free' | 'starter' | 'pro' | 'scale' | 'unlimited';

export interface QuotaUsage {
  used: number;
  remaining: number;
  limit: number | null;
}

export interface PlanInfo {
  plan: PlanTier;
  limits: {
    maxProjects: number | null;
    maxOutreachPerMonth: number | null;
    maxProspects: number | null;
    isLifetime: boolean;
  };
  outreach: QuotaUsage;
  prospects?: QuotaUsage;
}
