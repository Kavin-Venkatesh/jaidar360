import type { Me } from "./types";

const TOKEN_KEY = "wa-canvas.token";
const ME_KEY = "wa-canvas.me";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode: the session just won't survive a reload.
  }
}

let memoryToken = read(TOKEN_KEY);

export const session = {
  get token() {
    return memoryToken;
  },
  get me(): Me | null {
    const raw = read(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  },
  signIn(token: string, me: Me) {
    memoryToken = token;
    write(TOKEN_KEY, token);
    write(ME_KEY, JSON.stringify(me));
  },
  signOut() {
    memoryToken = null;
    write(TOKEN_KEY, null);
    write(ME_KEY, null);
  },
};

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.message === "string" ? body.message : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(session.token ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      session.signOut();
      window.location.assign(`${import.meta.env.BASE_URL}login`);
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}

// Plain links (media in submissions) can't send headers, so the token rides in the query string.
export function fileUrl(relativePath: string) {
  return `/api/files/${relativePath.split("/").map(encodeURIComponent).join("/")}?token=${encodeURIComponent(session.token || "")}`;
}
