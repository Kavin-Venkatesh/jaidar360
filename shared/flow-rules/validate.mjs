// Flow validation shared by the editor (live Problems bar) and the server (validate + publish).
//
// validateFlow(canvas, ctx) -> [{ nodeId, field, message, severity: "error" | "warning" }]
//
// ctx = {
//   flowId, isEntry,
//   tenantFlows: [{ id, name, isEntry, status, activeVersion, keywords: [], calls: [], saves: [] }]
//     (every flow of the tenant; keywords/calls/saves come from the active compiled version)
// }

import { LIMITS, textLength } from "./limits.mjs";
import {
  CONDITION_OPERATORS,
  DISABLABLE_TYPES,
  EXECUTE_MODES,
  INPUT_TYPES,
  MEDIA_ACCEPT,
  NODE_TYPES,
  RESERVED_VAR_ROOTS,
  VAR_NAME_PATTERN,
  listRows,
  normalizeHandle,
  normalizeKeyword,
  outputHandles,
  savedVariable,
} from "./nodes.mjs";
import { indexCanvas, reachableFrom } from "./graph.mjs";

const OPERATORS = new Map(CONDITION_OPERATORS.map((o) => [o.id, o]));

export function hasErrors(problems) {
  return problems.some((p) => p.severity === "error");
}

