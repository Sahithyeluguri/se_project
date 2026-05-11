// All backend calls go through here.
// Swap BASE_URL to your server address when deploying.

const BASE_URL = "";  // empty = same origin (works with Vite proxy)

async function req(method, path, body) {
  const res = await fetch(BASE_URL + path, {
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
  myTickets:      (customerId)         => req("GET",  `/customers/${customerId}/tickets`),
  agentTickets:   (agentId)            => req("GET",  `/agents/${agentId}/tickets`),
  allTickets:     ()                   => req("GET",  "/tickets"),
  getTicket:      (ref)                => req("GET",  `/tickets/${ref}`),
  createTicket:   (data)               => req("POST", "/tickets", data),
  resolveTicket:  (ref, data)          => req("POST", `/tickets/${ref}/resolve`, data),
  allAgents:      ()                   => req("GET",  "/agents"),
};
