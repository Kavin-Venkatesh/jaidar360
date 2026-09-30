// Seeds and publishes the example flows from the plan (Acme Pharma §5.2, FreshMart Retail §5.3).
// Idempotent: a tenant that already has flows is skipped. Run with `npm run db:seed`.
const { prisma } = require("../src/db/prisma");
const flows = require("../src/flows/flow.service");

class CanvasBuilder {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.counter = 0;
  }

  // col/row are grid positions; the editor's auto-layout can tidy them further.
  add(type, col, row, data) {
    const id = `n_${type.slice(0, 4).toLowerCase()}_${++this.counter}`;
    this.nodes.push({ id, type, position: { x: col * 300, y: row * 170 }, data });
    return id;
  }

  link(source, target, sourceHandle = null) {
    this.edges.push({ id: `e_${this.edges.length + 1}`, source, sourceHandle, target, targetHandle: null });
  }

  chain(...ids) {
    for (let i = 0; i < ids.length - 1; i++) this.link(ids[i], ids[i + 1]);
  }

  toJSON() {
    return { nodes: this.nodes, edges: this.edges, viewport: { x: 60, y: 60, zoom: 0.85 } };
  }
}

const trigger = (b, keywords = []) => b.add("trigger", 0, 1, { label: "Start", keywords });
const question = (label, prompt, saveAs, inputType = "text", extra = {}) => ({ label, prompt, saveAs, inputType, maxAttempts: 3, validation: {}, ...extra });
const opt = (id, title) => ({ id, title });

async function createAndPublish(tenantId, name, canvas, { isEntry = false } = {}) {
  const flow = await flows.create(tenantId, { name, isEntry, draft: canvas });
  const result = await flows.publish(tenantId, flow.id, { publishedBy: "seed" });
  console.log(`  ✔ ${name} → v${result.version}`);
  return flow.id;
}

async function seedAcme() {
  const tenantId = "tnt_acme";

  const checkIn = new CanvasBuilder();
  {
    const t = trigger(checkIn);
    const loc = checkIn.add("location", 1, 1, { label: "Share location", prompt: "📍 Please share your current location.", saveAs: "checkin_location" });
    const selfie = checkIn.add("media", 2, 1, { label: "Selfie at location", prompt: "🤳 Now send a selfie at the location.", accept: "image", required: true, saveAs: "checkin_selfie" });
    const end = checkIn.add("end", 3, 1, { label: "Checked in", message: "✅ Checked in. Thanks {{agent.name}}!", saveSubmission: true });
    checkIn.chain(t, loc, selfie, end);
  }
  const checkInId = await createAndPublish(tenantId, "Check-in", checkIn.toJSON());

  const newCustomer = new CanvasBuilder();
  {
    const b = newCustomer;
    const t = trigger(b);
    const name = b.add("question", 1, 1, question("Customer name", "What is the customer's name?", "customer_name"));
    const phone = b.add("question", 2, 1, question("Contact number", "What is their contact number?", "customer_phone", "phone", { errorMessage: "Please send a valid 10-digit mobile number." }));
    const type = b.add("list", 3, 1, {
      label: "Customer type",
      body: "What type of customer is {{customer_name}}?",
      buttonLabel: "Choose type",
      sections: [{ id: "sec_1", title: "Customer type", rows: [{ id: "opt_doc", title: "Doctor", description: "" }, { id: "opt_chem", title: "Chemist", description: "" }] }],
      saveAs: "customer_type",
    });
    const speciality = b.add("question", 4, 0, question("Speciality", "What is the doctor's speciality?", "speciality"));
    const shop = b.add("question", 4, 2, question("Shop name", "What is the shop's name?", "shop_name"));
    const call = b.add("executeFlow", 5, 1, { label: "Check-in", targetFlowId: checkInId, mode: "call" });
    const end = b.add("end", 6, 1, { label: "Customer created", message: "🎉 Customer {{customer_name}} created.", saveSubmission: true });
    b.chain(t, name, phone, type);
    b.link(type, speciality, "opt_doc");
    b.link(type, shop, "opt_chem");
    b.link(speciality, call);
    b.link(shop, call);
    b.link(call, end);
  }
  const newCustomerId = await createAndPublish(tenantId, "New customer", newCustomer.toJSON());

  const menu = new CanvasBuilder();
  {
    const t = trigger(menu, ["hi", "hello", "menu"]);
    const buttons = menu.add("buttons", 1, 1, {
      label: "Main menu",
      body: "Hi {{agent.name}} 👋 What would you like to do?",
      buttons: [opt("opt_ci", "Check in"), opt("opt_nc", "New customer")],
      saveAs: "menu_choice",
    });
    const goCheckIn = menu.add("executeFlow", 2, 0, { label: "Check-in", targetFlowId: checkInId, mode: "jump" });
    const goNew = menu.add("executeFlow", 2, 2, { label: "New customer", targetFlowId: newCustomerId, mode: "jump" });
    menu.link(t, buttons);
    menu.link(buttons, goCheckIn, "opt_ci");
    menu.link(buttons, goNew, "opt_nc");
  }
  await createAndPublish(tenantId, "Main Menu", menu.toJSON(), { isEntry: true });
}

