import { getDb } from "./db";

/** A CRM change the coach proposed during a session, awaiting (or past) the owner's review. */
export interface CoachProposal {
  id: number;
  session_id: number;
  message_id: number | null;
  kind: "complete" | "create";
  action_id: number | null;
  title: string;
  bucket: string | null;
  due_label: string | null;
  person_slug: string | null;
  status: "pending" | "applied" | "rejected";
  created_at: string;
  resolved_at: string | null;
}

export function loadProposals(sessionId: number): CoachProposal[] {
  return getDb()
    .prepare(`SELECT * FROM coach_proposals WHERE session_id=? ORDER BY id`)
    .all(sessionId) as CoachProposal[];
}

