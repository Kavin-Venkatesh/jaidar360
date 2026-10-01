// Node catalog shared by the editor, validator and compiler.

export const NODE_TYPES = [
  "trigger",
  "message",
  "buttons",
  "list",
  "question",
  "location",
  "locationLink",
  "media",
  "condition",
  "executeFlow",
  "end",
];

export const INPUT_TYPES = ["text", "number", "phone", "email", "date"];
export const MEDIA_ACCEPT = ["image", "document", "any"];
export const EXECUTE_MODES = ["jump", "call"];

export const CONDITION_OPERATORS = [
  { id: "equals", label: "equals", needsValue: true },
  { id: "not_equals", label: "does not equal", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "gt", label: ">", needsValue: true, numeric: true },
  { id: "gte", label: "≥", needsValue: true, numeric: true },
  { id: "lt", label: "<", needsValue: true, numeric: true },
  { id: "lte", label: "≤", needsValue: true, numeric: true },
  { id: "is_set", label: "is set", needsValue: false },
  { id: "is_empty", label: "is empty", needsValue: false },
];

// Nodes with exactly one input and one output can be disabled; the compiler routes around them.
export const DISABLABLE_TYPES = new Set(["message", "question", "location", "locationLink", "media"]);

// Variables the runtime always provides, usable as {{agent.name}} etc.
export const BUILT_IN_VARIABLES = ["agent.name", "agent.team", "agent.phone", "tenant.name"];
export const RESERVED_VAR_ROOTS = new Set(["agent", "tenant", "flow", "session"]);
export const VAR_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// Source handle IDs for each output of a node. `null` is the single unnamed output.
export function outputHandles(node) {
  const data = node?.data || {};
  switch (node?.type) {
    case "trigger":
    case "message":
    case "question":
    case "location":
    case "locationLink":
    case "media":
      return [null];
    case "buttons":
      return (data.buttons || []).map((b) => b.id);
    case "list":
      return listRows(data).map((r) => r.id);
    case "condition":
      return ["true", "false"];
    case "executeFlow":
      return data.mode === "call" ? [null] : [];
    default:
      return [];
  }
}

export function hasInput(type) {
  return type !== "trigger";
}

export function listRows(data) {
  return (data?.sections || []).flatMap((s) => s.rows || []);
}

export function savedVariable(node) {
  if (node?.data?.disabled) return null;
  if (["buttons", "list", "question", "location", "locationLink", "media"].includes(node?.type)) {
    const name = String(node.data?.saveAs || "").trim();
    return name || null;
  }
  return null;
}

export function normalizeKeyword(keyword) {
  return String(keyword ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeHandle(handle) {
  return handle === undefined || handle === "" ? null : handle;
}

// `{{customer_name}}`, `{{agent.name}}`, `{{visit_location.address}}`
export const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export function lookupPath(scope, path) {
  let value = scope;
  for (const key of String(path).split(".")) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

export function renderTemplate(text, scope) {
  return String(text ?? "").replace(TEMPLATE_PATTERN, (_, path) => {
    const value = lookupPath(scope, path);
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return value.address || value.name || value.title || "";
    return String(value);
  });
}
