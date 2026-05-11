/**
 * SUPPORTIQ — COMPLETE TEST SUITE (JEST)
 * Covers:
 *   UNIT TESTS        (UT-01 … UT-07)
 *   INTEGRATION TESTS (IT-01 … IT-06)
 *   NEGATIVE / WRONG-OUTPUT TESTS  (NEG-01 … NEG-05)
 */

// DB MODULE
const DB = (() => {
  const customers = {};
  for (let i = 1; i <= 10; i++) {
    customers[`customer${i}`] = {
      id: i, username: `customer${i}`,
      password: `cust${i}pass`, full_name: `Customer ${i}`,
      email: `customer${i}@example.com`, active: true
    };
  }
  const supportTeam = {};
  const QUEUE_SPEC = {
    "Technical Support": ["Bug", "Performance", "Software", "API", "Crash"],
    "IT Support": ["Network", "Security", "IT", "Hardware", "Cloud"],
    "Billing and Payments": ["Billing", "Payment", "Account", "Refund"],
    "Product Support": ["Hardware", "Product Support", "Bug"],
    "Service Outages and Maintenance": ["Outage", "Disruption", "Maintenance", "Recovery"],
    "Returns and Exchanges": ["Returns and Exchanges", "Refund", "Order Issue"],
    "Customer Service": ["Customer Service", "Feedback", "Account"],
    "Sales and Pre-Sales": ["Sales", "Feature", "Documentation"],
    "General Inquiry": ["General Inquiry", "Documentation", "Feedback"],
    "Human Resources": ["HR", "Compliance", "Employee", "Policy"],
  };
  const QUEUE_KEYS = Object.keys(QUEUE_SPEC);
  for (let i = 1; i <= 20; i++) {
    const q = QUEUE_KEYS[(i - 1) % QUEUE_KEYS.length];
    supportTeam[`support${i}`] = {
      id: i, username: `support${i}`,
      password: `support${i}pass`, full_name: `Agent ${i}`,
      primary_queue: q, specialty: QUEUE_SPEC[q].slice(0, 3),
      current_load: 0, max_load: 5, active: true
    };
  }
  const admins = {
    admin: { username: "admin", password: "admin123", full_name: "Admin", role: "admin" }
  };
  const tickets = {};
  let counter = 1000;

  function login(username, password, role) {
    const u = (username || "").trim();
    const p = (password || "").trim();
    let found = null;
    if (role === "customer" && customers[u]?.password === p) found = { ...customers[u], role: "customer" };
    else if (role === "support" && supportTeam[u]?.password === p) found = { ...supportTeam[u], role: "support" };
    else if (role === "admin" && admins[u]?.password === p) found = { ...admins[u], role: "admin" };
    return found;
  }

  function genId() { return `TKT-${++counter}`; }

  function recalcLoads() {
    Object.values(supportTeam).forEach((a) => a.current_load = 0);
    Object.values(tickets).forEach((t) => {
      if ((t.status === "open" || t.status === "in-progress") && t.assigned_to) {
        if (supportTeam[t.assigned_to]) supportTeam[t.assigned_to].current_load++;
      }
    });
  }

  function getAgentHistory() {
    const history = {};
    Object.keys(supportTeam).forEach((k) => history[k] = []);
    Object.values(tickets).filter((t) => t.status === "resolved" && t.assigned_to).forEach((t) => {
      if (history[t.assigned_to]) {
        history[t.assigned_to].push({
          subject: t.subject, queue: t.queue,
          tags: t.tags, priority: t.priority, ticket_type: t.ticket_type
        });
      }
    });
    return history;
  }

  function selectAgent(ranked) {
    for (const r of ranked) {
      const a = supportTeam[r.agent];
      if (a && a.current_load < a.max_load) { a.current_load++; return r.agent; }
    }
    const least = Object.entries(supportTeam).sort((a, b) => a[1].current_load - b[1].current_load)[0];
    if (least) { supportTeam[least[0]].current_load++; return least[0]; }
    return "support1";
  }

  function resetLoads() { Object.values(supportTeam).forEach((a) => a.current_load = 0); }

  return { customers, supportTeam, admins, tickets, login, genId, recalcLoads, getAgentHistory, selectAgent, resetLoads, QUEUE_KEYS };
})();

// TRANSFORMER MODULE
const TransformerEngine = (() => {
  const STOPWORDS = new Set(["the","and","for","with","this","that","from","are","has","have",
    "been","will","your","our","can","not","but","all","its","was","had","who","what","how",
    "when","they","their","more","also","about","into","over","after","before","each","such",
    "than","then","these","other","some","same","just","there","were","which","would","could",
    "should","may","might","upon","where","while","both","here","those","through","much","per",
    "any","out","use","her","him","his","she","you","get","set","let","got","did","via","yet"]);

  let idfMap = null, corpusSize = 0;

  const MINI_CORPUS = [
    {s:"Server crash production database",q:"Technical Support",p:"high",t:"Incident",tg:["Bug","Crash","Performance"]},
    {s:"Invoice wrong amount charged",q:"Billing and Payments",p:"medium",t:"Problem",tg:["Billing","Payment","Account"]},
    {s:"Network connectivity dropping",q:"IT Support",p:"high",t:"Incident",tg:["Network","IT","Outage"]},
    {s:"Feature request bulk CSV export",q:"General Inquiry",p:"low",t:"Change",tg:["Feature","Documentation"]},
    {s:"Security breach unauthorized access",q:"IT Support",p:"high",t:"Incident",tg:["Security","Data Breach","IT"]},
    {s:"AWS service outage all regions",q:"Service Outages and Maintenance",p:"high",t:"Incident",tg:["Outage","Cloud","Disruption"]},
    {s:"Refund not processed fourteen days",q:"Returns and Exchanges",p:"medium",t:"Request",tg:["Refund","Payment"]},
    {s:"API integration returns 500 error",q:"Technical Support",p:"high",t:"Problem",tg:["API","Bug","Software"]},
    {s:"Product documentation update guide",q:"Product Support",p:"low",t:"Request",tg:["Documentation","Feature"]},
    {s:"Slow page load performance issue",q:"Technical Support",p:"medium",t:"Problem",tg:["Performance","Network"]},
  ];

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  }

  function buildIDF(corpus) {
    idfMap = new Map(); corpusSize = corpus.length;
    for (const doc of corpus) {
      const text = `${doc.s || ""} ${(doc.tg || []).join(" ")} ${doc.q || ""} ${doc.t || ""}`;
      for (const t of new Set(tokenize(text))) idfMap.set(t, (idfMap.get(t) || 0) + 1);
    }
    for (const [term, df] of idfMap) idfMap.set(term, Math.log(corpusSize / (1 + df)) + 1);
  }

  function tfidfVector(text, extraTags = []) {
    const allText = `${text} ${extraTags.join(" ")}`;
    const tokens = tokenize(allText);
    if (!tokens.length) return new Map();
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const maxTF = Math.max(...tf.values());
    const vec = new Map();
    for (const [t, count] of tf) {
      const idf = idfMap?.get(t) || 0.1;
      vec.set(t, (count / maxTF) * idf);
    }
    return vec;
  }

  function cosine(v1, v2) {
    if (!v1.size || !v2.size) return 0;
    let dot = 0, n1 = 0, n2 = 0;
    for (const [t, w] of v1) { dot += w * (v2.get(t) || 0); n1 += w * w; }
    for (const [, w] of v2) n2 += w * w;
    const denom = Math.sqrt(n1) * Math.sqrt(n2);
    return denom > 0 ? dot / denom : 0;
  }

  function rankAgents({ subject, tags, queue, priority, type_, agentHistory }) {
    void priority;
    void type_;
    if (!idfMap) buildIDF(MINI_CORPUS);
    const queryVec = tfidfVector(subject, tags || []);
    const scores = {};
    for (const [agent, history] of Object.entries(agentHistory || {})) {
      if (!history?.length) { scores[agent] = 0.25; continue; }
      let best = 0;
      for (const rt of history) {
        const rtVec = tfidfVector(`${rt.subject || ""} ${rt.queue || ""}`, rt.tags || []);
        const sim = cosine(queryVec, rtVec);
        const tagOverlap = (tags || []).filter((t) => (rt.tags || []).map((x) => x.toLowerCase()).includes(t.toLowerCase())).length;
        const queueBonus = rt.queue === queue ? 0.08 : 0;
        const total = sim + tagOverlap * 0.05 + queueBonus;
        if (total > best) best = total;
      }
      scores[agent] = best;
    }
    return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([agent, score]) => ({ agent, score: Math.min(0.99, score), tfidf_score: Math.min(0.99, score), reason: "Matched by similarity" }));
  }

  function textSimilarity(t1, t2) {
    if (!idfMap) buildIDF(MINI_CORPUS);
    return cosine(tfidfVector(t1), tfidfVector(t2));
  }

  return { tokenize, buildIDF, tfidfVector, cosine, rankAgents, textSimilarity, MINI_CORPUS };
})();

