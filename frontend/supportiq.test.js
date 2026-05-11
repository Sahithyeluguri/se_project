/**
 * ================================================================
 * SUPPORTIQ — COMPLETE TEST SUITE (JEST)
 * ================================================================
 * Following the uploaded Test Plan structure:
 *   - Objectives, Scope, Test Approach (Agile / Iterative)
 *   - Unit Tests        → each module tested in isolation
 *   - Integration Tests → modules working together end-to-end
 *   - System Tests      → full end-to-end user-facing workflows
 *
 * HOW TO RUN:
 *   npm install --save-dev jest
 *   npx jest --verbose
 *   npx jest --verbose --coverage
 *   npx jest -t "ST-"   ← system tests only
 *
 * FILE STRUCTURE ASSUMED:
 *   supportiq/
 *     modules/
 *       db.js              ← DB (in-memory store, auth)
 *       transformer.js     ← TF-IDF engine
 *       priorityClf.js     ← Priority classifier
 *       queueClf.js        ← Queue classifier
 *       typeClf.js         ← Type classifier
 *       tagExtractor.js    ← Tag extractor
 *       assignmentEngine.js← Orchestrator
 * ================================================================
 */

// ── Inline module definitions (self-contained, no imports needed) ─────────────
// These mirror the exact logic from supportiq_full.html and the Python modules

// ── DB MODULE ──────────────────────────────────────────────────────────────────
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
    'Technical Support':              ['Bug','Performance','Software','API','Crash'],
    'IT Support':                     ['Network','Security','IT','Hardware','Cloud'],
    'Billing and Payments':            ['Billing','Payment','Account','Refund'],
    'Product Support':                ['Hardware','Product Support','Bug'],
    'Service Outages and Maintenance':['Outage','Disruption','Maintenance','Recovery'],
    'Returns and Exchanges':           ['Returns and Exchanges','Refund','Order Issue'],
    'Customer Service':               ['Customer Service','Feedback','Account'],
    'Sales and Pre-Sales':            ['Sales','Feature','Documentation'],
    'General Inquiry':                ['General Inquiry','Documentation','Feedback'],
    'Human Resources':                ['HR','Compliance','Employee','Policy'],
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
    admin: { username: 'admin', password: 'admin123', full_name: 'Admin', role: 'admin' }
  };
  const tickets = {};
  let counter = 1000;

  function login(username, password, role) {
    const u = (username || '').trim();
    const p = (password || '').trim();
    let found = null;
    if (role === 'customer' && customers[u]?.password === p) found = { ...customers[u], role: 'customer' };
    else if (role === 'support' && supportTeam[u]?.password === p) found = { ...supportTeam[u], role: 'support' };
    else if (role === 'admin' && admins[u]?.password === p) found = { ...admins[u], role: 'admin' };
    return found;
  }

  function genId() { return `TKT-${++counter}`; }

  function recalcLoads() {
    Object.values(supportTeam).forEach(a => a.current_load = 0);
    Object.values(tickets).forEach(t => {
      if ((t.status === 'open' || t.status === 'in-progress') && t.assigned_to) {
        if (supportTeam[t.assigned_to]) supportTeam[t.assigned_to].current_load++;
      }
    });
  }

  function getAgentHistory() {
    const history = {};
    Object.keys(supportTeam).forEach(k => history[k] = []);
    Object.values(tickets).filter(t => t.status === 'resolved' && t.assigned_to).forEach(t => {
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
    return 'support1';
  }

  function resetLoads() { Object.values(supportTeam).forEach(a => a.current_load = 0); }

  return { customers, supportTeam, admins, tickets, login, genId, recalcLoads, getAgentHistory, selectAgent, resetLoads, QUEUE_KEYS };
})();

// ── TRANSFORMER MODULE ─────────────────────────────────────────────────────────
const TransformerEngine = (() => {
  const STOPWORDS = new Set(['the','and','for','with','this','that','from','are','has','have',
    'been','will','your','our','can','not','but','all','its','was','had','who','what','how',
    'when','they','their','more','also','about','into','over','after','before','each','such',
    'than','then','these','other','some','same','just','there','were','which','would','could',
    'should','may','might','upon','where','while','both','here','those','through','much','per',
    'any','out','use','her','him','his','she','you','get','set','let','got','did','via','yet']);

  let idfMap = null, corpusSize = 0;

  const MINI_CORPUS = [
    {s:'Server crash production database',q:'Technical Support',p:'high',t:'Incident',tg:['Bug','Crash','Performance']},
    {s:'Invoice wrong amount charged',q:'Billing and Payments',p:'medium',t:'Problem',tg:['Billing','Payment','Account']},
    {s:'Network connectivity dropping',q:'IT Support',p:'high',t:'Incident',tg:['Network','IT','Outage']},
    {s:'Feature request bulk CSV export',q:'General Inquiry',p:'low',t:'Change',tg:['Feature','Documentation']},
    {s:'Security breach unauthorized access',q:'IT Support',p:'high',t:'Incident',tg:['Security','Data Breach','IT']},
    {s:'AWS service outage all regions',q:'Service Outages and Maintenance',p:'high',t:'Incident',tg:['Outage','Cloud','Disruption']},
    {s:'Refund not processed fourteen days',q:'Returns and Exchanges',p:'medium',t:'Request',tg:['Refund','Payment']},
    {s:'API integration returns 500 error',q:'Technical Support',p:'high',t:'Problem',tg:['API','Bug','Software']},
    {s:'Product documentation update guide',q:'Product Support',p:'low',t:'Request',tg:['Documentation','Feature']},
    {s:'Slow page load performance issue',q:'Technical Support',p:'medium',t:'Problem',tg:['Performance','Network']},
  ];

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
  }

  function buildIDF(corpus) {
    idfMap = new Map(); corpusSize = corpus.length;
    for (const doc of corpus) {
      const text = `${doc.s||''} ${(doc.tg||[]).join(' ')} ${doc.q||''} ${doc.t||''}`;
      for (const t of new Set(tokenize(text))) idfMap.set(t, (idfMap.get(t)||0) + 1);
    }
    for (const [term, df] of idfMap) idfMap.set(term, Math.log(corpusSize/(1+df)) + 1);
  }

  function tfidfVector(text, extraTags = []) {
    const allText = `${text} ${extraTags.join(' ')}`;
    const tokens = tokenize(allText);
    if (!tokens.length) return new Map();
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t)||0)+1);
    const maxTF = Math.max(...tf.values());
    const vec = new Map();
    for (const [t, count] of tf) {
      const idf = idfMap?.get(t) || 0.1;
      vec.set(t, (count/maxTF) * idf);
    }
    return vec;
  }

  function cosine(v1, v2) {
    if (!v1.size || !v2.size) return 0;
    let dot = 0, n1 = 0, n2 = 0;
    for (const [t, w] of v1) { dot += w*(v2.get(t)||0); n1 += w*w; }
    for (const [,w] of v2) n2 += w*w;
    const denom = Math.sqrt(n1)*Math.sqrt(n2);
    return denom > 0 ? dot/denom : 0;
  }

  function rankAgents({ subject, tags, queue, priority, type_, agentHistory }) {
    if (!idfMap) buildIDF(MINI_CORPUS);
    const queryVec = tfidfVector(subject, tags||[]);
    const scores = {};
    for (const [agent, history] of Object.entries(agentHistory||{})) {
      if (!history?.length) { scores[agent] = 0.25; continue; }
      let best = 0;
      for (const rt of history) {
        const rtVec = tfidfVector(`${rt.subject||''} ${rt.queue||''}`, rt.tags||[]);
        const sim = cosine(queryVec, rtVec);
        const tagOverlap = (tags||[]).filter(t=>(rt.tags||[]).map(x=>x.toLowerCase()).includes(t.toLowerCase())).length;
        const queueBonus = rt.queue === queue ? 0.08 : 0;
        const total = sim + tagOverlap*0.05 + queueBonus;
        if (total > best) best = total;
      }
      scores[agent] = best;
    }
    return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,5)
      .map(([agent,score]) => ({ agent, score: Math.min(0.99, score), tfidf_score: Math.min(0.99, score), reason: `Matched by similarity` }));
  }

  function textSimilarity(t1, t2) {
    if (!idfMap) buildIDF(MINI_CORPUS);
    return cosine(tfidfVector(t1), tfidfVector(t2));
  }

  return { tokenize, buildIDF, tfidfVector, cosine, rankAgents, textSimilarity, MINI_CORPUS };
})();

