import { useState } from "react";
import { ArrowRightLeft, Plus, Trash2, X } from "lucide-react";
import { useEditor } from "../../store/editorStore";
import { NODE_META } from "../catalog";
import { CONDITION_OPERATORS, DISABLABLE_TYPES, INPUT_TYPES, LIMITS, VAR_NAME_PATTERN, normalizeKeyword } from "../../lib/rules";
import { optionId, ruleId, sectionId } from "../../lib/ids";
import type { FlowNode, NodeData, Option, Rule, Section } from "../../lib/types";
import { Field, ProblemText, Select, TextArea, TextInput, Toggle, useFieldProblems, useVariables } from "./fields";

type Update = (patch: Partial<NodeData>, key?: string) => void;
type Problems = ReturnType<typeof useFieldProblems>;
interface FormProps {
  node: FlowNode;
  update: Update;
  problems: Problems;
}

function SaveAsField({ node, update, problems, optional = false }: FormProps & { optional?: boolean }) {
  const value = String(node.data.saveAs ?? "");
  const invalid = Boolean(value) && !VAR_NAME_PATTERN.test(value);
  return (
    <Field
      label={optional ? "Save choice as (optional)" : "Save answer as"}
      hint={<>Use it later as <code className="rounded bg-slate-100 px-1">{`{{${value || "name"}}}`}</code> or in an If node. snake_case only.</>}
      problems={problems("saveAs")}
    >
      <TextInput mono value={value} invalid={invalid} onChange={(v) => update({ saveAs: v.replace(/\s+/g, "_").toLowerCase() }, "saveAs")} placeholder="customer_name" />
    </Field>
  );
}