export function validateFlow(canvas, ctx = {}) {
  const problems = [];
  const add = (severity, message, nodeId = null, field = null) => problems.push({ severity, message, nodeId, field });
  const error = (message, nodeId, field) => add("error", message, nodeId, field);
  const warning = (message, nodeId, field) => add("warning", message, nodeId, field);

  const index = indexCanvas(canvas);
  const { nodes, edges, byId } = index;
  const tenantFlows = ctx.tenantFlows || [];
  const flowsById = new Map(tenantFlows.map((f) => [f.id, f]));
  const title = (node) => node.data?.label || node.type;

  const requireText = (node, field, value, max, name) => {
    const len = textLength(value);
    if (!String(value ?? "").trim()) error(`${name} is required.`, node.id, field);
    else if (len > max) error(`${name} is ${len} characters (max ${max}).`, node.id, field);
  };
  const optionalText = (node, field, value, max, name) => {
    const len = textLength(value);
    if (len > max) error(`${name} is ${len} characters (max ${max}).`, node.id, field);
  };

  // ---- Flow level --------------------------------------------------------
  for (const node of nodes) {
    if (!NODE_TYPES.includes(node.type)) error(`Unknown node type "${node.type}".`, node.id);
  }

  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) error("Add a Trigger node: every flow starts with one.");
  for (const extra of triggers.slice(1)) error("Only one Trigger is allowed per flow.", extra.id);
  const trigger = triggers[0];

  if (ctx.isEntry) {
    const otherEntry = tenantFlows.find((f) => f.id !== ctx.flowId && f.isEntry);
    if (otherEntry) error(`"${otherEntry.name}" is already the entry flow. A tenant can have only one.`, trigger?.id, "isEntry");
  }

  if (trigger) {
    const keywords = (trigger.data?.keywords || []).map(normalizeKeyword);
    if (ctx.isEntry && !keywords.some(Boolean)) error("The entry flow needs at least one keyword (e.g. hi).", trigger.id, "keywords");
    if (keywords.length > LIMITS.maxKeywords) error(`At most ${LIMITS.maxKeywords} keywords.`, trigger.id, "keywords");
    const seen = new Set();
    for (const keyword of keywords) {
      if (!keyword) {
        error("Keywords can't be empty.", trigger.id, "keywords");
        continue;
      }
      if (textLength(keyword) > LIMITS.keyword) error(`Keyword "${keyword}" is too long (max ${LIMITS.keyword}).`, trigger.id, "keywords");
      if (seen.has(keyword)) error(`Keyword "${keyword}" is listed twice.`, trigger.id, "keywords");
      seen.add(keyword);
      const clash = tenantFlows.find((f) => f.id !== ctx.flowId && f.status === "active" && (f.keywords || []).includes(keyword));
      if (clash) error(`Keyword "${keyword}" is already used by active flow "${clash.name}".`, trigger.id, "keywords");
    }
  }

  // ---- Node fields -------------------------------------------------------
  const saveAsOwners = new Map();

  for (const node of nodes) {
    const d = node.data || {};
    if (d.label !== undefined && textLength(d.label) > LIMITS.label) error(`Node name is too long (max ${LIMITS.label}).`, node.id, "label");
    if (d.disabled && !DISABLABLE_TYPES.has(node.type)) error(`${title(node)} can't be disabled.`, node.id, "disabled");
    if (d.disabled) continue;

    const saveAs = savedVariable(node);
    if (["buttons", "list"].includes(node.type) && saveAs === null) {
      // optional for menus
    } else if (["question", "location", "locationLink", "media"].includes(node.type) && !saveAs) {
      error("\"Save as\" variable name is required.", node.id, "saveAs");
    }
    if (saveAs) {
      if (!VAR_NAME_PATTERN.test(saveAs) || saveAs.length > LIMITS.varName) {
        error(`"${saveAs}" must be snake_case (a-z, 0-9, _), starting with a letter.`, node.id, "saveAs");
      } else if (RESERVED_VAR_ROOTS.has(saveAs)) {
        error(`"${saveAs}" is reserved.`, node.id, "saveAs");
      } else if (saveAsOwners.has(saveAs)) {
        error(`Variable "${saveAs}" is already saved by "${title(byId.get(saveAsOwners.get(saveAs)))}".`, node.id, "saveAs");
      } else {
        saveAsOwners.set(saveAs, node.id);
      }
    }

    switch (node.type) {
      case "message":
        if (d.imageUrl) {
          if (!/^https:\/\/\S+$/i.test(d.imageUrl)) error("Image URL must be a public https:// link.", node.id, "imageUrl");
          optionalText(node, "text", d.text, LIMITS.imageCaption, "Caption");
        } else {
          requireText(node, "text", d.text, LIMITS.textBody, "Message");
        }
        break;

      case "buttons": {
        optionalText(node, "header", d.header, LIMITS.buttonHeader, "Header");
        requireText(node, "body", d.body, LIMITS.buttonBody, "Body");
        optionalText(node, "footer", d.footer, LIMITS.buttonFooter, "Footer");
        const buttons = d.buttons || [];
        if (buttons.length < 1) error("Add at least one button.", node.id, "buttons");
        if (buttons.length > LIMITS.maxButtons) error(`WhatsApp allows at most ${LIMITS.maxButtons} buttons. Convert to a List for more.`, node.id, "buttons");
        checkOptions(node, buttons, LIMITS.buttonTitle, "Button");
        break;
      }

      case "list": {
        optionalText(node, "header", d.header, LIMITS.listHeader, "Header");
        requireText(node, "body", d.body, LIMITS.listBody, "Body");
        optionalText(node, "footer", d.footer, LIMITS.listFooter, "Footer");
        requireText(node, "buttonLabel", d.buttonLabel, LIMITS.listButton, "Menu button label");
        const sections = d.sections || [];
        if (sections.length < 1) error("Add at least one section.", node.id, "sections");
        if (sections.length > LIMITS.maxSections) error(`At most ${LIMITS.maxSections} sections.`, node.id, "sections");
        sections.forEach((s, i) => {
          if (sections.length > 1) requireText(node, `sections.${i}.title`, s.title, LIMITS.sectionTitle, `Section ${i + 1} title`);
          else optionalText(node, `sections.${i}.title`, s.title, LIMITS.sectionTitle, "Section title");
        });
        const rows = listRows(d);
        if (rows.length < 1) error("Add at least one row.", node.id, "sections");
        if (rows.length > LIMITS.maxRows) error(`WhatsApp lists allow at most ${LIMITS.maxRows} rows in total.`, node.id, "sections");
        checkOptions(node, rows, LIMITS.rowTitle, "Row");
        rows.forEach((r) => optionalText(node, `row.${r.id}.description`, r.description, LIMITS.rowDescription, `Row "${r.title}" description`));
        break;
      }

      case "question": {
        requireText(node, "prompt", d.prompt, LIMITS.textBody, "Question");
        if (!INPUT_TYPES.includes(d.inputType)) error("Choose an input type.", node.id, "inputType");
        const v = d.validation || {};
        if (v.regex) {
          try {
            new RegExp(v.regex);
          } catch {
            error("Pattern is not a valid regular expression.", node.id, "validation.regex");
          }
        }
        const min = v.min === "" || v.min === undefined || v.min === null ? null : Number(v.min);
        const max = v.max === "" || v.max === undefined || v.max === null ? null : Number(v.max);
        if (Number.isNaN(min)) error("Minimum must be a number.", node.id, "validation.min");
        if (Number.isNaN(max)) error("Maximum must be a number.", node.id, "validation.max");
        if (min !== null && max !== null && min > max) error("Minimum is greater than maximum.", node.id, "validation.min");
        const attempts = Number(d.maxAttempts ?? 3);
        if (!Number.isInteger(attempts) || attempts < 1 || attempts > LIMITS.maxAttempts) {
          error(`Max attempts must be 1–${LIMITS.maxAttempts}.`, node.id, "maxAttempts");
        }
        optionalText(node, "errorMessage", d.errorMessage, LIMITS.textBody, "Error message");
        break;
      }

      case "location":
        requireText(node, "prompt", d.prompt, LIMITS.locationBody, "Prompt");
        break;

      case "locationLink": {
        requireText(node, "prompt", d.prompt, LIMITS.ctaBody, "Message");
        requireText(node, "buttonText", d.buttonText, LIMITS.ctaButton, "Button text");
        const minutes = Number(d.linkMinutes ?? 10);
        if (!Number.isInteger(minutes) || minutes < LIMITS.minLinkMinutes || minutes > LIMITS.maxLinkMinutes) {
          error(`Link validity must be ${LIMITS.minLinkMinutes}–${LIMITS.maxLinkMinutes} minutes.`, node.id, "linkMinutes");
        }
        break;
      }

      case "media":
        requireText(node, "prompt", d.prompt, LIMITS.textBody, "Prompt");
        if (!MEDIA_ACCEPT.includes(d.accept)) error("Choose what to accept.", node.id, "accept");
        break;

      case "condition": {
        const rules = d.rules || [];
        if (rules.length < 1) error("Add at least one rule.", node.id, "rules");
        if (rules.length > LIMITS.maxRules) error(`At most ${LIMITS.maxRules} rules.`, node.id, "rules");
        rules.forEach((rule, i) => {
          const op = OPERATORS.get(rule.operator);
          if (!String(rule.variable || "").trim()) error(`Rule ${i + 1}: pick a variable.`, node.id, `rules.${i}.variable`);
          if (!op) error(`Rule ${i + 1}: pick an operator.`, node.id, `rules.${i}.operator`);
          else if (op.needsValue && String(rule.value ?? "").trim() === "") error(`Rule ${i + 1}: value is required.`, node.id, `rules.${i}.value`);
          else if (op.numeric && !String(rule.value).includes("{{") && Number.isNaN(Number(rule.value))) {
            error(`Rule ${i + 1}: "${op.label}" needs a number.`, node.id, `rules.${i}.value`);
          }
        });
        break;
      }

      case "executeFlow": {
        if (!EXECUTE_MODES.includes(d.mode)) error("Choose a mode (jump or call & return).", node.id, "mode");
        if (!d.targetFlowId) {
          error("Choose a target flow.", node.id, "targetFlowId");
          break;
        }
        if (d.targetFlowId === ctx.flowId) {
          error("A flow can't execute itself.", node.id, "targetFlowId");
          break;
        }
        const target = flowsById.get(d.targetFlowId);
        if (!target) error("Target flow no longer exists.", node.id, "targetFlowId");
        else if (target.status !== "active") error(`Target flow "${target.name}" must be published and active.`, node.id, "targetFlowId");
        break;
      }

      case "end":
        optionalText(node, "message", d.message, LIMITS.textBody, "Closing message");
        break;

      default:
        break;
    }
  }

  function checkOptions(node, options, maxTitle, kind) {
    const titles = new Set();
    const ids = new Set();
    for (const option of options) {
      const field = `option.${option.id}`;
      if (!option.id || ids.has(option.id)) error(`${kind} IDs must be unique.`, node.id, field);
      ids.add(option.id);
      const text = String(option.title || "").trim();
      if (!text) {
        error(`${kind} title is required.`, node.id, field);
        continue;
      }
      const len = textLength(text);
      if (len > maxTitle) error(`${kind} "${text}" is ${len} characters (max ${maxTitle}).`, node.id, field);
      const key = text.toLowerCase();
      if (titles.has(key)) error(`${kind} titles must be unique ("${text}").`, node.id, field);
      titles.add(key);
    }
  }

  // ---- Connections -------------------------------------------------------
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      error("A connection points to a node that no longer exists.", source ? source.id : null);
      continue;
    }
    if (target.type === "trigger") error("Nothing can connect into a Trigger.", source.id);
    const handle = normalizeHandle(edge.sourceHandle);
    if (!outputHandles(source).includes(handle)) {
      const hint = source.type === "executeFlow" ? " Jump mode ends this flow, so it has no output." : "";
      error(`Connection from an output that no longer exists.${hint}`, source.id);
    }
  }

  for (const node of nodes) {
    const handles = outputHandles(node);
    for (const handle of handles) {
      const out = index.edgesFrom(node.id, handle);
      const name = outputName(node, handle);
      if (out.length === 0) error(`${name} is not connected. Every path must end in End or Execute Flow (jump).`, node.id, handle ? `option.${handle}` : "next");
      if (out.length > 1) error(`${name} connects to ${out.length} nodes; connect it to one.`, node.id, handle ? `option.${handle}` : "next");
    }
  }

  if (trigger) {
    const reachable = reachableFrom(index, trigger.id);
    for (const node of nodes) {
      if (!reachable.has(node.id)) warning(`"${title(node)}" is not connected to the trigger and will be ignored.`, node.id);
    }
  }

  // ---- Variables used by conditions are set on every path before them ---
  if (trigger) checkConditionVariables();

  function checkConditionVariables() {
    const start = index.nextOf(trigger.id, null);
    if (!start) return;
    const sets = (node) => {
      const out = [];
      const own = savedVariable(node);
      if (own) out.push(own);
      if (node.type === "executeFlow" && node.data?.mode === "call") out.push(...(flowsById.get(node.data.targetFlowId)?.saves || []));
      return out;
    };
    const everywhere = new Set();
    for (const node of nodes) for (const v of sets(node)) everywhere.add(v);
    const inSets = new Map();
    const order = [...reachableFrom(index, start)].filter((id) => !byId.get(id).data?.disabled);
    // Must-analysis: a variable is "definitely set" at a node if it is set on every path reaching it.
    for (const id of order) inSets.set(id, id === start ? new Set() : new Set(everywhere));
    for (let changed = true, rounds = 0; changed && rounds < 100; rounds++) {
      changed = false;
      for (const id of order) {
        const node = byId.get(id);
        const out = new Set([...inSets.get(id), ...sets(node)]);
        for (const next of index.successors(id)) {
          const current = inSets.get(next);
          if (!current || next === start) continue;
          for (const v of [...current]) if (!out.has(v)) {
            current.delete(v);
            changed = true;
          }
        }
      }
    }
    for (const id of order) {
      const node = byId.get(id);
      if (node.type !== "condition") continue;
      (node.data?.rules || []).forEach((rule, i) => {
        const root = String(rule.variable || "").split(".")[0];
        if (!root || RESERVED_VAR_ROOTS.has(root)) return;
        if (!everywhere.has(root)) {
          warning(`Rule ${i + 1}: "${root}" is not saved in this flow; it is empty unless a parent flow sets it.`, node.id, `rules.${i}.variable`);
        } else if (!inSets.get(id).has(root)) {
          warning(`Rule ${i + 1}: "${root}" is not set on every path before this node.`, node.id, `rules.${i}.variable`);
        }
      });
    }
  }

  // ---- Linked flows: call-and-return cycles and depth --------------------
  const callNodes = nodes.filter((n) => n.type === "executeFlow" && n.data?.mode === "call" && n.data?.targetFlowId && !n.data?.disabled);
  if (callNodes.length && ctx.flowId) {
    const callsOf = (id) => {
      if (id === ctx.flowId) return [...new Set(callNodes.map((n) => n.data.targetFlowId))];
      const flow = flowsById.get(id);
      return flow && flow.status === "active" ? flow.calls || [] : [];
    };

    for (const node of callNodes) {
      const path = findPath(node.data.targetFlowId, ctx.flowId, callsOf);
      if (path) {
        const names = [ctx.flowId, ...path].map((id) => (id === ctx.flowId ? "this flow" : flowsById.get(id)?.name || id));
        error(`Call-and-return cycle: ${names.join(" → ")}.`, node.id, "targetFlowId");
      }
    }

    if (!problems.some((p) => p.message.startsWith("Call-and-return cycle"))) {
      const down = longestChain(ctx.flowId, callsOf);
      const callersOf = (id) => tenantFlows.filter((f) => f.status === "active" && f.id !== ctx.flowId && (f.calls || []).includes(id)).map((f) => f.id);
      const up = longestChain(ctx.flowId, callersOf);
      if (up + down > LIMITS.maxCallDepth) {
        error(`Call-and-return nesting would be ${up + down} levels deep (max ${LIMITS.maxCallDepth}).`, callNodes[0].id, "targetFlowId");
      }
    }
  }

  return problems;
}

function outputName(node, handle) {
  if (handle === null) return `"${node.data?.label || node.type}" output`;
  if (node.type === "condition") return `"${handle}" branch`;
  const option = node.type === "buttons" ? (node.data?.buttons || []).find((b) => b.id === handle) : listRows(node.data).find((r) => r.id === handle);
  return `Option "${option?.title || handle}"`;
}

function findPath(from, to, next, seen = new Set()) {
  if (from === to) return [to];
  if (seen.has(from)) return null;
  seen.add(from);
  for (const child of next(from)) {
    const rest = findPath(child, to, next, seen);
    if (rest) return [from, ...rest];
  }
  return null;
}

function longestChain(id, next, stack = new Set()) {
  if (stack.has(id)) return 0;
  stack.add(id);
  let best = 0;
  for (const child of next(id)) best = Math.max(best, 1 + longestChain(child, next, stack));
  stack.delete(id);
  return best;
}
