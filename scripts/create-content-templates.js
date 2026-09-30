require("dotenv").config();

const fs = require("fs");
const path = require("path");
const twilio = require("twilio");
const { VISIT_OPTIONS } = require("../src/utils/visit-options");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
const locationImageUrl = process.env.WHATSAPP_LOCATION_IMAGE_URL || process.env.S3_LOCATION_IMAGE_URL || "https://example.com/location.png";

if (!accountSid || !authToken) {
  console.error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set before creating content templates.");
  process.exit(1);
}

const client = twilio(accountSid, authToken);
const envPath = path.join(__dirname, "..", ".env");

function writeEnvValues(values) {
  const fileContent = fs.readFileSync(envPath, "utf8");
  const lines = fileContent.split(/\r?\n/);
  const map = new Map();

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      map.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(values)) {
    map.set(key, value);
  }

  const updated = [...map.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  fs.writeFileSync(envPath, `${updated}\n`);
}

async function createTemplate({ friendlyName, envKey, contentType, data, variables = {} }) {
  try {
    const content = await client.content.v1.contents.create({
      friendlyName,
      language: "en",
      types: {
        [contentType]: data,
      },
      variables,
    });

    console.log(`Created ${friendlyName}: ${content.sid}`);
    writeEnvValues({ [envKey]: content.sid });
    return content.sid;
  } catch (error) {
    console.error(`Failed to create ${friendlyName}:`, error.message);
    throw error;
  }
}

async function createAllTemplates() {
  const created = {};

  created.CONTENT_MAIN_MENU = await createTemplate({
    friendlyName: "main_menu",
    envKey: "CONTENT_MAIN_MENU",
    contentType: "twilio/list-picker",
    data: {
      body: "What would you like to do?",
      button: "Choose",
      items: [
        { id: "CHECK_IN", item: "Check in", description: "Record your field check-in" },
        { id: "NEW_CUSTOMER_VISIT", item: "New customer visit", description: "Create a new customer visit" },
      ],
    },
  });

  created.CONTENT_POST_CHECKIN_MENU = await createTemplate({
    friendlyName: "post_checkin_menu",
    envKey: "CONTENT_POST_CHECKIN_MENU",
    contentType: "twilio/list-picker",
    data: {
      body: "What would you like to do?",
      button: "Choose",
      items: [
        { id: "NEW_CUSTOMER_VISIT", item: "New customer visit", description: "Create a new customer visit" },
        { id: "MY_FOLLOW_UPS", item: "My follow-ups", description: "See follow-ups" },
        { id: "TODAYS_ACTIVITY", item: "Today's activity", description: "View activity for today" },
      ],
    },
  });

  created.CONTENT_CHECK_IN_LOCATION = await createTemplate({
    friendlyName: "check_in_location",
    envKey: "CONTENT_CHECK_IN_LOCATION",
    contentType: "twilio/card",
    data: {
      title: "Check in",
      body: "Share your current location to record your field visit.",
      media: [locationImageUrl],
      actions: [{ type: "URL", title: "Share location", url: `${publicBaseUrl}/geo/capture?token={{1}}` }],
    },
    variables: { 1: "sample-token" },
  });

  created.CONTENT_COMPANY_NAME = await createTemplate({
    friendlyName: "company_name_question",
    envKey: "CONTENT_COMPANY_NAME",
    contentType: "twilio/text",
    data: { body: "What is the customer company name?" },
  });

  created.CONTENT_CONTACT_NAME = await createTemplate({
    friendlyName: "contact_name_question",
    envKey: "CONTENT_CONTACT_NAME",
    contentType: "twilio/text",
    data: { body: "Who did you meet? Type their name." },
  });

  created.CONTENT_PHONE = await createTemplate({
    friendlyName: "phone_question",
    envKey: "CONTENT_PHONE",
    contentType: "twilio/quick-reply",
    data: {
      body: "What is their mobile number? Type the number, or tap Skip.",
      actions: [
        { id: "SKIP", title: "Skip" },
        { id: "BACK", title: "Back" },
      ],
    },
  });

  created.CONTENT_VISIT_LOCATION = await createTemplate({
    friendlyName: "visit_location",
    envKey: "CONTENT_VISIT_LOCATION",
    contentType: "twilio/card",
    data: {
      title: "Visit location",
      body: "Share your location to start the visit.",
      media: [locationImageUrl],
      actions: [{ type: "URL", title: "Share location", url: `${publicBaseUrl}/geo/capture?token={{1}}` }],
    },
    variables: { 1: "sample-token" },
  });

  created.CONTENT_INDUSTRY_GROUP = await createTemplate({
    friendlyName: "industry_group",
    envKey: "CONTENT_INDUSTRY_GROUP",
    contentType: "twilio/list-picker",
    data: {
      body: "Which industry group is this customer in?",
      button: "Choose",
      items: VISIT_OPTIONS.industryGroup.map((o) => ({ id: o.id, item: o.label, description: o.description })),
    },
  });

  created.CONTENT_INDUSTRY = await createTemplate({
    friendlyName: "industry",
    envKey: "CONTENT_INDUSTRY",
    contentType: "twilio/list-picker",
    data: {
      body: "Which industry?",
      button: "Choose",
      items: VISIT_OPTIONS.industry.map((o) => ({ id: o.id, item: o.label, description: o.description })),
    },
  });

  created.CONTENT_DISCUSSION = await createTemplate({
    friendlyName: "discussion",
    envKey: "CONTENT_DISCUSSION",
    contentType: "twilio/list-picker",
    data: {
      body: "What did you discuss?",
      button: "Choose",
      items: VISIT_OPTIONS.discussion.map((o) => ({ id: o.id, item: o.label, description: o.description })),
    },
  });

  created.CONTENT_MEETING_OUTCOME = await createTemplate({
    friendlyName: "meeting_outcome",
    envKey: "CONTENT_MEETING_OUTCOME",
    contentType: "twilio/list-picker",
    data: {
      body: "How did the meeting end?",
      button: "Choose",
      items: VISIT_OPTIONS.outcome.map((o) => ({ id: o.id, item: o.label, description: o.description })),
    },
  });

  // 3 options => quick-reply buttons (in-session limit is 3 buttons).
  created.CONTENT_PROSPECT_TEMPERATURE = await createTemplate({
    friendlyName: "prospect_temperature",
    envKey: "CONTENT_PROSPECT_TEMPERATURE",
    contentType: "twilio/quick-reply",
    data: {
      body: "How warm is this prospect?",
      actions: VISIT_OPTIONS.temperature.map((o) => ({ id: o.id, title: o.label })),
    },
  });

  // Meeting summary from a voice note. {{1}} = the rendered details (see renderMeetingDraftSummary).
  created.CONTENT_MEETING_DRAFT_ACTIONS = await createTemplate({
    friendlyName: "meeting_draft_actions",
    envKey: "CONTENT_MEETING_DRAFT_ACTIONS",
    contentType: "twilio/quick-reply",
    data: {
      body: "📋 Meeting Summary\n\n{{1}}\n\nPlease confirm these details.",
      actions: [
        { id: "SAVE", title: "Save" },
        { id: "EDIT", title: "Edit" },
        { id: "CANCEL", title: "Cancel" },
      ],
    },
    variables: { 1: "Company: ABC Traders" },
  });

  console.log("\nTemplate creation complete.");
  console.log(JSON.stringify(created, null, 2));
}

createAllTemplates().catch((error) => {
  console.error("Template creation failed:", error);
  process.exit(1);
});