// PRIORITY CLASSIFIER
const PriorityClassifier = (() => {
  const HIGH_KW = ["urgent","critical","emergency","crash","outage","breach","unauthorized","virus","malware","down","failed","blocked","inaccessible","severe","immediately","security incident","data loss"];
  const LOW_KW = ["inquiry","feature","documentation","guidance","suggestion","enhancement","when possible","low priority","general question"];
  const sig = { high: {}, medium: {}, low: {} };
  let trained = false;

  function train(corpus) {
    for (const p of ["high", "medium", "low"]) sig[p] = {};
    for (const doc of corpus) {
      const p = doc.p; if (!sig[p]) continue;
      const words = [...(doc.s || "").toLowerCase().split(/\s+/), ...(doc.tg || []).map((t) => t.toLowerCase())];
      for (const w of words) if (w.length >= 3) sig[p][w] = (sig[p][w] || 0) + 1;
    }
    trained = true;
  }

  function classify(subject, body = "") {
    const text = `${subject} ${body}`.toLowerCase();
    let h = 0, m = 5, l = 0;
    for (const kw of HIGH_KW) if (text.includes(kw)) h += 6;
    for (const kw of LOW_KW) if (text.includes(kw)) l += 2;
    if (trained) {
      for (const w of text.split(/\s+/)) {
        h += (sig.high[w] || 0) * 0.03;
        m += (sig.medium[w] || 0) * 0.03;
        l += (sig.low[w] || 0) * 0.03;
      }
    }
    const total = h + m + l || 1;
    const high = h / total, medium = m / total, low = l / total;
    const predicted = h > m && h > l ? "high" : l > h && l > m ? "low" : "medium";
    return { predicted, high, medium, low };
  }

  return { train, classify, HIGH_KW, LOW_KW };
})();

// QUEUE CLASSIFIER
const QueueClassifier = (() => {
  const QUEUES = ["Technical Support","Billing and Payments","Customer Service","Returns and Exchanges","Product Support","IT Support","Service Outages and Maintenance","Sales and Pre-Sales","General Inquiry","Human Resources"];
  const RULES = {
    "Technical Support": ["error","bug","crash","not working","fail","api","software","server","database","exception","code"],
    "Billing and Payments": ["billing","invoice","payment","charge","refund","fee","cost","overcharge","transaction","receipt"],
    "Returns and Exchanges": ["return","exchange","replace","defective","warranty","ship","deliver","order","damaged","wrong item"],
    "IT Support": ["network","wifi","vpn","access","login","password","security","breach","firewall","virus","infrastructure"],
    "Service Outages and Maintenance": ["outage","down","offline","unavailable","maintenance","disruption","service interrupt","downtime"],
    "Product Support": ["product","feature","setup","install","configure","guide","documentation","manual","firmware","driver"],
    "Customer Service": ["complaint","dissatisfied","feedback","poor service","unhappy","disappointed","escalate"],
    "Sales and Pre-Sales": ["pricing","purchase","demo","trial","license","quote","proposal","enterprise","upgrade"],
    "Human Resources": ["employee","hr","payroll","leave","attendance","policy","recruit","benefits","vacation"],
    "General Inquiry": ["information","general","question","inquiry","curious","what is","how does"],
  };
  const qSig = {};
  for (const q of QUEUES) qSig[q] = {};
  let trained = false;

  function train(corpus) {
    for (const q of QUEUES) qSig[q] = {};
    for (const doc of corpus) {
      const q = doc.q; if (!qSig[q]) continue;
      const words = [...(doc.s || "").toLowerCase().split(/\s+/), ...(doc.tg || []).map((t) => t.toLowerCase())];
      for (const w of words) if (w.length >= 3) qSig[q][w] = (qSig[q][w] || 0) + 1;
    }
    trained = true;
  }

  function scoreAll(subject, body = "") {
    const text = `${subject} ${body}`.toLowerCase();
    const scores = {};
    for (const q of QUEUES) {
      scores[q] = (RULES[q] || []).filter((kw) => text.includes(kw)).length * 3;
      if (trained) for (const w of text.split(/\s+/)) scores[q] += (qSig[q][w] || 0) * 0.05;
    }
    return scores;
  }

  function classify(subject, body = "") {
    const scores = scoreAll(subject, body);
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || "Technical Support";
  }

  function classifyTopN(subject, body = "", n = 3) {
    const scores = scoreAll(subject, body);
    const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n).map(([q, s]) => ({ queue: q, confidence: s / total }));
  }

  return { QUEUES, RULES, train, classify, classifyTopN, scoreAll };
})();

