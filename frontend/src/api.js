// All backend calls go through here.
// In local dev, leave VITE_API_BASE_URL unset so Vite proxies to localhost:8000.
// In hosted builds, default to the deployed Hugging Face backend unless overridden.
const IS_LOCALHOST =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || (IS_LOCALHOST ? "" : "https://ueusj-supportai-backend.hf.space")).replace(/\/$/, "");

async function readErrorMessage(res) {
  const text = await res.text().catch(() => "");
  if (!text) return `HTTP ${res.status}`;

  try {
    const data = JSON.parse(text);
    return data.detail || data.message || `HTTP ${res.status}`;
  } catch {
    return text;
  }
}

async function req(method, path, body) {
  const res = await fetch(BASE_URL ? `${BASE_URL}${path}` : path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res.json();
}

export const API = {
  login:          (data)               => req("POST", "/auth/login", data),
  signup:         (data)               => req("POST", "/auth/signup", data),
  forgotPassword: (data)               => req("POST", "/auth/forgot-password", data),
  myTickets:      (customerId)         => req("GET",  `/customers/${customerId}/tickets`),
  agentTickets:   (agentId)            => req("GET",  `/agents/${agentId}/tickets`),
  allTickets:     ()                   => req("GET",  "/tickets"),
  getTicket:      (ref)                => req("GET",  `/tickets/${ref}`),
  createTicket:   (data)               => req("POST", "/tickets", data),
  resolveTicket:  (ref, data)          => req("POST", `/tickets/${ref}/resolve`, data),
  allAgents:      ()                   => req("GET",  "/agents"),
};
