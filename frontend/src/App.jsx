import { useState, useEffect, useRef } from "react";
import { API } from "./api.js";

const C = {
  bg:"#0A0C10",surface:"#111318",border:"#1E2128",borderHi:"#2E3340",
  accent:"#4F8EF7",accentDim:"#1A2D4F",green:"#22C55E",greenDim:"#0D2E1A",
  amber:"#F59E0B",amberDim:"#2E1F05",red:"#EF4444",redDim:"#2E0D0D",
  textPri:"#F1F3F8",textSec:"#8B92A5",textDim:"#4B5263",
};

const GLOBAL_CSS=`
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{background:${C.bg};color:${C.textPri};font-family:'Syne',sans-serif;min-height:100vh;}
  ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:${C.bg};}
  ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideIn{from{opacity:0;transform:translateX(-12px);}to{opacity:1;transform:translateX(0);}}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .fade-up{animation:fadeUp 0.4s ease forwards;}
  .slide-in{animation:slideIn 0.3s ease forwards;}
  input,textarea,button{font-family:'Syne',sans-serif;outline:none;}button{cursor:pointer;}
`;

const pColor=p=>p==="high"?C.red:p==="medium"?C.amber:C.green;
const sColor=s=>s==="resolved"?C.green:s==="in_progress"?C.amber:C.accent;

const Badge=({label,color=C.accent})=>(
  <span style={{display:"inline-block",padding:"2px 10px",borderRadius:4,fontSize:11,
    fontFamily:"'DM Mono',monospace",fontWeight:500,letterSpacing:"0.05em",
    background:color+"22",color,border:`1px solid ${color}33`}}>{label}</span>
);
const Spinner=({size=16})=>(
  <div style={{width:size,height:size,border:`2px solid ${C.border}`,
    borderTop:`2px solid ${C.accent}`,borderRadius:"50%",
    animation:"spin 0.8s linear infinite",display:"inline-block",flexShrink:0}}/>
);
const Cursor=()=><span style={{animation:"blink 1s step-end infinite",color:C.accent}}>▋</span>;
const Mono=({children,color=C.textDim})=>(
  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,letterSpacing:"0.08em",color}}>{children}</span>
);
const Field=({label,value})=>(
  <div><Mono>{label.toUpperCase()}</Mono>
  <div style={{fontSize:14,color:C.textPri,marginTop:4}}>{value||"—"}</div></div>
);

function Shell({user,onLogout,nav,activeNav,setActiveNav,children}){
  const rColor=user.role==="admin"?C.amber:user.role==="support"?C.green:C.accent;
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
      <style>{GLOBAL_CSS}</style>
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 28px",height:56,background:C.surface,borderBottom:`1px solid ${C.border}`,
        position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:24}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:C.accent,fontSize:16}}>◈</span>
            <span style={{fontWeight:700,fontSize:14,letterSpacing:"0.1em"}}>SUPPORTAI</span>
          </div>
          <div style={{width:1,height:20,background:C.border}}/>
          <nav style={{display:"flex",gap:4}}>
            {nav.map(n=>(
              <button key={n.key} onClick={()=>setActiveNav(n.key)} style={{
                padding:"6px 14px",borderRadius:6,border:"none",
                background:activeNav===n.key?rColor+"22":"transparent",
                color:activeNav===n.key?rColor:C.textSec,
                fontSize:13,fontWeight:activeNav===n.key?600:400,transition:"all 0.15s"}}>
                {n.label}
              </button>
            ))}
          </nav>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:600}}>{user.name||user.username}</div>
            <Mono color={rColor}>{user.role.toUpperCase()}</Mono>
          </div>
          <button onClick={onLogout} style={{padding:"6px 12px",background:"none",
            border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:12}}>
            Sign out
          </button>
        </div>
      </header>
      <main style={{flex:1,padding:28,maxWidth:1100,width:"100%",margin:"0 auto"}}>{children}</main>
    </div>
  );
}