// TYPE CLASSIFIER
const TypeClassifier = (() => {
  const RULES = {
    Incident: ["crash","outage","down","not working","error","fail","disruption","breach","unavailable","offline","sudden","frozen"],
    Request: ["request","please","could you","can you","need","require","would like","want to","help me","enable","grant","reset"],
    Problem: ["problem","issue","incorrect","wrong","discrepancy","bug","not correct","defect","mismatch","recurring"],
    Change: ["change","update","modify","configure","upgrade","migrate","implement","improve","enhance","optimize","deploy"],
  };

  function classify(subject, body = "") {
    const text = `${subject} ${body}`.toLowerCase();
    let best = "Incident", bestScore = 0;
    for (const [t, rules] of Object.entries(RULES)) {
      const score = rules.filter((kw) => text.includes(kw)).length;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  function classifyAll(subject, body = "") {
    const text = `${subject} ${body}`.toLowerCase();
    return Object.fromEntries(Object.entries(RULES).map(([t, rules]) => [t, rules.filter((kw) => text.includes(kw)).length]));
  }

  return { RULES, classify, classifyAll };
})();

// TAG EXTRACTOR
const TagExtractor = (() => {
  const TAG_MAP = {
    Security: ["security","breach","unauthorized","encrypt","vulnerab","hack","firewall"],
    "Data Breach": ["data breach","data loss","leak","stolen data","compromised data"],
    Outage: ["outage","down","offline","unavailab","service interrupt"],
    Disruption: ["disruption","disrupt","interrupt","degraded"],
    Network: ["network","wifi","vpn","connectivity","router","bandwidth","dns"],
    Bug: ["bug","error","exception","defect","glitch","crash","fault"],
    Crash: ["crash","system crash","application crash"],
    Performance: ["slow","performance","latency","timeout","lag","speed","throughput"],
    Billing: ["billing","invoice","payment","charge","fee","price","overcharg"],
    Refund: ["refund","money back","reimburse"],
    Account: ["account","login","password","username","access","profile","credentials"],
    IT: ["it support","infrastructure","server","database","cloud"],
    Hardware: ["hardware","device","printer","laptop","monitor","keyboard"],
    Software: ["software","app","application","program","install"],
    API: ["api","integration","webhook","endpoint","rest","sdk"],
    Cloud: ["cloud","aws","azure","gcp","google cloud"],
    Feature: ["feature request","new feature","functionality","enhancement"],
    Documentation: ["documentation","guide","manual","tutorial","how to"],
    "Urgent Issue": ["urgent","critical","emergency","immediately","asap"],
    Virus: ["virus","malware","ransomware","trojan","phishing"],
  };

  function extract(subject, body = "", maxTags = 6) {
    const text = `${subject} ${body}`.toLowerCase();
    return Object.entries(TAG_MAP).filter(([, kws]) => kws.some((kw) => text.includes(kw))).map(([tag]) => tag).slice(0, maxTags);
  }

  function extractWithScores(subject, body = "") {
    const text = `${subject} ${body}`.toLowerCase();
    return Object.entries(TAG_MAP)
      .map(([tag, kws]) => ({ tag, matchCount: kws.filter((kw) => text.includes(kw)).length }))
      .filter((x) => x.matchCount > 0).sort((a, b) => b.matchCount - a.matchCount);
  }

  return { TAG_MAP, extract, extractWithScores };
})();

// ASSIGNMENT ENGINE
const AssignmentEngine = {
  blend(tfidfRanking, claudeRanking, w_tfidf = 0.6, w_claude = 0.4) {
    if (!claudeRanking?.length) return tfidfRanking;
    const cm = Object.fromEntries(claudeRanking.map((r) => [r.agent, parseFloat(r.score) || 0]));
    return tfidfRanking.map((r) => {
      const cs = cm[r.agent] ?? r.tfidf_score;
      return { ...r, claude_score: cs, score: Math.min(0.99, r.tfidf_score * w_tfidf + cs * w_claude) };
    }).sort((a, b) => b.score - a.score);
  },
  selectAgent(ranking, supportTeam) {
    for (const r of ranking) {
      const a = supportTeam[r.agent];
      if (a && a.current_load < a.max_load) return r.agent;
    }
    if (Object.keys(supportTeam).length) {
      return Object.entries(supportTeam).sort((a, b) => a[1].current_load - b[1].current_load)[0][0];
    }
    return ranking[0]?.agent || "support1";
  }
};

describe("UT-01 | Auth / DB Module", () => {
  describe("login() — valid credentials", () => {
    test("UT-01-001 — customer1 logs in with correct password", () => {
      const result = DB.login("customer1", "cust1pass", "customer");
      expect(result).not.toBeNull();
      expect(result.username).toBe("customer1");
      expect(result.role).toBe("customer");
    });

    test("UT-01-002 — support3 logs in with correct password", () => {
      const result = DB.login("support3", "support3pass", "support");
      expect(result).not.toBeNull();
      expect(result.role).toBe("support");
    });

    test("UT-01-003 — admin logs in with correct credentials", () => {
      const result = DB.login("admin", "admin123", "admin");
      expect(result).not.toBeNull();
      expect(result.role).toBe("admin");
    });

    test("UT-01-004 — all 10 customers exist in DB with correct IDs", () => {
      for (let i = 1; i <= 10; i++) {
        const r = DB.login(`customer${i}`, `cust${i}pass`, "customer");
        expect(r).not.toBeNull();
        expect(r.id).toBe(i);
      }
    });

    test("UT-01-005 — all 20 support agents exist in DB with correct IDs", () => {
      for (let i = 1; i <= 20; i++) {
        const r = DB.login(`support${i}`, `support${i}pass`, "support");
        expect(r).not.toBeNull();
        expect(r.id).toBe(i);
      }
    });

    test("UT-01-006 — returned customer object has required fields", () => {
      const r = DB.login("customer1", "cust1pass", "customer");
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("username");
      expect(r).toHaveProperty("email");
      expect(r).toHaveProperty("role");
    });

    test("UT-01-007 — returned support agent has primary_queue field", () => {
      const r = DB.login("support1", "support1pass", "support");
      expect(r).toHaveProperty("primary_queue");
      expect(typeof r.primary_queue).toBe("string");
    });
  });

  describe("login() — invalid / edge-case credentials", () => {
    test("UT-01-008 — wrong password returns null", () => {
      expect(DB.login("customer1", "wrongpass", "customer")).toBeNull();
    });

    test("UT-01-009 — non-existent username returns null", () => {
      expect(DB.login("customer999", "anypass", "customer")).toBeNull();
    });

    test("UT-01-010 — customer creds used under support role → null", () => {
      expect(DB.login("customer1", "cust1pass", "support")).toBeNull();
    });

    test("UT-01-011 — support creds used under customer role → null", () => {
      expect(DB.login("support1", "support1pass", "customer")).toBeNull();
    });

    test("UT-01-012 — empty username returns null", () => {
      expect(DB.login("", "cust1pass", "customer")).toBeNull();
    });

    test("UT-01-013 — whitespace-only username trimmed → null", () => {
      expect(DB.login("   ", "cust1pass", "customer")).toBeNull();
    });

    test("UT-01-014 — username is case-sensitive (Customer1 ≠ customer1)", () => {
      expect(DB.login("Customer1", "cust1pass", "customer")).toBeNull();
    });

    test("UT-01-015 — SQL injection strings in username → null (not executed)", () => {
      const injections = ["' OR '1'='1", "admin'--", "'; DROP TABLE customers;--", "\" OR \"1\"=\"1"];
      for (const payload of injections) {
        expect(DB.login(payload, "anypass", "customer")).toBeNull();
      }
    });

    test("UT-01-016 — undefined password → null", () => {
      expect(DB.login("customer1", undefined, "customer")).toBeNull();
    });

    test("UT-01-017 — correct admin username, wrong password → null", () => {
      expect(DB.login("admin", "wrongpass", "admin")).toBeNull();
    });
  });

  describe("genId()", () => {
    test("UT-01-018 — generates sequential TKT- prefixed IDs", () => {
      const id1 = DB.genId();
      const id2 = DB.genId();
      expect(id1).toMatch(/^TKT-\d+$/);
      expect(id2).toMatch(/^TKT-\d+$/);
      expect(id1).not.toBe(id2);
    });

    test("UT-01-019 — each generated ID is unique across 50 calls", () => {
      const ids = new Set();
      for (let i = 0; i < 50; i++) ids.add(DB.genId());
      expect(ids.size).toBe(50);
    });
  });

  describe("selectAgent()", () => {
    beforeEach(() => DB.resetLoads());

    test("UT-01-020 — picks first ranked agent when available", () => {
      const ranking = [
        { agent: "support5", score: 0.95 },
        { agent: "support1", score: 0.88 },
      ];
      expect(DB.selectAgent(ranking)).toBe("support5");
    });

    test("UT-01-021 — skips full agent, picks next available", () => {
      DB.supportTeam.support5.current_load = 5;
      const ranking = [
        { agent: "support5", score: 0.95 },
        { agent: "support1", score: 0.88 },
      ];
      expect(DB.selectAgent(ranking)).toBe("support1");
      DB.supportTeam.support5.current_load = 0;
    });

    test("UT-01-022 — falls back to least-loaded agent when all ranked are full", () => {
      DB.supportTeam.support1.current_load = 5;
      DB.supportTeam.support5.current_load = 5;
      const ranking = [{ agent: "support1", score: 0.9 }, { agent: "support5", score: 0.8 }];
      const assigned = DB.selectAgent(ranking);
      expect(DB.supportTeam[assigned].current_load).toBeLessThan(5);
      DB.supportTeam.support1.current_load = 0;
      DB.supportTeam.support5.current_load = 0;
    });

    test("UT-01-023 — agent load increments after selection", () => {
      const before = DB.supportTeam.support2.current_load;
      DB.selectAgent([{ agent: "support2", score: 0.9 }]);
      expect(DB.supportTeam.support2.current_load).toBe(before + 1);
    });
  });

  describe("recalcLoads()", () => {
    beforeEach(() => {
      DB.resetLoads();
      Object.keys(DB.tickets).forEach((k) => delete DB.tickets[k]);
    });

    test("UT-01-024 — open ticket increments agent load", () => {
      const id = DB.genId();
      DB.tickets[id] = { status: "open", assigned_to: "support1" };
      DB.recalcLoads();
      expect(DB.supportTeam.support1.current_load).toBe(1);
    });

    test("UT-01-025 — resolved ticket does not count toward load", () => {
      const id = DB.genId();
      DB.tickets[id] = { status: "resolved", assigned_to: "support1" };
      DB.recalcLoads();
      expect(DB.supportTeam.support1.current_load).toBe(0);
    });

    test("UT-01-026 — unassigned ticket does not affect any agent", () => {
      const id = DB.genId();
      DB.tickets[id] = { status: "open", assigned_to: null };
      DB.recalcLoads();
      expect(DB.supportTeam.support1.current_load).toBe(0);
    });
  });
});

describe("UT-02 | TF-IDF Transformer Engine", () => {
  beforeAll(() => TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS));

  describe("tokenize()", () => {
    test("UT-02-001 — converts text to lowercase tokens", () => {
      const tokens = TransformerEngine.tokenize("Server CRASH Production");
      expect(tokens).toContain("server");
      expect(tokens).toContain("crash");
      expect(tokens).toContain("production");
    });

    test("UT-02-002 — removes stopwords", () => {
      const tokens = TransformerEngine.tokenize("the server and the database are down");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("and");
      expect(tokens).not.toContain("are");
      expect(tokens).toContain("server");
      expect(tokens).toContain("database");
    });

    test("UT-02-003 — filters tokens shorter than 3 characters", () => {
      const tokens = TransformerEngine.tokenize("go do it on db");
      expect(tokens.every((t) => t.length > 2)).toBe(true);
    });

    test("UT-02-004 — returns empty array for empty string", () => {
      expect(TransformerEngine.tokenize("")).toEqual([]);
    });

    test("UT-02-005 — returns empty array for null", () => {
      expect(TransformerEngine.tokenize(null)).toEqual([]);
    });

    test("UT-02-006 — strips special characters and punctuation", () => {
      const tokens = TransformerEngine.tokenize("error: 500! crash@production#server");
      expect(tokens).toContain("error");
      expect(tokens).toContain("crash");
      expect(tokens).toContain("production");
      expect(tokens).toContain("server");
    });

    test("UT-02-007 — handles repeated words (should not crash)", () => {
      const tokens = TransformerEngine.tokenize("crash crash crash");
      expect(tokens).toContain("crash");
    });
  });

  describe("tfidfVector()", () => {
    test("UT-02-008 — returns non-empty Map for valid text", () => {
      const vec = TransformerEngine.tfidfVector("server crash production");
      expect(vec.size).toBeGreaterThan(0);
    });

    test("UT-02-009 — returns empty Map for empty string", () => {
      expect(TransformerEngine.tfidfVector("").size).toBe(0);
    });

    test("UT-02-010 — includes extra tags in the vector", () => {
      const vec = TransformerEngine.tfidfVector("server crash", ["Outage", "Bug"]);
      expect(vec.size).toBeGreaterThan(0);
    });

    test("UT-02-011 — all weights in vector are positive", () => {
      const vec = TransformerEngine.tfidfVector("network security breach");
      for (const [, w] of vec) expect(w).toBeGreaterThan(0);
    });
  });

  describe("cosine()", () => {
    test("UT-02-012 — identical vectors return ~1.0", () => {
      const v = TransformerEngine.tfidfVector("server crash production database");
      expect(TransformerEngine.cosine(v, v)).toBeCloseTo(1.0, 2);
    });

    test("UT-02-013 — semantically related texts return similarity > 0", () => {
      const v1 = TransformerEngine.tfidfVector("server crash production down");
      const v2 = TransformerEngine.tfidfVector("production server failure system down");
      expect(TransformerEngine.cosine(v1, v2)).toBeGreaterThan(0);
    });

    test("UT-02-014 — unrelated texts (billing vs network crash) return low similarity", () => {
      const v1 = TransformerEngine.tfidfVector("billing invoice payment refund");
      const v2 = TransformerEngine.tfidfVector("server crash network firewall");
      expect(TransformerEngine.cosine(v1, v2)).toBeLessThan(0.4);
    });

    test("UT-02-015 — empty vectors return 0", () => {
      expect(TransformerEngine.cosine(new Map(), new Map())).toBe(0);
    });

    test("UT-02-016 — cosine result is always in [0, 1]", () => {
      const v1 = TransformerEngine.tfidfVector("urgent critical crash");
      const v2 = TransformerEngine.tfidfVector("feature request documentation");
      const sim = TransformerEngine.cosine(v1, v2);
      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    });
  });

  describe("rankAgents()", () => {
    const agentHistory = {
      support1: [{ subject: "API crash production", queue: "Technical Support", tags: ["Bug", "Crash"], priority: "high", ticket_type: "Incident" }],
      support2: [{ subject: "Network firewall breach", queue: "IT Support", tags: ["Network", "Security"], priority: "high", ticket_type: "Incident" }],
      support3: [{ subject: "Invoice billing error", queue: "Billing and Payments", tags: ["Billing", "Payment"], priority: "medium", ticket_type: "Problem" }],
      support4: [],
      support5: [{ subject: "AWS outage disruption", queue: "Service Outages and Maintenance", tags: ["Outage", "Cloud"], priority: "high", ticket_type: "Incident" }],
    };

    test("UT-02-017 — returns exactly 5 ranked agents", () => {
      const r = TransformerEngine.rankAgents({ subject: "Server crash", tags: ["Bug"], queue: "Technical Support", priority: "high", type_: "Incident", agentHistory });
      expect(r).toHaveLength(5);
    });

    test("UT-02-018 — results are sorted descending by score", () => {
      const r = TransformerEngine.rankAgents({ subject: "Server crash", tags: ["Bug"], queue: "Technical Support", priority: "high", type_: "Incident", agentHistory });
      for (let i = 0; i < r.length - 1; i++) {
        expect(r[i].score).toBeGreaterThanOrEqual(r[i + 1].score);
      }
    });

    test("UT-02-019 — each result has agent, score, reason fields", () => {
      const r = TransformerEngine.rankAgents({ subject: "Server crash", tags: ["Bug"], queue: "Technical Support", priority: "high", type_: "Incident", agentHistory });
      for (const item of r) {
        expect(item).toHaveProperty("agent");
        expect(item).toHaveProperty("score");
        expect(item).toHaveProperty("reason");
      }
    });

    test("UT-02-020 — score values are between 0 and 1 (inclusive)", () => {
      const r = TransformerEngine.rankAgents({ subject: "Server crash", tags: ["Bug"], queue: "Technical Support", priority: "high", type_: "Incident", agentHistory });
      for (const item of r) {
        expect(item.score).toBeGreaterThanOrEqual(0);
        expect(item.score).toBeLessThanOrEqual(1);
      }
    });

    test("UT-02-021 — support1 ranks in top-3 for Technical Support ticket", () => {
      const r = TransformerEngine.rankAgents({ subject: "API integration 500 error crash", tags: ["API", "Bug"], queue: "Technical Support", priority: "high", type_: "Problem", agentHistory });
      expect(r.slice(0, 3).map((x) => x.agent)).toContain("support1");
    });

    test("UT-02-022 — support2 ranks in top-3 for IT/Security ticket", () => {
      const r = TransformerEngine.rankAgents({ subject: "Security breach unauthorized network", tags: ["Security", "Data Breach"], queue: "IT Support", priority: "high", type_: "Incident", agentHistory });
      expect(r.slice(0, 3).map((x) => x.agent)).toContain("support2");
    });

    test("UT-02-023 — textSimilarity: related texts score higher than unrelated", () => {
      const s1 = TransformerEngine.textSimilarity("server crash production", "production server failure");
      const s2 = TransformerEngine.textSimilarity("server crash production", "billing invoice payment");
      expect(s1).toBeGreaterThan(s2);
    });
  });
});

describe("UT-03 | Priority Classifier", () => {
  beforeAll(() => PriorityClassifier.train(TransformerEngine.MINI_CORPUS));

  test("UT-03-001 — crash/outage subject → HIGH", () => {
    expect(PriorityClassifier.classify("Production server crashed urgently").predicted).toBe("high");
  });

  test("UT-03-002 — security breach → HIGH", () => {
    expect(PriorityClassifier.classify("Security breach unauthorized access detected").predicted).toBe("high");
  });

  test("UT-03-003 — feature request → LOW or MEDIUM", () => {
    expect(["low", "medium"]).toContain(
      PriorityClassifier.classify("Feature request add dark mode to dashboard").predicted
    );
  });

  test("UT-03-004 — billing inquiry → MEDIUM or LOW", () => {
    expect(["medium", "low"]).toContain(
      PriorityClassifier.classify("My invoice shows a slightly wrong amount").predicted
    );
  });

  test("UT-03-005 — confidence scores sum to ≈ 1.0", () => {
    const r = PriorityClassifier.classify("Server crashed in production");
    expect(r.high + r.medium + r.low).toBeCloseTo(1.0, 2);
  });

  test("UT-03-006 — high is highest for emergency crash ticket", () => {
    const r = PriorityClassifier.classify("Emergency: production crash, all services down");
    expect(r.high).toBeGreaterThan(r.medium);
    expect(r.high).toBeGreaterThan(r.low);
  });

  test("UT-03-007 — returns all three confidence fields", () => {
    const r = PriorityClassifier.classify("Some issue");
    expect(r).toHaveProperty("predicted");
    expect(r).toHaveProperty("high");
    expect(r).toHaveProperty("medium");
    expect(r).toHaveProperty("low");
  });

  test("UT-03-008 — virus/malware → HIGH", () => {
    expect(PriorityClassifier.classify("Virus detected in hospital IT systems, malware outbreak").predicted).toBe("high");
  });

  test("UT-03-009 — data loss → HIGH", () => {
    expect(PriorityClassifier.classify("Data loss event: entire database wiped").predicted).toBe("high");
  });

  test("UT-03-010 — empty string does not throw, returns valid object", () => {
    const r = PriorityClassifier.classify("");
    expect(["high", "medium", "low"]).toContain(r.predicted);
  });
});

describe("UT-04 | Queue Classifier", () => {
  beforeAll(() => QueueClassifier.train(TransformerEngine.MINI_CORPUS));

  test("UT-04-001 — billing/invoice → Billing and Payments", () => {
    expect(QueueClassifier.classify("Invoice shows wrong charge, payment overcharged")).toBe("Billing and Payments");
  });

  test("UT-04-002 — network/VPN → IT Support", () => {
    expect(QueueClassifier.classify("Network connectivity dropping, VPN not connecting")).toBe("IT Support");
  });

  test("UT-04-003 — return/defective product → Returns and Exchanges", () => {
    expect(QueueClassifier.classify("I want to return the broken defective product for refund")).toBe("Returns and Exchanges");
  });

  test("UT-04-004 — server/crash/bug → Technical Support", () => {
    expect(QueueClassifier.classify("Server crash, database error, API failing")).toBe("Technical Support");
  });

  test("UT-04-005 — classifyTopN returns exactly N results", () => {
    expect(QueueClassifier.classifyTopN("server crash bug error", "", 3)).toHaveLength(3);
  });

  test("UT-04-006 — classifyTopN sorted by confidence descending", () => {
    const top = QueueClassifier.classifyTopN("server bug error crash", "", 3);
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i].confidence).toBeGreaterThanOrEqual(top[i + 1].confidence);
    }
  });

  test("UT-04-007 — classifyTopN each result has queue and confidence", () => {
    for (const item of QueueClassifier.classifyTopN("server error", "", 3)) {
      expect(item).toHaveProperty("queue");
      expect(item).toHaveProperty("confidence");
    }
  });

  test("UT-04-008 — exactly 10 queues are defined", () => {
    expect(QueueClassifier.QUEUES).toHaveLength(10);
  });

  test("UT-04-009 — employee/HR → Human Resources", () => {
    expect(QueueClassifier.classify("Employee leave policy HR payroll query")).toBe("Human Resources");
  });

  test("UT-04-010 — outage/maintenance → Service Outages and Maintenance", () => {
    expect(QueueClassifier.classify("Service outage, system down, maintenance window")).toBe("Service Outages and Maintenance");
  });
});