function TriggerForm({ node, update, problems }: FormProps) {
  const isEntry = useEditor((s) => s.isEntry);
  const setIsEntry = useEditor((s) => s.setIsEntry);
  const [draft, setDraft] = useState("");
  const keywords = (node.data.keywords as string[]) || [];
  const add = () => {
    const k = normalizeKeyword(draft);
    if (k && !keywords.includes(k)) update({ keywords: [...keywords, k] });
    setDraft("");
  };
  return (
    <>
      <Toggle checked={isEntry} onChange={setIsEntry} label="Entry flow" hint="The flow agents land in when they say hi. One per tenant; it usually branches into the others." />
      <ProblemText problems={problems("isEntry")} />
      <Field label="Keywords" hint="Messages that start this flow (case-insensitive). Leave empty for flows that only run from Execute Flow." problems={problems("keywords")}>
        <div className="flex flex-wrap gap-1">
          {keywords.map((k) => (
            <span key={k} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-1 pl-2 text-[12px]">
              {k}
              <button type="button" onClick={() => update({ keywords: keywords.filter((x) => x !== k) })} className="rounded-full p-0.5 hover:bg-slate-200">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Type a keyword and press Enter"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-[13px] outline-none focus:border-green-600"
          />
          <button type="button" onClick={add} className="btn-secondary">Add</button>
        </div>
      </Field>
    </>
  );
}

function MessageForm({ node, update, problems }: FormProps) {
  const hasImage = Boolean(node.data.imageUrl);
  return (
    <>
      <Field label={hasImage ? "Caption" : "Message"} problems={problems("text")}>
        <TextArea rows={5} value={node.data.text} max={hasImage ? LIMITS.imageCaption : LIMITS.textBody} onChange={(v) => update({ text: v }, "text")} placeholder="Hi {{agent.name}}!" />
      </Field>
      <Field label="Image URL (optional)" hint="A public https:// link to a JPG or PNG." problems={problems("imageUrl")}>
        <TextInput value={node.data.imageUrl || ""} onChange={(v) => update({ imageUrl: v.trim() }, "imageUrl")} placeholder="https://…/image.jpg" />
      </Field>
    </>
  );
}

function InteractiveTextFields({ node, update, problems, isList }: FormProps & { isList: boolean }) {
  return (
    <>
      <Field label="Header (optional)" problems={problems("header")}>
        <TextInput value={node.data.header || ""} max={isList ? LIMITS.listHeader : LIMITS.buttonHeader} onChange={(v) => update({ header: v }, "header")} />
      </Field>
      <Field label="Body" problems={problems("body")}>
        <TextArea rows={4} value={node.data.body} max={isList ? LIMITS.listBody : LIMITS.buttonBody} onChange={(v) => update({ body: v }, "body")} placeholder="What would you like to do?" />
      </Field>
      <Field label="Footer (optional)" problems={problems("footer")}>
        <TextInput value={node.data.footer || ""} max={isList ? LIMITS.listFooter : LIMITS.buttonFooter} onChange={(v) => update({ footer: v }, "footer")} />
      </Field>
    </>
  );
}

function ButtonsForm({ node, update, problems }: FormProps) {
  const removeOption = useEditor((s) => s.removeOption);
  const convertNode = useEditor((s) => s.convertNode);
  const buttons = (node.data.buttons as Option[]) || [];
  const full = buttons.length >= LIMITS.maxButtons;
  const setTitle = (id: string, title: string) => update({ buttons: buttons.map((b) => (b.id === id ? { ...b, title } : b)) }, `btn.${id}`);
  return (
    <>
      <InteractiveTextFields node={node} update={update} problems={problems} isList={false} />
      <Field label={`Buttons (${buttons.length}/${LIMITS.maxButtons})`} hint="Each button gets its own output on the canvas." problems={problems("buttons")}>
        <div className="space-y-1.5">
          {buttons.map((b) => (
            <div key={b.id}>
              <div className="flex items-center gap-1">
                <TextInput value={b.title} max={LIMITS.buttonTitle} onChange={(v) => setTitle(b.id, v)} invalid={problems(`option.${b.id}`).some((p) => p.severity === "error")} />
                <button type="button" onClick={() => removeOption(node.id, b.id)} className="icon-btn" title="Remove button">
                  <Trash2 size={14} />
                </button>
              </div>
              <ProblemText problems={problems(`option.${b.id}`)} />
            </div>
          ))}
        </div>
        <button type="button" disabled={full} onClick={() => update({ buttons: [...buttons, { id: optionId(), title: `Option ${buttons.length + 1}` }] })} className="btn-secondary mt-1 w-full">
          <Plus size={14} /> Add button
        </button>
        {full && (
          <p className="text-[11px] text-slate-500">
            WhatsApp allows 3 buttons. Need more?{" "}
            <button type="button" onClick={() => convertNode(node.id, "list")} className="font-medium text-green-700 underline">
              Convert to List
            </button>
          </p>
        )}
      </Field>
      {!full && (
        <button type="button" onClick={() => convertNode(node.id, "list")} className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-green-700">
          <ArrowRightLeft size={12} /> Convert to List (keeps connections)
        </button>
      )}
      <SaveAsField node={node} update={update} problems={problems} optional />
    </>
  );
}

function ListForm({ node, update, problems }: FormProps) {
  const removeOption = useEditor((s) => s.removeOption);
  const removeSection = useEditor((s) => s.removeSection);
  const convertNode = useEditor((s) => s.convertNode);
  const sections = (node.data.sections as Section[]) || [];
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const full = totalRows >= LIMITS.maxRows;
  const setSections = (next: Section[], key?: string) => update({ sections: next }, key);
  const setRow = (sid: string, rid: string, patch: Partial<Option>) =>
    setSections(sections.map((s) => (s.id === sid ? { ...s, rows: s.rows.map((r) => (r.id === rid ? { ...r, ...patch } : r)) } : s)), `row.${rid}.${Object.keys(patch)[0]}`);

  return (
    <>
      <InteractiveTextFields node={node} update={update} problems={problems} isList />
      <Field label="Menu button label" hint="The button that opens the list." problems={problems("buttonLabel")}>
        <TextInput value={node.data.buttonLabel} max={LIMITS.listButton} onChange={(v) => update({ buttonLabel: v }, "buttonLabel")} />
      </Field>
      <Field label={`Rows (${totalRows}/${LIMITS.maxRows})`} hint="Each row gets its own output on the canvas." problems={problems("sections")}>
        <div className="space-y-3">
          {sections.map((section, si) => (
            <div key={section.id} className="space-y-1.5 rounded-md border border-slate-200 p-2">
              <div className="flex items-center gap-1">
                <TextInput value={section.title} max={LIMITS.sectionTitle} placeholder={sections.length > 1 ? "Section title (required)" : "Section title (optional)"} onChange={(v) => setSections(sections.map((s) => (s.id === section.id ? { ...s, title: v } : s)), `sec.${section.id}`)} />
                {sections.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove section and its rows"
                    onClick={() => removeSection(node.id, section.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <ProblemText problems={problems(`sections.${si}`)} />
              {section.rows.map((row) => (
                <div key={row.id} className="space-y-1 border-l-2 border-green-200 pl-2">
                  <div className="flex items-center gap-1">
                    <TextInput value={row.title} max={LIMITS.rowTitle} onChange={(v) => setRow(section.id, row.id, { title: v })} invalid={problems(`option.${row.id}`).some((p) => p.severity === "error")} />
                    <button type="button" onClick={() => removeOption(node.id, row.id)} className="icon-btn" title="Remove row">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <TextInput value={row.description || ""} max={LIMITS.rowDescription} placeholder="Description (optional)" onChange={(v) => setRow(section.id, row.id, { description: v })} />
                  <ProblemText problems={[...problems(`option.${row.id}`), ...problems(`row.${row.id}`)]} />
                </div>
              ))}
              <button type="button" disabled={full} onClick={() => setSections(sections.map((s) => (s.id === section.id ? { ...s, rows: [...s.rows, { id: optionId(), title: `Option ${totalRows + 1}`, description: "" }] } : s)))} className="btn-secondary w-full">
                <Plus size={14} /> Add row
              </button>
            </div>
          ))}
        </div>
        <button type="button" disabled={sections.length >= LIMITS.maxSections || full} onClick={() => setSections([...sections, { id: sectionId(), title: "", rows: [{ id: optionId(), title: `Option ${totalRows + 1}`, description: "" }] }])} className="mt-1 text-[12px] text-slate-500 hover:text-green-700">
          + Add section
        </button>
        {full && <p className="text-[11px] text-slate-500">WhatsApp lists allow at most 10 rows.</p>}
      </Field>
      {totalRows <= LIMITS.maxButtons && (
        <button type="button" onClick={() => convertNode(node.id, "buttons")} className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-green-700">
          <ArrowRightLeft size={12} /> Convert to Buttons (keeps connections)
        </button>
      )}
      <SaveAsField node={node} update={update} problems={problems} optional />
    </>
  );
}

const INPUT_LABELS: Record<string, string> = { text: "Text", number: "Number", phone: "Phone number", email: "Email", date: "Date" };

function QuestionForm({ node, update, problems }: FormProps) {
  const v = node.data.validation || {};
  const setValidation = (patch: Record<string, unknown>, key: string) => update({ validation: { ...v, ...patch } }, key);
  const type = node.data.inputType;
  const rangeLabel = type === "number" ? "value" : "length";
  return (
    <>
      <Field label="Question" problems={problems("prompt")}>
        <TextArea rows={3} value={node.data.prompt} max={LIMITS.textBody} onChange={(val) => update({ prompt: val }, "prompt")} placeholder="What is the customer's name?" />
      </Field>
      <Field label="Answer type" problems={problems("inputType")} hint={type === "phone" ? "Numbers without a country code are read as Indian numbers and saved as +91…" : type === "date" ? "Accepts 25/12/2025, 2025-12-25, today, tomorrow." : undefined}>
        <Select value={type} onChange={(val) => update({ inputType: val })} options={INPUT_TYPES.map((t) => ({ value: t, label: INPUT_LABELS[t] || t }))} />
      </Field>
      {(type === "text" || type === "number") && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Min ${rangeLabel}`} problems={problems("validation.min")}>
            <TextInput value={v.min ?? ""} onChange={(val) => setValidation({ min: val === "" ? undefined : val }, "vmin")} />
          </Field>
          <Field label={`Max ${rangeLabel}`} problems={problems("validation.max")}>
            <TextInput value={v.max ?? ""} onChange={(val) => setValidation({ max: val === "" ? undefined : val }, "vmax")} />
          </Field>
        </div>
      )}
      <Field label="Pattern (optional regex)" hint="The raw reply must match, e.g. ^[A-Z]{3}\d{4}$" problems={problems("validation.regex")}>
        <TextInput mono value={v.regex || ""} onChange={(val) => setValidation({ regex: val || undefined }, "vregex")} />
      </Field>
      <Field label="Error message" hint="Sent when the reply is invalid; the question waits for another answer." problems={problems("errorMessage")}>
        <TextArea rows={2} value={node.data.errorMessage || ""} max={LIMITS.textBody} onChange={(val) => update({ errorMessage: val }, "errorMessage")} placeholder="Please send a valid 10-digit mobile number." variables={false} />
      </Field>
      <Field label="Max attempts" hint="After this many invalid replies the conversation stops." problems={problems("maxAttempts")}>
        <TextInput value={String(node.data.maxAttempts ?? 3)} onChange={(val) => update({ maxAttempts: val === "" ? "" : Number(val) }, "maxAttempts")} />
      </Field>
      <SaveAsField node={node} update={update} problems={problems} />
    </>
  );
}

function LocationForm({ node, update, problems }: FormProps) {
  return (
    <>
      <Field label="Prompt" hint="Sent with a “Send location” button. Agents can pick a place instead of GPS; those answers are flagged." problems={problems("prompt")}>
        <TextArea rows={3} value={node.data.prompt} max={LIMITS.locationBody} onChange={(v) => update({ prompt: v }, "prompt")} />
      </Field>
      <SaveAsField node={node} update={update} problems={problems} />
    </>
  );
}

function MediaForm({ node, update, problems }: FormProps) {
  return (
    <>
      <Field label="Prompt" problems={problems("prompt")}>
        <TextArea rows={3} value={node.data.prompt} max={LIMITS.textBody} onChange={(v) => update({ prompt: v }, "prompt")} />
      </Field>
      <Field label="Accept" problems={problems("accept")}>
        <Select value={node.data.accept} onChange={(v) => update({ accept: v })} options={[{ value: "image", label: "Photo" }, { value: "document", label: "Document" }, { value: "any", label: "Photo or document" }]} />
      </Field>
      <Toggle checked={node.data.required !== false} onChange={(v) => update({ required: v })} label="Required" hint="When off, the agent can reply “skip”." />
      <SaveAsField node={node} update={update} problems={problems} />
    </>
  );
}

function ConditionForm({ node, update, problems }: FormProps) {
  const rules = (node.data.rules as Rule[]) || [];
  const { saved, builtIn } = useVariables();
  const setRule = (id: string, patch: Partial<Rule>) => update({ rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, `rule.${id}.${Object.keys(patch)[0]}`);
  return (
    <>
      <Field label="Match">
        <Select value={node.data.match || "all"} onChange={(v) => update({ match: v })} options={[{ value: "all", label: "All rules (AND)" }, { value: "any", label: "Any rule (OR)" }]} />
      </Field>
      <Field label="Rules" hint="True goes to the green output, false to the red one." problems={problems("rules").filter((p) => p.field === "rules")}>
        <div className="space-y-2">
          {rules.map((rule, i) => {
            const op = CONDITION_OPERATORS.find((o) => o.id === rule.operator);
            return (
              <div key={rule.id} className="space-y-1 rounded-md border border-slate-200 p-2">
                <div className="flex items-center gap-1">
                  <input list={`vars-${node.id}`} value={rule.variable} onChange={(e) => setRule(rule.id, { variable: e.target.value.trim() })} placeholder="variable" className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-[12px] outline-none focus:border-green-600" />
                  <button type="button" onClick={() => update({ rules: rules.filter((r) => r.id !== rule.id) })} className="icon-btn" title="Remove rule">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex gap-1">
                  <Select value={rule.operator} onChange={(v) => setRule(rule.id, { operator: v })} options={CONDITION_OPERATORS.map((o) => ({ value: o.id, label: o.label }))} />
                  {op?.needsValue !== false && <TextInput value={rule.value} onChange={(v) => setRule(rule.id, { value: v })} placeholder="value" />}
                </div>
                <ProblemText problems={problems(`rules.${i}`)} />
              </div>
            );
          })}
          <datalist id={`vars-${node.id}`}>
            {[...saved, ...builtIn].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <button type="button" disabled={rules.length >= LIMITS.maxRules} onClick={() => update({ rules: [...rules, { id: ruleId(), variable: "", operator: "equals", value: "" }] })} className="btn-secondary mt-1 w-full">
          <Plus size={14} /> Add rule
        </button>
      </Field>
    </>
  );
}

function ExecuteFlowForm({ node, update, problems }: FormProps) {
  const linkable = useEditor((s) => s.linkable);
  const flowId = useEditor((s) => s.flowId);
  const setExecuteMode = useEditor((s) => s.setExecuteMode);
  const targets = linkable.filter((f) => f.id !== flowId);
  const current = node.data.targetFlowId;
  const missing = current && !targets.some((f) => f.id === current);
  return (
    <>
      <Field label="Target flow" hint="Only this tenant's published, active flows are listed." problems={problems("targetFlowId")}>
        <Select
          value={current}
          onChange={(v) => update({ targetFlowId: v })}
          invalid={Boolean(missing)}
          options={[{ value: "", label: "Choose a flow…" }, ...(missing ? [{ value: current, label: "(unavailable flow)" }] : []), ...targets.map((f) => ({ value: f.id, label: `${f.name}${f.isEntry ? " (entry)" : ""} · v${f.activeVersion}` }))]}
        />
      </Field>
      <Field label="Mode" problems={problems("mode")}>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" checked={node.data.mode === "jump"} onChange={() => setExecuteMode(node.id, "jump")} className="mt-0.5 accent-green-600" />
            <span>
              <span className="block text-[13px]">Jump</span>
              <span className="block text-[11px] text-slate-500">This flow ends and the target starts. No output.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" checked={node.data.mode === "call"} onChange={() => setExecuteMode(node.id, "call")} className="mt-0.5 accent-green-600" />
            <span>
              <span className="block text-[13px]">Call &amp; return</span>
              <span className="block text-[11px] text-slate-500">Runs the target, then continues from this node's output. Answers the target saves are available here.</span>
            </span>
          </label>
        </div>
      </Field>
      <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-500">Saved answers are shared across linked flows in the same conversation.</p>
    </>
  );
}

function EndForm({ node, update, problems }: FormProps) {
  return (
    <>
      <Field label="Closing message (optional)" problems={problems("message")}>
        <TextArea rows={3} value={node.data.message || ""} max={LIMITS.textBody} onChange={(v) => update({ message: v }, "message")} placeholder="✅ Done, thanks {{agent.name}}!" />
      </Field>
      <Toggle checked={node.data.saveSubmission !== false} onChange={(v) => update({ saveSubmission: v })} label="Save submission" hint="Stores every saved answer on the Submissions page. Ignored when this flow was called by another (the caller's End saves it)." />
    </>
  );
}

const FORMS = {
  trigger: TriggerForm,
  message: MessageForm,
  buttons: ButtonsForm,
  list: ListForm,
  question: QuestionForm,
  location: LocationForm,
  media: MediaForm,
  condition: ConditionForm,
  executeFlow: ExecuteFlowForm,
  end: EndForm,
};

export function NodePanel() {
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const updateNodeData = useEditor((s) => s.updateNodeData);
  const removeNodes = useEditor((s) => s.removeNodes);
  const select = useEditor((s) => s.select);
  const problems = useFieldProblems(node?.id || "");
  const nodeProblems = useEditor((s) => (node ? s.problemsByNode.get(node.id) : undefined));

  if (!node) {
    return (
      <aside className="flex w-80 shrink-0 flex-col items-center justify-center border-l border-slate-200 bg-white p-6 text-center text-[13px] text-slate-500">
        <p className="font-medium text-slate-700">No node selected</p>
        <p className="mt-1">Click a node to edit its settings. Drag nodes in from the left, or use the + on any output.</p>
      </aside>
    );
  }

  const meta = NODE_META[node.type];
  const Form = FORMS[node.type];
  const Icon = meta.icon;
  const update: Update = (patch, key) => updateNodeData(node.id, patch, key ? `${node.id}.${key}` : undefined);
  const general = (nodeProblems || []).filter((p) => !p.field || p.field === "next");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded" style={{ background: meta.color }}>
          <Icon size={15} color="white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">{meta.label}</div>
          <input value={node.data.label ?? ""} maxLength={LIMITS.label} onChange={(e) => update({ label: e.target.value }, "label")} className="w-full truncate text-[14px] font-semibold text-slate-800 outline-none" placeholder={meta.label} />
        </div>
        <button type="button" className="icon-btn" title="Close" onClick={() => select(null)}>
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {general.length > 0 && (
          <div className="rounded-md border border-red-100 bg-red-50/60 p-2">
            <ProblemText problems={general} />
          </div>
        )}
        <Form node={node} update={update} problems={problems} />
        {DISABLABLE_TYPES.has(node.type) && (
          <div className="border-t border-slate-100 pt-3">
            <Toggle checked={Boolean(node.data.disabled)} onChange={(v) => update({ disabled: v })} label="Disable node" hint="Skipped at runtime; the flow goes straight to the next node." />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2">
        <span className="text-[11px] text-slate-400">
          ID <code>{node.id}</code>
        </span>
        <button type="button" onClick={() => removeNodes([node.id])} className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-red-600 hover:bg-red-50">
          <Trash2 size={13} /> Delete node
        </button>
      </div>
    </aside>
  );
}