async function seedFreshMart() {
  const tenantId = "tnt_freshmart";
  const ids = {};

  {
    const b = new CanvasBuilder();
    const t = trigger(b);
    const store = b.add("question", 1, 1, question("Store name", "Which store are you auditing?", "store_name"));
    const count = b.add("question", 2, 1, question("Out of stock count", "How many items are out of stock?", "out_of_stock_count", "number", { validation: { min: 0 } }));
    const cond = b.add("condition", 3, 1, { label: "Any out of stock?", match: "all", rules: [{ id: "r_1", variable: "out_of_stock_count", operator: "gt", value: "0" }] });
    const skus = b.add("question", 4, 0, question("Which SKUs", "Which SKUs are out of stock? (comma separated)", "out_of_stock_skus"));
    const shelf = b.add("media", 4, 2, { label: "Shelf photo", prompt: "📷 Please send a photo of the shelf.", accept: "image", required: true, saveAs: "shelf_photo" });
    const end = b.add("end", 5, 1, { label: "Audit saved", message: "✅ Store audit for {{store_name}} saved.", saveSubmission: true });
    b.chain(t, store, count, cond);
    b.link(cond, skus, "true");
    b.link(cond, shelf, "false");
    b.link(skus, end);
    b.link(shelf, end);
    ids.audit = await createAndPublish(tenantId, "Store audit", b.toJSON());
  }

  {
    const b = new CanvasBuilder();
    const t = trigger(b);
    const store = b.add("question", 1, 1, question("Store name", "Which store needs stock?", "store_name"));
    const items = b.add("question", 2, 1, question("Items", "Which items and quantities do you need?", "requested_items"));
    const urgency = b.add("buttons", 3, 1, {
      label: "Urgency",
      body: "How urgent is this request?",
      buttons: [opt("opt_today", "Today"), opt("opt_week", "This week"), opt("opt_next", "Next week")],
      saveAs: "urgency",
    });
    const end = b.add("end", 4, 1, { label: "Request sent", message: "📦 Stock request for {{store_name}} sent ({{urgency}}).", saveSubmission: true });
    b.chain(t, store, items, urgency);
    for (const handle of ["opt_today", "opt_week", "opt_next"]) b.link(urgency, end, handle);
    ids.stock = await createAndPublish(tenantId, "Stock request", b.toJSON());
  }

  {
    const b = new CanvasBuilder();
    const t = trigger(b);
    const competitor = b.add("question", 1, 1, question("Competitor", "Which competitor?", "competitor"));
    const details = b.add("question", 2, 1, question("Activity", "What are they doing (offer, display, pricing)?", "activity"));
    const photo = b.add("media", 3, 1, { label: "Photo", prompt: "📷 Send a photo of the activity.", accept: "image", required: false, saveAs: "activity_photo" });
    const end = b.add("end", 4, 1, { label: "Logged", message: "👍 Competitor activity logged.", saveSubmission: true });
    b.chain(t, competitor, details, photo, end);
    ids.competitor = await createAndPublish(tenantId, "Competitor activity", b.toJSON());
  }

  {
    const b = new CanvasBuilder();
    const t = trigger(b);
    const visits = b.add("question", 1, 1, question("Stores visited", "How many stores did you visit today?", "stores_visited", "number", { validation: { min: 0 } }));
    const orders = b.add("question", 2, 1, question("Order value", "Total order value today (₹)?", "order_value", "number", { validation: { min: 0 } }));
    const remarks = b.add("question", 3, 1, question("Remarks", "Any remarks for your manager?", "remarks"));
    const end = b.add("end", 4, 1, { label: "Report sent", message: "🌙 Day end report sent. Good work today, {{agent.name}}!", saveSubmission: true });
    b.chain(t, visits, orders, remarks, end);
    ids.dayEnd = await createAndPublish(tenantId, "Day end report", b.toJSON());
  }

  {
    const b = new CanvasBuilder();
    const t = trigger(b, ["hi", "hello", "menu"]);
    const rows = [
      { id: "opt_audit", title: "Store audit", description: "Check shelves and stock", target: ids.audit },
      { id: "opt_stock", title: "Stock request", description: "Ask the warehouse for stock", target: ids.stock },
      { id: "opt_comp", title: "Competitor activity", description: "Log offers, displays, pricing", target: ids.competitor },
      { id: "opt_dayend", title: "Day end report", description: "Visits, orders and remarks", target: ids.dayEnd },
    ];
    const list = b.add("list", 1, 1, {
      label: "Main menu",
      body: "Hi {{agent.name}} 👋 What would you like to do?",
      buttonLabel: "Open menu",
      sections: [{ id: "sec_1", title: "Tasks", rows: rows.map(({ id, title, description }) => ({ id, title, description })) }],
      saveAs: "menu_choice",
    });
    b.link(t, list);
    rows.forEach((row, i) => {
      const go = b.add("executeFlow", 2, i - 0.5, { label: row.title, targetFlowId: row.target, mode: "jump" });
      b.link(list, go, row.id);
    });
    await createAndPublish(tenantId, "Main Menu", b.toJSON(), { isEntry: true });
  }
}

async function main() {
  for (const [tenantId, seed] of [["tnt_acme", seedAcme], ["tnt_freshmart", seedFreshMart]]) {
    const existing = await prisma.flow.count({ where: { tenantId } });
    if (existing) {
      console.log(`${tenantId}: ${existing} flows already exist, skipping.`);
      continue;
    }
    console.log(`${tenantId}:`);
    await seed();
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error.body || error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedAcme, seedFreshMart, main };
