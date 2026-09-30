const test = require("node:test");
const assert = require("node:assert/strict");
const { validateFlow, compileFlow, hasErrors, textLength } = require("../shared/flow-rules/index.mjs");

const trigger = (keywords = ["hi"]) => ({ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { keywords } });
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source, target, sourceHandle = null) => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle });
const messagesFor = (problems, nodeId) => problems.filter((p) => p.nodeId === nodeId).map((p) => p.message);

function buttonsFlow(buttons) {
  const nodes = [trigger(), node("b", "buttons", { body: "Pick one", buttons }), node("e", "end", {})];
  const edges = [edge("t", "b"), ...buttons.map((btn) => edge("b", "e", btn.id))];
  return { nodes, edges };
}

test("rules: a valid buttons flow has no errors and compiles to next maps keyed by option ID", () => {
  const canvas = buttonsFlow([{ id: "opt_a", title: "Check in" }, { id: "opt_b", title: "New customer" }]);
  assert.equal(hasErrors(validateFlow(canvas, { flowId: "f", isEntry: true })), false);
  const compiled = compileFlow(canvas, { flowId: "f", version: 3, isEntry: true });
  assert.equal(compiled.start, "b");
  assert.deepEqual(compiled.trigger, { keywords: ["hi"], entry: true });
  assert.deepEqual(compiled.nodes.b.next, { opt_a: "e", opt_b: "e" });
  assert.equal(compiled.nodes.t, undefined, "trigger is not a runtime node");
});

test("rules: 4 buttons and a 21-character title are errors", () => {
  const four = buttonsFlow([1, 2, 3, 4].map((i) => ({ id: `o${i}`, title: `B${i}` })));
  assert.match(messagesFor(validateFlow(four), "b").join("\n"), /at most 3 buttons/);

  const long = buttonsFlow([{ id: "o1", title: "x".repeat(21) }]);
  const problems = validateFlow(long);
  assert.ok(hasErrors(problems));
  assert.match(messagesFor(problems, "b").join("\n"), /21 characters \(max 20\)/);
});

test("rules: character limits count graphemes (emoji, Tamil)", () => {
  assert.equal(textLength("👍🏽"), 1);
  assert.equal(textLength("தமிழ்"), 3);
  const canvas = buttonsFlow([{ id: "o1", title: "👍🏽".repeat(20) }]);
  assert.equal(hasErrors(validateFlow(canvas)), false);
});

test("rules: an unconnected button output blocks publish and points at the node", () => {
  const canvas = buttonsFlow([{ id: "o1", title: "A" }, { id: "o2", title: "B" }]);
  canvas.edges = canvas.edges.filter((e) => e.sourceHandle !== "o2");
  const problem = validateFlow(canvas).find((p) => p.field === "option.o2");
  assert.equal(problem.severity, "error");
  assert.equal(problem.nodeId, "b");
  assert.match(problem.message, /Option "B" is not connected/);
});

test("rules: duplicate titles, missing saveAs, bad variable names and bad regex are errors", () => {
  const canvas = {
    nodes: [
      trigger(),
      node("b", "buttons", { body: "x", buttons: [{ id: "o1", title: "Yes" }, { id: "o2", title: "yes" }] }),
      node("q1", "question", { prompt: "Name?", inputType: "text", saveAs: "" }),
      node("q2", "question", { prompt: "Code?", inputType: "text", saveAs: "CustomerCode", validation: { regex: "([" } }),
      node("e", "end"),
    ],
    edges: [edge("t", "b"), edge("b", "q1", "o1"), edge("b", "q1", "o2"), edge("q1", "q2"), edge("q2", "e")],
  };
  const text = validateFlow(canvas).map((p) => p.message).join("\n");
  assert.match(text, /titles must be unique/);
  assert.match(text, /"Save as" variable name is required/);
  assert.match(text, /must be snake_case/);
  assert.match(text, /not a valid regular expression/);
});

