import type { Edge, Node, Viewport } from "@xyflow/react";

export type NodeType =
  | "trigger"
  | "message"
  | "buttons"
  | "list"
  | "question"
  | "location"
  | "media"
  | "condition"
  | "executeFlow"
  | "end";

// Node data is edited through many small forms; keep it loose and let the shared validator enforce shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeData = { label?: string; disabled?: boolean; [key: string]: any };
export type FlowNode = Node<NodeData, NodeType>;
export type FlowEdge = Edge;

export interface Option {
  id: string;
  title: string;
  description?: string;
}

export interface Section {
  id: string;
  title: string;
  rows: Option[];
}

export interface Rule {
  id: string;
  variable: string;
  operator: string;
  value: string;
}

export interface Canvas {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: Viewport;
}

export type FlowStatus = "draft" | "active" | "inactive";

export interface FlowSummary {
  id: string;
  name: string;
  isEntry: boolean;
  status: FlowStatus;
  activeVersion: number | null;
  revision: number;
  publishedRevision: number | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface FlowDetail extends FlowSummary {
  draft: Canvas;
}

export interface Problem {
  nodeId: string | null;
  field: string | null;
  message: string;
  severity: "error" | "warning";
}

export interface TenantFlowInfo {
  id: string;
  name: string;
  isEntry: boolean;
  status: FlowStatus;
  activeVersion: number | null;
  keywords: string[];
  calls: string[];
  jumps: string[];
  saves: string[];
}

export interface ValidationContext {
  flowId: string;
  isEntry: boolean;
  tenantFlows: TenantFlowInfo[];
}

export interface LinkableFlow {
  id: string;
  name: string;
  isEntry: boolean;
  activeVersion: number | null;
}

export interface Tenant {
  id: string;
  name: string;
  whatsappNumber: string;
  whatsappConnected: boolean;
  agents: { id: string; name: string; team: string; registered: boolean }[];
}

export interface Me {
  user: { username: string; name: string };
  tenant: Tenant;
}

export interface FlowVersionInfo {
  version: number;
  publishedAt: string;
  publishedBy: string;
}

export interface Submission {
  id: string;
  flowId: string;
  flowName: string;
  flowVersion: number;
  sessionId: string;
  agentId: string;
  agentName: string;
  agentTeam: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  status: string;
  agentId: string;
  agentName: string;
  agentTeam: string | null;
  frames: { flowId: string; flowName: string; version: number; nodeId: string | null; nodeLabel: string; waiting: string | null }[];
  vars: Record<string, unknown>;
  lastError: string | null;
  expiresAt: string;
  updatedAt: string;
  createdAt: string;
}
