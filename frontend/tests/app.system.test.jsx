import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../src/App.jsx";
import { API } from "../src/api.js";

jest.mock("../src/api.js", () => ({
  API: {
    login: jest.fn(),
    signup: jest.fn(),
    myTickets: jest.fn(),
    agentTickets: jest.fn(),
    allTickets: jest.fn(),
    getTicket: jest.fn(),
    createTicket: jest.fn(),
    resolveTicket: jest.fn(),
    allAgents: jest.fn(),
  },
}));

describe("System | App portal flows", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("customer can sign in and submit a ticket through the chat flow", async () => {
    API.login.mockResolvedValue({
      id: 1,
      username: "customer1",
      name: "Customer One",
      role: "customer",
    });
    API.myTickets.mockResolvedValue([]);
    API.createTicket.mockResolvedValue({
      id: 101,
      ticket_ref: "TKT-1001",
      subject: "Production API outage",
      body: "The checkout API is returning 500 for every request.",
      priority: "high",
      queue: "Technical Support",
      status: "open",
      assigned_agent_name: "Agent 7",
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /customer/i }));
    fireEvent.change(screen.getByLabelText("USERNAME"), {
      target: { value: "customer1" },
    });
    fireEvent.change(screen.getByLabelText("PASSWORD"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /sign in/i })[1]);

    expect(API.login).toHaveBeenCalledWith({
      username: "customer1",
      password: "pass123",
      role: "customer",
    });

    expect(await screen.findByText("Support Chat")).toBeInTheDocument();
    expect(API.myTickets).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "Production API outage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    jest.advanceTimersByTime(700);
    expect(await screen.findByText(/describe the issue in more detail/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "The checkout API is returning 500 for every request." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    jest.advanceTimersByTime(700);
    expect(await screen.findByText(/ready to submit/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "yes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(API.createTicket).toHaveBeenCalledWith({
        customer_id: 1,
        subject: "Production API outage",
        body: "The checkout API is returning 500 for every request.",
      }),
    );

    jest.advanceTimersByTime(1500);
    expect(await screen.findByText(/ticket tkt-1001 raised/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /my tickets \(1\)/i })).toBeInTheDocument();
  });

  test("customer small-talk does not create a ticket", async () => {
    API.login.mockResolvedValue({
      id: 1,
      username: "customer1",
      name: "Customer One",
      role: "customer",
    });
    API.myTickets.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /customer/i }));
    fireEvent.change(screen.getByLabelText("USERNAME"), {
      target: { value: "customer1" },
    });
    fireEvent.change(screen.getByLabelText("PASSWORD"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /sign in/i })[1]);

    expect(await screen.findByText("Support Chat")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    jest.advanceTimersByTime(700);
    expect(await screen.findByText(/doesn't look like a support issue yet/i)).toBeInTheDocument();
    expect(API.createTicket).not.toHaveBeenCalled();
  });

  test("customer must provide meaningful detail in the second chat step", async () => {
    API.login.mockResolvedValue({
      id: 1,
      username: "customer1",
      name: "Customer One",
      role: "customer",
    });
    API.myTickets.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /customer/i }));
    fireEvent.change(screen.getByLabelText("USERNAME"), {
      target: { value: "customer1" },
    });
    fireEvent.change(screen.getByLabelText("PASSWORD"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /sign in/i })[1]);

    expect(await screen.findByText("Support Chat")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "Production API outage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    jest.advanceTimersByTime(700);
    expect(await screen.findByText(/describe the issue in more detail/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Type your message..."), {
      target: { value: "ok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    jest.advanceTimersByTime(700);
    expect(await screen.findByText(/i need a bit more detail before i create a ticket/i)).toBeInTheDocument();
    expect(screen.queryByText(/ready to submit/i)).not.toBeInTheDocument();
    expect(API.createTicket).not.toHaveBeenCalled();
  });

  test("support agent can resolve an assigned ticket", async () => {
    API.login.mockResolvedValue({
      id: 7,
      username: "support1",
      name: "Agent 1",
      role: "support",
    });
    API.agentTickets.mockResolvedValue([
      {
        id: 200,
        ticket_ref: "TKT-2000",
        subject: "VPN is unavailable",
        body: "Remote staff cannot connect to the VPN gateway.",
        priority: "high",
        status: "open",
        queue: "IT Support",
        customer_id: 4,
        top5_ranking: [],
      },
    ]);
    API.resolveTicket.mockResolvedValue({
      id: 200,
      ticket_ref: "TKT-2000",
      subject: "VPN is unavailable",
      body: "Remote staff cannot connect to the VPN gateway.",
      priority: "high",
      status: "resolved",
      queue: "IT Support",
      customer_id: 4,
      resolution_notes: "Restarted the gateway and restored user access.",
      top5_ranking: [],
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /support agent/i }));
    fireEvent.change(screen.getByLabelText("USERNAME"), {
      target: { value: "support1" },
    });
    fireEvent.change(screen.getByLabelText("PASSWORD"), {
      target: { value: "pass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Active Tickets")).toBeInTheDocument();
    expect(await screen.findByText("VPN is unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByText("VPN is unavailable"));
    fireEvent.change(screen.getByPlaceholderText(/describe how you resolved/i), {
      target: { value: "Restarted the gateway and restored user access." },
    });
    fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));

    await waitFor(() =>
      expect(API.resolveTicket).toHaveBeenCalledWith("TKT-2000", {
        agent_id: 7,
        resolution_notes: "Restarted the gateway and restored user access.",
      }),
    );

    expect(await screen.findByText(/resolution/i)).toBeInTheDocument();
    expect(screen.getByText("Restarted the gateway and restored user access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark resolved/i })).not.toBeInTheDocument();
  });
});