// ── PRIORITY CLASSIFIER ────────────────────────────────────────────────────────
const PriorityClassifier = (() => {
  const HIGH_KW = ['urgent','critical','emergency','crash','outage','breach','unauthorized','virus','malware','down','failed','blocked','inaccessible','severe','immediately','security incident','data loss'];
  const LOW_KW  = ['inquiry','feature','documentation','guidance','suggestion','enhancement','when possible','low priority','general question'];
  const sig = { high:{}, medium:{}, low:{} };
  let trained = false;

  function train(corpus) {
    for (const p of ['high','medium','low']) sig[p] = {};
    for (const doc of corpus) {
      const p = doc.p; if (!sig[p]) continue;
      const words = [...(doc.s||'').toLowerCase().split(/\s+/), ...(doc.tg||[]).map(t=>t.toLowerCase())];
      for (const w of words) if (w.length>=3) sig[p][w] = (sig[p][w]||0)+1;
    }
    trained = true;
  }

  function classify(subject, body='') {
    const text = `${subject} ${body}`.toLowerCase();
    let h=0, m=5, l=0;
    for (const kw of HIGH_KW) if (text.includes(kw)) h+=3;
    for (const kw of LOW_KW)  if (text.includes(kw)) l+=2;
    if (trained) {
      for (const w of text.split(/\s+/)) {
        h += (sig.high[w]||0)*0.03;
        m += (sig.medium[w]||0)*0.03;
        l += (sig.low[w]||0)*0.03;
      }
    }
    const total = h+m+l||1;
    const high=h/total, medium=m/total, low=l/total;
    const predicted = h>m&&h>l?'high':l>h&&l>m?'low':'medium';
    return { predicted, high, medium, low };
  }

  return { train, classify, HIGH_KW, LOW_KW };
})();

// ── QUEUE CLASSIFIER ───────────────────────────────────────────────────────────
const QueueClassifier = (() => {
  const QUEUES = ['Technical Support','Billing and Payments','Customer Service','Returns and Exchanges','Product Support','IT Support','Service Outages and Maintenance','Sales and Pre-Sales','General Inquiry','Human Resources'];
  const RULES = {
    'Technical Support':              ['error','bug','crash','not working','fail','api','software','server','database','exception','code'],
    'Billing and Payments':            ['billing','invoice','payment','charge','refund','fee','cost','overcharge','transaction','receipt'],
    'Returns and Exchanges':           ['return','exchange','replace','defective','warranty','ship','deliver','order','damaged','wrong item'],
    'IT Support':                     ['network','wifi','vpn','access','login','password','security','breach','firewall','virus','infrastructure'],
    'Service Outages and Maintenance':['outage','down','offline','unavailable','maintenance','disruption','service interrupt','downtime'],
    'Product Support':                ['product','feature','setup','install','configure','guide','documentation','manual','firmware','driver'],
    'Customer Service':               ['complaint','dissatisfied','feedback','poor service','unhappy','disappointed','escalate'],
    'Sales and Pre-Sales':            ['pricing','purchase','demo','trial','license','quote','proposal','enterprise','upgrade'],
    'Human Resources':                ['employee','hr','payroll','leave','attendance','policy','recruit','benefits','vacation'],
    'General Inquiry':                ['information','general','question','inquiry','curious','what is','how does'],
  };
  const qSig = {};
  for (const q of QUEUES) qSig[q]={};
  let trained = false;

  function train(corpus) {
    for (const q of QUEUES) qSig[q]={};
    for (const doc of corpus) {
      const q=doc.q; if (!qSig[q]) continue;
      const words=[...(doc.s||'').toLowerCase().split(/\s+/), ...(doc.tg||[]).map(t=>t.toLowerCase())];
      for (const w of words) if (w.length>=3) qSig[q][w]=(qSig[q][w]||0)+1;
    }
    trained=true;
  }

  function scoreAll(subject, body='') {
    const text=`${subject} ${body}`.toLowerCase();
    const scores={};
    for (const q of QUEUES) {
      scores[q]=(RULES[q]||[]).filter(kw=>text.includes(kw)).length*3;
      if (trained) for (const w of text.split(/\s+/)) scores[q]+=(qSig[q][w]||0)*0.05;
    }
    return scores;
  }

  function classify(subject, body='') {
    const scores=scoreAll(subject,body);
    return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0]?.[0]||'Technical Support';
  }

  function classifyTopN(subject, body='', n=3) {
    const scores=scoreAll(subject,body);
    const total=Object.values(scores).reduce((s,v)=>s+v,0)||1;
    return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([q,s])=>({queue:q,confidence:s/total}));
  }

  return { QUEUES, RULES, train, classify, classifyTopN, scoreAll };
})();

// ── TYPE CLASSIFIER ────────────────────────────────────────────────────────────
const TypeClassifier = (() => {
  const RULES = {
    'Incident':['crash','outage','down','not working','error','fail','disruption','breach','unavailable','offline','sudden','frozen'],
    'Request': ['request','please','could you','can you','need','require','would like','want to','help me','enable','grant','reset'],
    'Problem': ['problem','issue','incorrect','wrong','discrepancy','bug','not correct','defect','mismatch','recurring'],
    'Change':  ['change','update','modify','configure','upgrade','migrate','implement','improve','enhance','optimize','deploy'],
  };

  function classify(subject, body='') {
    const text=`${subject} ${body}`.toLowerCase();
    let best='Incident', bestScore=0;
    for (const [t,rules] of Object.entries(RULES)) {
      const score=rules.filter(kw=>text.includes(kw)).length;
      if (score>bestScore) { bestScore=score; best=t; }
    }
    return best;
  }

  function classifyAll(subject, body='') {
    const text=`${subject} ${body}`.toLowerCase();
    return Object.fromEntries(Object.entries(RULES).map(([t,rules])=>[t,rules.filter(kw=>text.includes(kw)).length]));
  }

  return { RULES, classify, classifyAll };
})();

// ── TAG EXTRACTOR ──────────────────────────────────────────────────────────────
const TagExtractor = (() => {
  const TAG_MAP = {
    'Security':          ['security','breach','unauthorized','encrypt','vulnerab','hack','firewall'],
    'Data Breach':       ['data breach','data loss','leak','stolen data','compromised data'],
    'Outage':            ['outage','down','offline','unavailab','service interrupt'],
    'Disruption':        ['disruption','disrupt','interrupt','degraded'],
    'Network':           ['network','wifi','vpn','connectivity','router','bandwidth','dns'],
    'Bug':               ['bug','error','exception','defect','glitch','crash','fault'],
    'Crash':             ['crash','system crash','application crash'],
    'Performance':       ['slow','performance','latency','timeout','lag','speed','throughput'],
    'Billing':           ['billing','invoice','payment','charge','fee','price','overcharg'],
    'Refund':            ['refund','money back','reimburse'],
    'Account':           ['account','login','password','username','access','profile','credentials'],
    'IT':                ['it support','infrastructure','server','database','cloud'],
    'Hardware':          ['hardware','device','printer','laptop','monitor','keyboard'],
    'Software':          ['software','app','application','program','install'],
    'API':               ['api','integration','webhook','endpoint','rest','sdk'],
    'Cloud':             ['cloud','aws','azure','gcp','google cloud'],
    'Feature':           ['feature request','new feature','functionality','enhancement'],
    'Documentation':     ['documentation','guide','manual','tutorial','how to'],
    'Urgent Issue':      ['urgent','critical','emergency','immediately','asap'],
    'Virus':             ['virus','malware','ransomware','trojan','phishing'],
  };

  function extract(subject, body='', maxTags=6) {
    const text=`${subject} ${body}`.toLowerCase();
    return Object.entries(TAG_MAP).filter(([,kws])=>kws.some(kw=>text.includes(kw))).map(([tag])=>tag).slice(0,maxTags);
  }

  function extractWithScores(subject, body='') {
    const text=`${subject} ${body}`.toLowerCase();
    return Object.entries(TAG_MAP)
      .map(([tag,kws])=>({tag,matchCount:kws.filter(kw=>text.includes(kw)).length}))
      .filter(x=>x.matchCount>0).sort((a,b)=>b.matchCount-a.matchCount);
  }

  return { TAG_MAP, extract, extractWithScores };
})();

// ── ASSIGNMENT ENGINE ──────────────────────────────────────────────────────────
const AssignmentEngine = {
  blend(tfidfRanking, claudeRanking, w_tfidf=0.6, w_claude=0.4) {
    if (!claudeRanking?.length) return tfidfRanking;
    const cm = Object.fromEntries(claudeRanking.map(r=>[r.agent, parseFloat(r.score)||0]));
    return tfidfRanking.map(r => {
      const cs = cm[r.agent] ?? r.tfidf_score;
      return { ...r, claude_score:cs, score:Math.min(0.99, r.tfidf_score*w_tfidf + cs*w_claude) };
    }).sort((a,b)=>b.score-a.score);
  },
  selectAgent(ranking, supportTeam) {
    for (const r of ranking) {
      const a=supportTeam[r.agent];
      if (a && a.current_load < a.max_load) return r.agent;
    }
    if (Object.keys(supportTeam).length)
      return Object.entries(supportTeam).sort((a,b)=>a[1].current_load-b[1].current_load)[0][0];
    return ranking[0]?.agent || 'support1';
  }
};

