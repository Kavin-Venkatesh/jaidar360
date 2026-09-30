import {
  CircleStop,
  Image as ImageIcon,
  List,
  MapPin,
  MessageCircleQuestion,
  MessageSquareText,
  SquareMousePointer,
  Split,
  SquareArrowOutUpRight,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { optionId, ruleId, sectionId } from "../lib/ids";
import type { FlowNode, NodeData, NodeType } from "../lib/types";

export interface NodeMeta {
  type: NodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string; // accent for the icon tile
}

export const NODE_CATALOG: NodeMeta[] = [
  { type: "trigger", label: "Trigger", description: "Starts the flow on keywords like “hi”", icon: Zap, color: "#f59e0b" },
  { type: "message", label: "Send Message", description: "Text, optionally with an image", icon: MessageSquareText, color: "#0ea5e9" },
  { type: "buttons", label: "Buttons", description: "Up to 3 reply buttons, one output each", icon: SquareMousePointer, color: "#16a34a" },
  { type: "list", label: "List", description: "Menu of up to 10 rows, one output each", icon: List, color: "#15803d" },
  { type: "question", label: "Ask Question", description: "Text, number, phone, email or date", icon: MessageCircleQuestion, color: "#8b5cf6" },
  { type: "location", label: "Ask Location", description: "Asks the agent to share their location", icon: MapPin, color: "#ef4444" },
  { type: "media", label: "Ask Media", description: "Photo or document upload", icon: ImageIcon, color: "#ec4899" },
  { type: "condition", label: "If / Condition", description: "Branch on saved answers", icon: Split, color: "#64748b" },
  { type: "executeFlow", label: "Execute Flow", description: "Jump to, or call and return from, another flow", icon: SquareArrowOutUpRight, color: "#0d9488" },
  { type: "end", label: "End", description: "Closing message and save the submission", icon: CircleStop, color: "#475569" },
];

export const NODE_META = Object.fromEntries(NODE_CATALOG.map((m) => [m.type, m])) as Record<NodeType, NodeMeta>;

// Suggest a unique snake_case variable for nodes that save answers.
function nextVariable(base: string, nodes: FlowNode[]) {
  const used = new Set(nodes.map((n) => n.data?.saveAs).filter(Boolean));
  for (let i = 1; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function defaultData(type: NodeType, nodes: FlowNode[]): NodeData {
  switch (type) {
    case "trigger":
      return { label: "Start", keywords: [] };
    case "message":
      return { label: "Message", text: "" };
    case "buttons":
      return {
        label: "Buttons",
        body: "",
        buttons: [
          { id: optionId(), title: "Option 1" },
          { id: optionId(), title: "Option 2" },
        ],
        saveAs: "",
      };
    case "list":
      return {
        label: "List",
        body: "",
        buttonLabel: "Choose",
        sections: [{ id: sectionId(), title: "", rows: [{ id: optionId(), title: "Option 1", description: "" }] }],
        saveAs: "",
      };
    case "question":
      return { label: "Question", prompt: "", inputType: "text", validation: {}, errorMessage: "", maxAttempts: 3, saveAs: nextVariable("answer", nodes) };
    case "location":
      return { label: "Location", prompt: "📍 Please share your current location.", saveAs: nextVariable("location", nodes) };
    case "media":
      return { label: "Media", prompt: "📷 Please send a photo.", accept: "image", required: true, saveAs: nextVariable("photo", nodes) };
    case "condition":
      return { label: "If", match: "all", rules: [{ id: ruleId(), variable: "", operator: "equals", value: "" }] };
    case "executeFlow":
      return { label: "Execute flow", targetFlowId: "", mode: "jump" };
    case "end":
      return { label: "End", message: "", saveSubmission: true };
  }
}
