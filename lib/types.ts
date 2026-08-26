export interface Company {
  id: number;
  slug: string;
  name: string;
  status_key: string;
  status_note: string | null;
  industry: string | null;
  size: string | null;
  hq: string | null;
  website: string | null;
  revenue_stage: string | null;
  business_context: string | null;
  relationship_intel: string | null;
  engagement_strategy: string | null;
  extra_sections: string | null;
  notes: string | null;
  last_touch: string | null;
  next_action: string | null;
}

export interface Person {
  id: number;
  slug: string;
  name: string;
  status_key: string;
  status_note: string | null;
  role_title: string | null;
  company_id: number | null;
  company_note: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  relationship_strength: string | null;
  relationship_intel: string | null;
  business_context: string | null;
  engagement_strategy: string | null;
  extra_sections: string | null;
  notes: string | null;
  last_touch: string | null;
  next_action: string | null;
  cadence_days: number | null;
  tags: string | null;
}

export interface PersonWithCompany extends Person {
  company_name: string | null;
  company_slug: string | null;
}

export interface Interaction {
  id: number;
  person_id: number | null;
  company_id: number | null;
  date: string;
  channel: string | null;
  summary: string;
}

export interface ActionItem {
  id: number;
  bucket: string;
  due_label: string | null;
  title: string;
  detail: string | null;
  person_id: number | null;
  company_id: number | null;
  source: string | null;
  status: string;
  completed_at: string | null;
}

export interface ActionItemJoined extends ActionItem {
  person_name: string | null;
  person_slug: string | null;
  company_name: string | null;
  company_slug: string | null;
}

export interface Opportunity {
  id: number;
  name: string;
  kind: string;
  stage: string;
  person_id: number | null;
  company_id: number | null;
  value_note: string | null;
  priority: number;
  next_step: string | null;
  notes: string | null;
  updated_at: string;
}

export interface OpportunityJoined extends Opportunity {
  person_name: string | null;
  person_slug: string | null;
  company_name: string | null;
  company_slug: string | null;
}

export interface FollowUp {
  id: number;
  slug: string;
  name: string;
  status_key: string;
  status_note: string | null;
  company_name: string | null;
  company_slug: string | null;
  relationship_strength: string | null;
  tags: string | null;
  last_touch: string | null;
  next_action: string | null;
  cadence_days: number | null;
  days_since: number | null; // null = never touched / unparseable date
  days_over: number | null; // positive = overdue for a touch
}

export interface Outreach {
  id: number;
  person_id: number | null;
  date: string | null;
  topic: string | null;
  title: string | null;
  body: string | null;
  status: string;
}
