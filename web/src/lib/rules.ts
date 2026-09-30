// Typed façade over the rules shared with the server (../shared/flow-rules), so the editor's counters,
// Problems bar and publish-time validation on the server always agree.
import * as shared from "@shared/index.mjs";
import type { Canvas, FlowNode, NodeType, Problem, ValidationContext } from "./types";

export const LIMITS = shared.LIMITS as Record<keyof typeof shared.LIMITS, number>;
export const textLength: (value: unknown) => number = shared.textLength;
export const CONDITION_OPERATORS = shared.CONDITION_OPERATORS as { id: string; label: string; needsValue: boolean; numeric?: boolean }[];
export const INPUT_TYPES = shared.INPUT_TYPES as string[];
export const DISABLABLE_TYPES = shared.DISABLABLE_TYPES as Set<string>;
export const BUILT_IN_VARIABLES = shared.BUILT_IN_VARIABLES as string[];
export const VAR_NAME_PATTERN = shared.VAR_NAME_PATTERN as RegExp;

export const outputHandles: (node: Pick<FlowNode, "type" | "data">) => (string | null)[] = shared.outputHandles;
export const savedVariable: (node: Pick<FlowNode, "type" | "data">) => string | null = shared.savedVariable;
export const normalizeKeyword: (value: string) => string = shared.normalizeKeyword;

export function validateFlow(canvas: Pick<Canvas, "nodes" | "edges">, ctx: Partial<ValidationContext>): Problem[] {
  return shared.validateFlow(canvas, ctx) as Problem[];
}

export function isNodeType(value: string): value is NodeType {
  return (shared.NODE_TYPES as string[]).includes(value);
}