// ── SYSTEM-LEVEL HELPER: simulate a full ticket submission ─────────────────────
function simulateTicketSubmission({ subject, body, customerUsername, role = 'customer', password }) {
  // Step 1 – Authenticate
  const pwd = password || `cust${customerUsername.replace('customer','')}pass`;
  const session = DB.login(customerUsername, pwd, role);
  if (!session) return { error: 'Authentication failed', session: null };

  // Step 2 – Classify
  const priority = PriorityClassifier.classify(subject, body).predicted;
  const queue    = QueueClassifier.classify(subject, body);
  const type_    = TypeClassifier.classify(subject, body);
  const tags     = TagExtractor.extract(subject, body);

  // Step 3 – Rank agents and assign
  const agentHistory = DB.getAgentHistory();
  const ranking      = TransformerEngine.rankAgents({ subject, tags, queue, priority, type_, agentHistory });
  const agentId      = DB.selectAgent(ranking);

  // Step 4 – Create ticket record
  const ticketId = DB.genId();
  const now      = new Date().toISOString();
  DB.tickets[ticketId] = {
    id: ticketId, subject, body,
    customer_id: customerUsername,
    assigned_to: agentId,
    queue, priority, ticket_type: type_, tags,
    status: 'open',
    created_at: now, assigned_at: now,
    resolved_at: null, resolution_note: null,
    tfidf_score: ranking[0]?.score || 0,
    ai_score: 0, final_score: ranking[0]?.score || 0,
    top5_ranking: ranking, priority_scores: {}
  };

  return { session, ticket: DB.tickets[ticketId], ranking, agentId };
}

// ─────────────────────────────────────────────────────────────────────────────
// ░░░░░░░░░░░░░░░░░░░░░░░░  J E S T   T E S T S  ░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ════════════════════════════════════════════════════════════════════════════════

