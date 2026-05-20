// All backend calls go through here.
// In local dev, leave VITE_API_BASE_URL unset so Vite proxies to localhost:8000.
// For hosted builds, set VITE_API_BASE_URL to the deployed backend URL.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function req(method, path, body) {
  const res = await fetch(BASE_URL ? `${BASE_URL}${path}` : path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
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