describe("UT-05 | Type Classifier", () => {
  test("UT-05-001 — crash/outage → Incident", () => {
    expect(TypeClassifier.classify("Server crashed, all users affected")).toBe("Incident");
  });

  test("UT-05-002 — \"please reset\" → Request", () => {
    expect(TypeClassifier.classify("Could you please reset my account password")).toBe("Request");
  });

  test("UT-05-003 — wrong calculation / bug → Problem", () => {
    expect(TypeClassifier.classify("Invoice shows wrong calculation, this is a bug")).toBe("Problem");
  });

  test("UT-05-004 — \"upgrade configure\" → Change", () => {
    expect(TypeClassifier.classify("Please upgrade and configure the server to latest version")).toBe("Change");
  });

  test("UT-05-005 — classifyAll returns all 4 type scores", () => {
    const scores = TypeClassifier.classifyAll("server crash");
    ["Incident", "Request", "Problem", "Change"].forEach((t) => expect(scores).toHaveProperty(t));
  });

  test("UT-05-006 — Incident score highest for crash ticket", () => {
    const scores = TypeClassifier.classifyAll("Server crash outage, service down");
    expect(scores.Incident).toBeGreaterThan(scores.Change);
  });

  test("UT-05-007 — Change score highest for upgrade ticket", () => {
    const scores = TypeClassifier.classifyAll("upgrade deploy migrate improve optimize");
    expect(scores.Change).toBeGreaterThanOrEqual(scores.Request);
  });

  test("UT-05-008 — empty text defaults to Incident (first type, score 0 for all)", () => {
    expect(TypeClassifier.classify("")).toBe("Incident");
  });
});