function TicketCard({ticket:t,onClick,showCustomer}){
  return(
    <div onClick={onClick} style={{padding:"14px 18px",background:C.surface,
      border:`1px solid ${C.border}`,borderRadius:10,cursor:"pointer",
      display:"flex",alignItems:"center",gap:16,transition:"border-color 0.15s"}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderHi}
      onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
      <Mono>{t.ticket_ref}</Mono>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:14,whiteSpace:"nowrap",
          overflow:"hidden",textOverflow:"ellipsis"}}>{t.subject}</div>
        {showCustomer&&<div style={{fontSize:12,color:C.textSec,marginTop:2}}>Customer #{t.customer_id}</div>}
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
        <Badge label={t.priority} color={pColor(t.priority)}/>
        <Badge label={t.status.replace("_"," ")} color={sColor(t.status)}/>
        <span style={{color:C.textDim,fontSize:18}}>›</span>
      </div>
    </div>
  );
}

function TicketDetail({ticket:t,onBack,showRanking}){
  return(
    <div className="fade-up">
      {onBack&&<button onClick={onBack} style={{background:"none",border:"none",color:C.textSec,
        fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:6}}>← Back</button>}
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`,
          display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{display:"flex",gap:8,marginBottom:6,flexWrap:"wrap"}}>
              <Mono>{t.ticket_ref}</Mono>
              <Badge label={t.priority} color={pColor(t.priority)}/>
              <Badge label={t.status.replace("_"," ")} color={sColor(t.status)}/>
              <Badge label={t.ticket_type||t.type||""} color={C.textSec}/>
            </div>
            <h2 style={{fontSize:18,fontWeight:700}}>{t.subject}</h2>
          </div>
          {t.priority_score>0&&(
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:22,fontWeight:800,color:C.accent}}>
                {(t.priority_score*100).toFixed(1)}%
              </div>
              <Mono>AI confidence</Mono>
            </div>
          )}
        </div>
        <div style={{padding:"20px 24px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
            <Field label="Queue" value={t.queue}/>
            <Field label="Assigned to" value={t.assigned_agent_name||"Unassigned"}/>
            <Field label="Created" value={t.created_at}/>
            {t.resolved_at&&<Field label="Resolved" value={t.resolved_at}/>}
          </div>
          <div style={{marginBottom:16}}>
            <Mono>DESCRIPTION</Mono>
            <p style={{fontSize:14,color:C.textSec,lineHeight:1.7,marginTop:6}}>{t.body}</p>
          </div>
          {t.resolution_notes&&(
            <div style={{padding:"14px 16px",background:C.greenDim,
              border:`1px solid ${C.green}33`,borderRadius:8}}>
              <Mono color={C.green}>RESOLUTION</Mono>
              <p style={{fontSize:14,color:C.textPri,lineHeight:1.7,marginTop:6}}>{t.resolution_notes}</p>
            </div>
          )}
        </div>
        {showRanking&&t.top5_ranking?.length>0&&(
          <div style={{borderTop:`1px solid ${C.border}`,padding:"20px 24px"}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>AI Agent Ranking — Top 5</div>
            {t.top5_ranking.map((r,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:14,
                padding:"10px 14px",borderRadius:8,marginBottom:8,
                background:i===0?C.accentDim:C.bg,
                border:`1px solid ${i===0?C.accent+"44":C.border}`}}>
                <div style={{width:24,height:24,borderRadius:"50%",flexShrink:0,
                  background:i===0?C.accent:C.borderHi,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:11,fontWeight:700,color:i===0?"#fff":C.textSec}}>{r.rank}</div>
                <div style={{flex:1}}>
                  <span style={{fontWeight:600,fontSize:14}}>{r.name}</span>
                  <span style={{fontSize:12,color:C.textDim,
                    fontFamily:"'DM Mono',monospace",marginLeft:10}}>{r.reason}</span>
                </div>
                <Mono color={i===0?C.accent:C.textSec}>
                  {typeof r.score==="number"?r.score.toFixed(4):r.score}
                </Mono>
                {i===0&&t.assigned_agent_name===r.name&&<Badge label="Assigned" color={C.green}/>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoginScreen({onLogin}){
  const [role,setRole]=useState(null);
  const [mode,setMode]=useState("login");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const ROLES=[
    {key:"customer",label:"Customer",icon:"◎",desc:"Raise & track tickets"},
    {key:"support",label:"Support Agent",icon:"◈",desc:"Manage assigned tickets"},
    {key:"admin",label:"Admin",icon:"◆",desc:"Full system oversight"},
  ];
  const handleLogin=async()=>{
    setError("");setLoading(true);
    try{const user=await API.login({username,password,role});onLogin(user);}
    catch(e){setError(e.message);}
    finally{setLoading(false);}
  };
  const resetAuthFields=()=>{
    setName("");setEmail("");setUsername("");setPassword("");setError("");
  };
  const handleSignup=async()=>{
    setError("");setLoading(true);
    try{const user=await API.signup({name,email,username,password});onLogin(user);}
    catch(e){setError(e.message);}
    finally{setLoading(false);}
  };
  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:`radial-gradient(ellipse 80% 60% at 50% -10%, ${C.accentDim}, ${C.bg})`,padding:24}}>
      <style>{GLOBAL_CSS}</style>
      <div className="fade-up" style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:10,padding:"8px 18px",
            border:`1px solid ${C.border}`,borderRadius:8,background:C.surface,marginBottom:16}}>
            <span style={{color:C.accent,fontSize:18}}>◈</span>
            <span style={{fontSize:15,fontWeight:700,letterSpacing:"0.12em"}}>SUPPORTAI</span>
          </div>
          <p style={{color:C.textDim,fontSize:13,fontFamily:"'DM Mono',monospace"}}>
            Intelligent ticket routing system
          </p>
        </div>
        {!role?(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <Mono>SELECT PORTAL</Mono><div style={{height:8}}/>
            {ROLES.map(r=>(
              <button key={r.key} onClick={()=>{setRole(r.key);setMode("login");resetAuthFields();}} style={{
                display:"flex",alignItems:"center",gap:14,padding:"16px 20px",
                background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:10,color:C.textPri,textAlign:"left",transition:"all 0.2s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background=C.accentDim;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.surface;}}>
                <span style={{fontSize:22,color:C.accent}}>{r.icon}</span>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{r.label}</div>
                  <div style={{fontSize:12,color:C.textSec,marginTop:2}}>{r.desc}</div>
                </div>
                <span style={{marginLeft:"auto",color:C.textDim,fontSize:18}}>›</span>
              </button>
            ))}
          </div>
        ):(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
              <button onClick={()=>{setRole(null);setMode("login");resetAuthFields();}} style={{
                background:"none",border:"none",color:C.textSec,fontSize:20}}>←</button>
              <Mono>{ROLES.find(r=>r.key===role)?.label} {mode}</Mono>
            </div>
            {role==="customer"&&(
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                {["login","signup"].map(opt=>(
                  <button key={opt} onClick={()=>{setMode(opt);setError("");}} style={{
                    flex:1,padding:"10px 12px",borderRadius:8,
                    border:`1px solid ${mode===opt?C.accent:C.border}`,
                    background:mode===opt?C.accentDim:C.surface,
                    color:mode===opt?C.accent:C.textSec,fontSize:13,fontWeight:600}}>
                    {opt==="login"?"Sign In":"Sign Up"}
                  </button>
                ))}
              </div>
            )}
            {[
              ...(role==="customer"&&mode==="signup"?[
                {label:"NAME",value:name,set:setName,type:"text"},
                {label:"EMAIL",value:email,set:setEmail,type:"email"},
              ]:[]),
              {label:"USERNAME",value:username,set:setUsername,type:"text"},
              {label:"PASSWORD",value:password,set:setPassword,type:"password"}].map(f=>(
              <div key={f.label} style={{marginBottom:14}}>
                <label htmlFor={`auth-${f.label.toLowerCase()}`} style={{display:"block",marginBottom:6}}><Mono>{f.label}</Mono></label>
                <input id={`auth-${f.label.toLowerCase()}`} type={f.type} value={f.value}
                  onChange={e=>f.set(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&(mode==="signup"?handleSignup():handleLogin())}
                  style={{width:"100%",padding:"12px 14px",background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:8,color:C.textPri,fontSize:14}}/>
              </div>
            ))}
            {error&&<p style={{color:C.red,fontSize:12,fontFamily:"'DM Mono',monospace",marginBottom:14}}>{error}</p>}
            <button onClick={mode==="signup"?handleSignup:handleLogin} disabled={loading} style={{
              width:"100%",padding:13,background:loading?C.accentDim:C.accent,
              border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:14,
              letterSpacing:"0.06em",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {loading?<><Spinner/>{mode==="signup"?"Creating account...":"Authenticating..."}</>:(mode==="signup"?"Create Customer Account →":"Sign In →")}
            </button>
            <div style={{marginTop:14,padding:"12px 14px",background:C.bg,
              borderRadius:8,border:`1px solid ${C.border}`}}>
              <Mono>DEMO CREDENTIALS</Mono>
              <p style={{fontSize:12,color:C.textSec,marginTop:6}}>
                {role==="admin"&&"admin / admin123"}
                {role==="customer"&&(mode==="signup"?"Create a new customer account here.":"customer1 / pass123")}
                {role==="support"&&"support1 / pass123"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerPortal({user,onLogout}){
  const [view,setView]=useState("chat");
  const [tickets,setTickets]=useState([]);
  const [loading,setLoading]=useState(false);
  const [refreshingTickets,setRefreshingTickets]=useState(false);
  const [messages,setMessages]=useState([{from:"bot",text:"Hello! Describe your issue and I'll raise a ticket instantly."}]);
  const [input,setInput]=useState("");
  const [stage,setStage]=useState("idle");
  const [draft,setDraft]=useState({});
  const [typing,setTyping]=useState(false);
  const [selected,setSelected]=useState(null);
  const bottomRef=useRef(null);
  useEffect(()=>{loadTickets();},[]);
  useEffect(()=>{if(view==="tickets")loadTickets(true);},[view]);
  useEffect(()=>{
    if(view!=="tickets")return;
    const timer=setInterval(()=>{loadTickets(true);},5000);
    return()=>clearInterval(timer);
  },[view,selected]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,typing]);
  const loadTickets=async(silent=false)=>{
    if(silent)setRefreshingTickets(true);
    else setLoading(true);
    try{
      const nextTickets=await API.myTickets(user.id);
      setTickets(nextTickets);
      if(selected){
        const updatedSelected=nextTickets.find(t=>t.id===selected.id||t.ticket_ref===selected.ticket_ref);
        if(updatedSelected)setSelected(updatedSelected);
      }
    }
    catch(e){console.error(e);}
    finally{
      if(silent)setRefreshingTickets(false);
      else setLoading(false);
    }
  };
  const botSay=(text,delay=700)=>{
    setTyping(true);
    setTimeout(()=>{setTyping(false);setMessages(m=>[...m,{from:"bot",text}]);},delay);
  };
  const handleSend=async()=>{
    const val=input.trim();if(!val)return;
    setMessages(m=>[...m,{from:"user",text:val}]);setInput("");
    if(stage==="idle"){
      setDraft({subject:val});setStage("body");
      botSay("Got it. Can you describe the issue in more detail?");
    }else if(stage==="body"){
      setDraft(d=>({...d,body:val}));setStage("confirm");
      botSay(`Ready to submit:\n\nSubject: "${draft.subject}"\nDetails: "${val}"\n\nType "yes" to confirm or "no" to cancel.`);
    }else if(stage==="confirm"){
      if(val.toLowerCase()==="yes"){
        setStage("submitting");
        botSay("Submitting your ticket...",300);
        try{
          const ticket=await API.createTicket({customer_id:user.id,subject:draft.subject,body:draft.body});
          setTickets(t=>[ticket,...t]);
          setTimeout(()=>{
            setTyping(false);
            setMessages(m=>[...m,{from:"bot",
              text:`Ticket ${ticket.ticket_ref} raised.\nPriority: ${ticket.priority.toUpperCase()}\nQueue: ${ticket.queue}\nAssigned to: ${ticket.assigned_agent_name||"Pending"}\n\nTrack it in "My Tickets".`}]);
          },1200);
        }catch(e){botSay(`Error: ${e.message}`);}
        setStage("idle");setDraft({});
      }else{
        setStage("idle");setDraft({});
        botSay("Cancelled. What's the issue you'd like to report?");
      }
    }else{botSay("Switch to 'My Tickets' to track your tickets.");}
  };
  const nav=[{key:"chat",label:"New Ticket"},{key:"tickets",label:`My Tickets (${tickets.length})`}];
  const activeTickets=tickets.filter(t=>t.status!=="resolved");
  const resolvedTickets=tickets.filter(t=>t.status==="resolved");
  return(
    <Shell user={user} onLogout={onLogout} nav={nav} activeNav={view} setActiveNav={setView}>
      {view==="chat"&&(
        <div className="fade-up" style={{maxWidth:680,margin:"0 auto"}}>
          <div style={{marginBottom:20}}>
            <h1 style={{fontSize:22,fontWeight:700}}>Support Chat</h1>
            <p style={{fontSize:13,color:C.textSec,marginTop:4}}>Describe your issue — AI classifies and assigns it instantly.</p>
          </div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{height:420,overflowY:"auto",padding:"20px 20px 12px",
              display:"flex",flexDirection:"column",gap:12}}>
              {messages.map((m,i)=>(
                <div key={i} className="slide-in" style={{display:"flex",justifyContent:m.from==="user"?"flex-end":"flex-start"}}>
                  {m.from==="bot"&&(
                    <div style={{width:28,height:28,borderRadius:"50%",background:C.accentDim,
                      border:`1px solid ${C.accent}44`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:12,color:C.accent,
                      flexShrink:0,marginRight:10,marginTop:2}}>◈</div>
                  )}
                  <div style={{maxWidth:"72%",padding:"10px 14px",borderRadius:10,
                    background:m.from==="user"?C.accentDim:C.bg,
                    border:`1px solid ${m.from==="user"?C.accent+"44":C.border}`,
                    fontSize:14,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{m.text}</div>
                </div>
              ))}
              {typing&&(
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:C.accentDim,
                    border:`1px solid ${C.accent}44`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:12,color:C.accent}}>◈</div>
                  <div style={{padding:"10px 14px",borderRadius:10,background:C.bg,
                    border:`1px solid ${C.border}`,fontSize:14,color:C.textSec}}>
                    typing<Cursor/>
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>
            <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 16px",display:"flex",gap:10}}>
              <input value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSend()}
                placeholder="Type your message..."
                style={{flex:1,padding:"10px 14px",background:C.bg,
                  border:`1px solid ${C.border}`,borderRadius:8,color:C.textPri,fontSize:14}}/>
              <button onClick={handleSend} style={{padding:"10px 18px",background:C.accent,
                border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:13}}>Send</button>
            </div>
          </div>
        </div>
      )}
      {view==="tickets"&&(
        <div className="fade-up">
          <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <h1 style={{fontSize:22,fontWeight:700}}>My Tickets</h1>
            {!selected&&(
              <button onClick={()=>loadTickets(true)} disabled={refreshingTickets} style={{
                padding:"8px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
                color:C.textSec,fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                {refreshingTickets?<><Spinner size={14}/>Refreshing...</>:"Refresh"}
              </button>
            )}
          </div>
          {loading?<div style={{display:"flex",justifyContent:"center",padding:40}}><Spinner size={32}/></div>
          :selected?<TicketDetail ticket={selected} onBack={()=>setSelected(null)}/>
          :(
            <div style={{display:"flex",flexDirection:"column",gap:24}}>
              <section>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <h2 style={{fontSize:16,fontWeight:600}}>Active Tickets</h2>
                  <Badge label={String(activeTickets.length)} color={C.amber}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {activeTickets.map(t=>(
                    <TicketCard key={t.id} ticket={t} onClick={()=>setSelected(t)}/>
                  ))}
                  {!activeTickets.length&&<p style={{color:C.textDim,textAlign:"center",padding:"28px 20px",fontSize:14,
                    background:C.surface,border:`1px solid ${C.border}`,borderRadius:10}}>
                    No active tickets. Use the chat to raise one.
                  </p>}
                </div>
              </section>
              <section>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                  <h2 style={{fontSize:16,fontWeight:600}}>Resolved Tickets</h2>
                  <Badge label={String(resolvedTickets.length)} color={C.green}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {resolvedTickets.map(t=>(
                    <div key={t.id} style={{display:"flex",flexDirection:"column",gap:8}}>
                      <TicketCard ticket={t} onClick={()=>setSelected(t)}/>
                      <div style={{padding:"12px 14px",background:C.greenDim,border:`1px solid ${C.green}33`,borderRadius:8}}>
                        <Mono color={C.green}>SUPPORT RESOLUTION</Mono>
                        <p style={{fontSize:13,color:C.textPri,lineHeight:1.6,marginTop:6}}>
                          {t.resolution_notes||"No resolution notes were added by the support team."}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!resolvedTickets.length&&<p style={{color:C.textDim,textAlign:"center",padding:"28px 20px",fontSize:14,
                    background:C.surface,border:`1px solid ${C.border}`,borderRadius:10}}>
                    No resolved tickets yet.
                  </p>}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function SupportPortal({user,onLogout}){
  const [view,setView]=useState("active");
  const [tickets,setTickets]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(null);
  const [resolveText,setResolveText]=useState("");
  const [resolving,setResolving]=useState(false);
  useEffect(()=>{loadTickets();},[]);
  const loadTickets=async()=>{
    setLoading(true);
    try{setTickets(await API.agentTickets(user.id));}
    catch(e){console.error(e);}
    finally{setLoading(false);}
  };
  const handleResolve=async()=>{
    if(!resolveText.trim())return;setResolving(true);
    try{
      const updated=await API.resolveTicket(selected.ticket_ref,{agent_id:user.id,resolution_notes:resolveText});
      setTickets(ts=>ts.map(t=>t.id===updated.id?updated:t));
      setSelected(updated);setResolveText("");
    }catch(e){alert(e.message);}
    finally{setResolving(false);}
  };
  const open=tickets.filter(t=>t.status!=="resolved");
  const resolved=tickets.filter(t=>t.status==="resolved");
  const list=view==="active"?open:resolved;
  const nav=[{key:"active",label:`Active (${open.length})`},{key:"resolved",label:`Resolved (${resolved.length})`}];
  return(
    <Shell user={user} onLogout={onLogout} nav={nav} activeNav={view}
      setActiveNav={v=>{setView(v);setSelected(null);}}>
      <div className="fade-up">
        <div style={{display:"flex",gap:14,marginBottom:24}}>
          {[{label:"Active",value:open.length,color:C.amber},{label:"Resolved",value:resolved.length,color:C.green},{label:"Total",value:tickets.length,color:C.accent}].map(s=>(
            <div key={s.label} style={{flex:1,padding:"16px 20px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10}}>
              <div style={{fontSize:28,fontWeight:800,color:s.color}}>{s.value}</div>
              <div style={{fontSize:12,color:C.textSec,marginTop:4}}>{s.label}</div>
            </div>
          ))}
        </div>
        {loading?<div style={{display:"flex",justifyContent:"center",padding:40}}><Spinner size={32}/></div>
        :selected?(
          <>
            <button onClick={()=>{setSelected(null);setResolveText("");}} style={{background:"none",border:"none",color:C.textSec,fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:6}}>← Back</button>
            <TicketDetail ticket={selected} showRanking/>
            {selected.status!=="resolved"&&(
              <div style={{marginTop:20,padding:20,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10}}>
                <h3 style={{fontSize:14,fontWeight:600,marginBottom:12}}>Mark as Resolved</h3>
                <textarea value={resolveText} onChange={e=>setResolveText(e.target.value)}
                  placeholder="Describe how you resolved this issue..."
                  rows={4} style={{width:"100%",padding:"10px 14px",background:C.bg,
                    border:`1px solid ${C.border}`,borderRadius:8,color:C.textPri,fontSize:14,resize:"vertical",lineHeight:1.6}}/>
                <button onClick={handleResolve} disabled={resolving} style={{marginTop:10,padding:"10px 24px",
                  background:C.green,border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:13,
                  display:"flex",alignItems:"center",gap:8}}>
                  {resolving?<><Spinner/>Saving...</>:"Mark Resolved"}
                </button>
              </div>
            )}
          </>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <h2 style={{fontSize:16,fontWeight:600,marginBottom:4}}>{view==="active"?"Active Tickets":"Resolved Tickets"}</h2>
            {list.map(t=><TicketCard key={t.id} ticket={t} onClick={()=>setSelected(t)} showCustomer/>)}
            {!list.length&&<p style={{color:C.textDim,textAlign:"center",padding:40,fontSize:14}}>No tickets here.</p>}
          </div>
        )}
      </div>
    </Shell>
  );
}

function AdminPortal({user,onLogout}){
  const [view,setView]=useState("overview");
  const [tickets,setTickets]=useState([]);
  const [agents,setAgents]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState("");
  useEffect(()=>{loadAll();},[]);
  const loadAll=async()=>{
    setLoading(true);
    try{const[t,a]=await Promise.all([API.allTickets(),API.allAgents()]);setTickets(t);setAgents(a);}
    catch(e){console.error(e);}
    finally{setLoading(false);}
  };
  const found=tickets.find(t=>t.ticket_ref?.toLowerCase()===search.trim().toLowerCase());
  const counts={
    open:tickets.filter(t=>t.status==="open").length,
    in_progress:tickets.filter(t=>t.status==="in_progress").length,
    resolved:tickets.filter(t=>t.status==="resolved").length,
  };
  const nav=[{key:"overview",label:"Overview"},{key:"tickets",label:"All Tickets"},{key:"lookup",label:"Ticket Lookup"},{key:"agents",label:"Agents"}];
  return(
    <Shell user={user} onLogout={onLogout} nav={nav} activeNav={view}
      setActiveNav={v=>{setView(v);setSelected(null);}}>
      <div className="fade-up">
        {view==="overview"&&(
          <>
            <div style={{marginBottom:24}}>
              <h1 style={{fontSize:22,fontWeight:700}}>System Overview</h1>
              <p style={{fontSize:13,color:C.textSec,marginTop:4}}>Real-time ticket pipeline status.</p>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:28}}>
              {[{label:"Open",value:counts.open,color:C.accent},{label:"In Progress",value:counts.in_progress,color:C.amber},{label:"Resolved",value:counts.resolved,color:C.green}].map(s=>(
                <div key={s.label} style={{padding:"20px 24px",background:C.surface,
                  border:`1px solid ${C.border}`,borderRadius:12,borderLeft:`3px solid ${s.color}`}}>
                  <div style={{fontSize:36,fontWeight:800,color:s.color}}>{s.value}</div>
                  <div style={{fontSize:13,color:C.textSec,marginTop:6}}>{s.label}</div>
                </div>
              ))}
            </div>
            <h2 style={{fontSize:15,fontWeight:600,marginBottom:12}}>Recent Tickets</h2>
            {loading?<Spinner/>:(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {tickets.slice(0,5).map(t=>(
                  <TicketCard key={t.id} ticket={t} showCustomer
                    onClick={()=>{setSelected(t);setView("tickets");}}/>
                ))}
              </div>
            )}
          </>
        )}
        {view==="tickets"&&(
          <>
            <div style={{marginBottom:20}}><h1 style={{fontSize:22,fontWeight:700}}>All Tickets</h1></div>
            {loading?<div style={{display:"flex",justifyContent:"center",padding:40}}><Spinner size={32}/></div>
            :selected?(
              <>
                <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:C.textSec,fontSize:13,marginBottom:16,display:"flex",alignItems:"center",gap:6}}>← Back</button>
                <TicketDetail ticket={selected} showRanking/>
              </>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {tickets.map(t=><TicketCard key={t.id} ticket={t} showCustomer onClick={()=>setSelected(t)}/>)}
              </div>
            )}
          </>
        )}
        {view==="lookup"&&(
          <>
            <div style={{marginBottom:24}}>
              <h1 style={{fontSize:22,fontWeight:700}}>Ticket Lookup</h1>
              <p style={{fontSize:13,color:C.textSec,marginTop:4}}>Enter a ticket ID to inspect AI ranking and assignment.</p>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:24,maxWidth:480}}>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="e.g. TKT-0001"
                style={{flex:1,padding:"11px 14px",background:C.surface,
                  border:`1px solid ${C.border}`,borderRadius:8,color:C.textPri,fontSize:14}}/>
            </div>
            {search&&found&&<TicketDetail ticket={found} showRanking/>}
            {search&&!found&&<p style={{color:C.red,fontSize:13,fontFamily:"'DM Mono',monospace"}}>No ticket found: "{search}"</p>}
          </>
        )}
        {view==="agents"&&(
          <>
            <div style={{marginBottom:20}}><h1 style={{fontSize:22,fontWeight:700}}>Support Agents</h1></div>
            {loading?<Spinner/>:(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
                {agents.map(a=>{
                  const res=tickets.filter(t=>t.assigned_agent_id===a.id&&t.status==="resolved").length;
                  const act=tickets.filter(t=>t.assigned_agent_id===a.id&&t.status!=="resolved").length;
                  return(
                    <div key={a.id} style={{padding:"18px 20px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                        <div style={{width:36,height:36,borderRadius:"50%",background:C.greenDim,
                          border:`1px solid ${C.green}44`,display:"flex",alignItems:"center",
                          justifyContent:"center",fontSize:14,color:C.green,fontWeight:700}}>{a.id}</div>
                        <div>
                          <div style={{fontWeight:600,fontSize:14}}>{a.name}</div>
                          <Mono>{a.username}</Mono>
                        </div>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
                        {(a.specialties||[]).map(s=><Badge key={s} label={s}/>)}
                      </div>
                      <div style={{display:"flex",gap:20}}>
                        <div><div style={{fontSize:20,fontWeight:800,color:C.green}}>{res}</div><div style={{fontSize:11,color:C.textDim}}>Resolved</div></div>
                        <div><div style={{fontSize:20,fontWeight:800,color:C.amber}}>{act}</div><div style={{fontSize:11,color:C.textDim}}>Active</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

export default function App(){
  const [user,setUser]=useState(null);
  if(!user)return <LoginScreen onLogin={setUser}/>;
  if(user.role==="customer")return <CustomerPortal user={user} onLogout={()=>setUser(null)}/>;
  if(user.role==="support") return <SupportPortal  user={user} onLogout={()=>setUser(null)}/>;
  if(user.role==="admin")   return <AdminPortal    user={user} onLogout={()=>setUser(null)}/>;
}