test("rules: entry flow needs a keyword; only one entry flow; keywords unique across active flows", () => {
  const canvas = buttonsFlow([{ id: "o1", title: "A" }]);
  canvas.nodes[0] = trigger([]);
  assert.match(validateFlow(canvas, { flowId: "f", isEntry: true }).map((p) => p.message).join(), /needs at least one keyword/);

  canvas.nodes[0] = trigger(["Hi", "menu"]);
  const ctx = {
    flowId: "f",
    isEntry: true,
    tenantFlows: [
      { id: "f", name: "This", status: "draft" },
      { id: "g", name: "Old menu", isEntry: true, status: "active", keywords: ["menu"] },
    ],
  };
  const text = validateFlow(canvas, ctx).map((p) => p.message).join("\n");
  assert.match(text, /"Old menu" is already the entry flow/);
  assert.match(text, /Keyword "menu" is already used by active flow "Old menu"/);
  assert.doesNotMatch(text, /Keyword "hi"/);
});

test("rules: execute flow targets must be active; call-and-return cycles and depth are rejected", () => {
  const callFlow = (target) => ({
    nodes: [trigger([]), node("x", "executeFlow", { targetFlowId: target, mode: "call" }), node("e", "end")],
    edges: [edge("t", "x"), edge("x", "e")],
  });
  const flows = [
    { id: "A", name: "A", status: "draft" },
    { id: "B", name: "B", status: "active", calls: ["A"] },
    { id: "C", name: "C", status: "inactive", calls: [] },
    { id: "D", name: "D", status: "active", calls: ["E"] },
    { id: "E", name: "E", status: "active", calls: ["F"] },
    { id: "F", name: "F", status: "active", calls: [] },
  ];

  const cycle = validateFlow(callFlow("B"), { flowId: "A", tenantFlows: flows });
  assert.match(cycle.map((p) => p.message).join(), /Call-and-return cycle: this flow → B → this flow/);

  const inactive = validateFlow(callFlow("C"), { flowId: "A", tenantFlows: flows });
  assert.match(inactive.map((p) => p.message).join(), /must be published and active/);

  const self = validateFlow(callFlow("A"), { flowId: "A", tenantFlows: flows });
  assert.match(self.map((p) => p.message).join(), /can't execute itself/);

  // A -> D -> E -> F is 3 levels (ok); B already calls A, so B -> A -> D -> E -> F would be 4.
  const deep = validateFlow(callFlow("D"), { flowId: "A", tenantFlows: flows });
  assert.match(deep.map((p) => p.message).join(), /nesting would be 4 levels deep \(max 3\)/);
  const ok = validateFlow(callFlow("D"), { flowId: "A", tenantFlows: flows.filter((f) => f.id !== "B") });
  assert.equal(hasErrors(ok), false);
});

test("rules: jump mode has no output; condition needs both branches and warns on unset variables", () => {
  const canvas = {
    nodes: [
      trigger(),
      node("c", "condition", { match: "all", rules: [{ id: "r", variable: "count", operator: "gt", value: "0" }] }),
      node("q", "question", { prompt: "How many?", inputType: "number", saveAs: "count" }),
      node("j", "executeFlow", { targetFlowId: "B", mode: "jump" }),
      node("e", "end"),
    ],
    edges: [edge("t", "c"), edge("c", "q", "true"), edge("q", "j"), edge("j", "e")],
  };
  const problems = validateFlow(canvas, { flowId: "A", tenantFlows: [{ id: "B", name: "B", status: "active" }] });
  const text = problems.map((p) => p.message).join("\n");
  assert.match(text, /"false" branch is not connected/);
  assert.match(text, /Jump mode ends this flow/);
  const warn = problems.find((p) => p.nodeId === "c" && p.severity === "warning");
  assert.match(warn.message, /"count" is not set on every path/);
});

test("rules: disabled pass-through nodes are skipped by the compiler", () => {
  const canvas = {
    nodes: [trigger(), node("m", "message", { text: "hello", disabled: true }), node("e", "end", { message: "bye" })],
    edges: [edge("t", "m"), edge("m", "e")],
  };
  assert.equal(hasErrors(validateFlow(canvas)), false);
  const compiled = compileFlow(canvas, { flowId: "f", version: 1 });
  assert.equal(compiled.start, "e");
  assert.equal(compiled.nodes.m, undefined);
});
