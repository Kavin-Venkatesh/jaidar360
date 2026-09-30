// One executor per node type.
//   enter(node, ctx)          -> { send: [payload], wait } | { send, next: handle } | { jump: flowId } | { call: flowId } | { send, end }
//   receive(node, event, ctx) -> { ok: true, value, handle } | { ok: false, stale?, message, resend? }
// ctx = { tenant, agent, session, scope, saveMedia(media) }
const { lookupPath, renderTemplate, textLength } = require("../../shared/flow-rules/index.mjs");
const renderers = require("./renderers");
const { parseAnswer } = require("./inputs");
const { logError } = require("../utils/logger");

const stale = () => ({ ok: false, stale: true });
const retry = (message) => ({ ok: false, message, resend: true });

// Typed fallback for menus: exact title (case-insensitive) or the option's number ("2").
function matchTypedOption(options, text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  const byTitle = options.find((o) => o.title.toLowerCase() === t);
  if (byTitle) return byTitle;
  if (/^\d+$/.test(t)) return options[Number(t) - 1] || null;
  return null;
}

function receiveOption(node, event, replyKind) {
  if (event.replyId) {
    // Option IDs are unique per node, so an unknown ID means a tap on an older menu.
    const option = node.options.find((o) => o.id === event.replyId);
    if (!option) return stale();
    return { ok: true, value: option.title, handle: option.id };
  }
  if (event.kind === "text") {
    const option = matchTypedOption(node.options, event.text);
    if (option) return { ok: true, value: option.title, handle: option.id };
  }
  return retry(replyKind === "list_reply" ? "Please pick an option from the list below." : "Please tap one of the buttons below.");
}

const waitingForText = (event) => (event.replyId ? stale() : null);

function asString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return String(value.title || value.address || value.name || JSON.stringify(value));
  return String(value);
}

function evaluateRule(rule, scope) {
  const actual = lookupPath(scope, rule.variable);
  const expected = renderTemplate(String(rule.value ?? ""), scope).trim();
  const a = asString(actual).trim();
  const set = a !== "";
  const numbers = () => [Number(a), Number(expected)];
  switch (rule.operator) {
    case "is_set":
      return set;
    case "is_empty":
      return !set;
    case "equals":
      return a.toLowerCase() === expected.toLowerCase();
    case "not_equals":
      return a.toLowerCase() !== expected.toLowerCase();
    case "contains":
      return a.toLowerCase().includes(expected.toLowerCase());
    case "gt": {
      const [x, y] = numbers();
      return set && x > y;
    }
    case "gte": {
      const [x, y] = numbers();
      return set && x >= y;
    }
    case "lt": {
      const [x, y] = numbers();
      return set && x < y;
    }
    case "lte": {
      const [x, y] = numbers();
      return set && x <= y;
    }
    default:
      return false;
  }
}

function evaluateCondition(node, scope) {
  const results = node.rules.map((rule) => evaluateRule(rule, scope));
  return node.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

const MEDIA_LABEL = { image: "a photo", document: "a document", any: "a photo or document" };

const executors = {
  message: {
    enter: (node, ctx) => ({ send: [renderers.message(node, ctx.scope)], next: "default" }),
  },

  buttons: {
    enter: (node, ctx) => ({ send: [renderers.buttons(node, ctx.scope)], wait: true }),
    receive: (node, event) => receiveOption(node, event, "button_reply"),
  },

  list: {
    enter: (node, ctx) => ({ send: [renderers.list(node, ctx.scope)], wait: true }),
    receive: (node, event) => receiveOption(node, event, "list_reply"),
  },

  question: {
    enter: (node, ctx) => ({ send: [renderers.prompt(node, ctx.scope)], wait: true }),
    receive: (node, event, ctx) => {
      const wrong = waitingForText(event);
      if (wrong) return wrong;
      if (event.kind !== "text") return { ok: false, message: "Please reply with a text message." };
      const result = parseAnswer(node, event.text, { country: ctx.tenant.country });
      return result.ok ? { ok: true, value: result.value, handle: "default" } : { ok: false, message: result.message };
    },
  },

  location: {
    enter: (node, ctx) => ({ send: [renderers.locationRequest(node, ctx.scope)], wait: true }),
    receive: (node, event) => {
      const wrong = waitingForText(event);
      if (wrong) return wrong;
      if (event.kind !== "location") return retry("Please tap *Send location* below to share where you are.");
      const { latitude, longitude, name, address } = event.location;
      // A named place or typed address means the agent picked a spot rather than sharing GPS: flag, don't trust.
      return {
        ok: true,
        handle: "default",
        value: { latitude, longitude, name, address, flagged: Boolean(name || address) },
      };
    },
  },

  media: {
    enter: (node, ctx) => ({
      send: [renderers.prompt(node, ctx.scope, node.required ? "" : "\n\n(Reply *skip* to skip.)")],
      wait: true,
    }),
    receive: async (node, event, ctx) => {
      const wrong = waitingForText(event);
      if (wrong) return wrong;
      if (!node.required && event.kind === "text" && event.text.trim().toLowerCase() === "skip") {
        return { ok: true, value: null, handle: "default" };
      }
      const accepted = node.accept === "any" ? ["image", "document"] : [node.accept];
      if (!accepted.includes(event.kind) || !event.media?.id) {
        return { ok: false, message: `Please send ${MEDIA_LABEL[node.accept] || "a file"}.` };
      }
      const value = { mediaId: event.media.id, mimeType: event.media.mimeType || null, caption: event.media.caption || null, kind: event.kind };
      try {
        value.path = await ctx.saveMedia(event.media);
      } catch (error) {
        logError("FLOW_MEDIA_DOWNLOAD_FAILED", error, { mediaId: event.media.id });
        value.error = error.message;
        ctx.session.lastError = `Media download failed: ${error.message}`;
      }
      return { ok: true, value, handle: "default" };
    },
  },

  condition: {
    enter: (node, ctx) => ({ next: evaluateCondition(node, ctx.scope) ? "true" : "false" }),
  },

  executeFlow: {
    enter: (node) => (node.mode === "call" ? { call: node.targetFlowId } : { jump: node.targetFlowId }),
  },

  end: {
    enter: (node, ctx) => {
      const message = node.message ? renderers.render(node.message, ctx.scope, 4096) : "";
      return { send: textLength(message) ? [renderers.text(message)] : [], end: true };
    },
  },
};

module.exports = { executors, evaluateCondition, matchTypedOption };