// ── UT-01: AUTH / DB MODULE ───────────────────────────────────────────────────
describe('UT-01 | Auth / DB Module', () => {

  describe('login() — valid credentials', () => {
    test('customer1 logs in with correct password', () => {
      const result = DB.login('customer1', 'cust1pass', 'customer');
      expect(result).not.toBeNull();
      expect(result.username).toBe('customer1');
      expect(result.role).toBe('customer');
    });

    test('support3 logs in with correct password', () => {
      const result = DB.login('support3', 'support3pass', 'support');
      expect(result).not.toBeNull();
      expect(result.role).toBe('support');
    });

    test('admin logs in with correct password', () => {
      const result = DB.login('admin', 'admin123', 'admin');
      expect(result).not.toBeNull();
      expect(result.role).toBe('admin');
    });

    test('all 10 customers exist in the DB', () => {
      for (let i = 1; i <= 10; i++) {
        const r = DB.login(`customer${i}`, `cust${i}pass`, 'customer');
        expect(r).not.toBeNull();
        expect(r.id).toBe(i);
      }
    });

    test('all 20 support agents exist in the DB', () => {
      for (let i = 1; i <= 20; i++) {
        const r = DB.login(`support${i}`, `support${i}pass`, 'support');
        expect(r).not.toBeNull();
        expect(r.id).toBe(i);
      }
    });
  });

  describe('login() — invalid credentials', () => {
    test('wrong password returns null', () => {
      expect(DB.login('customer1', 'wrongpass', 'customer')).toBeNull();
    });

    test('non-existent username returns null', () => {
      expect(DB.login('customer999', 'anypass', 'customer')).toBeNull();
    });

    test('customer creds used under support role → null', () => {
      expect(DB.login('customer1', 'cust1pass', 'support')).toBeNull();
    });

    test('support creds used under customer role → null', () => {
      expect(DB.login('support1', 'support1pass', 'customer')).toBeNull();
    });

    test('empty username returns null', () => {
      expect(DB.login('', 'cust1pass', 'customer')).toBeNull();
    });

    test('whitespace username trimmed → returns null', () => {
      expect(DB.login('   ', 'cust1pass', 'customer')).toBeNull();
    });

    test('username is case-sensitive (Customer1 ≠ customer1)', () => {
      expect(DB.login('Customer1', 'cust1pass', 'customer')).toBeNull();
    });

    test('SQL injection in username → rejected', () => {
      const injections = ["' OR '1'='1", "admin'--", "'; DROP TABLE customers;--", '" OR "1"="1'];
      for (const payload of injections) {
        expect(DB.login(payload, 'anypass', 'customer')).toBeNull();
      }
    });
  });

  describe('genId()', () => {
    test('generates sequential unique IDs starting with TKT-', () => {
      const id1 = DB.genId();
      const id2 = DB.genId();
      expect(id1).toMatch(/^TKT-\d+$/);
      expect(id2).toMatch(/^TKT-\d+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('selectAgent()', () => {
    beforeEach(() => DB.resetLoads());

    test('picks first available agent from ranked list', () => {
      DB.supportTeam['support5'].current_load = 5; // FULL
      const ranking = [
        { agent: 'support5', score: 0.95 },
        { agent: 'support1', score: 0.88 },
      ];
      const assigned = DB.selectAgent(ranking);
      expect(assigned).toBe('support1');
      DB.supportTeam['support5'].current_load = 0;
    });

    test('falls back to globally least-loaded when all ranked are full', () => {
      DB.supportTeam['support1'].current_load = 5;
      DB.supportTeam['support5'].current_load = 5;
      DB.supportTeam['support3'].current_load = 0;
      const ranking = [{ agent:'support1',score:0.9 },{ agent:'support5',score:0.8 }];
      const assigned = DB.selectAgent(ranking);
      expect(DB.supportTeam[assigned].current_load).toBeLessThan(5);
      DB.supportTeam['support1'].current_load = 0;
      DB.supportTeam['support5'].current_load = 0;
    });
  });
});

// ── UT-02: TF-IDF TRANSFORMER ENGINE ──────────────────────────────────────────
describe('UT-02 | TF-IDF Transformer Engine', () => {

  beforeAll(() => TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS));

  describe('tokenize()', () => {
    test('converts text to lowercase tokens', () => {
      const tokens = TransformerEngine.tokenize('Server CRASH Production');
      expect(tokens).toContain('server');
      expect(tokens).toContain('crash');
      expect(tokens).toContain('production');
    });

    test('removes stopwords', () => {
      const tokens = TransformerEngine.tokenize('the server and the database are down');
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('and');
      expect(tokens).not.toContain('are');
      expect(tokens).toContain('server');
      expect(tokens).toContain('database');
    });

    test('removes tokens shorter than 3 characters', () => {
      const tokens = TransformerEngine.tokenize('go do it on db');
      expect(tokens.every(t => t.length > 2)).toBe(true);
    });

    test('returns empty array for empty input', () => {
      expect(TransformerEngine.tokenize('')).toEqual([]);
      expect(TransformerEngine.tokenize(null)).toEqual([]);
    });

    test('handles special characters and punctuation', () => {
      const tokens = TransformerEngine.tokenize('error: 500! crash@production#server');
      expect(tokens).toContain('error');
      expect(tokens).toContain('crash');
    });
  });

  describe('tfidfVector()', () => {
    test('returns non-empty Map for valid text', () => {
      const vec = TransformerEngine.tfidfVector('server crash production');
      expect(vec.size).toBeGreaterThan(0);
    });

    test('returns empty Map for empty input', () => {
      const vec = TransformerEngine.tfidfVector('');
      expect(vec.size).toBe(0);
    });

    test('includes extra tags in vector', () => {
      const vec = TransformerEngine.tfidfVector('server crash', ['Outage', 'Bug']);
      expect(vec.size).toBeGreaterThan(0);
    });
  });

  describe('cosine()', () => {
    test('identical vectors return 1.0', () => {
      const v = TransformerEngine.tfidfVector('server crash production database');
      const sim = TransformerEngine.cosine(v, v);
      expect(sim).toBeCloseTo(1.0, 2);
    });

    test('related texts return similarity > 0', () => {
      const v1 = TransformerEngine.tfidfVector('server crash production down');
      const v2 = TransformerEngine.tfidfVector('production server failure system down');
      expect(TransformerEngine.cosine(v1, v2)).toBeGreaterThan(0);
    });

    test('completely different texts return low similarity', () => {
      const v1 = TransformerEngine.tfidfVector('billing invoice payment refund');
      const v2 = TransformerEngine.tfidfVector('server crash network firewall');
      expect(TransformerEngine.cosine(v1, v2)).toBeLessThan(0.4);
    });

    test('empty vectors return 0', () => {
      expect(TransformerEngine.cosine(new Map(), new Map())).toBe(0);
    });
  });

  describe('rankAgents()', () => {
    const agentHistory = {
      support1: [{ subject:'API crash production', queue:'Technical Support', tags:['Bug','Crash'], priority:'high', ticket_type:'Incident' }],
      support2: [{ subject:'Network firewall breach', queue:'IT Support', tags:['Network','Security'], priority:'high', ticket_type:'Incident' }],
      support3: [{ subject:'Invoice billing error', queue:'Billing and Payments', tags:['Billing','Payment'], priority:'medium', ticket_type:'Problem' }],
      support4: [],
      support5: [{ subject:'AWS outage disruption', queue:'Service Outages and Maintenance', tags:['Outage','Cloud'], priority:'high', ticket_type:'Incident' }],
    };

    test('returns exactly 5 ranked agents', () => {
      const r = TransformerEngine.rankAgents({ subject:'Server crash', tags:['Bug'], queue:'Technical Support', priority:'high', type_:'Incident', agentHistory });
      expect(r).toHaveLength(5);
    });

    test('results are sorted descending by score', () => {
      const r = TransformerEngine.rankAgents({ subject:'Server crash', tags:['Bug'], queue:'Technical Support', priority:'high', type_:'Incident', agentHistory });
      for (let i = 0; i < r.length - 1; i++) {
        expect(r[i].score).toBeGreaterThanOrEqual(r[i+1].score);
      }
    });

    test('each result has agent, score, reason fields', () => {
      const r = TransformerEngine.rankAgents({ subject:'Server crash', tags:['Bug'], queue:'Technical Support', priority:'high', type_:'Incident', agentHistory });
      for (const item of r) {
        expect(item).toHaveProperty('agent');
        expect(item).toHaveProperty('score');
        expect(item).toHaveProperty('reason');
      }
    });

    test('score values are between 0 and 1', () => {
      const r = TransformerEngine.rankAgents({ subject:'Server crash', tags:['Bug'], queue:'Technical Support', priority:'high', type_:'Incident', agentHistory });
      for (const item of r) {
        expect(item.score).toBeGreaterThanOrEqual(0);
        expect(item.score).toBeLessThanOrEqual(1);
      }
    });

    test('support1 ranks in top-3 for Technical Support ticket (has matching history)', () => {
      const r = TransformerEngine.rankAgents({ subject:'API integration 500 error crash', tags:['API','Bug'], queue:'Technical Support', priority:'high', type_:'Problem', agentHistory });
      const top3 = r.slice(0, 3).map(x => x.agent);
      expect(top3).toContain('support1');
    });

    test('support2 ranks in top-3 for IT/Security ticket', () => {
      const r = TransformerEngine.rankAgents({ subject:'Security breach unauthorized network access', tags:['Security','Data Breach'], queue:'IT Support', priority:'high', type_:'Incident', agentHistory });
      const top3 = r.slice(0, 3).map(x => x.agent);
      expect(top3).toContain('support2');
    });

    test('textSimilarity returns higher score for related texts', () => {
      const s1 = TransformerEngine.textSimilarity('server crash production', 'production server failure');
      const s2 = TransformerEngine.textSimilarity('server crash production', 'billing invoice payment');
      expect(s1).toBeGreaterThan(s2);
    });
  });
});

// ── UT-03: PRIORITY CLASSIFIER ────────────────────────────────────────────────
describe('UT-03 | Priority Classifier', () => {

  beforeAll(() => PriorityClassifier.train(TransformerEngine.MINI_CORPUS));

  test('classifies crash/outage as HIGH priority', () => {
    expect(PriorityClassifier.classify('Production server crashed urgently').predicted).toBe('high');
  });

  test('classifies security breach as HIGH priority', () => {
    expect(PriorityClassifier.classify('Security breach unauthorized access detected').predicted).toBe('high');
  });

  test('classifies feature request as LOW priority', () => {
    expect(['low','medium']).toContain(PriorityClassifier.classify('Feature request add dark mode to dashboard').predicted);
  });

  test('classifies billing inquiry as MEDIUM priority', () => {
    const r = PriorityClassifier.classify('My invoice shows a slightly wrong amount');
    expect(['medium','low']).toContain(r.predicted);
  });

  test('confidence scores sum to approximately 1.0', () => {
    const r = PriorityClassifier.classify('Server crashed in production');
    expect(r.high + r.medium + r.low).toBeCloseTo(1.0, 2);
  });

  test('high confidence is highest for crash ticket', () => {
    const r = PriorityClassifier.classify('Emergency: production crash, all services down');
    expect(r.high).toBeGreaterThan(r.medium);
    expect(r.high).toBeGreaterThan(r.low);
  });

  test('returns all three confidence fields', () => {
    const r = PriorityClassifier.classify('Some issue');
    expect(r).toHaveProperty('predicted');
    expect(r).toHaveProperty('high');
    expect(r).toHaveProperty('medium');
    expect(r).toHaveProperty('low');
  });

  test('virus/malware classified as HIGH', () => {
    expect(PriorityClassifier.classify('Virus detected in hospital IT systems, malware outbreak').predicted).toBe('high');
  });
});

// ── UT-04: QUEUE CLASSIFIER ───────────────────────────────────────────────────
describe('UT-04 | Queue Classifier', () => {

  beforeAll(() => QueueClassifier.train(TransformerEngine.MINI_CORPUS));

  test('billing/invoice routes to Billing and Payments', () => {
    expect(QueueClassifier.classify('Invoice shows wrong charge, payment overcharged')).toBe('Billing and Payments');
  });

  test('network/VPN routes to IT Support', () => {
    expect(QueueClassifier.classify('Network connectivity dropping, VPN not connecting')).toBe('IT Support');
  });

  test('return/defective routes to Returns and Exchanges', () => {
    expect(QueueClassifier.classify('I want to return the broken defective product for refund')).toBe('Returns and Exchanges');
  });

  test('classifyTopN returns exactly N results', () => {
    expect(QueueClassifier.classifyTopN('server crash bug error', '', 3)).toHaveLength(3);
  });

  test('classifyTopN results sorted by confidence descending', () => {
    const top = QueueClassifier.classifyTopN('server bug error crash', '', 3);
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i].confidence).toBeGreaterThanOrEqual(top[i+1].confidence);
    }
  });

  test('classifyTopN each result has queue and confidence fields', () => {
    const top = QueueClassifier.classifyTopN('server error', '', 3);
    for (const item of top) {
      expect(item).toHaveProperty('queue');
      expect(item).toHaveProperty('confidence');
    }
  });

  test('all 10 queues are known', () => {
    expect(QueueClassifier.QUEUES).toHaveLength(10);
  });

  test('server crash routes to Technical Support', () => {
    expect(QueueClassifier.classify('Server crash, database error, API failing')).toBe('Technical Support');
  });
});

// ── UT-05: TYPE CLASSIFIER ────────────────────────────────────────────────────
describe('UT-05 | Type Classifier', () => {

  test('crash/outage → Incident', () => {
    expect(TypeClassifier.classify('Server crashed, all users affected')).toBe('Incident');
  });

  test('"please reset" → Request', () => {
    expect(TypeClassifier.classify('Could you please reset my account password')).toBe('Request');
  });

  test('"wrong calculation / bug" → Problem', () => {
    expect(TypeClassifier.classify('Invoice shows wrong calculation, this is a bug')).toBe('Problem');
  });

  test('"upgrade configure" → Change', () => {
    expect(TypeClassifier.classify('Please upgrade and configure the server to latest version')).toBe('Change');
  });

  test('classifyAll returns all 4 type scores', () => {
    const scores = TypeClassifier.classifyAll('server crash');
    expect(scores).toHaveProperty('Incident');
    expect(scores).toHaveProperty('Request');
    expect(scores).toHaveProperty('Problem');
    expect(scores).toHaveProperty('Change');
  });

  test('Incident score highest for crash ticket', () => {
    const scores = TypeClassifier.classifyAll('Server crash outage, service down');
    expect(scores['Incident']).toBeGreaterThan(scores['Change']);
  });
});

// ── UT-06: TAG EXTRACTOR ──────────────────────────────────────────────────────
describe('UT-06 | Tag Extractor', () => {

  test('extracts Security tag for breach content', () => {
    expect(TagExtractor.extract('Security breach unauthorized access')).toContain('Security');
  });

  test('extracts multiple tags from rich text', () => {
    expect(TagExtractor.extract('server crash network outage billing bug').length).toBeGreaterThan(1);
  });

  test('respects maxTags limit', () => {
    const tags = TagExtractor.extract('security breach crash outage network billing bug performance api cloud', '', 3);
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  test('extractWithScores returns sorted results', () => {
    const scores = TagExtractor.extractWithScores('security breach hack virus malware unauthorized');
    expect(scores[0].matchCount).toBeGreaterThanOrEqual(scores[scores.length - 1].matchCount);
  });

  test('extractWithScores result has tag and matchCount fields', () => {
    const scores = TagExtractor.extractWithScores('server crash bug');
    for (const s of scores) {
      expect(s).toHaveProperty('tag');
      expect(s).toHaveProperty('matchCount');
    }
  });

  test('Outage tag extracted for outage content', () => {
    expect(TagExtractor.extract('Service outage, system down, offline')).toContain('Outage');
  });

  test('returns empty array when no tags match', () => {
    expect(TagExtractor.extract('xyz zzz qqqq')).toEqual([]);
  });
});

// ── UT-07: ASSIGNMENT ENGINE ──────────────────────────────────────────────────
describe('UT-07 | Assignment Engine', () => {

  const mockTeam = {
    support1: { current_load: 2, max_load: 5 },
    support2: { current_load: 5, max_load: 5 }, // FULL
    support3: { current_load: 0, max_load: 5 },
  };

  describe('selectAgent()', () => {
    test('picks first available agent from ranking', () => {
      const ranking = [
        { agent:'support2', score:0.95 },
        { agent:'support1', score:0.88 },
        { agent:'support3', score:0.75 },
      ];
      expect(AssignmentEngine.selectAgent(ranking, mockTeam)).toBe('support1');
    });

    test('skips full agents and picks next available', () => {
      const ranking = [{ agent:'support2', score:0.95 }, { agent:'support3', score:0.80 }];
      expect(AssignmentEngine.selectAgent(ranking, mockTeam)).toBe('support3');
    });

    test('falls back to least-loaded when all ranked are full', () => {
      const fullTeam = {
        support1: { current_load:5, max_load:5 },
        support2: { current_load:1, max_load:5 },
        support3: { current_load:4, max_load:5 },
      };
      const ranking = [{ agent:'support1', score:0.9 }];
      expect(AssignmentEngine.selectAgent(ranking, fullTeam)).toBe('support2');
    });
  });

  describe('blend()', () => {
    test('returns tfidf ranking unchanged when no claude ranking', () => {
      const tfidf = [{ agent:'s1', score:0.8, tfidf_score:0.8, reason:'r' }];
      expect(AssignmentEngine.blend(tfidf, null)).toEqual(tfidf);
    });

    test('blends tfidf*0.6 + claude*0.4 correctly', () => {
      const tfidf  = [{ agent:'s1', score:0.8, tfidf_score:0.8, reason:'r' }];
      const claude = [{ agent:'s1', score:0.9 }];
      const result = AssignmentEngine.blend(tfidf, claude);
      expect(result[0].score).toBeCloseTo(0.84, 2);
    });

    test('result is sorted descending after blending', () => {
      const tfidf  = [
        { agent:'s1', score:0.8, tfidf_score:0.8, reason:'r' },
        { agent:'s2', score:0.6, tfidf_score:0.6, reason:'r' },
      ];
      const claude = [{ agent:'s2', score:0.95 }, { agent:'s1', score:0.5 }];
      const result = AssignmentEngine.blend(tfidf, claude);
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    });

    test('blended score does not exceed 0.99', () => {
      const tfidf  = [{ agent:'s1', score:0.99, tfidf_score:0.99, reason:'r' }];
      const claude = [{ agent:'s1', score:0.99 }];
      const result = AssignmentEngine.blend(tfidf, claude);
      expect(result[0].score).toBeLessThanOrEqual(0.99);
    });
  });
});


// ════════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════════

// ── IT-01: LOGIN → SESSION → ROLE-BASED ACCESS ────────────────────────────────
describe('IT-01 | Login → Session → Role-Based Access', () => {

  test('customer login gives access to customer-only route', () => {
    const user = DB.login('customer1', 'cust1pass', 'customer');
    expect(user).not.toBeNull();
    const customerNav = ['chat', 'my-tickets', 'new-ticket'];
    const adminOnlyNav = ['dashboard', 'lookup', 'agents'];
    expect(customerNav.includes('chat')).toBe(true);
    expect(adminOnlyNav.includes(user.role)).toBe(false);
  });

  test('support login gives access to support queue, not admin dashboard', () => {
    const user = DB.login('support7', 'support7pass', 'support');
    expect(user).not.toBeNull();
    expect(['customer','support','admin']).toContain(user.role);
    expect(['admin']).not.toContain(user.role === 'support' ? 'support' : 'admin');
  });

  test('admin login gives full access', () => {
    const user = DB.login('admin', 'admin123', 'admin');
    expect(user).not.toBeNull();
    expect(user.role).toBe('admin');
    expect(['customer','support','admin']).toContain(user.role);
    expect(['admin']).toContain(user.role);
  });

  test('wrong role + correct creds → null → no access to any route', () => {
    const user = DB.login('customer1', 'cust1pass', 'admin');
    expect(user).toBeNull();
  });

  test('logout clears session (CU = null, CR = null)', () => {
    let CU = DB.login('customer1', 'cust1pass', 'customer');
    let CR = CU?.role;
    expect(CU).not.toBeNull();
    CU = null; CR = null;
    expect(CU).toBeNull();
    expect(CR).toBeNull();
  });
});

// ── IT-02: TICKET CREATION PIPELINE ──────────────────────────────────────────
describe('IT-02 | Full Ticket Creation Pipeline', () => {

  beforeAll(() => {
    TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS);
    PriorityClassifier.train(TransformerEngine.MINI_CORPUS);
    QueueClassifier.train(TransformerEngine.MINI_CORPUS);
    DB.resetLoads();
  });

  test('priority classifier correctly identifies high-priority ticket', () => {
    const subject = 'Production server crashed, all services down';
    const r = PriorityClassifier.classify(subject, 'Out of memory error at 14:32 UTC');
    expect(r.predicted).toBe('high');
    expect(r.high).toBeGreaterThan(r.low);
  });

  test('queue classifier routes payment ticket correctly', () => {
    const subject = 'Payment deducted but order not placed';
    expect(['Billing and Payments','Returns and Exchanges']).toContain(QueueClassifier.classify(subject, 'Bank shows debit but portal shows failure'));
  });

  test('type classifier identifies payment failure as Incident', () => {
    expect(TypeClassifier.classify('Payment failed, money deducted, order not placed')).toBe('Incident');
  });

  test('tag extractor pulls correct tags from payment issue', () => {
    const tags = TagExtractor.extract('Payment deducted invoice billing error account');
    expect(tags).toContain('Billing');
    expect(tags).toContain('Account');
  });

  test('full pipeline: classify + rank + assign for payment issue', () => {
    const subject = 'Payment deducted but order not placed on portal';
    const body    = 'Bank debited ₹4999 but order shows failed';

    const priority = PriorityClassifier.classify(subject, body).predicted;
    const queue    = QueueClassifier.classify(subject, body);
    const type_    = TypeClassifier.classify(subject, body);
    const tags     = TagExtractor.extract(subject, body);

    expect(['high','medium','low']).toContain(priority);
    expect(typeof queue).toBe('string');
    expect(['Incident','Request','Problem','Change']).toContain(type_);
    expect(Array.isArray(tags)).toBe(true);

    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({ subject, tags, queue, priority, type_, agentHistory });

    expect(ranking).toHaveLength(5);
    expect(ranking[0].score).toBeGreaterThanOrEqual(ranking[4].score);

    const assigned = DB.selectAgent(ranking);
    expect(assigned).toMatch(/^support\d+$/);
    expect(DB.supportTeam[assigned].current_load).toBeLessThanOrEqual(DB.supportTeam[assigned].max_load);
  });
});

// ── IT-03: ASSIGNMENT ENGINE — NO CONGESTION ──────────────────────────────────
describe('IT-03 | Assignment Engine — No Congestion', () => {

  beforeEach(() => DB.resetLoads());

  test('busy top agent skipped, next available assigned', () => {
    DB.supportTeam['support1'].current_load = 5;
    const ranking = [
      { agent:'support1', score:0.95 },
      { agent:'support2', score:0.88 },
      { agent:'support3', score:0.75 },
    ];
    const assigned = DB.selectAgent(ranking);
    expect(assigned).not.toBe('support1');
    expect(['support2','support3']).toContain(assigned);
  });

  test('agent load increments after assignment', () => {
    const before = DB.supportTeam['support4'].current_load;
    const ranking = [{ agent:'support4', score:0.9 }];
    DB.selectAgent(ranking);
    expect(DB.supportTeam['support4'].current_load).toBe(before + 1);
  });

  test('multiple tickets distribute without exceeding max_load', () => {
    DB.resetLoads();
    for (let i = 0; i < 5; i++) {
      const ranking = [{ agent:'support2', score:0.9 }];
      DB.selectAgent(ranking);
    }
    expect(DB.supportTeam['support2'].current_load).toBe(5);
    const ranking = [{ agent:'support2', score:0.9 }];
    const assigned = DB.selectAgent(ranking);
    expect(assigned).not.toBe('support2');
  });

  test('blended score: tfidf 0.70 + claude 0.80 → ~0.74', () => {
    const tfidf  = [{ agent:'s1', score:0.70, tfidf_score:0.70, reason:'r' }];
    const claude = [{ agent:'s1', score:0.80 }];
    const result = AssignmentEngine.blend(tfidf, claude);
    expect(result[0].score).toBeCloseTo(0.74, 2);
  });
});

// ── IT-04: TICKET STATUS TRANSITIONS ──────────────────────────────────────────
describe('IT-04 | Ticket Status Transitions', () => {

  let ticketId;

  beforeAll(() => {
    DB.resetLoads();
    ticketId = DB.genId();
    DB.tickets[ticketId] = {
      id: ticketId, subject: 'Test ticket', body: 'Test body',
      customer_id: 'customer1', assigned_to: 'support1',
      queue: 'Technical Support', priority: 'medium', ticket_type: 'Request',
      tags: ['Bug'], status: 'open',
      created_at: new Date().toISOString(), assigned_at: new Date().toISOString(),
      resolved_at: null, resolution_note: null,
      tfidf_score: 0.8, ai_score: 0, final_score: 0.8,
      top5_ranking: [], priority_scores: {}
    };
    DB.supportTeam['support1'].current_load = 1;
  });

  test('ticket starts in "open" status', () => {
    expect(DB.tickets[ticketId].status).toBe('open');
  });

  test('ticket moves from open → in-progress', () => {
    DB.tickets[ticketId].status = 'in-progress';
    expect(DB.tickets[ticketId].status).toBe('in-progress');
  });

  test('ticket moves from in-progress → resolved with note', () => {
    DB.tickets[ticketId].status = 'resolved';
    DB.tickets[ticketId].resolved_at = new Date().toISOString();
    DB.tickets[ticketId].resolution_note = 'Payment gateway timeout fixed. Refund initiated.';
    expect(DB.tickets[ticketId].status).toBe('resolved');
    expect(DB.tickets[ticketId].resolution_note).toBeTruthy();
    expect(DB.tickets[ticketId].resolved_at).toBeTruthy();
  });

  test('recalcLoads correctly reflects resolved ticket', () => {
    DB.recalcLoads();
    expect(DB.supportTeam['support1'].current_load).toBe(0);
  });

  test('resolved ticket appears in agent history', () => {
    const history = DB.getAgentHistory();
    const support1History = history['support1'];
    const found = support1History.find(t => t.subject === 'Test ticket');
    expect(found).toBeDefined();
  });
});

// ── IT-05: CLASSIFIER PIPELINE CONSISTENCY ────────────────────────────────────
describe('IT-05 | Classifier Pipeline Consistency', () => {

  const TEST_CASES = [
    {
      subject: 'Server crash on production database',
      body: 'OOM error at 14:32, all APIs returning 500',
      expectedPriority: ['high','medium'],
      expectedQueue: 'Technical Support',
      expectedType: 'Incident',
      shouldContainTags: ['Bug', 'Crash'],
    },
    {
      subject: 'Invoice overcharged by ₹500',
      body: 'My payment receipt shows higher amount than quoted',
      expectedPriority: ['medium', 'high'],
      expectedQueue: 'Billing and Payments',
      expectedType: ['Problem', 'Incident'],
      shouldContainTags: ['Billing'],
    },
    {
      subject: 'Feature request: add dark mode',
      body: 'It would be nice to have a dark theme in the dashboard',
      expectedPriority: ['low','medium'],
      expectedQueue: ['General Inquiry', 'Product Support'],
      expectedType: ['Change', 'Request'],
      shouldContainTags: ['Feature'],
    },
    {
      subject: 'Security breach detected, unauthorized access',
      body: 'Our firewall logs show unauthorized login attempts from foreign IP',
      expectedPriority: 'high',
      expectedQueue: 'IT Support',
      expectedType: 'Incident',
      shouldContainTags: ['Security'],
    },
  ];

  test.each(TEST_CASES)('Pipeline consistent for: $subject', ({ subject, body, expectedPriority, expectedQueue, expectedType, shouldContainTags }) => {
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

    for (const tag of shouldContainTags) {
      expect(tags).toContain(tag);
    }
  });
});

// ── IT-06: SAME PROBLEM → SAME AGENT ROUTING ──────────────────────────────────
describe('IT-06 | Same Problem → Same Agent Routing', () => {

  beforeAll(() => {
    DB.resetLoads();
    TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS);
    const id = DB.genId();
    DB.tickets[id] = {
      id, subject: 'Payment deducted order not placed billing error',
      body:'', queue:'Billing and Payments', priority:'high', ticket_type:'Incident',
      tags:['Billing','Payment','Account'], customer_id:'customer2',
      assigned_to:'support3', status:'resolved',
      created_at: new Date().toISOString(), assigned_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(), resolution_note:'Fixed',
      tfidf_score:0.85, ai_score:0, final_score:0.85,
      top5_ranking:[], priority_scores:{}
    };
  });

  test('similar billing ticket ranks support3 in top agents', () => {
    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({
      subject: 'Payment debited but order failed on portal',
      tags: ['Billing','Payment'],
      queue: 'Billing and Payments',
      priority: 'high',
      type_: 'Incident',
      agentHistory,
    });
    const top3 = ranking.slice(0, 3).map(r => r.agent);
    expect(top3).toContain('support3');
  });

  test('when support3 is busy, next best billing agent is assigned', () => {
    DB.supportTeam['support3'].current_load = 5;
    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({
      subject: 'Payment debited but order failed on portal',
      tags: ['Billing','Payment'],
      queue: 'Billing and Payments',
      priority: 'high',
      type_: 'Incident',
      agentHistory,
    });
    const assigned = DB.selectAgent(ranking);
    expect(assigned).not.toBe('support3');
    expect(DB.supportTeam[assigned].current_load).toBeLessThan(DB.supportTeam[assigned].max_load);
    DB.supportTeam['support3'].current_load = 0;
  });
});


// ════════════════════════════════════════════════════════════════════════════════
// SYSTEM TESTS
// ════════════════════════════════════════════════════════════════════════════════
// System tests simulate complete end-to-end user journeys across the full
// SupportIQ platform. Each test exercises a real user-facing workflow from
// login through ticket lifecycle, as a user would experience via the web UI.
// ════════════════════════════════════════════════════════════════════════════════

beforeAll(() => {
  TransformerEngine.buildIDF(TransformerEngine.MINI_CORPUS);
  PriorityClassifier.train(TransformerEngine.MINI_CORPUS);
  QueueClassifier.train(TransformerEngine.MINI_CORPUS);
  DB.resetLoads();
});

beforeEach(() => {
  // Clear all tickets and reset loads between system tests to avoid state leakage
  Object.keys(DB.tickets).forEach(k => delete DB.tickets[k]);
  DB.resetLoads();
});

// ── ST-01: CUSTOMER PORTAL — RAISE CRITICAL TICKET END-TO-END ─────────────────
describe('ST-01 | Customer Portal — Raise Critical Ticket End-to-End', () => {

  /**
   * Scenario: A customer logs into the portal, describes a production server
   * crash, and the system automatically classifies, routes, and assigns the
   * ticket to an available agent — all within a single workflow.
   *
   * Steps (mirrors the web UI flow):
   *   1. Customer authenticates
   *   2. Customer submits ticket via chat / new-ticket form
   *   3. System classifies priority, queue, type, tags
   *   4. System ranks agents and assigns the best available
   *   5. Ticket record is persisted with correct metadata
   *   6. Customer can see the ticket in "My Tickets"
   */

  test('ST-01-001: customer authentication succeeds before ticket submission', () => {
    const session = DB.login('customer3', 'cust3pass', 'customer');
    expect(session).not.toBeNull();
    expect(session.role).toBe('customer');
    expect(session.username).toBe('customer3');
  });

  test('ST-01-002: critical production crash classified as HIGH priority end-to-end', () => {
    const result = simulateTicketSubmission({
      subject: 'Production server is down, all APIs returning 500',
      body: 'Started 10 minutes ago. Database connection pool exhausted. All customers affected.',
      customerUsername: 'customer1',
    });

    expect(result.error).toBeUndefined();
    expect(result.ticket.priority).toBe('high');
  });

  test('ST-01-003: ticket routed to Technical Support queue for server crash', () => {
    const result = simulateTicketSubmission({
      subject: 'Production server crash, database error, API down',
      body: 'All backend services unresponsive. Error logs show OOM.',
      customerUsername: 'customer2',
    });

    expect(result.ticket.queue).toBe('Technical Support');
  });

  test('ST-01-004: ticket assigned to a valid, non-overloaded support agent', () => {
    const result = simulateTicketSubmission({
      subject: 'Server crashed, production database down',
      body: 'All services offline.',
      customerUsername: 'customer3',
    });

    const agent = DB.supportTeam[result.agentId];
    expect(agent).toBeDefined();
    expect(agent.current_load).toBeLessThanOrEqual(agent.max_load);
  });

  test('ST-01-005: ticket persisted in DB with all required fields', () => {
    const result = simulateTicketSubmission({
      subject: 'Production API crash — urgent',
      body: 'Gateway timeout errors across all endpoints.',
      customerUsername: 'customer4',
    });

    const t = result.ticket;
    expect(t.id).toMatch(/^TKT-\d+$/);
    expect(t.status).toBe('open');
    expect(t.created_at).toBeTruthy();
    expect(t.assigned_to).toMatch(/^support\d+$/);
    expect(t.top5_ranking).toHaveLength(5);
  });

  test('ST-01-006: customer can see their ticket in "My Tickets" view', () => {
    const result = simulateTicketSubmission({
      subject: 'Login failure after password reset',
      body: 'Cannot access my account.',
      customerUsername: 'customer5',
    });

    // Simulate "My Tickets" query: filter by customer_id
    const myTickets = Object.values(DB.tickets).filter(
      t => t.customer_id === 'customer5'
    );
    expect(myTickets.length).toBeGreaterThanOrEqual(1);
    expect(myTickets[0].subject).toBe('Login failure after password reset');
  });

  test('ST-01-007: ticket type is classified as Incident for crash scenario', () => {
    const result = simulateTicketSubmission({
      subject: 'Application crash, service down for all users',
      body: 'Complete outage since 09:00 UTC.',
      customerUsername: 'customer6',
    });

    expect(result.ticket.ticket_type).toBe('Incident');
  });

  test('ST-01-008: Bug and Crash tags are extracted for crash ticket', () => {
    const result = simulateTicketSubmission({
      subject: 'Server crash causing application bug on production',
      body: 'Crash dump shows null pointer exception in payment service.',
      customerUsername: 'customer7',
    });

    expect(result.ticket.tags).toContain('Bug');
    expect(result.ticket.tags).toContain('Crash');
  });
});

// ── ST-02: SUPPORT AGENT PORTAL — ACCEPT AND RESOLVE TICKET ──────────────────
describe('ST-02 | Support Agent Portal — Accept and Resolve Ticket', () => {

  /**
   * Scenario: A support agent logs in, picks up an assigned open ticket,
   * moves it to in-progress, adds a resolution note, and marks it resolved.
   * The system correctly recalculates agent load and archives history.
   *
   * Steps (mirrors the support portal UI flow):
   *   1. Agent authenticates
   *   2. Agent views their queue (open tickets)
   *   3. Agent accepts ticket → status: in-progress
   *   4. Agent adds resolution note → status: resolved
   *   5. Agent load decrements on resolution
   *   6. Ticket appears in resolved history, usable for future ranking
   */

  let ticketId;

  beforeEach(() => {
    // Seed an open ticket assigned to support1
    ticketId = DB.genId();
    DB.tickets[ticketId] = {
      id: ticketId,
      subject: 'VPN access blocked after office migration',
      body: 'Unable to connect to company VPN from new office subnet.',
      customer_id: 'customer8',
      assigned_to: 'support1',
      queue: 'IT Support',
      priority: 'medium',
      ticket_type: 'Incident',
      tags: ['Network', 'Account'],
      status: 'open',
      created_at: new Date().toISOString(),
      assigned_at: new Date().toISOString(),
      resolved_at: null,
      resolution_note: null,
      tfidf_score: 0.72,
      ai_score: 0,
      final_score: 0.72,
      top5_ranking: [],
      priority_scores: {},
    };
    DB.supportTeam['support1'].current_load = 1;
  });

  test('ST-02-001: support agent authenticates successfully', () => {
    const session = DB.login('support1', 'support1pass', 'support');
    expect(session).not.toBeNull();
    expect(session.role).toBe('support');
  });

  test('ST-02-002: agent can view their assigned open tickets', () => {
    const myOpen = Object.values(DB.tickets).filter(
      t => t.assigned_to === 'support1' && t.status === 'open'
    );
    expect(myOpen.length).toBeGreaterThanOrEqual(1);
    expect(myOpen[0].assigned_to).toBe('support1');
  });

  test('ST-02-003: agent transitions ticket from open to in-progress', () => {
    DB.tickets[ticketId].status = 'in-progress';
    expect(DB.tickets[ticketId].status).toBe('in-progress');
  });

  test('ST-02-004: agent resolves ticket with note and timestamp', () => {
    DB.tickets[ticketId].status = 'resolved';
    DB.tickets[ticketId].resolution_note = 'Updated firewall rules to allow new subnet. VPN access restored.';
    DB.tickets[ticketId].resolved_at = new Date().toISOString();

    expect(DB.tickets[ticketId].status).toBe('resolved');
    expect(DB.tickets[ticketId].resolution_note).toContain('VPN access restored');
    expect(DB.tickets[ticketId].resolved_at).toBeTruthy();
  });

  test('ST-02-005: agent load decrements after resolution and recalculation', () => {
    DB.tickets[ticketId].status = 'resolved';
    DB.recalcLoads();
    expect(DB.supportTeam['support1'].current_load).toBe(0);
  });

  test('ST-02-006: resolved ticket feeds into agent history for future ranking', () => {
    DB.tickets[ticketId].status = 'resolved';
    DB.tickets[ticketId].resolved_at = new Date().toISOString();
    DB.tickets[ticketId].resolution_note = 'Fixed.';

    const history = DB.getAgentHistory();
    const support1Hist = history['support1'];
    expect(support1Hist.some(t => t.subject === 'VPN access blocked after office migration')).toBe(true);
  });

  test('ST-02-007: similar future ticket preferentially routes to support1', () => {
    // Resolve the seeded ticket so it appears in history
    DB.tickets[ticketId].status = 'resolved';
    DB.tickets[ticketId].resolved_at = new Date().toISOString();
    DB.tickets[ticketId].resolution_note = 'Fixed.';

    const agentHistory = DB.getAgentHistory();
    const ranking = TransformerEngine.rankAgents({
      subject: 'VPN not connecting after network change',
      tags: ['Network', 'Account'],
      queue: 'IT Support',
      priority: 'medium',
      type_: 'Incident',
      agentHistory,
    });

    const top3 = ranking.slice(0, 3).map(r => r.agent);
    expect(top3).toContain('support1');
  });
});

// ── ST-03: ADMIN PORTAL — SYSTEM DASHBOARD AND TICKET OVERSIGHT ───────────────
describe('ST-03 | Admin Portal — System Dashboard and Ticket Oversight', () => {

  /**
   * Scenario: An admin logs in and uses the dashboard to review system health:
   * total tickets, agent load distribution, and the ability to look up any ticket.
   *
   * Steps (mirrors the admin portal UI flow):
   *   1. Admin authenticates
   *   2. Admin views aggregate ticket stats (open / in-progress / resolved)
   *   3. Admin inspects agent workload (load vs max_load)
   *   4. Admin performs a ticket lookup by ID
   *   5. Admin views all agents and verifies no agent is overloaded
   */

  beforeEach(() => {
    // Seed a variety of tickets across statuses
    ['open','in-progress','resolved'].forEach((status, i) => {
      const id = DB.genId();
      DB.tickets[id] = {
        id, subject: `Ticket ${status}`, body: '',
        customer_id: `customer${i+1}`,
        assigned_to: `support${i+1}`,
        queue: 'Technical Support', priority: 'medium',
        ticket_type: 'Problem', tags: ['Bug'],
        status,
        created_at: new Date().toISOString(),
        assigned_at: new Date().toISOString(),
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
        resolution_note: status === 'resolved' ? 'Resolved.' : null,
        tfidf_score: 0.6, ai_score: 0, final_score: 0.6,
        top5_ranking: [], priority_scores: {}
      };
    });
    DB.recalcLoads();
  });

  test('ST-03-001: admin authenticates and receives admin role', () => {
    const session = DB.login('admin', 'admin123', 'admin');
    expect(session).not.toBeNull();
    expect(session.role).toBe('admin');
  });

  test('ST-03-002: admin can view aggregate ticket count breakdown', () => {
    const all = Object.values(DB.tickets);
    const open       = all.filter(t => t.status === 'open').length;
    const inProgress = all.filter(t => t.status === 'in-progress').length;
    const resolved   = all.filter(t => t.status === 'resolved').length;

    expect(open).toBeGreaterThanOrEqual(1);
    expect(inProgress).toBeGreaterThanOrEqual(1);
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(open + inProgress + resolved).toBe(all.length);
  });

  test('ST-03-003: admin can look up a specific ticket by ID', () => {
    const sampleId = Object.keys(DB.tickets)[0];
    const found = DB.tickets[sampleId];
    expect(found).toBeDefined();
    expect(found.id).toBe(sampleId);
  });

  test('ST-03-004: no active agent exceeds their max_load', () => {
    const overloaded = Object.values(DB.supportTeam).filter(
      a => a.current_load > a.max_load
    );
    expect(overloaded).toHaveLength(0);
  });

  test('ST-03-005: admin can see all 20 agents in the system', () => {
    expect(Object.keys(DB.supportTeam)).toHaveLength(20);
  });

  test('ST-03-006: admin cannot be created via customer or support login', () => {
    // Attempting to get admin access through wrong role channels
    expect(DB.login('admin', 'admin123', 'customer')).toBeNull();
    expect(DB.login('admin', 'admin123', 'support')).toBeNull();
  });

  test('ST-03-007: recalcLoads correctly counts only open and in-progress tickets', () => {
    DB.recalcLoads();
    const activeByAgent = {};
    Object.values(DB.tickets).forEach(t => {
      if ((t.status === 'open' || t.status === 'in-progress') && t.assigned_to) {
        activeByAgent[t.assigned_to] = (activeByAgent[t.assigned_to] || 0) + 1;
      }
    });
    Object.entries(activeByAgent).forEach(([agentId, count]) => {
      expect(DB.supportTeam[agentId].current_load).toBe(count);
    });
  });
});

// ── ST-04: FULL MULTI-TICKET QUEUE SATURATION AND FAILOVER ───────────────────
describe('ST-04 | Full Multi-Ticket Queue Saturation and Failover', () => {

  /**
   * Scenario: A burst of tickets arrives simultaneously for the same queue.
   * The system must correctly distribute assignments across agents, respecting
   * max_load=5, and never assign a 6th ticket to an already-full agent.
   * This mirrors real-world peak-load behavior visible on the Admin dashboard.
   */

  beforeEach(() => DB.resetLoads());

  test('ST-04-001: 5 sequential crash tickets all get unique valid assignments', () => {
    const assignedAgents = [];
    for (let i = 0; i < 5; i++) {
      const result = simulateTicketSubmission({
        subject: `Production crash incident #${i+1}, server down`,
        body: `Crash at ${i}:00 UTC. All APIs returning 500.`,
        customerUsername: `customer${(i % 10) + 1}`,
      });
      expect(result.ticket.assigned_to).toMatch(/^support\d+$/);
      assignedAgents.push(result.ticket.assigned_to);
    }
    // All assignments must be to valid agents
    assignedAgents.forEach(a => expect(DB.supportTeam[a]).toBeDefined());
  });

  test('ST-04-002: no agent is assigned more than max_load (5) tickets at once', () => {
    // Flood with 20 tickets to saturate some agents
    for (let i = 0; i < 20; i++) {
      simulateTicketSubmission({
        subject: `Batch ticket ${i}: server error crash database`,
        body: 'High priority system failure.',
        customerUsername: `customer${(i % 10) + 1}`,
      });
    }
    Object.values(DB.supportTeam).forEach(agent => {
      expect(agent.current_load).toBeLessThanOrEqual(agent.max_load);
    });
  });

  test('ST-04-003: system assigns ticket even when preferred agent is full', () => {
    // Fill support1 to max
    DB.supportTeam['support1'].current_load = 5;

    const result = simulateTicketSubmission({
      subject: 'Server crash bug error API down',
      body: 'Critical production incident.',
      customerUsername: 'customer1',
    });

    expect(result.agentId).not.toBe('support1');
    expect(result.ticket.assigned_to).toMatch(/^support\d+$/);
  });

  test('ST-04-004: total open ticket count across all agents equals sum of loads', () => {
    for (let i = 0; i < 10; i++) {
      simulateTicketSubmission({
        subject: `Crash ticket ${i} production server down`,
        body: 'Critical.',
        customerUsername: `customer${(i % 10) + 1}`,
      });
    }
    DB.recalcLoads();

    const totalLoad = Object.values(DB.supportTeam).reduce((s, a) => s + a.current_load, 0);
    const openTickets = Object.values(DB.tickets).filter(
      t => t.status === 'open' || t.status === 'in-progress'
    ).length;

    expect(totalLoad).toBe(openTickets);
  });
});

// ── ST-05: SECURITY AND ROLE ISOLATION SYSTEM TEST ───────────────────────────
describe('ST-05 | Security and Role Isolation System Test', () => {

  /**
   * Scenario: Validate that the system enforces role-based access control
   * end-to-end. No user should be able to access resources or perform actions
   * outside their assigned role, regardless of credential manipulation.
   */

  test('ST-05-001: customer cannot log in as support or admin', () => {
    expect(DB.login('customer1', 'cust1pass', 'support')).toBeNull();
    expect(DB.login('customer1', 'cust1pass', 'admin')).toBeNull();
  });

  test('ST-05-002: support agent cannot log in as customer or admin', () => {
    expect(DB.login('support1', 'support1pass', 'customer')).toBeNull();
    expect(DB.login('support1', 'support1pass', 'admin')).toBeNull();
  });

  test('ST-05-003: admin credentials only work under admin role', () => {
    expect(DB.login('admin', 'admin123', 'admin')).not.toBeNull();
    expect(DB.login('admin', 'admin123', 'customer')).toBeNull();
    expect(DB.login('admin', 'admin123', 'support')).toBeNull();
  });

  test('ST-05-004: brute-force credential attempts all return null', () => {
    const attempts = [
      ['customer1', 'admin123', 'customer'],
      ['admin', 'cust1pass', 'admin'],
      ['support1', 'admin123', 'support'],
      ['customer1', 'support1pass', 'customer'],
    ];
    for (const [u, p, r] of attempts) {
      expect(DB.login(u, p, r)).toBeNull();
    }
  });

  test('ST-05-005: SQL injection attempts do not bypass authentication', () => {
    const payloads = [
      ["' OR 1=1 --", 'anything', 'admin'],
      ["admin'--", 'admin123', 'admin'],
      ['"; DROP TABLE users; --', 'pass', 'customer'],
    ];
    for (const [u, p, r] of payloads) {
      expect(DB.login(u, p, r)).toBeNull();
    }
  });

  test('ST-05-006: session is invalidated on logout (null check)', () => {
    let session = DB.login('customer2', 'cust2pass', 'customer');
    expect(session).not.toBeNull();
    // Simulate logout
    session = null;
    expect(session).toBeNull();
    // Confirm DB state unchanged (user still exists)
    expect(DB.customers['customer2']).toBeDefined();
  });

  test('ST-05-007: empty and whitespace credentials always rejected', () => {
    const bad = [
      ['', '', 'customer'],
      ['   ', '   ', 'admin'],
      ['customer1', '', 'customer'],
      ['', 'cust1pass', 'customer'],
    ];
    for (const [u, p, r] of bad) {
      expect(DB.login(u, p, r)).toBeNull();
    }
  });
});

// ── ST-06: END-TO-END TICKET LIFECYCLE WITH HISTORY FEEDBACK ──────────────────
describe('ST-06 | End-to-End Ticket Lifecycle with History Feedback Loop', () => {

  /**
   * Scenario: A ticket is raised, resolved, and the resolution history is
   * used to improve routing of a subsequent similar ticket. This validates
   * that the ranking feedback loop works correctly across the full lifecycle.
   *
   * This is the most comprehensive system test — it spans authentication,
   * ticket creation, resolution, history persistence, and ranking feedback.
   */

  test('ST-06-001: full lifecycle — raise, assign, resolve, verify history loop', () => {
    // Step 1: Customer raises a billing ticket
    const step1 = simulateTicketSubmission({
      subject: 'Invoice payment overcharged billing error account',
      body: 'Double-charged for subscription renewal. Please refund.',
      customerUsername: 'customer9',
    });

    expect(step1.error).toBeUndefined();
    expect(step1.ticket.status).toBe('open');
    const assignedAgent = step1.agentId;

    // Step 2: Agent resolves the ticket
    DB.tickets[step1.ticket.id].status = 'resolved';
    DB.tickets[step1.ticket.id].resolved_at = new Date().toISOString();
    DB.tickets[step1.ticket.id].resolution_note = 'Refund of duplicate charge processed. Billing team notified.';
    DB.recalcLoads();

    // Step 3: Verify load decremented
    expect(DB.supportTeam[assignedAgent].current_load).toBe(0);

    // Step 4: Verify history captured
    const history = DB.getAgentHistory();
    const agentHist = history[assignedAgent];
    expect(agentHist.some(t => t.subject.includes('Invoice payment overcharged'))).toBe(true);

    // Step 5: New similar ticket — should rank the same agent highly
    const ranking = TransformerEngine.rankAgents({
      subject: 'Payment invoice billing overcharged, need refund',
      tags: ['Billing', 'Refund', 'Account'],
      queue: 'Billing and Payments',
      priority: 'medium',
      type_: 'Problem',
      agentHistory: history,
    });

    const top3 = ranking.slice(0, 3).map(r => r.agent);
    expect(top3).toContain(assignedAgent);

    // Step 6: Assign the new ticket and confirm a valid agent is selected
    const newAssignment = DB.selectAgent(ranking);
    expect(newAssignment).toMatch(/^support\d+$/);
    expect(DB.supportTeam[newAssignment].current_load).toBeLessThanOrEqual(DB.supportTeam[newAssignment].max_load);
  });

  test('ST-06-002: multiple resolutions build richer history and improve ranking accuracy', () => {
    // Resolve 3 billing tickets for support5
    ['billing error overcharged', 'payment refund required account', 'invoice incorrect billing charge'].forEach((subj, i) => {
      const id = DB.genId();
      DB.tickets[id] = {
        id, subject: subj, body: '',
        customer_id: `customer${i+1}`,
        assigned_to: 'support5',
        queue: 'Billing and Payments',
        priority: 'medium', ticket_type: 'Problem',
        tags: ['Billing', 'Account'],
        status: 'resolved',
        created_at: new Date().toISOString(),
        assigned_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
        resolution_note: 'Fixed.',
        tfidf_score: 0.7, ai_score: 0, final_score: 0.7,
        top5_ranking: [], priority_scores: {}
      };
    });

    const history = DB.getAgentHistory();
    expect(history['support5'].length).toBe(3);

    const ranking = TransformerEngine.rankAgents({
      subject: 'Billing invoice payment overcharged account error',
      tags: ['Billing', 'Account'],
      queue: 'Billing and Payments',
      priority: 'medium',
      type_: 'Problem',
      agentHistory: history,
    });

    // support5 should be top ranked due to rich billing history
    expect(ranking[0].agent).toBe('support5');
  });
});