require("dotenv").config();

const fs = require("fs");
const path = require("path");
const twilio = require("twilio");

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
    contentType: "twilio/text",
    data: { body: "What is their mobile number?" },
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
      items: [
        { id: "SERVICE", item: "Service", description: "Service industry" },
        { id: "MANUFACTURING", item: "Manufacturing", description: "Manufacturing" },
        { id: "RETAIL", item: "Retail", description: "Retail" },
        { id: "CONSTRUCTION", item: "Construction", description: "Construction" },
        { id: "HEALTHCARE", item: "Healthcare", description: "Healthcare" },
        { id: "EDUCATION", item: "Education", description: "Education" },
        { id: "FINANCE", item: "Finance", description: "Finance" },
        { id: "TECHNOLOGY", item: "Technology", description: "Technology" },
        { id: "OTHER", item: "Other", description: "Other" },
      ],
    },
  });

  created.CONTENT_INDUSTRY = await createTemplate({
    friendlyName: "industry",
    envKey: "CONTENT_INDUSTRY",
    contentType: "twilio/list-picker",
    data: {
      body: "Which industry?",
      button: "Choose",
      items: [
        { id: "ECOMMERCE", item: "E-commerce", description: "E-commerce" },
        { id: "CONSULTING", item: "Consulting", description: "Consulting" },
        { id: "IT_SERVICES", item: "IT Services", description: "IT Services" },
        { id: "LOGISTICS", item: "Logistics", description: "Logistics" },
        { id: "PROFESSIONAL_SERVICES", item: "Professional Services", description: "Professional Services" },
        { id: "OTHER", item: "Other", description: "Other" },
      ],
    },
  });

  created.CONTENT_DISCUSSION = await createTemplate({
    friendlyName: "discussion",
    envKey: "CONTENT_DISCUSSION",
    contentType: "twilio/list-picker",
    data: {
      body: "What did you discuss?",
      button: "Choose",
      items: [
        { id: "PRODUCT_REQUIREMENT", item: "Product requirement", description: "Product requirement" },
        { id: "PRICING", item: "Pricing", description: "Pricing" },
        { id: "TECHNICAL_DISCUSSION", item: "Technical discussion", description: "Technical discussion" },
        { id: "DEMO", item: "Demo", description: "Demo" },
        { id: "PROCUREMENT", item: "Procurement", description: "Procurement" },
        { id: "CUSTOMER_REQUIREMENT", item: "Customer requirement", description: "Customer requirement" },
        { id: "OTHER", item: "Other", description: "Other" },
      ],
    },
  });

  created.CONTENT_MEETING_OUTCOME = await createTemplate({
    friendlyName: "meeting_outcome",
    envKey: "CONTENT_MEETING_OUTCOME",
    contentType: "twilio/list-picker",
    data: {
      body: "How did the meeting end?",
      button: "Choose",
      items: [
        { id: "FOLLOW_UP_REQUIRED", item: "Follow-up required", description: "Follow-up required" },
        { id: "PROPOSAL_REQUESTED", item: "Proposal requested", description: "Proposal requested" },
        { id: "DEMO_REQUIRED", item: "Demo required", description: "Demo required" },
        { id: "NEGOTIATION", item: "Negotiation", description: "Negotiation" },
        { id: "NO_REQUIREMENT", item: "No requirement", description: "No requirement" },
        { id: "NOT_INTERESTED", item: "Not interested", description: "Not interested" },
        { id: "CONVERTED", item: "Converted", description: "Converted" },
      ],
    },
  });

  created.CONTENT_PROSPECT_TEMPERATURE = await createTemplate({
    friendlyName: "prospect_temperature",
    envKey: "CONTENT_PROSPECT_TEMPERATURE",
    contentType: "twilio/list-picker",
    data: {
      body: "How warm is this prospect?",
      button: "Choose",
      items: [
        { id: "HOT", item: "Hot", description: "Hot" },
        { id: "WARM", item: "Warm", description: "Warm" },
        { id: "COLD", item: "Cold", description: "Cold" },
      ],
    },
  });

  console.log("\nTemplate creation complete.");
  console.log(JSON.stringify(created, null, 2));
}

createAllTemplates().catch((error) => {
  console.error("Template creation failed:", error);
  process.exit(1);
});
