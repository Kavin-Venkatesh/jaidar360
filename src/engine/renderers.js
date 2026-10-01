// Compiled nodes -> WhatsApp Cloud API message payloads (without `to`; the sender adds it).
const { LIMITS, truncateText, renderTemplate } = require("../../shared/flow-rules/index.mjs");

const render = (text, scope, max) => truncateText(renderTemplate(text, scope).trim(), max);

function text(body) {
  return { type: "text", text: { body: truncateText(body, LIMITS.textBody), preview_url: false } };
}

function message(node, scope) {
  if (node.imageUrl) {
    const caption = render(node.text, scope, LIMITS.imageCaption);
    return { type: "image", image: { link: node.imageUrl, ...(caption ? { caption } : {}) } };
  }
  return text(render(node.text, scope, LIMITS.textBody));
}

function headerAndFooter(node, scope, headerMax, footerMax) {
  const header = node.header ? render(node.header, scope, headerMax) : "";
  const footer = node.footer ? render(node.footer, scope, footerMax) : "";
  return {
    ...(header ? { header: { type: "text", text: header } } : {}),
    ...(footer ? { footer: { text: footer } } : {}),
  };
}

function buttons(node, scope) {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      ...headerAndFooter(node, scope, LIMITS.buttonHeader, LIMITS.buttonFooter),
      body: { text: render(node.body, scope, LIMITS.buttonBody) },
      action: {
        buttons: node.options.map((o) => ({ type: "reply", reply: { id: o.id, title: truncateText(o.title, LIMITS.buttonTitle) } })),
      },
    },
  };
}

function list(node, scope) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      ...headerAndFooter(node, scope, LIMITS.listHeader, LIMITS.listFooter),
      body: { text: render(node.body, scope, LIMITS.listBody) },
      action: {
        button: truncateText(node.buttonLabel, LIMITS.listButton),
        sections: node.sections.map((s) => ({
          ...(s.title ? { title: truncateText(s.title, LIMITS.sectionTitle) } : {}),
          rows: s.rows.map((r) => ({
            id: r.id,
            title: truncateText(r.title, LIMITS.rowTitle),
            ...(r.description ? { description: truncateText(r.description, LIMITS.rowDescription) } : {}),
          })),
        })),
      },
    },
  };
}

function locationRequest(node, scope) {
  return {
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: render(node.prompt, scope, LIMITS.locationBody) },
      action: { name: "send_location" },
    },
  };
}

// Message with one URL button (Location Link nodes).
function ctaUrl(node, scope, url) {
  return {
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: render(node.prompt, scope, LIMITS.ctaBody) },
      action: { name: "cta_url", parameters: { display_text: truncateText(node.buttonText, LIMITS.ctaButton), url } },
    },
  };
}

function prompt(node, scope, suffix = "") {
  return text(`${render(node.prompt, scope, LIMITS.textBody - suffix.length)}${suffix}`);
}

module.exports = { text, message, buttons, list, locationRequest, ctaUrl, prompt, render };
