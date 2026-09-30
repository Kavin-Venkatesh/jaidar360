// Parses and validates answers to Ask Question nodes.
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const env = require("../config/env");
const { textLength } = require("../../shared/flow-rules/index.mjs");

const DEFAULT_ERRORS = {
  text: "Please type your answer.",
  number: "Please reply with a number.",
  phone: "That doesn't look like a valid phone number. Please try again.",
  email: "That doesn't look like a valid email address. Please try again.",
  date: "Please reply with a date like 25/12/2025.",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function todayParts(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: env.BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

function parseDate(input) {
  const text = input.trim().toLowerCase();
  if (text === "today") return todayParts(0);
  if (text === "tomorrow") return todayParts(1);
  if (text === "yesterday") return todayParts(-1);

  let y;
  let m;
  let d;
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, y, m, d] = match;
  else {
    // Indian convention: day first.
    match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!match) return null;
    [, d, m, y] = match;
    if (y.length === 2) y = `20${y}`;
  }
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// -> { ok: true, value } | { ok: false, message }
function parseAnswer(node, rawText, { country = "IN" } = {}) {
  const text = String(rawText ?? "").trim();
  const fail = () => ({ ok: false, message: node.errorMessage || DEFAULT_ERRORS[node.inputType] || DEFAULT_ERRORS.text });
  if (!text) return fail();

  const { regex, min, max } = node.validation || {};
  if (regex) {
    try {
      if (!new RegExp(regex).test(text)) return fail();
    } catch {
      // Invalid patterns are blocked at publish; ignore defensively.
    }
  }
  const inRange = (n) => (min === undefined || min === null || n >= min) && (max === undefined || max === null || n <= max);

  switch (node.inputType) {
    case "number": {
      const cleaned = text.replace(/[,\s]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return fail();
      const value = Number(cleaned);
      return inRange(value) ? { ok: true, value } : fail();
    }
    case "phone": {
      const phone = parsePhoneNumberFromString(text, country);
      return phone && phone.isValid() ? { ok: true, value: phone.number } : fail();
    }
    case "email":
      return EMAIL.test(text) ? { ok: true, value: text.toLowerCase() } : fail();
    case "date": {
      const value = parseDate(text);
      return value ? { ok: true, value } : fail();
    }
    default:
      return inRange(textLength(text)) ? { ok: true, value: text } : fail();
  }
}

module.exports = { parseAnswer, parseDate };