describe("UT-06 | Tag Extractor", () => {
  test("UT-06-001 — extracts Security tag from breach content", () => {
    expect(TagExtractor.extract("Security breach unauthorized access")).toContain("Security");
  });

  test("UT-06-002 — extracts multiple tags from rich text", () => {
    expect(TagExtractor.extract("server crash network outage billing bug").length).toBeGreaterThan(1);
  });

  test("UT-06-003 — respects maxTags limit", () => {
    const tags = TagExtractor.extract("security breach crash outage network billing bug performance api cloud", "", 3);
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  test("UT-06-004 — extractWithScores results are sorted descending", () => {
    const scores = TagExtractor.extractWithScores("security breach hack virus malware unauthorized");
    expect(scores[0].matchCount).toBeGreaterThanOrEqual(scores[scores.length - 1].matchCount);
  });

  test("UT-06-005 — extractWithScores items have tag and matchCount fields", () => {
    for (const s of TagExtractor.extractWithScores("server crash bug")) {
      expect(s).toHaveProperty("tag");
      expect(s).toHaveProperty("matchCount");
    }
  });

  test("UT-06-006 — Outage tag extracted for outage content", () => {
    expect(TagExtractor.extract("Service outage, system down, offline")).toContain("Outage");
  });

  test("UT-06-007 — returns empty array for no matching content", () => {
    expect(TagExtractor.extract("xyz zzz qqqq 1234")).toEqual([]);
  });

  test("UT-06-008 — API tag extracted for API-related content", () => {
    expect(TagExtractor.extract("API integration webhook endpoint")).toContain("API");
  });

  test("UT-06-009 — Cloud tag extracted for AWS/Azure content", () => {
    expect(TagExtractor.extract("AWS cloud deployment azure gcp")).toContain("Cloud");
  });
});

describe("UT-07 | Assignment Engine", () => {
  const mockTeam = {
    support1: { current_load: 2, max_load: 5 },
    support2: { current_load: 5, max_load: 5 },
    support3: { current_load: 0, max_load: 5 },
  };

  describe("selectAgent()", () => {
    test("UT-07-001 — picks first available agent (skipping full)", () => {
      const ranking = [
        { agent: "support2", score: 0.95 },
        { agent: "support1", score: 0.88 },
        { agent: "support3", score: 0.75 },
      ];
      expect(AssignmentEngine.selectAgent(ranking, mockTeam)).toBe("support1");
    });

    test("UT-07-002 — skips full agent, picks next", () => {
      const ranking = [{ agent: "support2", score: 0.95 }, { agent: "support3", score: 0.80 }];
      expect(AssignmentEngine.selectAgent(ranking, mockTeam)).toBe("support3");
    });

    test("UT-07-003 — falls back to least-loaded when all ranked are full", () => {
      const fullTeam = {
        support1: { current_load: 5, max_load: 5 },
        support2: { current_load: 1, max_load: 5 },
        support3: { current_load: 4, max_load: 5 },
      };
      const ranking = [{ agent: "support1", score: 0.9 }];
      expect(AssignmentEngine.selectAgent(ranking, fullTeam)).toBe("support2");
    });
  });

  describe("blend()", () => {
    test("UT-07-004 — returns tfidf unchanged when no claude ranking", () => {
      const tfidf = [{ agent: "s1", score: 0.8, tfidf_score: 0.8, reason: "r" }];
      expect(AssignmentEngine.blend(tfidf, null)).toEqual(tfidf);
    });

    test("UT-07-005 — blends tfidf*0.6 + claude*0.4 correctly (0.8*0.6+0.9*0.4=0.84)", () => {
      const tfidf = [{ agent: "s1", score: 0.8, tfidf_score: 0.8, reason: "r" }];
      const claude = [{ agent: "s1", score: 0.9 }];
      expect(AssignmentEngine.blend(tfidf, claude)[0].score).toBeCloseTo(0.84, 2);
    });

    test("UT-07-006 — blended result sorted descending by score", () => {
      const tfidf = [
        { agent: "s1", score: 0.8, tfidf_score: 0.8, reason: "r" },
        { agent: "s2", score: 0.6, tfidf_score: 0.6, reason: "r" },
      ];
      const claude = [{ agent: "s2", score: 0.95 }, { agent: "s1", score: 0.5 }];
      const result = AssignmentEngine.blend(tfidf, claude);
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    });

    test("UT-07-007 — blended score capped at 0.99", () => {
      const tfidf = [{ agent: "s1", score: 0.99, tfidf_score: 0.99, reason: "r" }];
      const claude = [{ agent: "s1", score: 0.99 }];
      expect(AssignmentEngine.blend(tfidf, claude)[0].score).toBeLessThanOrEqual(0.99);
    });

    test("UT-07-008 — 0.70 tfidf + 0.80 claude → blended ≈ 0.74", () => {
      const tfidf = [{ agent: "s1", score: 0.70, tfidf_score: 0.70, reason: "r" }];
      const claude = [{ agent: "s1", score: 0.80 }];
      expect(AssignmentEngine.blend(tfidf, claude)[0].score).toBeCloseTo(0.74, 2);
    });
  });
});

describe("IT-01 | Login → Session → Role-Based Access", () => {
  test("IT-01-001 — customer login succeeds, role = customer", () => {
    const user = DB.login("customer1", "cust1pass", "customer");
    expect(user).not.toBeNull();
    expect(user.role).toBe("customer");
  });

  test("IT-01-002 — support login succeeds, role = support", () => {
    const user = DB.login("support7", "support7pass", "support");
    expect(user).not.toBeNull();
    expect(user.role).toBe("support");
  });

  test("IT-01-003 — admin login gives role = admin", () => {
    const user = DB.login("admin", "admin123", "admin");
    expect(user).not.toBeNull();
    expect(user.role).toBe("admin");
  });

  test("IT-01-004 — customer cannot masquerade as admin role", () => {
    expect(DB.login("customer1", "cust1pass", "admin")).toBeNull();
  });

  test("IT-01-005 — support cannot masquerade as admin role", () => {
    expect(DB.login("support1", "support1pass", "admin")).toBeNull();
  });

  test("IT-01-006 — logout simulation: session variables become null", () => {
    let CU = DB.login("customer1", "cust1pass", "customer");
    let CR = CU?.role;
    expect(CU).not.toBeNull();
    CU = null; CR = null;
    expect(CU).toBeNull();
    expect(CR).toBeNull();
  });

  test("IT-01-007 — failed login does not expose user data in error object", () => {
    const result = DB.login("customer1", "badpass", "customer");
    expect(result).toBeNull();
  });
});

describe("IT-02 | Full Ticket Creation Pipeline", () => {
  beforeAll(() => {
    TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS);
    PriorityClassifier.train(TransformerEngine.MINI_CORPUS);
    QueueClassifier.train(TransformerEngine.MINI_CORPUS);
    DB.resetLoads();
  });

  test("IT-02-001 — priority classifier identifies high-priority crash ticket", () => {
    const r = PriorityClassifier.classify("Production server crashed, all services down", "Out of memory error at 14:32 UTC");
    expect(r.predicted).toBe("high");
    expect(r.high).toBeGreaterThan(r.low);
  });

  test("IT-02-002 — queue classifier routes payment ticket correctly", () => {
    const q = QueueClassifier.classify("Payment deducted but order not placed", "Bank shows debit but portal shows failure");
    expect(["Billing and Payments", "Returns and Exchanges"]).toContain(q);
  });

  test("IT-02-003 — type classifier identifies payment failure as Incident", () => {
    expect(TypeClassifier.classify("Payment failed, money deducted, order not placed")).toBe("Incident");
  });

  test("IT-02-004 — tag extractor pulls Billing and Account from payment issue", () => {
    const tags = TagExtractor.extract("Payment deducted invoice billing error account");
    expect(tags).toContain("Billing");
    expect(tags).toContain("Account");
  });

  test("IT-02-005 — full pipeline: classify → rank → assign for payment issue", () => {
    const subject = "Payment deducted but order not placed on portal";
    const body = "Bank debited Rs.4999 but order shows failed";

    const priority = PriorityClassifier.classify(subject, body).predicted;
    const queue = QueueClassifier.classify(subject, body);
    const type_ = TypeClassifier.classify(subject, body);
    const tags = TagExtractor.extract(subject, body);

    expect(["high", "medium", "low"]).toContain(priority);
    expect(typeof queue).toBe("string");
    expect(["Incident", "Request", "Problem", "Change"]).toContain(type_);
    expect(Array.isArray(tags)).toBe(true);

    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({ subject, tags, queue, priority, type_, agentHistory });

    expect(ranking).toHaveLength(5);
    expect(ranking[0].score).toBeGreaterThanOrEqual(ranking[4].score);

    const assigned = DB.selectAgent(ranking);
    expect(assigned).toMatch(/^support\d+$/);
    expect(DB.supportTeam[assigned].current_load).toBeLessThanOrEqual(DB.supportTeam[assigned].max_load);
  });

  test("IT-02-006 — ticket ID generated after assignment has TKT- prefix", () => {
    const id = DB.genId();
    expect(id).toMatch(/^TKT-\d+$/);
  });

  test("IT-02-007 — pipeline for security breach ticket routes to IT Support", () => {
    const subject = "Security breach detected, unauthorized access to database";
    const body = "Firewall logs show suspicious login attempts from foreign IPs";
    expect(QueueClassifier.classify(subject, body)).toBe("IT Support");
    expect(PriorityClassifier.classify(subject, body).predicted).toBe("high");
    expect(TypeClassifier.classify(subject, body)).toBe("Incident");
    expect(TagExtractor.extract(subject, body)).toContain("Security");
  });
});

describe("IT-03 | Assignment Engine — Load Management", () => {
  beforeEach(() => DB.resetLoads());

  test("IT-03-001 — busy top agent skipped, next available assigned", () => {
    DB.supportTeam.support1.current_load = 5;
    const ranking = [
      { agent: "support1", score: 0.95 },
      { agent: "support2", score: 0.88 },
      { agent: "support3", score: 0.75 },
    ];
    const assigned = DB.selectAgent(ranking);
    expect(assigned).not.toBe("support1");
    expect(["support2", "support3"]).toContain(assigned);
  });

  test("IT-03-002 — agent load increments after assignment", () => {
    const before = DB.supportTeam.support4.current_load;
    DB.selectAgent([{ agent: "support4", score: 0.9 }]);
    expect(DB.supportTeam.support4.current_load).toBe(before + 1);
  });

  test("IT-03-003 — agent cannot exceed max_load (5 tickets)", () => {
    for (let i = 0; i < 5; i++) {
      DB.selectAgent([{ agent: "support2", score: 0.9 }]);
    }
    expect(DB.supportTeam.support2.current_load).toBe(5);
    const assigned = DB.selectAgent([{ agent: "support2", score: 0.9 }]);
    expect(assigned).not.toBe("support2");
  });

  test("IT-03-004 — blend 0.70 tfidf + 0.80 claude → ≈ 0.74", () => {
    const result = AssignmentEngine.blend(
      [{ agent: "s1", score: 0.70, tfidf_score: 0.70, reason: "r" }],
      [{ agent: "s1", score: 0.80 }]
    );
    expect(result[0].score).toBeCloseTo(0.74, 2);
  });

  test("IT-03-005 — 20 agents all start with current_load = 0 after resetLoads", () => {
    Object.values(DB.supportTeam).forEach((a) => {
      expect(a.current_load).toBe(0);
    });
  });
});

describe("IT-04 | Ticket Status Lifecycle", () => {
  let ticketId;

  beforeAll(() => {
    DB.resetLoads();
    Object.keys(DB.tickets).forEach((k) => delete DB.tickets[k]);
    ticketId = DB.genId();
    DB.tickets[ticketId] = {
      id: ticketId, subject: "Test lifecycle ticket", body: "Body text",
      customer_id: "customer1", assigned_to: "support1",
      queue: "Technical Support", priority: "medium", ticket_type: "Request",
      tags: ["Bug"], status: "open",
      created_at: new Date().toISOString(), assigned_at: new Date().toISOString(),
      resolved_at: null, resolution_note: null,
      tfidf_score: 0.8, ai_score: 0, final_score: 0.8,
      top5_ranking: [], priority_scores: {}
    };
    DB.supportTeam.support1.current_load = 1;
  });

  test("IT-04-001 — ticket starts in \"open\" status", () => {
    expect(DB.tickets[ticketId].status).toBe("open");
  });

  test("IT-04-002 — ticket transitions open → in-progress", () => {
    DB.tickets[ticketId].status = "in-progress";
    expect(DB.tickets[ticketId].status).toBe("in-progress");
  });

  test("IT-04-003 — ticket transitions in-progress → resolved with note and timestamp", () => {
    DB.tickets[ticketId].status = "resolved";
    DB.tickets[ticketId].resolved_at = new Date().toISOString();
    DB.tickets[ticketId].resolution_note = "Payment gateway timeout fixed. Refund initiated.";
    expect(DB.tickets[ticketId].status).toBe("resolved");
    expect(DB.tickets[ticketId].resolution_note).toBeTruthy();
    expect(DB.tickets[ticketId].resolved_at).toBeTruthy();
  });

  test("IT-04-004 — recalcLoads: resolved ticket reduces agent load to 0", () => {
    DB.recalcLoads();
    expect(DB.supportTeam.support1.current_load).toBe(0);
  });

  test("IT-04-005 — resolved ticket appears in agent history", () => {
    const history = DB.getAgentHistory();
    const found = history.support1.find((t) => t.subject === "Test lifecycle ticket");
    expect(found).toBeDefined();
  });

  test("IT-04-006 — resolved ticket has all required fields populated", () => {
    const t = DB.tickets[ticketId];
    expect(t.status).toBe("resolved");
    expect(t.resolution_note).not.toBeNull();
    expect(t.resolved_at).not.toBeNull();
    expect(t.assigned_to).toBe("support1");
  });
});

describe("IT-05 | Classifier Pipeline — Cross-Module Consistency", () => {
  const TEST_CASES = [
    {
      subject: "Server crash on production database",
      body: "OOM error at 14:32, all APIs returning 500",
      expectedPriority: ["high", "medium"],
      expectedQueue: "Technical Support",
      expectedType: "Incident",
      shouldContainTags: ["Bug", "Crash"],
    },
    {
      subject: "Invoice overcharged by Rs.500",
      body: "My payment receipt shows higher amount than quoted",
      expectedPriority: ["medium", "high"],
      expectedQueue: "Billing and Payments",
      expectedType: ["Problem", "Incident"],
      shouldContainTags: ["Billing"],
    },
    {
      subject: "Feature request: add dark mode",
      body: "It would be nice to have a dark theme in the dashboard",
      expectedPriority: ["low", "medium"],
      expectedQueue: ["General Inquiry", "Product Support"],
      expectedType: ["Change", "Request"],
      shouldContainTags: ["Feature"],
    },
    {
      subject: "Security breach detected, unauthorized access",
      body: "Our firewall logs show unauthorized login attempts from foreign IP",
      expectedPriority: "high",
      expectedQueue: "IT Support",
      expectedType: "Incident",
      shouldContainTags: ["Security"],
    },
    {
      subject: "AWS outage — all regions unavailable",
      body: "Service disruption affecting all cloud resources",
      expectedPriority: ["high", "medium"],
      expectedQueue: ["Service Outages and Maintenance", "IT Support"],
      expectedType: "Incident",
      shouldContainTags: ["Outage"],
    },
  ];

  test.each(TEST_CASES)("IT-05 — Pipeline consistent: \"$subject\"",
    ({ subject, body, expectedPriority, expectedQueue, expectedType, shouldContainTags }) => {
      const p = PriorityClassifier.classify(subject, body).predicted;
      const q = QueueClassifier.classify(subject, body);
      const t = TypeClassifier.classify(subject, body);
      const tags = TagExtractor.extract(subject, body);

      if (Array.isArray(expectedPriority)) expect(expectedPriority).toContain(p);
      else expect(p).toBe(expectedPriority);

      if (Array.isArray(expectedQueue)) expect(expectedQueue).toContain(q);
      else expect(q).toBe(expectedQueue);

      if (Array.isArray(expectedType)) expect(expectedType).toContain(t);
      else expect(t).toBe(expectedType);

      for (const tag of shouldContainTags) expect(tags).toContain(tag);
    }
  );
});

describe("IT-06 | Same Problem → Same Agent Re-Routing", () => {
  beforeAll(() => {
    DB.resetLoads();
    Object.keys(DB.tickets).forEach((k) => delete DB.tickets[k]);
    TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS);

    const id = DB.genId();
    DB.tickets[id] = {
      id, subject: "Payment deducted order not placed billing error",
      body: "", queue: "Billing and Payments", priority: "high", ticket_type: "Incident",
      tags: ["Billing", "Payment", "Account"], customer_id: "customer2",
      assigned_to: "support3", status: "resolved",
      created_at: new Date().toISOString(), assigned_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(), resolution_note: "Fixed",
      tfidf_score: 0.85, ai_score: 0, final_score: 0.85,
      top5_ranking: [], priority_scores: {}
    };
  });

  test("IT-06-001 — similar billing ticket places support3 in top-3", () => {
    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({
      subject: "Payment debited but order failed on portal",
      tags: ["Billing", "Payment"],
      queue: "Billing and Payments",
      priority: "high",
      type_: "Incident",
      agentHistory,
    });
    expect(ranking.slice(0, 3).map((r) => r.agent)).toContain("support3");
  });

  test("IT-06-002 — when support3 is busy, next billing agent is assigned", () => {
    DB.supportTeam.support3.current_load = 5;
    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({
      subject: "Payment debited but order failed on portal",
      tags: ["Billing", "Payment"],
      queue: "Billing and Payments",
      priority: "high",
      type_: "Incident",
      agentHistory,
    });
    const assigned = DB.selectAgent(ranking);
    expect(assigned).not.toBe("support3");
    expect(DB.supportTeam[assigned].current_load).toBeLessThan(DB.supportTeam[assigned].max_load);
    DB.supportTeam.support3.current_load = 0;
  });

  test("IT-06-003 — agent history persists across multiple ticket resolutions", () => {
    const id2 = DB.genId();
    DB.tickets[id2] = {
      id: id2, subject: "Another billing refund ticket",
      body: "", queue: "Billing and Payments", priority: "medium", ticket_type: "Problem",
      tags: ["Billing", "Refund"], customer_id: "customer3",
      assigned_to: "support3", status: "resolved",
      created_at: new Date().toISOString(), assigned_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(), resolution_note: "Refund processed",
      tfidf_score: 0.80, ai_score: 0, final_score: 0.80,
      top5_ranking: [], priority_scores: {}
    };
    const history = DB.getAgentHistory();
    expect(history.support3.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skip("NEG-01 | Wrong Auth Expectations (Negative / Intentional Fails)", () => {
  test("NEG-01-001 [WRONG] — expects correct login to return null (should FAIL)", () => {
    const result = DB.login("customer1", "cust1pass", "customer");
    expect(result).toBeNull();
  });

  test("NEG-01-002 [WRONG] — expects wrong password login to succeed (should FAIL)", () => {
    const result = DB.login("customer1", "BADPASSWORD", "customer");
    expect(result).not.toBeNull();
  });

  test("NEG-01-003 [WRONG] — expects customer role for admin login (should FAIL)", () => {
    const result = DB.login("admin", "admin123", "admin");
    expect(result?.role).toBe("customer");
  });

  test("NEG-01-004 [WRONG] — expects 5 customers in DB instead of 10 (should FAIL)", () => {
    const count = Object.keys(DB.customers).length;
    expect(count).toBe(5);
  });
});

describe.skip("NEG-02 | Wrong Priority Classification (Negative / Intentional Fails)", () => {
  beforeAll(() => PriorityClassifier.train(TransformerEngine.MINI_CORPUS));

  test("NEG-02-001 [WRONG] — expects crash to be LOW priority (should FAIL)", () => {
    const r = PriorityClassifier.classify("Emergency: production server crashed");
    expect(r.predicted).toBe("low");
  });

  test("NEG-02-002 [WRONG] — expects feature request to be HIGH (should FAIL)", () => {
    const r = PriorityClassifier.classify("Feature request: add dark mode");
    expect(r.predicted).toBe("high");
  });

  test("NEG-02-003 [WRONG] — expects confidence sum to be exactly 2.0 (should FAIL)", () => {
    const r = PriorityClassifier.classify("Server crash");
    expect(r.high + r.medium + r.low).toBeCloseTo(2.0, 2);
  });
});

describe.skip("NEG-03 | Wrong Queue Classification (Negative / Intentional Fails)", () => {
  beforeAll(() => QueueClassifier.train(TransformerEngine.MINI_CORPUS));

  test("NEG-03-001 [WRONG] — expects billing ticket routed to IT Support (should FAIL)", () => {
    const q = QueueClassifier.classify("Invoice overcharge, payment error, billing dispute");
    expect(q).toBe("IT Support");
  });

  test("NEG-03-002 [WRONG] — expects classifyTopN to return 10 results for N=3 (should FAIL)", () => {
    const top = QueueClassifier.classifyTopN("server crash bug", "", 3);
    expect(top).toHaveLength(10);
  });

  test("NEG-03-003 [WRONG] — expects VPN/network ticket routed to Billing (should FAIL)", () => {
    const q = QueueClassifier.classify("VPN not connecting, network dropping, wifi issues");
    expect(q).toBe("Billing and Payments");
  });
});

describe.skip("NEG-04 | Wrong Tag Extraction (Negative / Intentional Fails)", () => {
  test("NEG-04-001 [WRONG] — expects security breach to NOT contain Security tag (should FAIL)", () => {
    const tags = TagExtractor.extract("Security breach unauthorized access");
    expect(tags).not.toContain("Security");
  });

  test("NEG-04-002 [WRONG] — expects outage text to have 0 tags (should FAIL)", () => {
    const tags = TagExtractor.extract("Service outage, system down, offline");
    expect(tags.length).toBe(0);
  });

  test("NEG-04-003 [WRONG] — expects extractWithScores to not have tag field (should FAIL)", () => {
    const scores = TagExtractor.extractWithScores("server crash bug");
    for (const s of scores) {
      expect(s).not.toHaveProperty("tag");
    }
  });
});

describe.skip("NEG-05 | Wrong Assignment Engine Expectations (Negative / Intentional Fails)", () => {
  test("NEG-05-001 [WRONG] — expects tfidf*0.6+claude*0.4 for 0.8+0.9 to equal 0.50 (should FAIL)", () => {
    const tfidf = [{ agent: "s1", score: 0.8, tfidf_score: 0.8, reason: "r" }];
    const claude = [{ agent: "s1", score: 0.9 }];
    const result = AssignmentEngine.blend(tfidf, claude);
    expect(result[0].score).toBeCloseTo(0.50, 2);
  });

  test("NEG-05-002 [WRONG] — expects full agent (load=5/5) to be selected first (should FAIL)", () => {
    const team = {
      support1: { current_load: 5, max_load: 5 },
      support2: { current_load: 0, max_load: 5 },
    };
    const ranking = [{ agent: "support1", score: 0.99 }, { agent: "support2", score: 0.50 }];
    expect(AssignmentEngine.selectAgent(ranking, team)).toBe("support1");
  });

  test("NEG-05-003 [WRONG] — expects cosine similarity of identical vectors to be 0 (should FAIL)", () => {
    const v = TransformerEngine.tfidfVector("server crash production database");
    expect(TransformerEngine.cosine(v, v)).toBeCloseTo(0, 2);
  });
});
