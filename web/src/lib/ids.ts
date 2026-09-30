const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export function randomId(prefix: string, length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}

export const nodeId = () => randomId("n");
export const optionId = () => randomId("opt", 4);
export const edgeId = () => randomId("e", 8);
export const sectionId = () => randomId("sec", 4);
export const ruleId = () => randomId("r", 4);
