import { useState, useEffect, useRef, useCallback, createContext, useContext, Fragment } from "react";

const genId = () => Math.random().toString(36).slice(2, 9);
const genPIN = () => String(Math.floor(1000 + Math.random() * 9000));

// ── CLIENT-SIDE RATE LIMITER ─────────────────────────────────────
// Token bucket: max 100 requests per hour per browser session.
// Persisted in sessionStorage so it resets on tab close.
const _rl = {
  get() {
    try {
      const d = JSON.parse(sessionStorage.getItem("jda_rl") || "{}");
      return { count: d.count || 0, windowStart: d.windowStart || Date.now() };
    } catch { return { count: 0, windowStart: Date.now() }; }
  },
  check() {
    const { count, windowStart } = this.get();
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    if (now - windowStart > windowMs) {
      // Window expired — reset
      sessionStorage.setItem("jda_rl", JSON.stringify({ count: 1, windowStart: now }));
      return true;
    }
    if (count >= 100) return false; // Hard limit
    sessionStorage.setItem("jda_rl", JSON.stringify({ count: count + 1, windowStart }));
    return true;
  },
};

// ── PROMPT SANITIZER ─────────────────────────────────────────────
// Strips control characters and truncates user-supplied text.
const sanitizeForPrompt = (str, maxLen) => {
  if (typeof str !== "string") return "";
  const max = typeof maxLen === "number" ? maxLen : 8000;
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, max);
};

const callAPI = async (prompt, maxTokens = 4000) => {
  if (!_rl.check()) {
    throw new Error("Rate limit reached: max 100 requests per hour. Please wait before trying again.");
  }
  const apiEndpoint = window.location.hostname === "localhost" && !window._useProxy
    ? "https://api.anthropic.com/v1/messages"
    : "/api/anthropic";
  const directHeaders = apiEndpoint.includes("anthropic.com")
    ? { "anthropic-dangerous-direct-browser-calls": "true" }
    : {};
  const r = await fetch(apiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", ...directHeaders },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`API ${r.status}: ${t}`); }
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const raw = d.content.map(b => b.text || "").join("");
  const c = raw.replace(/```json\n?|```\n?/g, "").trim();
  try { return JSON.parse(c); } catch {
    const m = c.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    try { return JSON.parse(c.replace(/[\u0000-\u001F\u007F]/g, " ")); } catch {}
    throw new Error(`Parse failed: ${raw.slice(0, 100)}...`);
  }
};


const exportPDF = (kit) => {
  const __pdf = "<" + "!DOCTYPE html>";
  const rows = (kit.scoring_rubric||[]).map(r=>`<tr><td><strong>${r.competency}</strong><br/><small>${r.ats_field_key||""}</small></td><td>${r.weight}</td><td>${r.score_1||""}</td><td>${r.score_2||""}</td><td>${r.score_3||""}</td><td>${r.score_4||""}</td></tr>`).join("");
  const questions = (kit.rounds||[]).map(round=>`<div class="round"><h3>Round ${round.round}: ${round.title}</h3><p class="meta">Led by: ${round.led_by} — ${round.purpose}</p>${(round.questions||[]).map((q,i)=>`<div class="q"><span class="qn">${String(i+1).padStart(2,"0")}</span><div><div class="qt">${q.question}</div><span class="tag">${q.type}</span> <span class="tag">${q.competency}</span>${q.type==="cultural_competency"?'<span class="edi">EDI</span>':""}</div></div>`).join("")}</div>`).join("");
  const __pdfHtml = __pdf + `<!DOCTYPE html><html><head><title>${kit.role} — Interview Kit</title><style>@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',sans-serif;color:#1A1814;padding:48px;font-size:13px;line-height:1.6}h1{font-size:26px;font-weight:800;letter-spacing:-0.8px;margin-bottom:4px}h2{font-size:15px;font-weight:700;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #C8D832}h3{font-size:13px;font-weight:700;margin-bottom:4px;color:#5C3D99}.meta{font-size:11px;color:#6B6760;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px}th{text-align:left;padding:8px 10px;background:#F2F3F5;border:1px solid #D5D8DC;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6B6760}td{padding:10px;border:1px solid #D5D8DC;vertical-align:top}.tag{display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;background:#F2F3F5;border:1px solid #D5D8DC;border-radius:5px;margin-right:4px;color:#3D3A35}.edi{display:inline-block;font-size:10px;font-weight:700;padding:2px 7px;background:#E6F4ED;border:1px solid #A8D5BC;border-radius:5px;color:#2D8653}.round{margin-bottom:28px}.q{display:flex;gap:12px;padding:10px 12px;border:1px solid #D5D8DC;border-radius:8px;margin-bottom:8px}.qn{font-size:11px;font-weight:700;color:#9C9890;min-width:22px;padding-top:2px}.qt{font-size:13px;color:#1A1814;margin-bottom:6px}</style></head><body><h1>${kit.role}</h1><p style="font-size:12px;color:#6B6760;margin-bottom:8px">Generated ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px">${(kit.competencies||[]).map(c=>`<span class="tag" style="background:#F3F7D4;border-color:#D8E44A;color:#4A5200">${c}</span>`).join("")}</div><h2>Interview Questions by Round</h2>${questions}<h2>Competency Scoring Rubric</h2><table><thead><tr><th>Competency</th><th>Weight</th><th>1 Weak</th><th>2 Lean Weak</th><th>3 Neutral</th><th>4 Lean Strong</th><th>5 Strong</th></tr></thead><tbody>${rows}</tbody></table>${(kit.do_not_ask||[]).length>0?`<h2>Do Not Ask</h2>${kit.do_not_ask.map(q=>`<div style="padding:10px 14px;border-radius:8px;background:#FCECEA;border:1px solid #E8B5B0;margin-bottom:8px;font-size:13px;color:#C0392B"><strong>⊘</strong> ${q}</div>`).join("")}`:""}</body></html>`;
  const _pBlob = new Blob([__pdfHtml], { type: "text/html" });
  const _pUrl = URL.createObjectURL(_pBlob);
  const _pA = document.createElement("a");
  _pA.href = _pUrl;
  _pA.download = (kit.role || "scorecard").replace(/[^a-z0-9]/gi, "_").toLowerCase() + "_scorecard.html";
  document.body.appendChild(_pA); _pA.click(); document.body.removeChild(_pA);
  setTimeout(() => URL.revokeObjectURL(_pUrl), 1000);
};

const exportWord = async (kit) => {
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.min.js";
  document.head.appendChild(script);
  await new Promise(res => { script.onload = res; });
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType } = window.docx;
  const border = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
  const borders = { top:border, bottom:border, left:border, right:border };
  const cm = { top:80, bottom:80, left:120, right:120 };
  const hp = (text, lvl) => new Paragraph({ heading:lvl, children:[new TextRun({text,bold:true,font:"Arial",size:lvl===HeadingLevel.HEADING_1?32:26})], spacing:{before:240,after:120} });
  const p = (text, opts={}) => new Paragraph({ children:[new TextRun({text,font:"Arial",size:22,...opts})], spacing:{before:60,after:60} });
  const children = [
    hp(`${kit.role} — Interview Kit`, HeadingLevel.HEADING_1),
    p(`Generated ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}`, {color:"666666"}),
    p(""),
    hp("Core Competencies", HeadingLevel.HEADING_2),
    p((kit.competencies||[]).join("  ·  ")),
    p(""),
  ];
  (kit.rounds||[]).forEach(round => {
    children.push(hp(`Round ${round.round}: ${round.title}`, HeadingLevel.HEADING_2));
    children.push(p(`Led by: ${round.led_by}`, {color:"666666"}));
    children.push(p(round.purpose, {italics:true}));
    children.push(p(""));
    (round.questions||[]).forEach((q,i) => {
      children.push(new Paragraph({ children:[new TextRun({text:`${String(i+1).padStart(2,"0")}  `,bold:true,font:"Arial",size:22}),new TextRun({text:q.question,font:"Arial",size:22})], spacing:{before:80,after:40} }));
      children.push(p(`[${q.type}${q.type==="cultural_competency"?" — EDI":""}  ·  ${q.competency}]`, {color:"888888",size:18}));
    });
    children.push(p(""));
  });
  children.push(hp("Competency Scoring Rubric", HeadingLevel.HEADING_2));
  children.push(p("Rename field keys to match your ATS schema before importing.", {italics:true,color:"888888"}));
  children.push(p(""));
  const hRow = new TableRow({ tableHeader:true, children:["Competency","Weight","1 Weak","2 Lean Weak","3 Neutral","4 Lean Strong","5 Strong"].map((h,idx) => new TableCell({ borders, margins:cm, width:{size:[1600,700,1565,1565,1565,1565][idx],type:WidthType.DXA}, shading:{fill:"F2F3F5",type:ShadingType.CLEAR}, children:[new Paragraph({children:[new TextRun({text:h,bold:true,font:"Arial",size:18})]})] })) });
  const dRows = (kit.scoring_rubric||[]).map(row => new TableRow({ children:[
    new TableCell({borders,margins:cm,width:{size:1600,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.competency,bold:true,font:"Arial",size:20})]}),row.ats_field_key?new Paragraph({children:[new TextRun({text:row.ats_field_key,font:"Arial",size:16,color:"888888"})]}):new Paragraph()]}),
    new TableCell({borders,margins:cm,width:{size:700,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.weight,font:"Arial",size:20})]})] }),
    new TableCell({borders,margins:cm,width:{size:1565,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.score_1||"",font:"Arial",size:20})]})] }),
    new TableCell({borders,margins:cm,width:{size:1565,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.score_2||"",font:"Arial",size:20})]})] }),
    new TableCell({borders,margins:cm,width:{size:1565,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.score_3||"",font:"Arial",size:20})]})] }),
    new TableCell({borders,margins:cm,width:{size:1565,type:WidthType.DXA},children:[new Paragraph({children:[new TextRun({text:row.score_4||"",font:"Arial",size:20})]})] }),
  ]}));
  children.push(new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[1600,700,1565,1565,1565,1565],rows:[hRow,...dRows]}));
  if ((kit.do_not_ask||[]).length>0) {
    children.push(p(""));
    children.push(hp("Do Not Ask", HeadingLevel.HEADING_2));
    kit.do_not_ask.forEach(q => children.push(new Paragraph({children:[new TextRun({text:"⊘  ",bold:true,color:"C0392B",font:"Arial",size:22}),new TextRun({text:q,font:"Arial",size:22})],spacing:{before:60,after:60}})));
  }
  const doc = new Document({
    styles: { default:{document:{run:{font:"Arial",size:22}}}, paragraphStyles:[{id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:32,bold:true,font:"Arial",color:"1A1814"},paragraph:{spacing:{before:240,after:120},outlineLevel:0}},{id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,run:{size:26,bold:true,font:"Arial",color:"5C3D99"},paragraph:{spacing:{before:200,after:80},outlineLevel:1}}] },
    sections: [{ properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}}}, children }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${(kit.role||"interview_kit").replace(/\s+/g,"_").toLowerCase()}_scorecard.docx`;
  a.click(); URL.revokeObjectURL(url);
};

// ── Constants ────────────────────────────────────────────────────
const SAMPLE_JD = `Software Engineering Manager\n\nWe're looking for a rockstar engineering manager who can hit the ground running. The ideal candidate is a young, energetic leader with 10+ years of experience managing ninja developers.\n\nRequirements:\n- Must be a native English speaker\n- Bachelor's degree required (MBA preferred)\n- 10+ years managing high-performing teams\n- Strong culture fit with our fast-paced bro culture\n\nResponsibilities:\n- Lead a team of engineers to crush quarterly goals\n- Own the full technical roadmap`;

const AUDIT_STEPS = [
  { label:"Parsing structure", detail:"Identifying claims, requirements, and language patterns" },
  { label:"Scanning for bias", detail:"Gender-coding, age signals, ableist phrasing, culture-fit proxies" },
  { label:"Checking inclusive signals", detail:"Salary, accommodation, remote policy, EEO statement" },
  { label:"Evaluating requirements", detail:"Flagging inflated credentials and unnecessary gatekeeping" },
  { label:"Drafting rewrites", detail:"Generating inclusive alternatives for each flagged item" },
  { label:"Compiling score", detail:"Calculating inclusivity score and finalizing report" },
];

const ROUND_TYPES = ["Recruiter Screen","Hiring Manager Screen","Behavioral Interview","Technical Assessment","Case Study / Presentation","Panel Interview","Culture / Values Interview","Executive Interview","Skills Demo","Reference Check"];
const EDI_ITEMS = [
  { key:"cross_cultural", label:"Cross-cultural communication", sub:"Communicate clearly across backgrounds, languages, and styles." },
  { key:"equity_awareness", label:"Equity & inclusion awareness", sub:"Understanding of systemic barriers and commitment to equitable outcomes." },
  { key:"anti_bias", label:"Navigating bias & microaggressions", sub:"Recognizes and responds to bias in themselves and institutional settings." },
  { key:"community_engagement", label:"Community & stakeholder representation", sub:"Experience working with historically underrepresented communities." },
  { key:"inclusive_leadership", label:"Inclusive leadership & psych safety", sub:"Creates environments where all backgrounds feel safe to contribute." },
  { key:"accessibility", label:"Accessibility & accommodation mindset", sub:"Proactive approach to ensuring work and spaces are accessible." },
  { key:"global_mindset", label:"Global & multilingual competency", sub:"Works across geographies, time zones, languages, or cultures." },
];
const RECS = [{key:"sc5",label:"Strong Candidate"},{key:"sc4",label:"Lean Candidate"},{key:"sc3",label:"Neutral"},{key:"sc2",label:"Lean Weak"},{key:"sc1",label:"Weak Candidate"}];
const DEFAULT_DEBRIEF = [
  {step:"Grounding Rule",duration:"1 min",instructions:"Remind the panel: score on evidence and specific behaviors only — not gut feel, likability, or culture fit."},
  {step:"Independent Score Review",duration:"3 min",instructions:"Each interviewer shares scores before any discussion. No one changes scores at this stage."},
  {step:"Surface Outliers",duration:"5 min",instructions:"Identify competencies with a spread of 2+ points. Ask: 'What specific behavior led to your score?' Do not debate."},
  {step:"Discuss Open Questions",duration:"8 min",instructions:"Are there gaps in what was assessed? Fill in the picture collaboratively."},
  {step:"Overall Recommendation",duration:"5 min",instructions:"Each interviewer states hire/no-hire and one reason. Start with the most junior person to reduce anchoring."},
  {step:"Align or Escalate",duration:"3 min",instructions:"If the panel agrees, record the decision. If split, the hiring manager decides and documents rationale."},
  {step:"Next Steps",duration:"2 min",instructions:"Who sends the offer or decline? What is the timeline? Assign clear owners before leaving the room."},
];

// Tab color config
const TAB_COLORS = {
  home:      { bg:"#F2F3F5", active:"#1A1814", border:"#D5D8DC" },
  why:       { bg:"#E6F5EF", active:"#00804C", border:"#80C2A6" },
  audit:     { bg:"#E6F5EF", active:"#00804C", border:"#80C2A6" },
  generate:  { bg:"#EDE8F7", active:"#5C3D99", border:"#C4B3E8" },
  scorecards:{ bg:"#E6F4ED", active:"#2D8653", border:"#A8D5BC" },
  debrief:   { bg:"#F3F7D4", active:"#6B7A0A", border:"#D8E44A" },
};

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// ── Styles ───────────────────────────────────────────────────────
const S = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --egg:#F2F3F5;--egg-d:#E8EAED;--egg-dd:#DDE0E4;
  --white:#FFFFFF;--ink:#1A1814;--ink2:#3D3A35;--ink3:#6B6760;--ink4:#9C9890;
  --border:#D5D8DC;--border-l:#EAECEF;
  --lime:#C8D832;--lime-bg:#F3F7D4;--lime-b:#D8E44A;--lime-text:#6B7A0A;
  --green:#2D8653;--green-bg:#E6F4ED;--green-b:#A8D5BC;
  --purple:#5C3D99;--purple-bg:#EDE8F7;--purple-b:#C4B3E8;
  --red:#C0392B;--red-bg:#FCECEA;--red-b:#E8B5B0;
  --amber:#00804C;--amber-bg:#E6F5EF;--amber-b:#80C2A6;
  --teal:#0E7490;--teal-bg:#E0F2FE;--teal-b:#7DD3FC;
  --sh:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
  --sh-md:0 4px 16px rgba(0,0,0,.08),0 2px 4px rgba(0,0,0,.04);
}
body{font-family:'Plus Jakarta Sans',sans-serif;background:var(--egg);color:var(--ink);-webkit-font-smoothing:antialiased;min-height:100vh}

/* Shell */
.shell{display:flex;min-height:100vh}

/* Sidebar */
.sidebar{
  width:240px;flex-shrink:0;
  background:var(--white);
  border-right:1px solid var(--border);
  display:flex;flex-direction:column;
  position:sticky;top:0;height:100vh;
  box-shadow:var(--sh);z-index:50;
}
.sidebar-brand{padding:22px 20px 18px;border-bottom:1px solid var(--border-l);display:flex;align-items:center;gap:12px}
.brand-gem{width:34px;height:34px;background:var(--lime);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.brand-gem-inner{width:15px;height:15px;background:var(--ink);border-radius:3px;transform:rotate(45deg)}
.brand-name{font-size:17px;font-weight:800;letter-spacing:-0.4px;line-height:1.1}
.brand-tag{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--green);margin-top:1px}

.nav{padding:14px 10px;flex:1;overflow-y:auto}
.nav-section-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--ink4);padding:6px 12px 6px;margin-bottom:4px}

/* Color-coded nav items */
.nav-item{
  display:flex;align-items:center;gap:0;
  border-radius:10px;
  font-size:14px;font-weight:600;
  cursor:pointer;transition:all .15s;
  margin-bottom:4px;border:1.5px solid transparent;
  background:transparent;width:100%;text-align:left;
  overflow:hidden;
  padding:0;
}
.nav-item-bar{
  width:5px;flex-shrink:0;align-self:stretch;
  border-radius:8px 0 0 8px;
  transition:all .15s;
}
.nav-item-content{
  display:flex;align-items:center;gap:10px;
  padding:11px 14px 11px 12px;flex:1;
}
.nav-item-label{font-size:14px;font-weight:600;line-height:1.2}
.nav-item-sub{font-size:11px;font-weight:500;opacity:.7;line-height:1.2;margin-top:1px}

.sidebar-footer{padding:14px;border-top:1px solid var(--border-l)}
.proto-badge{font-size:11px;font-weight:500;color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-b);border-radius:20px;padding:5px 12px;text-align:center;display:block}

/* Main */
.main{flex:1;overflow:hidden;min-width:0;display:flex;flex-direction:column}
.main-scroll{flex:1;overflow-y:auto;scroll-behavior:smooth}

/* Page header band */
.page-hdr{
  background:var(--white);
  border-bottom:1px solid var(--border);
  padding:20px 36px 18px;
  display:flex;align-items:center;gap:20px;
  box-shadow:var(--sh);
  flex-shrink:0;
}
.page-hdr-logo{
  display:flex;align-items:center;gap:10px;
  padding-right:20px;
  border-right:1px solid var(--border-l);
  flex-shrink:0;
}
.page-hdr-gem{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.page-hdr-gem-inner{width:11px;height:11px;border-radius:2px;transform:rotate(45deg)}
.page-hdr-wordmark{font-size:13px;font-weight:800;letter-spacing:-0.2px;color:var(--ink);line-height:1.1}
.page-hdr-platform{font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);margin-top:1px}
.page-hdr-divider{width:1px;height:32px;background:var(--border-l);flex-shrink:0}
.page-hdr-text{flex:1;min-width:0}
.page-hdr-title{font-size:17px;font-weight:800;letter-spacing:-0.3px;color:var(--ink);line-height:1.1}
.page-hdr-desc{font-size:12px;color:var(--ink4);font-weight:500;margin-top:3px;line-height:1.4}
.page-hdr-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}

/* Layout — adjusted for page header */
.split{display:grid;grid-template-columns:480px 1fr;flex:1;overflow:hidden}
.panel-l{padding:24px 28px;border-right:1px solid var(--border);background:var(--white);overflow-y:auto;display:flex;flex-direction:column;gap:14px;position:relative}
.panel-r{padding:24px 28px;background:var(--egg);overflow-y:auto}
.full-page{padding:32px 40px;background:var(--egg);overflow-y:auto;flex:1}

/* Typography */
.section-label{font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);margin-bottom:7px}
.sec-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.sec-head-line{flex:1;height:1px;background:var(--border)}

/* Cards */
.card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px 22px;box-shadow:var(--sh)}

/* Inputs */
textarea{width:100%;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;line-height:1.7;color:var(--ink);background:var(--egg);border:1.5px solid var(--border);border-radius:10px;padding:12px 14px;resize:none;outline:none;transition:border-color .15s,box-shadow .15s}
textarea:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-bg)}
textarea::placeholder{color:var(--ink4)}
input[type=text],input[type=password]{width:100%;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;color:var(--ink);background:var(--egg);border:1.5px solid var(--border);border-radius:8px;padding:10px 14px;outline:none;transition:border-color .15s,box-shadow .15s}
input[type=text]:focus,input[type=password]:focus{border-color:var(--purple);box-shadow:0 0 0 3px var(--purple-bg)}
select{font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;color:var(--ink);background:var(--egg);border:1.5px solid var(--border);border-radius:8px;padding:9px 12px;outline:none;cursor:pointer;transition:border-color .15s}
select:focus{border-color:var(--purple)}

/* Buttons */
.btn{font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;font-weight:700;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;transition:all .15s;white-space:nowrap;align-self:flex-start;display:inline-flex;align-items:center;gap:6px}
.btn:active{transform:scale(.98)}
.btn-primary{background:var(--lime);color:var(--ink)}
.btn-primary:hover{background:#B8C82A;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-primary:disabled{background:var(--egg-dd);color:var(--ink4);cursor:not-allowed;transform:none;box-shadow:none}
.btn-ghost{background:transparent;color:var(--ink3);border:1.5px solid var(--border)}
.btn-ghost:hover{background:var(--egg);color:var(--ink);border-color:var(--ink4)}
.btn-green{background:var(--green);color:#fff}
.btn-green:hover{background:#236B41;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-purple{background:var(--purple);color:#fff}
.btn-purple:hover{background:#4A2F80;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-amber{background:var(--amber);color:#fff}
.btn-amber:hover{background:#924309;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-teal{background:var(--teal);color:#fff}
.btn-teal:hover{background:#0A5F75;transform:translateY(-1px);box-shadow:var(--sh-md)}
.btn-sm{padding:7px 13px;font-size:12px;border-radius:7px}
.btn-xs{padding:4px 10px;font-size:11px;border-radius:6px}

/* Tags + Pills */
.tag{display:inline-block;font-size:11px;font-weight:600;color:var(--ink3);background:var(--egg-d);border:1px solid var(--border);border-radius:6px;padding:2px 8px}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;border-radius:20px;padding:3px 10px;border:1px solid}
.pill-red{background:var(--red-bg);color:var(--red);border-color:var(--red-b)}
.pill-amber{background:var(--amber-bg);color:var(--amber);border-color:var(--amber-b)}
.pill-green{background:var(--green-bg);color:var(--green);border-color:var(--green-b)}
.pill-lime{background:var(--lime-bg);color:var(--lime-text);border-color:var(--lime-b)}
.pill-purple{background:var(--purple-bg);color:var(--purple);border-color:var(--purple-b)}
.pill-teal{background:var(--teal-bg);color:var(--teal);border-color:var(--teal-b)}

/* ── Skill panels ── */
.skill-panel{border-radius:12px;border:1.5px solid;padding:16px 18px;margin-bottom:4px}
.skill-panel-must{background:#FAFBF4;border-color:var(--lime-b)}
.skill-panel-nice{background:#F8FAFB;border-color:var(--teal-b)}
.skill-panel-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.skill-panel-title{font-size:13px;font-weight:800;letter-spacing:-0.1px}
.skill-panel-count{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px}
.skill-panel-actions{display:flex;gap:7px;margin-left:auto;flex-wrap:wrap}

/* Skill chips in panel (selected/locked in) */
.skill-bucket{display:flex;flex-wrap:wrap;gap:6px;min-height:32px;padding:6px 0 2px}
.skill-bucket-empty{font-size:12px;color:var(--ink4);font-style:italic;padding:4px 0}

/* Removable chip */
.skill-chip-locked{
  display:inline-flex;align-items:center;gap:5px;
  font-size:12px;font-weight:600;padding:5px 10px;
  border-radius:20px;border:1.5px solid;
  transition:all .15s;
}
.skill-chip-locked-must{background:var(--lime-bg);color:var(--lime-text);border-color:var(--lime-b)}
.skill-chip-locked-nice{background:var(--teal-bg);color:var(--teal);border-color:var(--teal-b)}
.skill-chip-remove{
  display:flex;align-items:center;justify-content:center;
  width:14px;height:14px;border-radius:50%;
  background:rgba(0,0,0,.12);cursor:pointer;font-size:9px;font-weight:900;
  transition:background .15s;flex-shrink:0;
  border:none;line-height:1;
}
.skill-chip-remove:hover{background:rgba(0,0,0,.28)}

/* Suggested chips (pick to add) */
.skill-suggest-area{border-top:1px dashed;padding-top:12px;margin-top:10px}
.skill-suggest-label{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);margin-bottom:8px}
.skill-chip-suggest{
  display:inline-flex;align-items:center;gap:4px;
  font-size:12px;font-weight:600;padding:5px 11px;
  border-radius:20px;border:1.5px dashed;cursor:pointer;
  transition:all .15s;margin:3px;
}
.skill-chip-suggest-must{color:var(--lime-text);border-color:var(--lime-b);background:var(--white)}
.skill-chip-suggest-must:hover{background:var(--lime-bg);border-style:solid}
.skill-chip-suggest-nice{color:var(--teal);border-color:var(--teal-b);background:var(--white)}
.skill-chip-suggest-nice:hover{background:var(--teal-bg);border-style:solid}
.skill-chip-added{opacity:.4;cursor:default;text-decoration:line-through}

/* Boolean string section */
.bool-panel{background:var(--white);border:1.5px solid var(--border);border-radius:12px;padding:16px 18px}
.bool-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer}
.bool-title{font-size:13px;font-weight:800;color:var(--ink)}
.bool-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:var(--egg-d);color:var(--ink3);border:1px solid var(--border)}
.bool-textarea{font-family:'IBM Plex Mono','Courier New',monospace!important;font-size:12px!important;background:var(--egg)!important;line-height:1.6!important}
.bool-parsed{display:flex;flex-wrap:wrap;gap:5px;padding-top:8px}
.bool-term{font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;background:var(--egg-d);color:var(--ink2);border:1px solid var(--border)}
.bool-op{font-size:11px;font-weight:800;padding:3px 6px;color:var(--green);font-family:monospace}

/* Flags */
.flag{border-radius:10px;padding:13px 15px;margin-bottom:10px;border:1px solid}
.flag-bias{background:var(--red-bg);border-color:var(--red-b)}
.flag-missing{background:var(--amber-bg);border-color:var(--amber-b)}
.flag-inflated{background:var(--green-bg);border-color:var(--green-b)}
.flag-note{background:var(--purple-bg);border-color:var(--purple-b)}
.flag-warn{background:var(--amber-bg);border-color:var(--amber-b)}
.flag-label{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:5px}
.fl-bias{color:var(--red)}.fl-missing{color:var(--amber)}.fl-inflated{color:var(--green)}.fl-note{color:var(--purple)}.fl-warn{color:var(--amber)}
.flag-orig{font-size:12px;font-style:italic;color:var(--red);background:rgba(192,57,43,.07);border:1px solid var(--red-b);border-radius:6px;padding:5px 10px;margin-bottom:7px}
.flag-body{font-size:13px;color:var(--ink2);line-height:1.6;margin-bottom:8px}
.flag-rw-label{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--green);margin-bottom:4px}
.flag-rw{font-size:13px;color:var(--green);background:rgba(45,134,83,.07);border:1px solid var(--green-b);border-radius:6px;padding:6px 10px;line-height:1.6}

/* Score hero */
.score-hero{background:var(--white);border:1px solid var(--border);border-radius:16px;padding:24px 28px;margin-bottom:22px;box-shadow:var(--sh);display:flex;align-items:center;gap:24px;position:relative;overflow:hidden}
.score-hero::after{content:'';position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;background:var(--lime-bg);opacity:.5;pointer-events:none}
.score-num{font-size:68px;font-weight:800;letter-spacing:-4px;line-height:1}
.score-verdict{font-size:15px;font-weight:700;letter-spacing:-0.2px;margin-bottom:8px}
.score-bar-track{height:5px;background:var(--egg-d);border-radius:99px;overflow:hidden;margin-bottom:10px}
.score-bar-fill{height:100%;border-radius:99px;transition:width 1.2s cubic-bezier(.4,0,.2,1)}

/* Audit loader */
.audit-ring{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-top:1px;transition:all .3s}
.audit-ring.done{background:var(--green);border-color:var(--green);color:white}
.audit-ring.active{border-color:var(--purple);border-top-color:transparent;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.step-name{font-size:14px;font-weight:600;color:var(--ink);margin-bottom:2px;transition:color .3s}
.step-name.active{color:var(--purple)}.step-name.done{color:var(--green)}.step-name.waiting{color:var(--ink4);font-weight:500}
.step-detail{font-size:12px;color:var(--ink4)}
.audit-prog{height:4px;background:var(--egg-d);border-radius:99px;margin-top:20px;overflow:hidden}
.audit-prog-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--lime));border-radius:99px;transition:width 1.2s cubic-bezier(.4,0,.2,1)}

/* Spinners */
.spin-wrap{display:flex;align-items:center;gap:12px;color:var(--ink3);font-size:14px;padding:48px 0}
.spinner{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--purple);border-radius:50%;animation:spin .8s linear infinite}
.spinner-sm{width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:white;border-radius:50%;animation:spin .8s linear infinite}

/* Error */
.err{background:var(--red-bg);border:1px solid var(--red-b);border-radius:8px;color:var(--red);font-size:13px;padding:12px 14px;margin-top:8px}

/* Round builder */
.round-row{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--egg);border:1.5px solid var(--border);border-radius:10px}
.round-num{width:24px;height:24px;border-radius:50%;background:var(--egg-d);color:var(--ink3);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.round-row select{flex:1;background:var(--white);border-color:var(--border-l);font-size:13px;padding:6px 10px}
.round-remove{width:26px;height:26px;border-radius:6px;border:none;background:var(--red-bg);color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;transition:all .15s}
.round-remove:hover{background:var(--red);color:white}

/* Question items */
.q-item{background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 15px;font-size:13px;line-height:1.65;display:flex;gap:12px;margin-bottom:8px;transition:border-color .15s,box-shadow .15s}
.q-item:hover{border-color:var(--purple-b);box-shadow:0 2px 8px rgba(92,61,153,.08)}
.q-num{font-size:11px;font-weight:700;color:var(--ink4);flex-shrink:0;padding-top:2px;min-width:22px}
.q-meta{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}

/* Scoring table */
.score-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px}
.score-table th{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);text-align:left;padding:8px 11px;background:var(--egg);border:1px solid var(--border)}
.score-table td{padding:10px 11px;border:1px solid var(--border);vertical-align:top;line-height:1.5;font-size:12px;color:var(--ink2);background:var(--white)}
.score-table tr:nth-child(even) td{background:var(--egg)}
.score-table td:first-child{font-weight:600;color:var(--ink)}

/* Board */
.board-wrap{overflow-x:auto;border-radius:12px;border:1px solid var(--border);box-shadow:var(--sh)}
.board{width:100%;border-collapse:collapse;font-size:13px;background:var(--white)}
.board th{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);padding:10px 13px;background:var(--egg);border-bottom:1px solid var(--border);border-right:1px solid var(--border);text-align:left;white-space:nowrap;position:sticky;top:0;z-index:5}
.board th.sc{text-align:center;min-width:70px}
.board th:first-child{min-width:190px}
.board td{padding:11px 13px;border-bottom:1px solid var(--border-l);border-right:1px solid var(--border-l);vertical-align:middle;color:var(--ink2)}
.board tr:hover td{background:var(--egg)}
.board td.sc{text-align:center}
.b-cand{display:flex;align-items:center;gap:10px}
.b-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0}
.b-name{font-weight:700;font-size:13px;color:var(--ink)}
.b-sub{font-size:11px;color:var(--ink4)}
.sc-chip{display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid}
.sc4{background:var(--green-bg);color:var(--green);border-color:var(--green-b)}
.sc3{background:var(--lime-bg);color:var(--lime-text);border-color:var(--lime-b)}
.sc2{background:var(--amber-bg);color:var(--amber);border-color:var(--amber-b)}
.sc1{background:var(--red-bg);color:var(--red);border-color:var(--red-b)}
.avg-chip{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:24px;font-size:11px;font-weight:800;border-radius:6px;border:1px solid;padding:0 7px}
.rec-tag{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;border:1px solid;white-space:nowrap}
.rec-sc5{background:var(--green-bg);border-color:var(--green);color:var(--green)}
.rec-sc4{background:var(--lime-bg);border-color:var(--lime-b);color:var(--lime-text)}
.rec-sc3{background:var(--egg);border-color:var(--ink3);color:var(--ink2)}
.rec-sc2{background:var(--amber-bg);border-color:var(--amber);color:var(--amber)}
.rec-sc1{background:var(--red-bg);border-color:var(--red);color:var(--red)}
.rec-sh{background:var(--green-bg);color:var(--green);border-color:var(--green-b)}
.rec-hi{background:var(--lime-bg);color:var(--lime-text);border-color:var(--lime-b)}
.rec-nh{background:var(--amber-bg);color:var(--amber);border-color:var(--amber-b)}
.rec-sn{background:var(--red-bg);color:var(--red);border-color:var(--red-b)}
.split-w{font-size:10px;font-weight:700;color:var(--amber);background:var(--amber-bg);border:1px solid var(--amber-b);border-radius:4px;padding:1px 5px}
.sum-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.sum-card{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:14px 18px;box-shadow:var(--sh)}
.sum-val{font-size:30px;font-weight:800;letter-spacing:-1.5px;line-height:1;margin-bottom:3px}
.sum-lbl{font-size:11px;font-weight:600;color:var(--ink4);text-transform:uppercase;letter-spacing:0.5px}

/* Subtabs */
.subtabs{display:flex;gap:4px;margin-bottom:22px;background:var(--egg-d);border-radius:10px;padding:4px}
.subtab{flex:1;font-size:12px;font-weight:600;color:var(--ink3);background:transparent;border:none;padding:8px 10px;border-radius:7px;cursor:pointer;transition:all .15s;text-align:center}
.subtab.on{background:var(--white);color:var(--ink);box-shadow:var(--sh)}
.subtab:hover:not(.on){color:var(--ink)}

/* Score buttons */
.s-btn{width:42px;height:42px;border-radius:8px;border:1.5px solid var(--border);background:var(--egg);cursor:pointer;font-size:15px;font-weight:800;color:var(--ink4);transition:all .15s;display:inline-flex;align-items:center;justify-content:center;margin-right:5px}
.s-btn:hover{border-color:var(--ink);color:var(--ink)}
.s-btn.on-1{background:var(--red-bg);border-color:var(--red);color:var(--red)}
.s-btn.on-2{background:var(--amber-bg);border-color:var(--amber);color:var(--amber)}
.s-btn.on-3{background:var(--lime-bg);border-color:var(--lime-b);color:var(--lime-text)}
.s-btn.on-4{background:var(--green-bg);border-color:var(--green);color:var(--green)}

/* Rec buttons */
.r-btn{font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;font-weight:700;padding:9px 15px;border-radius:8px;border:1.5px solid var(--border);background:var(--egg);cursor:pointer;transition:all .15s;margin-right:8px;margin-bottom:8px;color:var(--ink3)}
.r-btn:hover{border-color:var(--ink3);color:var(--ink);background:var(--egg)}
.r-btn.on-sc5{background:var(--green-bg);border-color:var(--green);color:var(--green)}
.r-btn.on-sc4{background:var(--lime-bg);border-color:var(--lime-b);color:var(--lime-text)}
.r-btn.on-sc3{background:var(--egg);border-color:var(--ink3);color:var(--ink2)}
.r-btn.on-sc2{background:var(--amber-bg);border-color:var(--amber);color:var(--amber)}
.r-btn.on-sc1{background:var(--red-bg);border-color:var(--red);color:var(--red)}

/* Kit rows */
.kit-row{display:flex;align-items:center;gap:14px;padding:15px 18px;background:var(--white);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;cursor:pointer;transition:all .15s;box-shadow:var(--sh)}
.kit-row:hover{border-color:var(--purple-b);box-shadow:0 4px 16px rgba(92,61,153,.1);transform:translateY(-1px)}
.kit-row-name{font-size:14px;font-weight:700;color:var(--ink);flex:1}

/* Pin display */
.pin-box{background:var(--egg);border:1px solid var(--border);border-radius:8px;padding:10px 14px}
.pin-lbl{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--ink4);margin-bottom:3px}
.pin-num{font-size:22px;font-weight:800;letter-spacing:6px;line-height:1}

/* Misc */
.success-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--green-bg);border:1px solid var(--green-b);border-radius:10px;font-size:13px;font-weight:600;color:var(--green);margin-bottom:14px}
.deb-step{border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden}
.deb-hdr{display:flex;align-items:center;gap:12px;padding:13px 15px;background:var(--white);cursor:pointer;transition:background .15s}
.deb-hdr:hover,.deb-hdr.open{background:var(--egg)}
.deb-hdr.open{border-bottom:1px solid var(--border)}
.deb-body{padding:15px;background:var(--egg);font-size:13px;line-height:1.7;color:var(--ink2)}
.note-area{width:100%;min-height:75px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;line-height:1.6;border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;resize:vertical;outline:none;margin-top:8px;background:var(--white);color:var(--ink);transition:border-color .15s}
.note-area:focus{border-color:var(--purple)}
.ifield{margin-bottom:14px}
.ilbl{font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:5px}
.isub{font-size:12px;color:var(--ink4);margin-bottom:5px;line-height:1.5}
.radio-grp{display:flex;flex-wrap:wrap;gap:7px}
.r-opt{font-size:12px;font-weight:600;padding:6px 13px;border:1.5px solid var(--border);border-radius:20px;cursor:pointer;transition:all .15s;background:var(--white);color:var(--ink3)}
.r-opt.on{background:var(--ink);color:var(--white);border-color:var(--ink)}
.r-opt:hover:not(.on){border-color:var(--ink4);color:var(--ink)}
.edi-block{background:var(--green-bg);border:1px solid var(--green-b);border-radius:12px;padding:16px}
.edi-check{display:flex;align-items:flex-start;gap:11px;padding:9px 11px;border-radius:8px;border:1.5px solid;cursor:pointer;transition:all .15s;margin-bottom:6px}
.edi-check:last-child{margin-bottom:0}
.edi-check.unchecked{background:rgba(255,255,255,.5);border-color:var(--green-b)}
.edi-check.checked{background:var(--white);border-color:var(--green)}
.edi-cb{width:17px;height:17px;border-radius:5px;border:2px solid;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.edi-cb.checked{background:var(--green);border-color:var(--green)}
.edi-cb.unchecked{background:transparent;border-color:var(--green-b)}
.rb{font-size:11px;font-weight:700;letter-spacing:0.3px;padding:3px 10px;border-radius:20px;border:1px solid;display:inline-block}
.rb-1{background:var(--lime-bg);color:var(--lime-text);border-color:var(--lime-b)}
.rb-2{background:var(--purple-bg);color:var(--purple);border-color:var(--purple-b)}
.rb-3{background:var(--green-bg);color:var(--green);border-color:var(--green-b)}
.div{border:none;border-top:1px solid var(--border);margin:14px 0}
.check-item{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink3);margin-bottom:8px}
.check-dot{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.cd-lime{background:var(--lime-bg);color:var(--lime-text);border:1px solid var(--lime-b)}
.cd-green{background:var(--green-bg);color:var(--green);border:1px solid var(--green-b)}
.cd-purple{background:var(--purple-bg);color:var(--purple);border:1px solid var(--purple-b)}
.cd-teal{background:var(--teal-bg);color:var(--teal);border:1px solid var(--teal-b)}
.prompter{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--sh)}
.p-eg{display:block;font-size:12px;font-weight:500;color:var(--ink3);padding:7px 11px;border:1px solid var(--border);border-radius:7px;background:var(--egg);margin-bottom:6px;cursor:pointer;transition:all .15s}
.p-eg:hover{border-color:var(--ink3);color:var(--ink);background:var(--white)}
`;

// ── Audit Loader ─────────────────────────────────────────────────
function AuditLoader({ stepIndex, elapsed }) {
  const pct = Math.round(((stepIndex + 1) / AUDIT_STEPS.length) * 100);
  return (
    <div>
      <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.4px", marginBottom:4 }}>Analyzing your JD</div>
      <div style={{ fontSize:13, color:"var(--ink3)", marginBottom:24, lineHeight:1.6 }}>Running a full inclusivity audit — usually 15–30 seconds.</div>
      {AUDIT_STEPS.map((step, i) => {
        const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "waiting";
        return (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:13, padding:"12px 0", borderBottom:"1px solid var(--border-l)" }}>
            <div className={`audit-ring ${state}`}>{state === "done" ? "✓" : ""}</div>
            <div style={{ flex:1 }}>
              <div className={`step-name ${state}`}>{step.label}</div>
              <div className="step-detail">{step.detail}</div>
            </div>
            <div style={{ fontSize:11, fontWeight:600, flexShrink:0, color:state==="done"?"var(--green)":state==="active"?"var(--purple)":"var(--ink4)" }}>
              {state==="done"?"Done":state==="active"?"Running":"—"}
            </div>
          </div>
        );
      })}
      <div className="audit-prog" style={{ marginTop:20 }}>
        <div className="audit-prog-fill" style={{ width:`${pct}%` }} />
      </div>
      <div style={{ fontSize:11, color:"var(--ink4)", marginTop:7, fontWeight:500 }}>{elapsed}s elapsed · {pct}% complete</div>
    </div>
  );
}

// ── Skill Panel ───────────────────────────────────────────────────
// type: "must" | "nice"
function SkillPanel({ type, selectedSkills, setSelectedSkills, roleTitle, jd, mustHasContent }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const isNice = type === "nice";
  // Nice-to-Haves: collapsed until must-haves has content, or user has already added nice-to-haves
  const [collapsed, setCollapsed] = useState(isNice);
  // Auto-expand nice-to-haves once must-haves has content
  useEffect(() => {
    if (isNice && mustHasContent && collapsed && selectedSkills.length === 0) {
      // Stay collapsed — user can open manually. Only auto-open if they already have nice-to-have skills.
    }
  }, [mustHasContent]);

  const isMust = type === "must";
  const label = isMust ? "Must-Haves" : "Nice-to-Haves";
  const color = isMust ? "must" : "nice";
  const chipClass = `skill-chip-locked skill-chip-locked-${color}`;
  const suggestClass = `skill-chip-suggest skill-chip-suggest-${color}`;
  const btnClass = isMust ? "btn-primary" : "btn-teal";
  const countStyle = isMust
    ? { background:"var(--lime-bg)", color:"var(--lime-text)", border:"1px solid var(--lime-b)" }
    : { background:"var(--teal-bg)", color:"var(--teal)", border:"1px solid var(--teal-b)" };
  const borderColor = isMust ? "var(--lime-b)" : "var(--teal-b)";

  const suggest = async () => {
    if (!roleTitle.trim() && !jd.trim()) return;
    setLoading(true);
    try {
      const data = await callAPI(`You are a recruiting expert. For the role "${sanitizeForPrompt(roleTitle, 200)||"(see JD below)"}", generate a list of ${isMust ? "essential must-have" : "nice-to-have preferred but not required"} skills, competencies, and qualifications.

${jd ? `JD context:\n${jd.slice(0,600)}` : ""}

Return ONLY valid JSON: {"skills":["<skill 1>","<skill 2>",...]}

Generate 12-16 specific, actionable ${isMust ? "critical" : "preferred"} skills. ${isMust ? "Focus on non-negotiables the role cannot function without." : "Focus on differentiators that elevate a candidate from good to great."} Short phrases only (2-5 words each). No duplicates.`, 1200);
      // Accumulate: merge new with existing, dedup
      const newSkills = (data.skills || []).filter(s => !suggestions.includes(s));
      setSuggestions(prev => [...prev, ...newSkills]);
      setShowSuggest(true);
    } catch(e) { /* silent */ }
    finally { setLoading(false); }
  };

  const addSkill = (skill) => {
    if (!selectedSkills.includes(skill)) {
      setSelectedSkills(prev => [...prev, skill]);
    }
  };

  const removeSkill = (skill) => {
    setSelectedSkills(prev => prev.filter(s => s !== skill));
  };

  const addAll = () => {
    const toAdd = suggestions.filter(s => !selectedSkills.includes(s));
    setSelectedSkills(prev => [...prev, ...toAdd]);
  };

  const unaddedSuggestions = suggestions.filter(s => !selectedSkills.includes(s));

  return (
    <div className={`skill-panel skill-panel-${color}`}>
      <div className="skill-panel-header" style={{ cursor: isNice ? "pointer" : "default" }} onClick={() => isNice && setCollapsed(c => !c)}>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div className="skill-panel-title" style={{ color: isMust ? "var(--lime-text)" : "var(--teal)" }}>{label}</div>
            {isNice && selectedSkills.length > 0 && (
              <div className="skill-panel-count" style={countStyle}>{selectedSkills.length}</div>
            )}
            {isNice && (
              <span style={{ marginLeft:"auto", fontSize:11, color:"var(--ink4)", fontWeight:600, userSelect:"none" }}>{collapsed ? "▼ Expand" : "▲ Collapse"}</span>
            )}
          </div>
          <div style={{ fontSize:11, color:"var(--ink4)", marginTop:2 }}>{isMust ? "Skills this candidate cannot be without" : "Differentiators that separate good from great"}</div>
        </div>
        {!isNice && selectedSkills.length > 0 && (
          <div className="skill-panel-count" style={countStyle}>{selectedSkills.length} selected</div>
        )}
        {!isNice && (
          <div className="skill-panel-actions" onClick={e => e.stopPropagation()}>
            <button className={`btn ${btnClass} btn-sm`} onClick={suggest} disabled={loading || (!roleTitle.trim() && !jd.trim())}>
              {loading ? <><div className="spinner-sm" />Thinking...</> : suggestions.length > 0 ? "Get More" : "AI Suggest"}
            </button>
          </div>
        )}
      </div>

      {isNice && collapsed ? null : <>
      {isNice && (
        <div className="skill-panel-actions" style={{ marginBottom:10 }} onClick={e => e.stopPropagation()}>
          <button className={`btn ${btnClass} btn-sm`} onClick={suggest} disabled={loading || (!roleTitle.trim() && !jd.trim())}>
            {loading ? <><div className="spinner-sm" />Thinking...</> : suggestions.length > 0 ? "Get More" : "AI Suggest"}
          </button>
        </div>
      )}

      {/* Selected chips — always visible */}
      <div className="skill-bucket">
        {selectedSkills.length === 0
          ? <div className="skill-bucket-empty">{suggestions.length > 0 ? "Click suggested skills below to add them here" : "Click 'AI Suggest' to get skill recommendations, or type and press Enter below"}</div>
          : selectedSkills.map(skill => (
            <div key={skill} className={chipClass}>
              {skill}
              <button className="skill-chip-remove" onClick={() => removeSkill(skill)}>×</button>
            </div>
          ))
        }
      </div>

      {/* Manual add */}
      <ManualSkillInput onAdd={addSkill} isMust={isMust} />

      {/* Suggestions area */}
      {suggestions.length > 0 && (
        <div className="skill-suggest-area" style={{ borderTopColor: borderColor }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div className="skill-suggest-label">AI Suggestions — click to add</div>
            {unaddedSuggestions.length > 0 && (
              <button className="btn btn-ghost btn-xs" onClick={addAll}>Add all ({unaddedSuggestions.length})</button>
            )}
          </div>
          <div>
            {suggestions.map(skill => {
              const added = selectedSkills.includes(skill);
              return (
                <div
                  key={skill}
                  className={`${suggestClass}${added ? " skill-chip-added" : ""}`}
                  onClick={() => !added && addSkill(skill)}
                >
                  {added ? "✓" : "+"} {skill}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

function ManualSkillInput({ onAdd, isMust }) {
  const [val, setVal] = useState("");
  const handle = (e) => {
    if (e.key === "Enter" && val.trim()) {
      onAdd(val.trim());
      setVal("");
    }
  };
  return (
    <div style={{ display:"flex", gap:7, marginTop:8 }}>
      <input
        type="text"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handle}
        placeholder={`Type a ${isMust ? "must-have" : "nice-to-have"} skill and press Enter...`}
        style={{ flex:1, fontSize:12, padding:"7px 12px", background:"var(--white)" }}
      />
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => { if(val.trim()){ onAdd(val.trim()); setVal(""); } }}
        disabled={!val.trim()}
      >Add</button>
    </div>
  );
}

// ── Boolean String Panel ──────────────────────────────────────────
function BooleanPanel({ value, onChange }) {
  const [expanded, setExpanded] = useState(false);

  // Parse boolean string into display tokens
  const parseBoolean = (str) => {
    if (!str.trim()) return [];
    const tokens = [];
    // Split on spaces but keep quoted strings together
    const parts = str.match(/"[^"]+"|'[^']+'|AND|OR|NOT|\(|\)|\w+[-\w]*/g) || [];
    parts.forEach((part, i) => {
      if (["AND","OR","NOT"].includes(part.toUpperCase())) {
        tokens.push({ type:"op", val:part.toUpperCase() });
      } else if (["(",")"].includes(part)) {
        tokens.push({ type:"paren", val:part });
      } else {
        tokens.push({ type:"term", val:part.replace(/^["']|["']$/g,"") });
      }
    });
    return tokens;
  };

  const tokens = parseBoolean(value);
  const termCount = tokens.filter(t => t.type === "term").length;

  return (
    <div className="bool-panel">
      <div className="bool-header" style={{ cursor:"pointer" }} onClick={() => setExpanded(e => !e)}>
        <div className="bool-title">Boolean String</div>
        <div className="bool-badge">Sourcing / ATS Search</div>
        {termCount > 0 && <span style={{ fontSize:11, color:"var(--ink4)", marginLeft:4 }}>{termCount} terms</span>}
        <span style={{ marginLeft:"auto", fontSize:12, color:"var(--ink4)", fontWeight:600 }}>{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </div>
      {expanded && (
        <>
          <div style={{ fontSize:12, color:"var(--purple)", opacity:.75, lineHeight:1.6, marginBottom:12 }}>
            Paste an existing boolean search string for this role. Terms will be parsed and displayed as chips below — and passed to question generation for deeper alignment.
          </div>
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={`e.g. ("product manager" OR "PM") AND ("SaaS" OR "B2B") AND ("agile" OR "scrum") NOT "entry level"`}
            className="bool-textarea"
            style={{ minHeight:80, marginBottom:12 }}
          />
          {tokens.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:8 }}>Parsed Terms</div>
              <div className="bool-parsed">
                {tokens.map((t, i) => (
                  t.type === "op"
                    ? <span key={i} className="bool-op">{t.val}</span>
                    : t.type === "paren"
                    ? <span key={i} style={{ color:"var(--ink4)", fontWeight:700, fontFamily:"monospace", fontSize:13 }}>{t.val}</span>
                    : <span key={i} className="bool-term">{t.val}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── PageHeader ────────────────────────────────────────────────────
// Shared header band: logo left, title+desc center, optional actions right
function PageHeader({ title, desc, accentColor = "#00804C", actions }) {
  return (
    <div className="page-hdr">
      <div className="page-hdr-logo">
        <div className="page-hdr-gem" style={{ background: accentColor === "#1A1814" ? "#C8D832" : accentColor === "#00804C" ? "#C8D832" : accentColor, opacity: accentColor === "#C8D832" ? 1 : .15, position:"absolute" }} />
        <div className="page-hdr-gem" style={{ background: "#C8D832", position:"relative" }}>
          <div className="page-hdr-gem-inner" style={{ background:"#1A1814" }} />
        </div>
        <div>
          <div className="page-hdr-wordmark">JD Audit</div>
          <div className="page-hdr-platform">EDI Platform</div>
        </div>
      </div>
      <div style={{ width:1, height:32, background:"var(--border-l)", flexShrink:0 }} />
      <div className="page-hdr-text">
        <div className="page-hdr-title" style={{ color: accentColor !== "#C8D832" ? accentColor : "var(--ink)" }}>{title}</div>
        <div className="page-hdr-desc">{desc}</div>
      </div>
      {actions && <div className="page-hdr-actions">{actions}</div>}
    </div>
  );
}
// ── JD DIFF HELPERS ──────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildOriginalJD(jd, flags) {
  let text = escHtml(jd || '');
  (flags || []).forEach(f => {
    if (!f.original || f.original === 'Not present') return;
    const escaped = escHtml(f.original);
    // Wrap flagged phrases with strikethrough highlight
    text = text.split(escaped).join(
      '<span class="orig-phrase">' + escaped + '</span>'
    );
  });
  return text.replace(/\n/g, '<br>');
}

function buildRevisedJD(jd, flags) {
  let text = escHtml(jd || '');
  (flags || []).forEach(f => {
    if (!f.original || f.original === 'Not present' || !f.rewrite) return;
    const escaped = escHtml(f.original);
    const rewriteEscaped = escHtml(f.rewrite);
    text = text.split(escaped).join(
      '<span class="revised-phrase">' + rewriteEscaped + '</span>'
    );
  });
  // For missing signals (no original phrase), append rewrite as a note
  const missing = (flags || []).filter(f => f.original === 'Not present' && f.rewrite);
  if (missing.length > 0) {
    text += '<br><br>' + missing.map(f =>
      '<span class="revised-phrase">+ ' + escHtml(f.rewrite) + '</span>'
    ).join('<br>');
  }
  return text.replace(/\n/g, '<br>');
}

// ── AUDIT RECEIPT EXPORT ────────────────────────────────────────
function exportReceipt(result, jd, reviewerName, reviewerRole) {
  const ts = new Date();
  const dateStr = ts.toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const timeStr = ts.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" });
  const receiptId = `JDA-${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,"0")}${String(ts.getDate()).padStart(2,"0")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const scoreColor = result.score >= 75 ? "#2D8653" : result.score >= 50 ? "#00804C" : "#C0392B";
  const flagRows = (result.flags || []).map((f, i) => `
    <div class="flag flag-${f.type}">
      <div class="flag-type">${f.type === "bias" ? "⚠ Biased Language" : f.type === "missing" ? "○ Missing Signal" : "↑ Inflated Requirement"}</div>
      ${f.original && f.original !== "Not present" ? `<div class="flag-orig">"${f.original}"</div>` : ""}
      <div class="flag-issue">${f.issue}</div>
      <div class="flag-rw-label">Suggested rewrite</div>
      <div class="flag-rw">${f.rewrite}</div>
    </div>`).join("");

  const __doctype = '<' + '!DOCTYPE html>';
  const __receiptHtml = __doctype + `<html><head><title>J/D Audit Receipt — ${receiptId}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',sans-serif;color:#1A1814;background:#fff;padding:0;font-size:13px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:760px;margin:0 auto;padding:48px 56px}

/* Header */
.receipt-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:36px;padding-bottom:28px;border-bottom:2px solid #1A1814}
.brand{display:flex;align-items:center;gap:12px}
.gem{width:36px;height:36px;background:#C8D832;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.gem-inner{width:15px;height:15px;background:#1A1814;border-radius:3px;transform:rotate(45deg)}
.brand-text .name{font-size:16px;font-weight:800;letter-spacing:-0.3px}
.brand-text .sub{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#00804C;margin-top:1px}
.receipt-meta{text-align:right}
.receipt-id{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:#1A1814;letter-spacing:0.5px;margin-bottom:3px}
.receipt-ts{font-size:11px;color:#6B6760}
.receipt-title{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9C9890;margin-bottom:2px}

/* Score section */
.score-section{background:#F2F3F5;border-radius:12px;padding:24px 28px;margin-bottom:28px;display:flex;align-items:center;gap:32px}
.score-num{font-size:72px;font-weight:800;letter-spacing:-4px;line-height:1;color:${scoreColor}}
.score-detail{flex:1}
.score-verdict{font-size:18px;font-weight:800;color:${scoreColor};letter-spacing:-0.3px;margin-bottom:8px}
.score-bar-bg{height:6px;background:#D5D8DC;border-radius:99px;overflow:hidden;margin-bottom:12px}
.score-bar-fill{height:100%;border-radius:99px;background:${scoreColor};width:${result.score}%}
.flag-counts{display:flex;gap:8px;flex-wrap:wrap}
.fcount{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px}
.fcount-bias{background:#FCECEA;color:#C0392B;border:1px solid #E8B5B0}
.fcount-missing{background:#E6F5EF;color:#00804C;border:1px solid #80C2A6}
.fcount-inflated{background:#E6F4ED;color:#2D8653;border:1px solid #A8D5BC}

/* Summary */
.section-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9C9890;margin-bottom:10px;margin-top:24px}
.summary-text{font-size:13px;color:#3D3A35;line-height:1.8;padding:14px 18px;background:#F8F9FA;border-left:3px solid #C8D832;border-radius:0 8px 8px 0}

/* Flags */
.flag{border-radius:8px;padding:14px 16px;margin-bottom:10px;border:1px solid}
.flag-bias{background:#FEF9F9;border-color:#E8B5B0}
.flag-missing{background:#F4FCF8;border-color:#80C2A6}
.flag-inflated{background:#F2FAF5;border-color:#A8D5BC}
.flag-type{font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px}
.flag-bias .flag-type{color:#C0392B}
.flag-missing .flag-type{color:#00804C}
.flag-inflated .flag-type{color:#2D8653}
.flag-orig{font-size:12px;font-style:italic;color:#C0392B;background:rgba(192,57,43,.06);border:1px solid rgba(192,57,43,.15);border-radius:5px;padding:4px 10px;margin-bottom:6px;display:inline-block}
.flag-issue{font-size:12px;color:#3D3A35;line-height:1.6;margin-bottom:8px}
.flag-rw-label{font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#2D8653;margin-bottom:4px}
.flag-rw{font-size:12px;color:#2D8653;background:rgba(45,134,83,.06);border:1px solid rgba(45,134,83,.15);border-radius:5px;padding:5px 10px;line-height:1.6}

/* Reviewer sign-off */
.signoff{margin-top:36px;padding-top:28px;border-top:1.5px solid #D5D8DC;display:grid;grid-template-columns:1fr 1fr;gap:20px}
.signoff-field{border-bottom:1.5px solid #1A1814;padding-bottom:4px;min-height:36px}
.signoff-label{font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9C9890;margin-top:6px}
.signoff-value{font-size:13px;font-weight:600;color:#1A1814;padding-top:6px}
.signoff-blank{color:#D5D8DC}

/* Compliance footer */
.compliance{margin-top:28px;padding:16px 20px;background:#F2F3F5;border-radius:8px;font-size:11px;color:#6B6760;line-height:1.7}
.compliance strong{color:#1A1814;font-weight:700}

/* JD snippet */
.jd-full{background:#F8F9FA;border:1px solid #E8EAED;border-radius:8px;padding:18px 20px;font-size:12px;color:#3D3A35;line-height:1.9;white-space:pre-wrap;word-break:break-word;font-family:'Plus Jakarta Sans',sans-serif}
.jd-revised{background:#F4FCF8;border-color:#A8D5BC}
.orig-phrase{background:#FCECEA;color:#C0392B;text-decoration:line-through;border-radius:3px;padding:1px 3px;font-weight:600}
.revised-phrase{background:#E6F4ED;color:#2D8653;border-radius:3px;padding:1px 3px;font-weight:600;border-bottom:2px solid #2D8653}

/* Print */
@media print{
.no-print{display:none}
body{padding:0}
.page{padding:32px 40px}
}
</style></head><body>
<div class="page">

<div class="receipt-header">
  <div class="brand">
    <div class="gem"><div class="gem-inner"></div></div>
    <div class="brand-text"><div class="name">J/D Audit</div><div class="sub">EDI Platform</div></div>
  </div>
  <div class="receipt-meta">
    <div class="receipt-title">Audit Receipt</div>
    <div class="receipt-id">${receiptId}</div>
    <div class="receipt-ts">${dateStr} · ${timeStr}</div>
  </div>
</div>

<div class="score-section">
  <div class="score-num">${result.score}</div>
  <div class="score-detail">
    <div class="score-verdict">${result.verdict}</div>
    <div class="score-bar-bg"><div class="score-bar-fill"></div></div>
    <div class="flag-counts">
      ${(result.flags||[]).filter(f=>f.type==="bias").length > 0 ? `<span class="fcount fcount-bias">⚠ ${(result.flags||[]).filter(f=>f.type==="bias").length} bias flags</span>` : ""}
      ${(result.flags||[]).filter(f=>f.type==="missing").length > 0 ? `<span class="fcount fcount-missing">○ ${(result.flags||[]).filter(f=>f.type==="missing").length} missing signals</span>` : ""}
      ${(result.flags||[]).filter(f=>f.type==="inflated").length > 0 ? `<span class="fcount fcount-inflated">↑ ${(result.flags||[]).filter(f=>f.type==="inflated").length} inflated requirements</span>` : ""}
      ${(result.flags||[]).length === 0 ? `<span class="fcount" style="background:#F3F7D4;color:#6B7A0A;border:1px solid #D8E44A">✓ No flags — clean JD</span>` : ""}
    </div>
  </div>
</div>

<div class="section-label">Assessment</div>
<div class="summary-text">${result.summary}</div>

${(result.flags||[]).length > 0 ? `<div class="section-label" style="margin-top:28px">Flags & Rewrites (${(result.flags||[]).length} total)</div>${flagRows}` : ""}

<div class="section-label" style="margin-top:28px">Original Job Description</div>
<div style="font-size:11px;color:#6B6760;margin-bottom:8px">Flagged phrases are highlighted. Strikethrough = recommended for removal or replacement.</div>
<div class="jd-full">${buildOriginalJD(jd, result.flags)}</div>

<div class="section-label" style="margin-top:28px">Revised Job Description</div>
<div style="font-size:11px;color:#2D8653;margin-bottom:8px">Recommended rewrites applied and highlighted in green. Review before posting.</div>
<div class="jd-full jd-revised">${buildRevisedJD(jd, result.flags)}</div>

<div class="signoff">
  <div>
    <div class="signoff-field">
      ${reviewerName ? `<div class="signoff-value">${reviewerName}</div>` : `<div class="signoff-value signoff-blank">________________________</div>`}
    </div>
    <div class="signoff-label">Reviewed by</div>
  </div>
  <div>
    <div class="signoff-field">
      ${reviewerRole ? `<div class="signoff-value">${reviewerRole}</div>` : `<div class="signoff-value signoff-blank">________________________</div>`}
    </div>
    <div class="signoff-label">Title / Role</div>
  </div>
  <div>
    <div class="signoff-field"><div class="signoff-value signoff-blank">________________________</div></div>
    <div class="signoff-label">Signature</div>
  </div>
  <div>
    <div class="signoff-field"><div class="signoff-value signoff-blank">________________________</div></div>
    <div class="signoff-label">Date approved</div>
  </div>
</div>

<div class="compliance">
  <strong>Compliance note:</strong> This receipt documents that the above job description was reviewed using J/D Audit's AI-assisted inclusivity analysis prior to posting. It records the automated findings and any rewrites suggested. This document does not constitute legal compliance advice and should be reviewed alongside applicable employment law guidance. Retain this record as part of your equitable hiring documentation.
</div>

</div>
</body></html>`;
  const blob = new Blob([__receiptHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'JD_Audit_Receipt_' + receiptId + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// ══════════════════════════════════════════════════════════════════
// AUDIT TAB
// ══════════════════════════════════════════════════════════════════
function AuditTab() {
  const [jd, setJd] = useState(() => { try { return localStorage.getItem("jda_audit_jd") || ""; } catch { return ""; } });
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(() => { try { const s=localStorage.getItem("jda_audit_result"); return s?JSON.parse(s):null; } catch { return null; } });
  const [error, setError] = useState(null);
  const [jdFocused, setJdFocused] = useState(false);
  const [reviewerName, setReviewerName] = useState(() => { try { return localStorage.getItem("jda_audit_reviewer") || ""; } catch { return ""; } });
  const [reviewerRole, setReviewerRole] = useState(() => { try { return localStorage.getItem("jda_audit_reviewer_role") || ""; } catch { return ""; } });
  const [receiptExported, setReceiptExported] = useState(false);
  const timerRef = useRef(null);
  const stepRef = useRef(null);
  const startRef = useRef(null);
  const clear = () => { clearInterval(timerRef.current); clearInterval(stepRef.current); };
  useEffect(() => () => clear(), []);

  // Persist audit state to localStorage
  useEffect(() => { try { localStorage.setItem("jda_audit_jd", jd); } catch {} }, [jd]);
  useEffect(() => { try { if (result) { const s = JSON.stringify(result); if (s.length < 102400) localStorage.setItem("jda_audit_result", s); } else localStorage.removeItem("jda_audit_result"); } catch {} }, [result]);
  useEffect(() => { try { localStorage.setItem("jda_audit_reviewer", reviewerName); } catch {} }, [reviewerName]);
  useEffect(() => { try { localStorage.setItem("jda_audit_reviewer_role", reviewerRole); } catch {} }, [reviewerRole]);

  const clearAudit = () => {
    setJd(""); setResult(null); setError(null); setReviewerName(""); setReviewerRole(""); setReceiptExported(false);
    try { ["jda_audit_jd","jda_audit_result","jda_audit_reviewer","jda_audit_reviewer_role"].forEach(k => localStorage.removeItem(k)); } catch {}
  };

  const handleExportReceipt = () => { exportReceipt(result, jd, reviewerName, reviewerRole); setReceiptExported(true); };

  const run = async () => {
    if (!jd.trim()) return;
    setLoading(true); setResult(null); setError(null); setStepIndex(0); setElapsed(0); setReceiptExported(false);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-startRef.current)/1000)), 1000);
    let s = 0;
    stepRef.current = setInterval(() => { s++; if (s < AUDIT_STEPS.length-1) setStepIndex(s); else clearInterval(stepRef.current); }, 4200);
    try {
      const data = await callAPI(`You are an expert in inclusive hiring. Audit this JD for:
- BIAS: gender-coded words, age signals, ableist language, culture-fit dog whistles
- MISSING: no salary range, no accommodation statement, no remote/flexibility info, no EEO
- INFLATED: unnecessary degree requirements, excessive years of experience, gatekeeping credentials

Return ONLY valid JSON, no markdown:
{"score":<0-100>,"verdict":"Needs Work|Developing|Inclusive","summary":"2-3 sentences","flags":[{"type":"bias|missing|inflated","original":"exact phrase or Not present","issue":"explanation","rewrite":"improved version"}]}

JD:\n${sanitizeForPrompt(jd)}`, 4000);
      setStepIndex(AUDIT_STEPS.length - 1);
      await new Promise(r => setTimeout(r, 500));
      setResult(data);
    } catch(e) { setError(e.message); }
    finally { clear(); setLoading(false); }
  };

  const score = result?.score ?? 0;
  const scoreColor = score >= 75 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--red)";
  const ct = t => result?.flags?.filter(f => f.type === t).length || 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <PageHeader
        title="JD Audit"
        desc="Paste any job description to get an inclusivity score, bias flags, and line-by-line rewrites."
        accentColor="#00804C"
        actions={<div style={{display:"flex",gap:8}}><button className="btn btn-ghost btn-sm" onClick={() => setJd(SAMPLE_JD)} disabled={loading}>Load sample JD</button><button className="btn btn-ghost btn-sm" onClick={clearAudit} disabled={loading} style={{color:"var(--red)",borderColor:"var(--red-b)"}}>Clear</button></div>}
      />
      <div className="split" style={{ flex:1 }}>
        <div className="panel-l">
          <div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
              <div className="ilbl" style={{ marginBottom:0 }}>Job Description</div>
              {jd.length > 0 && (
                <span style={{
                  fontSize:11, fontWeight:600,
                  color: jd.length < 200 ? "var(--amber)" : jd.length < 500 ? "var(--lime-text)" : "var(--green)",
                  transition:"color .3s"
                }}>
                  {jd.length < 200 ? "Add more for better results" : jd.length < 500 ? "Good — more detail helps" : "✓ Ready to audit"} · {jd.length.toLocaleString()} chars
                </span>
              )}
            </div>
            <textarea
              value={jd}
              onChange={e => setJd(e.target.value)}
              onFocus={() => setJdFocused(true)}
              onBlur={() => setJdFocused(false)}
              placeholder="Paste your job description to audit for biased language, missing inclusive signals, and inflated requirements..."
              style={{ minHeight:260, borderColor: jdFocused ? "var(--amber)" : jd.length > 200 ? "var(--green-b)" : undefined, transition:"border-color .2s" }}
            />
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            <button
              className="btn btn-amber"
              onClick={run}
              disabled={loading||!jd.trim()}
              style={{
                transition:"all .2s",
                transform: jd.length > 200 && !loading ? "none" : "none",
                boxShadow: jd.length > 200 && !loading ? "0 0 0 3px rgba(0,128,76,.15)" : "none",
              }}
            >{loading?"Auditing...":"Run Audit →"}</button>
            {jd.length > 0 && jd.length < 150 && !loading && (
              <span style={{ fontSize:12, color:"var(--amber)", fontWeight:600 }}>Paste the full JD for best results</span>
            )}
          </div>
          {error && <div className="err">{error}</div>}
        </div>
        <div className="panel-r" style={{ background:"var(--white)", borderLeft:"1px solid var(--border)" }}>
          {!result && !loading && (
            <div style={{ padding:"40px 0 24px" }}>
              <div style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.6px", marginBottom:8, maxWidth:320, lineHeight:1.2, color:"var(--ink)" }}>Write JDs that invite everyone in.</div>
              <div style={{ fontSize:14, color:"var(--ink3)", lineHeight:1.7, maxWidth:320, marginBottom:24 }}>Get an inclusivity score, line-by-line flags, and inclusive rewrites in seconds.</div>
              <div>
                {[["#C0392B","#FCECEA","#E8B5B0","Biased & exclusionary language"],["#00804C","#E6F5EF","#80C2A6","Missing salary, flexibility & accommodation"],["#5C3D99","#EDE8F7","#C4B3E8","Inflated or unnecessary requirements"]].map(([col,bg,border,t]) => (
                  <div key={t} style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:"var(--ink2)", marginBottom:8 }}>
                    <div style={{ width:20, height:20, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, flexShrink:0, background:bg, border:`1px solid ${border}`, color:col }}>✓</div>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}
          {loading && (
            <div style={{ background:"var(--egg)", border:"1px solid var(--border)", borderRadius:16, padding:"24px 28px" }}>
              {/* Dark-mode AuditLoader */}
              <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.4px", marginBottom:4, color:"var(--ink)" }}>Analyzing your JD</div>
              <div style={{ fontSize:13, color:"var(--ink3)", marginBottom:24, lineHeight:1.6 }}>Running a full inclusivity audit — usually 15–30 seconds.</div>
              {AUDIT_STEPS.map((step, i) => {
                const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "waiting";
                return (
                  <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:13, padding:"12px 0", borderBottom:"1px solid rgba(255,255,255,.06)" }}>
                    <div style={{
                      width:22, height:22, borderRadius:"50%", border:"2px solid", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, marginTop:1,
                      background: state==="done" ? "#2D8653" : "transparent",
                      borderColor: state==="done" ? "#2D8653" : state==="active" ? "#9B78E8" : "var(--border)",
                      color: state==="done" ? "white" : "transparent",
                      animation: state==="active" ? "spin .7s linear infinite" : "none",
                      borderTopColor: state==="active" ? "transparent" : undefined,
                    }}>{state==="done" ? "✓" : ""}</div>
                    <div style={{ flex:1 }}>
                      <div style={{
                        fontSize:14, fontWeight:600, marginBottom:2,
                        color: state==="done" ? "var(--green)" : state==="active" ? "var(--purple)" : "var(--ink4)"
                      }}>{step.label}</div>
                      <div style={{ fontSize:12, color:"var(--ink4)" }}>{step.detail}</div>
                    </div>
                    <div style={{ fontSize:11, fontWeight:600, flexShrink:0, color:state==="done"?"var(--green)":state==="active"?"var(--purple)":"var(--ink4)" }}>
                      {state==="done"?"Done":state==="active"?"Running":"—"}
                    </div>
                  </div>
                );
              })}
              <div style={{ height:4, background:"var(--egg-dd)", borderRadius:99, marginTop:20, overflow:"hidden" }}>
                <div style={{ height:"100%", background:"linear-gradient(90deg,#9B78E8,#C8D832)", borderRadius:99, transition:"width 1.2s cubic-bezier(.4,0,.2,1)", width:`${Math.round(((stepIndex + 1) / AUDIT_STEPS.length) * 100)}%` }} />
              </div>
              <div style={{ fontSize:11, color:"var(--ink4)", marginTop:7, fontWeight:500 }}>{elapsed}s elapsed</div>
            </div>
          )}
          {result && !loading && (
            <>
              {/* Score hero — dark */}
              <div style={{ background:"var(--white)", border:`2px solid ${scoreColor}22`, borderRadius:16, padding:"24px 28px", marginBottom:22, position:"relative", overflow:"hidden", boxShadow:"var(--sh-md)" }}>
                <div style={{ position:"absolute", top:-40, right:-40, width:160, height:160, borderRadius:"50%", background: score >= 75 ? "rgba(45,134,83,.08)" : score >= 50 ? "rgba(0,128,76,.06)" : "rgba(192,57,43,.06)", pointerEvents:"none" }} />
                <div style={{ display:"flex", alignItems:"center", gap:24, position:"relative", zIndex:1 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:6 }}>Inclusivity Score</div>
                    <div style={{ fontSize:68, fontWeight:800, letterSpacing:"-4px", lineHeight:1, color:scoreColor }}>{result.score}</div>
                  </div>
                  <div style={{ flex:1, zIndex:1 }}>
                    <div style={{ fontSize:15, fontWeight:700, letterSpacing:"-0.2px", marginBottom:8, color:scoreColor }}>{result.verdict}</div>
                    <div style={{ height:5, background:"var(--egg-dd)", borderRadius:99, overflow:"hidden", marginBottom:10 }}>
                      <div style={{ height:"100%", borderRadius:99, transition:"width 1.2s cubic-bezier(.4,0,.2,1)", width:`${score}%`, background:scoreColor }} />
                    </div>
                    <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                      {ct("bias")>0 && <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"rgba(192,57,43,.2)", border:"1px solid rgba(192,57,43,.4)", color:"#E87B6E" }}>⚠ {ct("bias")} bias</span>}
                      {ct("missing")>0 && <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"rgba(0,128,76,.15)", border:"1px solid rgba(0,128,76,.3)", color:"#80C2A6" }}>○ {ct("missing")} missing</span>}
                      {ct("inflated")>0 && <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"rgba(45,134,83,.15)", border:"1px solid rgba(45,134,83,.3)", color:"#4DB87A" }}>↑ {ct("inflated")} inflated</span>}
                      {result.flags?.length===0 && <span style={{ fontSize:11, fontWeight:700, padding:"3px 10px", borderRadius:20, background:"rgba(200,216,50,.15)", border:"1px solid rgba(200,216,50,.3)", color:"#C8D832" }}>✓ Clean</span>}
                    </div>
                  </div>
                </div>
              </div>
              {/* Assessment */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"var(--ink4)", whiteSpace:"nowrap" }}>Assessment</span>
                <div style={{ flex:1, height:1, background:"var(--border-l)" }} />
              </div>
              <p style={{ fontSize:13, lineHeight:1.8, color:"var(--ink2)", marginBottom:22 }}>{result.summary}</p>
              {result.flags?.length > 0 && (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <span style={{ fontSize:10, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"var(--ink4)", whiteSpace:"nowrap" }}>Flags & Rewrites</span>
                    <div style={{ flex:1, height:1, background:"var(--border-l)" }} />
                  </div>
                  {result.flags.map((f, i) => {
                    const isBias = f.type==="bias";
                    const isMissing = f.type==="missing";
                    const flagAccent = isBias ? "#C0392B" : isMissing ? "#00804C" : "#2D8653";
                    const flagBg = isBias ? "#FEF9F9" : isMissing ? "#F4FCF8" : "#F2FAF5";
                    const flagBorder = isBias ? "#E8B5B0" : isMissing ? "#80C2A6" : "#A8D5BC";
                    const flagOrigColor = isBias ? "#C0392B" : isMissing ? "#00804C" : "#2D8653";
                    return (
                    <div key={i} style={{
                      borderRadius:10, marginBottom:12, overflow:"hidden",
                      border:`1.5px solid ${flagBorder}`,
                      boxShadow:`0 2px 8px ${isBias?"rgba(192,57,43,.08)":isMissing?"rgba(0,128,76,.06)":"rgba(45,134,83,.06)"}`,
                    }}>
                      {/* Flag type header bar */}
                      <div style={{ background:flagBg, padding:"8px 14px", display:"flex", alignItems:"center", gap:8, borderBottom:`1px solid ${flagBorder}` }}>
                        <div style={{ width:6, height:6, borderRadius:"50%", background:flagAccent, flexShrink:0 }} />
                        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:flagAccent }}>
                          {isBias?"⚠ Biased Language":isMissing?"○ Missing Signal":"↑ Inflated Requirement"}
                        </div>
                      </div>
                      {/* Flag body */}
                      <div style={{ padding:"12px 14px", background:"var(--white)" }}>
                        {f.original && f.original!=="Not present" && (
                          <div style={{ fontSize:12, fontStyle:"italic", color:flagOrigColor, background:flagBg, border:`1px solid ${flagBorder}`, borderRadius:6, padding:"5px 10px", marginBottom:8 }}>"{f.original}"</div>
                        )}
                        <div style={{ fontSize:13, color:"var(--ink2)", lineHeight:1.6, marginBottom:10 }}>{f.issue}</div>
                        <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"#2D8653", marginBottom:5 }}>Suggested rewrite</div>
                        <div style={{ fontSize:13, color:"#2D8653", background:"#F2FAF5", border:"1px solid #A8D5BC", borderRadius:6, padding:"8px 12px", lineHeight:1.6 }}>{f.rewrite}</div>
                      </div>
                    </div>
                    );
                  })}
                </>
              )}

              {/* ── RECEIPT ── */}
              <div style={{ marginTop:28, paddingTop:20, borderTop:"1px solid var(--border-l)" }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:14 }}>Generate Audit Receipt</div>
                <div style={{ fontSize:12, color:"var(--ink3)", lineHeight:1.6, marginBottom:16 }}>
                  A timestamped PDF documenting this audit — score, flags, rewrites, and a sign-off field. Retain for EEOC and equity compliance records.
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"var(--ink2)", marginBottom:5 }}>Reviewed by <span style={{ fontWeight:400, opacity:.6 }}>(optional)</span></div>
                    <input
                      type="text"
                      value={reviewerName}
                      onChange={e => setReviewerName(e.target.value)}
                      placeholder="e.g. Jordan Rivera"
                      style={{ width:"100%", fontSize:12, padding:"8px 12px", background:"var(--egg)", border:"1px solid var(--border)", borderRadius:7, color:"var(--ink)", fontFamily:"'Plus Jakarta Sans',sans-serif", outline:"none" }}
                      onFocus={e => e.target.style.borderColor="var(--amber)"}
                      onBlur={e => e.target.style.borderColor="var(--border)"}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:"var(--ink2)", marginBottom:5 }}>Title / Role <span style={{ fontWeight:400, opacity:.6 }}>(optional)</span></div>
                    <input
                      type="text"
                      value={reviewerRole}
                      onChange={e => setReviewerRole(e.target.value)}
                      placeholder="e.g. Recruiting Coordinator"
                      style={{ width:"100%", fontSize:12, padding:"8px 12px", background:"var(--egg)", border:"1px solid var(--border)", borderRadius:7, color:"var(--ink)", fontFamily:"'Plus Jakarta Sans',sans-serif", outline:"none" }}
                      onFocus={e => e.target.style.borderColor="var(--amber)"}
                      onBlur={e => e.target.style.borderColor="var(--border)"}
                    />
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <button
                    onClick={handleExportReceipt}
                    style={{
                      fontFamily:"'Plus Jakarta Sans',sans-serif",
                      fontSize:13, fontWeight:700,
                      background:"#C8D832", color:"#1A1814",
                      border:"none", borderRadius:8,
                      padding:"10px 22px", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:8,
                      transition:"all .15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background="#B8C82A"; e.currentTarget.style.transform="scale(1.02)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background="#C8D832"; e.currentTarget.style.transform=""; }}
                  >
                    ↓ Download Receipt
                  </button>
                  {receiptExported && (
                    <span style={{ fontSize:12, fontWeight:600, color:"var(--green)" }}>✓ Receipt generated</span>
                  )}
                </div>
                <div style={{ fontSize:11, color:"var(--ink4)", marginTop:10, lineHeight:1.6 }}>
                  Opens as a print dialog — save as PDF from your browser. Receipt ID is auto-generated for tracking.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── INTERVIEW KIT EXPORT ─────────────────────────────────────────
function exportInterviewKit(kit, submitPIN, viewPIN, intake, scorecards) {
  if (!kit) return;
  const ts = new Date();
  const dateStr = ts.toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const kitId = "KIT-" + ts.getFullYear() + String(ts.getMonth()+1).padStart(2,"0") + String(ts.getDate()).padStart(2,"0") + "-" + Math.random().toString(36).slice(2,6).toUpperCase();

  const roundsHtml = (kit.rounds || []).map(round => {
    const qs = (round.questions || []).map((q, i) =>
      '<div class="q-item">' +
      '<div class="q-num">' + String(i+1).padStart(2,"0") + '</div>' +
      '<div class="q-body">' +
      '<div class="q-text">' + (q.question||"").replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</div>' +
      '<div class="q-meta">' +
      '<span class="tag">' + (q.type||"") + '</span>' +
      '<span class="tag">' + (q.competency||"") + '</span>' +
      (q.type === "cultural_competency" ? '<span class="edi-tag">EDI</span>' : "") +
      '</div>' +
      '</div></div>'
    ).join("");
    return '<div class="round-block">' +
      '<div class="round-hdr">' +
      '<span class="round-badge">Round ' + round.round + '</span>' +
      '<span class="round-title">' + (round.title||"") + '</span>' +
      '</div>' +
      '<div class="round-meta">Led by: <strong>' + (round.led_by||"") + '</strong> &nbsp;·&nbsp; ' + (round.purpose||"") + '</div>' +
      qs +
      '</div>';
  }).join("");

  const dnaHtml = (kit.do_not_ask || []).map(q =>
    '<div class="dna-item"><span class="dna-icon">⊘</span><span>' + q.replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</span></div>'
  ).join("");

  const debriefHtml = (kit.debrief_agenda || []).map((s, i) =>
    '<div class="debrief-item">' +
    '<div class="debrief-step">Step ' + (i+1) + ' <span class="debrief-dur">' + (s.duration||"") + '</span></div>' +
    '<div class="debrief-title">' + (s.step||"") + '</div>' +
    '<div class="debrief-body">' + (s.instructions||"").replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</div>' +
    '</div>'
  ).join("");

  const fairnessHtml = (kit.fairness_notes || []).map(n =>
    '<div class="fairness-item">· ' + n.replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</div>'
  ).join("");

  // Pre-build conditional HTML sections
  const pinSectionHtml = submitPIN ? (
    '<div class="pin-section">' +
    '<div class="pin-section-title">Kit PINs — Coordinator Reference</div>' +
    '<div class="pin-row"><span class="pin-label">Submit PIN</span><div class="pin-val pin-submit">' + submitPIN + '</div></div>' +
    '<div class="pin-row"><span class="pin-label">View PIN</span><div class="pin-val pin-view">' + (viewPIN||"") + '</div></div>' +
    '<p class="pin-note">Share the Submit PIN with each interviewer. Keep the View PIN private — it unlocks the score board after all scorecards are submitted.</p>' +
    (intake && intake.interviewerCount ? (
      '<div class="interviewer-list">' +
      Array.from({length: intake.interviewerCount||3}, function(_,i) {
        return '<div class="interviewer-row"><div class="iv-num">'+(i+1)+'</div><span class="iv-name">Interviewer '+(i+1)+'</span><span class="iv-pin">'+submitPIN+'</span></div>';
      }).join("") +
      '</div>'
    ) : "") +
    '</div>'
  ) : "";

  const e = function(s){ return (s||"").split("<").join("&lt;").split(">").join("&gt;").split("\n").join("<br>"); };
  const intakeSectionHtml = intake ? (
    '<div class="intake-section">' +
    '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9C9890;margin-bottom:4px">Intake Data</div>' +
    '<div style="font-size:11px;color:#6B6760;margin-bottom:12px">Original inputs when building this kit.</div>' +
    '<div class="intake-grid">' +
      '<div class="intake-field"><span class="intake-label">Role Title</span><span class="intake-val">' + (intake.roleTitle||"—") + '</span></div>' +
      '<div class="intake-field"><span class="intake-label">Urgency</span><span class="intake-val">' + (intake.urgency||"—") + '</span></div>' +
      '<div class="intake-field"><span class="intake-label">Deal Breakers</span><span class="intake-val">' + (e(intake.dealBreakers)||"—") + '</span></div>' +
      '<div class="intake-field"><span class="intake-label">Success in 90 Days</span><span class="intake-val">' + (e(intake.successIn90)||"—") + '</span></div>' +
    '</div>' +
    (intake.mustHaves&&intake.mustHaves.length ? '<div class="intake-full"><span class="intake-label">Must-Haves</span><div style="margin-top:5px">' + intake.mustHaves.map(function(s){return '<span class="skill-chip">'+s+'</span>';}).join("") + '</div></div>' : "") +
    (intake.niceToHaves&&intake.niceToHaves.length ? '<div class="intake-full" style="margin-top:8px"><span class="intake-label">Nice-to-Haves</span><div style="margin-top:5px">' + intake.niceToHaves.map(function(s){return '<span class="skill-chip skill-chip-nice">'+s+'</span>';}).join("") + '</div></div>' : "") +
    (intake.companyAbout ? '<div class="intake-full" style="margin-top:8px"><span class="intake-label">Company Context</span><div class="intake-val" style="margin-top:3px">' + e(intake.companyAbout) + '</div></div>' : "") +
    (intake.ediChecks&&intake.ediChecks.length ? '<div class="intake-full" style="margin-top:8px"><span class="intake-label">EDI Dimensions</span><div style="margin-top:5px">' + intake.ediChecks.map(function(s){return '<span class="skill-chip" style="background:#E6F4ED;color:#2D8653;border-color:#A8D5BC">'+s+'</span>';}).join("") + '</div></div>' : "") +
    '</div>'
  ) : "";

  // Build scorecards section
  const RECS_LABELS = { sc5:"Strong Candidate", sc4:"Lean Candidate", sc3:"Neutral", sc2:"Lean Weak", sc1:"Weak Candidate" };
  const scorecardsHtml = (scorecards && scorecards.length > 0) ? (function() {
    const comps = (kit.scoring_rubric || []).map(function(r){ return r.competency; });
    const kA = function(card){ var v=Object.values(card.scores||{}).filter(Boolean); return v.length?(v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(1):null; };
    const cA = function(c){ var v=scorecards.map(function(x){return x.scores&&x.scores[c];}).filter(Boolean); return v.length?(v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(1):null; };
    const chipClass = function(n){ return n>=4.5?"sc-chip-5":n>=3.5?"sc-chip-4":n>=2.5?"sc-chip-3":n>=1.5?"sc-chip-2":"sc-chip-1"; };
    const ov = (function(){ var v=scorecards.flatMap(function(c){return Object.values(c.scores||{});}).filter(Boolean); return v.length?(v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(1):null; })();

    var compHeaders = comps.map(function(c){ return "<th>"+c+"</th>"; }).join("");
    var rows = scorecards.map(function(card) {
      var avg = kA(card);
      var avgClass = avg ? chipClass(Number(avg)) : "";
      var compCells = comps.map(function(comp) {
        var s = card.scores && card.scores[comp];
        var others = scorecards.map(function(x){ return x.scores&&x.scores[comp]; }).filter(Boolean);
        var split = others.length > 1 && (Math.max.apply(null,others)-Math.min.apply(null,others)) >= 2;
        return "<td class='sc'>" + (s ? "<span class='sc-chip "+chipClass(s)+"'>"+s+"</span>"+(split?"<span class='sc-split'>split</span>":"") : "<span style='color:#D5D8DC'>—</span>") + "</td>";
      }).join("");
      var notesCells = comps.map(function(comp) {
        var n = card.notes && card.notes[comp];
        return "<td>"+(n?"<div class='sc-notes'>"+n.replace(/</g,"&lt;")+"</div>":"<span style='color:#D5D8DC'>—</span>")+"</td>";
      }).join("");
      var recLabel = RECS_LABELS[card.recommendation] || card.recommendation || "—";
      var recClass = "sc-rec sc-rec-"+(card.recommendation||"sc3");
      return "<tr>" +
        "<td><div class='sc-interviewer'>"+card.interviewer+"</div><div class='sc-date'>"+new Date(card.submittedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})+"</div></td>" +
        compCells +
        "<td class='sc'>"+(avg?"<span class='sc-avg "+chipClass(Number(avg))+"' style='color:inherit'>"+avg+"</span>":"—")+"</td>" +
        "<td><span class='"+recClass+"'>"+recLabel+"</span></td>" +
        "</tr>";
    }).join("");

    var avgCells = comps.map(function(c){ var a=cA(c); return "<td class='sc'>"+(a?"<span class='sc-chip "+chipClass(Number(a))+"' style='font-weight:800'>"+a+"</span>":"—")+"</td>"; }).join("");
    var ovClass = ov ? chipClass(Number(ov)) : "";

    return "<div class='section-label page-break'>Submitted Scorecards ("+scorecards.length+" of "+((intake&&intake.interviewerCount)||"?")+")</div>" +
      "<p style='font-size:12px;color:#6B6760;margin-bottom:14px'>Scores submitted independently before debrief. Split decisions (2+ point spread) are flagged.</p>" +
      "<div class='sc-table-wrap'><table class='sc-table'>" +
      "<thead><tr><th>Interviewer</th>"+compHeaders+"<th>Avg</th><th>Recommendation</th></tr></thead>" +
      "<tbody>" + rows +
      "<tr class='team-avg-row'><td>Team Average</td>"+avgCells+"<td>"+(ov?"<span style='font-size:14px;font-weight:900'>"+ov+"</span>":"—")+"</td><td></td></tr>" +
      "</tbody></table></div>";
  })() : "";

  const __d = '<' + '!DOCTYPE html>';
  const html = __d + `<html><head><meta charset="UTF-8"><title>${kit.role || "Interview Kit"} — J/D Audit</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Plus Jakarta Sans',sans-serif;color:#1A1814;background:#fff;padding:0;font-size:13px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:780px;margin:0 auto;padding:48px 56px}
.kit-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:36px;padding-bottom:28px;border-bottom:2px solid #1A1814}
.brand{display:flex;align-items:center;gap:12px}
.gem{width:34px;height:34px;background:#C8D832;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.gem-i{width:14px;height:14px;background:#1A1814;border-radius:3px;transform:rotate(45deg)}
.brand-name{font-size:15px;font-weight:800;letter-spacing:-0.3px}
.brand-sub{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#00804C;margin-top:1px}
.kit-meta{text-align:right}
.kit-id{font-size:11px;font-weight:600;color:#6B6760;letter-spacing:0.3px;margin-bottom:3px}
.kit-date{font-size:11px;color:#9C9890}
.kit-role{font-size:28px;font-weight:800;letter-spacing:-1px;color:#1A1814;margin-bottom:10px;line-height:1.1}
.competencies{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:36px}
.comp-tag{font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:#F3F7D4;color:#6B7A0A;border:1px solid #D8E44A}
.section-label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9C9890;margin-bottom:14px;margin-top:32px;padding-bottom:8px;border-bottom:1px solid #EAECEF}
.round-block{margin-bottom:32px}
.round-hdr{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.round-badge{font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:#EDE8F7;color:#5C3D99;border:1px solid #C4B3E8}
.round-title{font-size:15px;font-weight:800;color:#1A1814;letter-spacing:-0.2px}
.round-meta{font-size:12px;color:#6B6760;margin-bottom:14px}
.q-item{display:flex;gap:12px;padding:11px 14px;background:#F8F9FA;border:1px solid #EAECEF;border-radius:8px;margin-bottom:8px}
.q-num{font-size:11px;font-weight:700;color:#9C9890;min-width:22px;padding-top:1px;flex-shrink:0}
.q-body{flex:1}
.q-text{font-size:13px;color:#1A1814;line-height:1.65;margin-bottom:6px}
.q-meta{display:flex;gap:6px;flex-wrap:wrap}
.tag{font-size:10px;font-weight:600;padding:2px 8px;border-radius:5px;background:#F2F3F5;border:1px solid #D5D8DC;color:#3D3A35}
.edi-tag{font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:#E6F4ED;border:1px solid #A8D5BC;color:#2D8653}
.dna-item{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:#FCECEA;border:1px solid #E8B5B0;border-radius:8px;margin-bottom:8px;font-size:13px;color:#1A1814}
.dna-icon{font-size:14px;color:#C0392B;font-weight:700;flex-shrink:0;margin-top:1px}
.debrief-item{padding:14px 16px;background:#F8F9FA;border:1px solid #EAECEF;border-radius:8px;margin-bottom:8px}
.debrief-step{font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9C9890;margin-bottom:3px}
.debrief-dur{font-size:9px;font-weight:600;padding:1px 7px;border-radius:20px;background:#F2F3F5;border:1px solid #D5D8DC;color:#6B6760;margin-left:7px;text-transform:none;letter-spacing:0}
.debrief-title{font-size:13px;font-weight:700;color:#1A1814;margin-bottom:5px}
.debrief-body{font-size:12px;color:#3D3A35;line-height:1.7}
.fairness-item{font-size:12px;color:#5C3D99;padding:6px 0;border-bottom:1px solid #F0EEF9}
.fairness-item:last-child{border-bottom:none}
.page-break{page-break-before:always;margin-top:40px}
.pin-section{background:#1A1814;border-radius:10px;padding:28px 32px;margin-bottom:32px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pin-section-title{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9C9890;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.1)}
.pin-row{display:flex;align-items:center;gap:20px;margin-bottom:16px}
.pin-label{font-size:12px;font-weight:700;color:rgba(255,255,255,.6);width:140px;flex-shrink:0}
.pin-val{font-family:'Courier New',monospace;font-size:36px;font-weight:900;letter-spacing:14px;padding:14px 24px;border-radius:8px;flex:1;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pin-submit{background:#3D2B6B;border:2px solid #7C5CBF;color:#E8D5FF}
.pin-view{background:#1A3D2B;border:2px solid #2D8653;color:#7BEBA0}
.pin-note{font-size:11px;color:rgba(255,255,255,.45);margin-top:16px;line-height:1.7;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)}
.interviewer-list{display:flex;flex-direction:column;gap:6px;margin-top:16px}
.interviewer-row{display:flex;align-items:center;gap:14px;padding:8px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:7px}
.iv-num{width:24px;height:24px;border-radius:50%;background:#3D2B6B;border:1px solid #7C5CBF;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#E8D5FF;flex-shrink:0}
.iv-name{font-size:12px;color:rgba(255,255,255,.4);flex:1}
.iv-pin{font-family:'Courier New',monospace;font-size:16px;font-weight:700;letter-spacing:5px;color:#E8D5FF;background:#3D2B6B;padding:4px 12px;border-radius:6px}
.intake-section{border:1px solid #E8EAED;border-radius:10px;padding:20px 22px;margin-bottom:24px;background:#FAFAFA}
.intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.intake-field{display:flex;flex-direction:column;gap:3px}
.intake-label{font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9C9890}
.intake-val{font-size:12px;color:#3D3A35;line-height:1.6}
.intake-full{margin-top:12px}
.skill-chip{display:inline-block;font-size:10px;font-weight:600;padding:2px 9px;border-radius:20px;margin:2px;background:#F3F7D4;color:#6B7A0A;border:1px solid #D8E44A}
.skill-chip-nice{background:#E0F2FE;color:#0E7490;border-color:#7DD3FC}
.sc-section{margin-top:8px}
.sc-table-wrap{overflow-x:auto;margin-top:12px}
.sc-table{width:100%;border-collapse:collapse;font-size:11px}
.sc-table th{background:#F2F3F5;padding:7px 10px;text-align:left;font-size:9px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#6B6760;border-bottom:2px solid #D5D8DC;white-space:nowrap}
.sc-table td{padding:8px 10px;border-bottom:1px solid #EAECEF;vertical-align:top;color:#1A1814;font-size:12px}
.sc-table tr:last-child td{border-bottom:none}
.sc-table tr:nth-child(even) td{background:#FAFAFA}
.sc-interviewer{font-weight:700;font-size:12px;color:#1A1814}
.sc-date{font-size:10px;color:#9C9890;margin-top:2px}
.sc-chip{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px;border:1px solid}
.sc-chip-5{background:#E6F4ED;color:#2D8653;border-color:#A8D5BC}
.sc-chip-4{background:#F3F7D4;color:#6B7A0A;border-color:#D8E44A}
.sc-chip-3{background:#F2F3F5;color:#3D3A35;border-color:#C5C8CC}
.sc-chip-2{background:#FFF3E0;color:#B45309;border-color:#FCD34D}
.sc-chip-1{background:#FCECEA;color:#C0392B;border-color:#E8B5B0}
.sc-avg{font-weight:800;font-size:13px}
.sc-rec{display:inline-block;font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid}
.sc-rec-sc5{background:#E6F4ED;color:#2D8653;border-color:#A8D5BC}
.sc-rec-sc4{background:#F3F7D4;color:#6B7A0A;border-color:#D8E44A}
.sc-rec-sc3{background:#F2F3F5;color:#3D3A35;border-color:#C5C8CC}
.sc-rec-sc2{background:#FFF3E0;color:#B45309;border-color:#FCD34D}
.sc-rec-sc1{background:#FCECEA;color:#C0392B;border-color:#E8B5B0}
.sc-notes{font-size:11px;color:#6B6760;line-height:1.5;margin-top:3px;font-style:italic}
.sc-split{display:inline-block;background:#FFF3E0;color:#B45309;border:1px solid #FCD34D;border-radius:4px;font-size:9px;font-weight:700;padding:1px 5px;margin-left:4px}
.team-avg-row td{background:#1A1814!important;color:white;font-weight:700}
@media print{body{padding:0}.page{padding:32px 40px}}
</style></head><body>
<div class="page">
<div class="kit-header">
  <div class="brand">
    <div class="gem"><div class="gem-i"></div></div>
    <div><div class="brand-name">J/D Audit</div><div class="brand-sub">EDI Platform</div></div>
  </div>
  <div class="kit-meta">
    <div class="kit-id">${kitId}</div>
    <div class="kit-date">${dateStr}</div>
  </div>
</div>
<div class="kit-role">${kit.role || "Interview Kit"}</div>
<div class="competencies">${(kit.competencies||[]).map(c=>'<span class="comp-tag">'+c+'</span>').join("")}</div>


${pinSectionHtml}
${intakeSectionHtml}

<div class="section-label">Interview Questions by Round</div>
${roundsHtml}
${(kit.do_not_ask||[]).length > 0 ? '<div class="section-label page-break">Do Not Ask</div><p style="font-size:12px;color:#6B6760;margin-bottom:12px">Share with all interviewers before the process begins.</p>' + dnaHtml : ""}
${(kit.debrief_agenda||[]).length > 0 ? '<div class="section-label">Debrief Agenda</div><p style="font-size:12px;color:#6B6760;margin-bottom:12px">Run after all interviewers score independently.</p>' + debriefHtml : ""}
${(kit.fairness_notes||[]).length > 0 ? '<div class="section-label">Fairness Notes</div>' + fairnessHtml : ""}
${scorecardsHtml}
</div></body></html>`

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (kit.role || "interview_kit").replace(/[^a-z0-9]/gi,"_").toLowerCase() + "_" + kitId + ".html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  // Also export intake JSON if available
  if (kit.intake) {
    const intakeData = { ...kit.intake, exportedAt: new Date().toISOString(), version: "1.0" };
    const jBlob = new Blob([JSON.stringify(intakeData, null, 2)], { type: "application/json" });
    const jUrl = URL.createObjectURL(jBlob);
    const b = document.createElement("a");
    b.href = jUrl;
    b.download = (kit.role || "intake").replace(/[^a-z0-9]/gi,"_").toLowerCase() + "_" + kitId + "_intake.json";
    document.body.appendChild(b); b.click(); document.body.removeChild(b);
    setTimeout(() => URL.revokeObjectURL(jUrl), 1000);
  }
}

// ══════════════════════════════════════════════════════════════════
// GENERATE QUESTIONS TAB
// ══════════════════════════════════════════════════════════════════
function GenerateTab({ onKitSaved }) {
  const { addKit, cards } = useApp();
  const [step, setStep] = useState("intake");

  // Load from localStorage or default
  const loadLS = (key, fallback) => { try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } };

  const [roleTitle, setRoleTitle] = useState(() => loadLS("jda_gen_roleTitle", ""));
  const [jd, setJd] = useState(() => loadLS("jda_gen_jd", ""));
  const [urgency, setUrgency] = useState(() => loadLS("jda_gen_urgency", ""));
  const [rounds, setRounds] = useState(() => loadLS("jda_gen_rounds", [
    { id:genId(), type:"Recruiter Screen" },
    { id:genId(), type:"Behavioral Interview" },
    { id:genId(), type:"Skills Demo" },
  ]));
  const [mustHaves, setMustHaves] = useState(() => loadLS("jda_gen_mustHaves", []));
  const [niceToHaves, setNiceToHaves] = useState(() => loadLS("jda_gen_niceToHaves", []));
  const [booleanString, setBooleanString] = useState(() => loadLS("jda_gen_booleanString", ""));
  const [dealBreakers, setDealBreakers] = useState(() => loadLS("jda_gen_dealBreakers", ""));
  const [successIn90, setSuccessIn90] = useState(() => loadLS("jda_gen_successIn90", ""));
  const [companyAbout, setCompanyAbout] = useState(() => loadLS("jda_gen_companyAbout", ""));
  const [ediChecks, setEdiChecks] = useState(() => loadLS("jda_gen_ediChecks", []));

  // Persist all intake fields
  useEffect(() => { try { localStorage.setItem("jda_gen_roleTitle", JSON.stringify(roleTitle)); } catch {} }, [roleTitle]);
  useEffect(() => { try { localStorage.setItem("jda_gen_jd", JSON.stringify(jd)); } catch {} }, [jd]);
  useEffect(() => { try { localStorage.setItem("jda_gen_urgency", JSON.stringify(urgency)); } catch {} }, [urgency]);
  useEffect(() => { try { localStorage.setItem("jda_gen_rounds", JSON.stringify(rounds)); } catch {} }, [rounds]);
  useEffect(() => { try { localStorage.setItem("jda_gen_mustHaves", JSON.stringify(mustHaves)); } catch {} }, [mustHaves]);
  useEffect(() => { try { localStorage.setItem("jda_gen_niceToHaves", JSON.stringify(niceToHaves)); } catch {} }, [niceToHaves]);
  useEffect(() => { try { localStorage.setItem("jda_gen_booleanString", JSON.stringify(booleanString)); } catch {} }, [booleanString]);
  useEffect(() => { try { localStorage.setItem("jda_gen_dealBreakers", JSON.stringify(dealBreakers)); } catch {} }, [dealBreakers]);
  useEffect(() => { try { localStorage.setItem("jda_gen_successIn90", JSON.stringify(successIn90)); } catch {} }, [successIn90]);
  useEffect(() => { try { localStorage.setItem("jda_gen_companyAbout", JSON.stringify(companyAbout)); } catch {} }, [companyAbout]);
  useEffect(() => { try { localStorage.setItem("jda_gen_ediChecks", JSON.stringify(ediChecks)); } catch {} }, [ediChecks]);

  const GEN_LS_KEYS = ["jda_gen_roleTitle","jda_gen_jd","jda_gen_urgency","jda_gen_rounds","jda_gen_mustHaves","jda_gen_niceToHaves","jda_gen_booleanString","jda_gen_dealBreakers","jda_gen_successIn90","jda_gen_companyAbout","jda_gen_ediChecks"];

  const clearGenerate = () => {
    setRoleTitle(""); setJd(""); setUrgency("");
    setRounds([{id:genId(),type:"Recruiter Screen"},{id:genId(),type:"Behavioral Interview"},{id:genId(),type:"Skills Demo"}]);
    setMustHaves([]); setNiceToHaves([]); setBooleanString("");
    setDealBreakers(""); setSuccessIn90(""); setCompanyAbout(""); setEdiChecks([]);
    setResult(null); setError(null); setStep("intake");
    try { GEN_LS_KEYS.forEach(k => localStorage.removeItem(k)); } catch {}
  };

  const exportIntakeData = () => {
    const data = { roleTitle, jd, urgency, rounds, mustHaves, niceToHaves, booleanString, dealBreakers, successIn90, companyAbout, ediChecks, exportedAt: new Date().toISOString(), version: "1.0" };
    // JSON download
    const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const a = document.createElement("a");
    a.href = jsonUrl;
    a.download = (roleTitle || "intake").replace(/\s+/g,"_").toLowerCase() + "_intake.json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(jsonUrl), 1000);
    // Text summary download
    const lines = [
      "J/D AUDIT — INTAKE DATA EXPORT",
      "================================",
      "Exported: " + new Date().toLocaleString(),
      "",
      "ROLE TITLE",
      roleTitle || "(not set)",
      "",
      "MUST-HAVE SKILLS",
      mustHaves.length ? mustHaves.join(", ") : "(none)",
      "",
      "NICE-TO-HAVE SKILLS",
      niceToHaves.length ? niceToHaves.join(", ") : "(none)",
      "",
      "INTERVIEW ROUNDS",
      rounds.map((r,i) => "  Round " + (i+1) + ": " + r.type).join("\n"),
      "",
      "BOOLEAN STRING",
      booleanString || "(not set)",
      "",
      "COMPANY CONTEXT",
      companyAbout || "(not set)",
      "",
      "DEAL BREAKERS",
      dealBreakers || "(not set)",
      "",
      "SUCCESS IN 90 DAYS",
      successIn90 || "(not set)",
      "",
      "URGENCY",
      urgency || "(not set)",
      "",
      "EDI DIMENSIONS",
      ediChecks.length ? ediChecks.join(", ") : "(none selected)",
      "",
      "JOB DESCRIPTION",
      jd || "(not provided)",
    ];
    const txtBlob = new Blob([lines.join("\n")], { type: "text/plain" });
    const txtUrl = URL.createObjectURL(txtBlob);
    const b = document.createElement("a");
    b.href = txtUrl;
    b.download = (roleTitle || "intake").replace(/\s+/g,"_").toLowerCase() + "_intake_summary.txt";
    document.body.appendChild(b); b.click(); document.body.removeChild(b);
    setTimeout(() => URL.revokeObjectURL(txtUrl), 1000);
  };

  const importIntakeRef = useRef(null);
  const importIntakeData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // File size guard — reject anything over 500KB
        if (ev.target.result.length > 512000) {
          alert("Import file is too large. Max 500KB.");
          return;
        }
        const data = JSON.parse(ev.target.result);
        // Type-validate every field before setting state
        const str = (v, max) => typeof v === "string" ? v.slice(0, max) : undefined;
        const arr = (v, itemValidator) => Array.isArray(v) ? v.slice(0, 50).filter(itemValidator) : undefined;
        const rt = str(data.roleTitle, 200);       if (rt !== undefined) setRoleTitle(rt);
        const jdV = str(data.jd, 20000);          if (jdV !== undefined) setJd(jdV);
        const urg = str(data.urgency, 100);        if (urg !== undefined) setUrgency(urg);
        const rds = arr(data.rounds, r => r && typeof r.type === "string");
        if (rds) setRounds(rds.map(r => ({ id: genId(), type: r.type.slice(0, 80) })));
        const mh = arr(data.mustHaves, s => typeof s === "string");
        if (mh) setMustHaves(mh.map(s => s.slice(0, 100)));
        const nh = arr(data.niceToHaves, s => typeof s === "string");
        if (nh) setNiceToHaves(nh.map(s => s.slice(0, 100)));
        const bs = str(data.booleanString, 2000);  if (bs !== undefined) setBooleanString(bs);
        const db = str(data.dealBreakers, 1000);   if (db !== undefined) setDealBreakers(db);
        const s90 = str(data.successIn90, 1000);   if (s90 !== undefined) setSuccessIn90(s90);
        const ca = str(data.companyAbout, 2000);   if (ca !== undefined) setCompanyAbout(ca);
        const edi = arr(data.ediChecks, s => typeof s === "string");
        if (edi) setEdiChecks(edi.map(s => s.slice(0, 80)));
        setStep("intake");
      } catch { alert("Could not parse intake file. Make sure it\'s a valid J/D Audit JSON export."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("questions");
  const [saveName, setSaveName] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedKitId, setSavedKitId] = useState(null);
  const [pt, setPt] = useState("");
  const [pLoading, setPLoading] = useState(false);
  const [pResult, setPResult] = useState(null);
  const [pError, setPError] = useState(null);
  const [pAdded, setPAdded] = useState([]);

  // PINs generated at kit generation time
  const [submitPIN, setSubmitPIN] = useState("");
  const [viewPIN, setViewPIN] = useState("");
  const [interviewerCount, setInterviewerCount] = useState(3);
  const [copied, setCopied] = useState("");

  const copyToClipboard = (text, label) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    });
  };

  const toggleEdi = key => setEdiChecks(p => p.includes(key) ? p.filter(k=>k!==key) : [...p,key]);
  const addRound = () => setRounds(p => [...p, { id:genId(), type:"Behavioral Interview" }]);
  const removeRound = id => setRounds(p => p.filter(r => r.id!==id));
  const updateRound = (id, type) => setRounds(p => p.map(r => r.id===id ? {...r,type} : r));

  const getRoundLead = (type) => {
    if (type.includes("Recruiter")) return "Recruiting Coordinator";
    if (type.includes("Hiring Manager")) return "Hiring Manager";
    if (type.includes("Executive")) return "Executive";
    if (type.includes("Panel")) return "Panel";
    if (type.includes("Technical")) return "Technical Lead";
    return "Hiring Team";
  };
  const getRoundQType = (type) => {
    if (type.includes("Technical")||type.includes("Skills")) return "technical|scenario";
    if (type.includes("Behavioral")) return "behavioral|cultural_competency";
    if (type.includes("Culture")||type.includes("Values")) return "values|cultural_competency";
    if (type.includes("Case")||type.includes("Presentation")) return "presentation|scenario";
    return "values|logistics|motivation|cultural_competency";
  };

  const generate = async () => {
    if (!jd.trim() && !roleTitle.trim()) return;
    setLoading(true); setResult(null); setError(null);
    const roundsPrompt = rounds.map((r,i) => `{"round":${i+1},"title":"${r.type}","led_by":"${getRoundLead(r.type)}","purpose":"<1 sentence>","questions":[{"question":"<text>","type":"${getRoundQType(r.type)}","competency":"<n>"}]}`).join(",");
    const ediSel = ediChecks.map(k=>EDI_ITEMS.find(e=>e.key===k)).filter(Boolean);
    const edi = ediSel.length>0?`\n\nEDI DIMENSIONS (1-2 dedicated questions each, type "cultural_competency"):\n${ediSel.map(e=>e.label+" — "+e.sub).join("\n")}`:"";
    const boolTerms = booleanString.trim() ? `\nBoolean string context: ${booleanString}` : "";

    try {
      const data = await callAPI(`Expert recruiter. Generate complete interview kit. ONLY valid JSON:
{"role":"${roleTitle||"<infer from JD>"}","competencies":["<3-5>"],"rounds":[${roundsPrompt}],"scoring_rubric":[{"competency":"<n>","weight":"<High|Medium>","ats_field_key":"<snake_case>","score_1":"<weak candidate>","score_2":"<lean weak>","score_3":"<neutral>","score_4":"<lean strong>","score_5":"<strong candidate>"}],"fairness_notes":["<2-3>"],"do_not_ask":["<5-7>"],"debrief_agenda":[{"step":"<title>","duration":"<e.g. 5 min>","instructions":"<notes>"}]}

Generate 4-5 questions per round tailored to that round type. Behavioral = STAR format. Technical = domain-specific.

CONTEXT:
Role: ${roleTitle||"(see JD)"}
Must-Haves: ${mustHaves.length>0?mustHaves.join(", "):"Not specified"}
Nice-to-Haves: ${niceToHaves.length>0?niceToHaves.join(", "):"Not specified"}
Deal Breakers: ${dealBreakers||"Not specified"}
Success in 90 Days: ${successIn90||"Not specified"}
Urgency: ${urgency||"Not specified"}
Interview Rounds: ${rounds.map((r,i)=>`Round ${i+1}: ${r.type}`).join("; ")}
Company: ${companyAbout||"Not specified"}${boolTerms}${edi}

JD:\n${jd||"(Use role title and must-haves above)"}`, 5500);
      const sPin = genPIN(); const vPin = genPIN();
      setSubmitPIN(sPin); setViewPIN(vPin);
      setResult(data); setSaveName(data.role||""); setStep("result"); setView("questions");
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const saveKit = () => {
    if (!saveName.trim()) return;
    const newKitId = genId();
    setSavedKitId(newKitId);
    addKit({ id:newKitId, name:saveName.trim(), candidate:candidateName.trim(), role:result.role, createdAt:new Date().toISOString(), submitPIN:submitPIN||genPIN(), viewPIN:viewPIN||genPIN(), ...result,
      intake: { roleTitle, jd, urgency, rounds, mustHaves, niceToHaves, booleanString, dealBreakers, successIn90, companyAbout, ediChecks }
    });
    setSaved(true); if (onKitSaved) onKitSaved();
  };

  const runPrompter = async () => {
    if (!pt.trim()) return;
    setPLoading(true); setPResult(null); setPError(null);
    try {
      const data = await callAPI(`Expert inclusive hiring specialist. Request: "${sanitizeForPrompt(pt, 1000)}"${result?` for role "${result.role}". Competencies: ${(result.competencies||[]).join(", ")}`:""}. EDI: job-related behaviors only, no illegal questions.\n\nONLY valid JSON:\n{"dei_flag":null,"questions":[{"question":"<text>","type":"<behavioral|situational|values|technical|motivation>","competency":"<n>","round_suggestion":"<Round 1|Round 2|Round 3>","dei_note":"<or null>"}],"rationale":"<1-2 sentences>"}\n\nGenerate 2-4 questions.`, 2000);
      setPResult(data);
    } catch(e) { setPError(e.message); }
    finally { setPLoading(false); }
  };

  const addToKit = q => {
    const idx = parseInt((q.round_suggestion||"Round 2").match(/\d+/)?.[0]||"2")-1;
    setResult(p => ({ ...p, rounds:p.rounds.map((r,i) => i===idx ? {...r, questions:[...(r.questions||[]), {question:q.question,type:q.type,competency:q.competency}]} : r) }));
    setPAdded(p => [...p, q.question]);
  };

  const Prompter = () => (
    <div className="prompter">
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <span style={{ fontSize:12, fontWeight:700, color:"var(--ink2)" }}>Question Prompter</span>
        <span className="pill pill-green" style={{ fontSize:10 }}>EDI-Reviewed</span>
      </div>
      <p style={{ fontSize:12, color:"var(--ink4)", lineHeight:1.6, marginBottom:10 }}>Request additional questions. All outputs reviewed against EDI principles.</p>
      <div style={{ marginBottom:10 }}>
        {["Add 2 conflict resolution questions","Generate a cross-functional collaboration question","Write a scenario about managing ambiguity"].map(eg => (
          <div key={eg} className="p-eg" onClick={() => setPt(eg)}>↳ {eg}</div>
        ))}
      </div>
      <textarea value={pt} onChange={e => setPt(e.target.value)} placeholder="Describe what you need..." style={{ minHeight:75, marginBottom:10 }} />
      <button className="btn btn-purple" onClick={runPrompter} disabled={pLoading||!pt.trim()}>{pLoading?"Generating...":"Generate →"}</button>
      {pError && <div className="err" style={{ marginTop:10 }}>{pError}</div>}
      {pLoading && <div className="spin-wrap" style={{ padding:"14px 0" }}><div className="spinner" />Building questions...</div>}
      {pResult && (
        <div style={{ marginTop:16 }}>
          {pResult.dei_flag && <div className="flag flag-bias" style={{ marginBottom:12 }}><div className="flag-label fl-bias">⚠ Bias in Request</div><div className="flag-body">{pResult.dei_flag}</div></div>}
          {pResult.rationale && <p style={{ fontSize:12, color:"var(--ink4)", lineHeight:1.6, marginBottom:10, fontStyle:"italic" }}>{pResult.rationale}</p>}
          <div className="section-label">Generated</div>
          {pResult.questions?.map((q,i) => (
            <div key={i} style={{ background:"var(--egg)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", marginBottom:8 }}>
              <div style={{ fontSize:13, lineHeight:1.65, color:"var(--ink2)", marginBottom:7 }}>{q.question}</div>
              <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap", justifyContent:"space-between" }}>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <span className="tag">{q.type}</span>
                  <span className="tag">{q.competency}</span>
                  <span className="tag">{q.round_suggestion}</span>
                  {q.dei_note && <span className="pill pill-green" style={{ fontSize:10 }}>✓ {q.dei_note}</span>}
                </div>
                {result ? (pAdded.includes(q.question) ? <span style={{ fontSize:11, fontWeight:700, color:"var(--green)" }}>✓ Added</span> : <button className="btn btn-green btn-sm" onClick={() => addToKit(q)}>+ Add</button>) : <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(q.question)}>Copy</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (loading) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#1A1814" }}>
      <PageHeader title="Generating Kit" desc={`Building structured interview kit for ${roleTitle || "this role"}...`} accentColor="#5C3D99" />
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"40px 64px" }}>
        <div style={{ maxWidth:560, width:"100%" }}>
          {/* Spinner + heading */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:32 }}>
            <div style={{ width:40, height:40, borderRadius:"50%", border:"3px solid rgba(92,61,153,.3)", borderTopColor:"#9B78E8", animation:"spin .8s linear infinite", flexShrink:0 }} />
            <div>
              <div style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.5px", color:"white", marginBottom:3 }}>Building your interview kit</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,.4)" }}>Calibrating questions to your role, skills, and rounds...</div>
            </div>
          </div>
          {/* What's being built */}
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:32 }}>
            {[
              { label:"Interview questions", detail:`${rounds.length} round${rounds.length!==1?"s":""} · 4–5 questions each`, color:"#9B78E8", done:false },
              { label:"Scoring rubric", detail:`${mustHaves.length + niceToHaves.length} competencies mapped`, color:"#C8D832", done:false },
              { label:"Do Not Ask list", detail:"Legal & EDI compliance review", color:"#4DB87A", done:false },
              { label:"Debrief agenda", detail:"7-step facilitation guide", color:"#80C2A6", done:false },
              ...(ediChecks.length > 0 ? [{ label:"EDI questions", detail:`${ediChecks.length} cultural competency dimension${ediChecks.length!==1?"s":""}`, color:"#F5A623", done:false }] : []),
            ].map((item, i) => (
              <div key={item.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", borderRadius:10 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:item.color, flexShrink:0, boxShadow:`0 0 8px ${item.color}88` }} />
                <div style={{ flex:1 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"white" }}>{item.label}</span>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,.35)", marginLeft:8 }}>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Role context */}
          {roleTitle && (
            <div style={{ borderTop:"1px solid rgba(255,255,255,.08)", paddingTop:20, display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"rgba(255,255,255,.25)" }}>Role</div>
              <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,.6)" }}>{roleTitle}</div>
              {mustHaves.length > 0 && <div style={{ fontSize:11, color:"rgba(255,255,255,.3)" }}>· {mustHaves.length} must-have{mustHaves.length!==1?"s":""}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (step === "intake") return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <PageHeader
        title="Generate Questions"
        desc="Build a structured, EDI-reviewed interview kit — tailored to the role and your interview process."
        accentColor="#5C3D99"
        actions={
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input ref={importIntakeRef} type="file" accept=".json" style={{display:"none"}} onChange={importIntakeData} />
            <button className="btn btn-ghost btn-sm" onClick={() => importIntakeRef.current?.click()}>↑ Import</button>
            <button className="btn btn-ghost btn-sm" onClick={exportIntakeData} disabled={!roleTitle && !mustHaves.length}>↓ Export</button>
            <button className="btn btn-ghost btn-sm" onClick={clearGenerate} style={{color:"var(--red)",borderColor:"var(--red-b)"}}>Clear</button>
          </div>
        }
      />
      <div className="split" style={{ flex:1 }}>
        {/* ── LEFT PANEL ── */}
        <div className="panel-l" style={{ gap:0, paddingBottom:80 }}>

          {/* Section 1: Role */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--border-l)" }}>Role Setup</div>
            <div className="ifield" style={{ marginBottom:12 }}>
              <div className="ilbl">Role Title</div>
              <div className="isub">Used to generate AI skill suggestions below.</div>
              <input type="text" value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="e.g. Senior Product Manager, Data Engineer, Recruiting Coordinator..." />
            </div>
            <SkillPanel type="must" selectedSkills={mustHaves} setSelectedSkills={setMustHaves} roleTitle={roleTitle} jd={jd} />
            <div style={{ marginTop:10 }}>
              <SkillPanel type="nice" selectedSkills={niceToHaves} setSelectedSkills={setNiceToHaves} roleTitle={roleTitle} jd={jd} mustHasContent={mustHaves.length > 0 || roleTitle.trim().length > 0} />
            </div>
            <div style={{ marginTop:10 }}>
              <BooleanPanel value={booleanString} onChange={setBooleanString} />
            </div>
          </div>

          {/* Section 2: JD + Rounds */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--border-l)" }}>Job Description & Rounds</div>
            <div className="ifield">
              <div className="ilbl">Job Description <span style={{ fontWeight:400, color:"var(--ink4)" }}>(optional)</span></div>
              <div className="isub">More context = more precise questions. Safe to skip if role title + skills are filled.</div>
              <textarea value={jd} onChange={e => setJd(e.target.value)} placeholder="Paste the job description..." style={{ minHeight:100 }} />
            </div>
            <div className="ifield" style={{ marginBottom:0 }}>
              <div className="ilbl" style={{ marginBottom:8 }}>Interview Rounds</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {rounds.map((round, i) => (
                  <div key={round.id} className="round-row">
                    <div className="round-num">{i+1}</div>
                    <select value={round.type} onChange={e => updateRound(round.id, e.target.value)} style={{ flex:1 }}>
                      {ROUND_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {rounds.length > 1 && <button className="round-remove" onClick={() => removeRound(round.id)}>×</button>}
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={addRound} style={{ marginTop:8 }}>+ Add Round</button>
            </div>
          </div>

          {/* Section 3: Context */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--border-l)" }}>Additional Context</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div className="ifield" style={{ marginBottom:0 }}>
                <div className="ilbl">About the Company</div>
                <textarea value={companyAbout} onChange={e => setCompanyAbout(e.target.value)} placeholder="Mission, values, stage..." style={{ minHeight:60 }} />
              </div>
              <div className="ifield" style={{ marginBottom:0 }}>
                <div className="ilbl">Deal Breakers</div>
                <textarea value={dealBreakers} onChange={e => setDealBreakers(e.target.value)} placeholder="What rules someone out?" style={{ minHeight:60 }} />
              </div>
            </div>
            <div className="ifield" style={{ marginBottom:10 }}>
              <div className="ilbl">Success in 90 Days</div>
              <textarea value={successIn90} onChange={e => setSuccessIn90(e.target.value)} placeholder="What does good look like in the first 90 days?" style={{ minHeight:55 }} />
            </div>
            <div className="ifield" style={{ marginBottom:0 }}>
              <div className="ilbl">Urgency</div>
              <div className="radio-grp">
                {["Backfill","New headcount","Pipeline building","Exploratory"].map(u => (
                  <div key={u} className={`r-opt${urgency===u?" on":""}`} onClick={() => setUrgency(u)}>{u}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 4: EDI */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--border-l)" }}>Cultural Competency</div>
            <div className="edi-block">
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <span style={{ fontSize:12, fontWeight:800, color:"var(--green)" }}>EDI Dimensions</span>
                <span className="pill pill-green" style={{ fontSize:10 }}>Optional</span>
                {ediChecks.length > 0 && <span className="pill pill-green" style={{ fontSize:10, marginLeft:"auto" }}>{ediChecks.length} selected</span>}
              </div>
              <p style={{ fontSize:12, color:"var(--green)", lineHeight:1.6, marginBottom:12, opacity:.75 }}>Select dimensions to generate dedicated EDI-reviewed questions for each.</p>
              {EDI_ITEMS.map(item => {
                const checked = ediChecks.includes(item.key);
                return (
                  <div key={item.key} className={`edi-check ${checked?"checked":"unchecked"}`} onClick={() => toggleEdi(item.key)}>
                    <div className={`edi-cb ${checked?"checked":"unchecked"}`}>{checked&&<span style={{ color:"white", fontSize:10, fontWeight:800 }}>✓</span>}</div>
                    <div><div style={{ fontSize:13, fontWeight:700, color:checked?"var(--green)":"var(--ink)", marginBottom:2 }}>{item.label}</div><div style={{ fontSize:11, color:"var(--ink3)", lineHeight:1.5 }}>{item.sub}</div></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sticky CTA */}
          <div style={{ position:"sticky", bottom:0, background:"var(--white)", borderTop:"1px solid var(--border)", padding:"12px 0 0", marginTop:16 }}>
            {error && <div className="err" style={{ marginBottom:10 }}>{error}</div>}
            <button className="btn btn-primary" onClick={generate}
              disabled={loading||(!jd.trim()&&!roleTitle.trim()&&mustHaves.length===0)}
              style={{ width:"100%", justifyContent:"center", fontSize:14, padding:"13px" }}>
              {loading ? "Generating..." : "Generate Interview Kit →"}
            </button>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="panel-r" style={{ padding:0, display:"flex", flexDirection:"column" }}>

          {/* How it works — bold editorial header */}
          <div style={{
            background:"#1A1814",
            padding:"32px 28px 28px",
            position:"relative",
            overflow:"hidden",
            flexShrink:0,
          }}>
            {/* Background texture */}
            <svg style={{ position:"absolute", top:0, right:0, width:220, height:"100%", opacity:.05, pointerEvents:"none" }} viewBox="0 0 220 280" fill="none">
              <circle cx="180" cy="60" r="130" stroke="white" strokeWidth="1"/>
              <circle cx="200" cy="160" r="70" stroke="#5C3D99" strokeWidth="1.5" fill="#5C3D99" fillOpacity=".3"/>
              <line x1="0" y1="140" x2="220" y2="140" stroke="white" strokeWidth=".5" opacity=".5"/>
            </svg>

            <div style={{ position:"relative", zIndex:1 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"rgba(255,255,255,.3)", marginBottom:10 }}>How it works</div>
              <div style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.8px", color:"white", lineHeight:1.15, marginBottom:6 }}>
                Fill the left.<br/>
                <span style={{ color:"#C8D832" }}>Get a full kit.</span>
              </div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,.45)", lineHeight:1.7, marginBottom:28, maxWidth:300 }}>
                Role title unlocks AI suggestions. Skills + rounds shape every question. EDI dimensions add dedicated questions per competency.
              </div>

              {/* Steps — horizontal pills */}
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {[
                  { num:"01", label:"Role Title", detail:"Unlocks AI skill suggestions", color:"#C8D832", textColor:"#1A1814" },
                  { num:"02", label:"Skills", detail:"Must-haves + nice-to-haves calibrate every question", color:"#9B78E8", textColor:"white" },
                  { num:"03", label:"Rounds", detail:"Type-specific questions per round format", color:"#4DB87A", textColor:"white" },
                  { num:"04", label:"Generate", detail:"4–5 questions per round, EDI-reviewed", color:"#5C3D99", textColor:"white" },
                  { num:"05", label:"Download Kit", detail:"Full kit as HTML — print or share", color:"rgba(255,255,255,.12)", textColor:"rgba(255,255,255,.5)", optional:true },
                ].map(s => (
                  <div key={s.num} style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{
                      width:28, height:28, borderRadius:8,
                      background:s.color,
                      border: s.optional ? "1.5px dashed rgba(255,255,255,.2)" : "none",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      flexShrink:0,
                    }}>
                      <span style={{ fontSize:10, fontWeight:900, color:s.textColor, letterSpacing:"-0.3px" }}>{s.optional ? "↓" : s.num}</span>
                    </div>
                    <div style={{ flex:1 }}>
                      <span style={{ fontSize:13, fontWeight:800, color: s.optional ? "rgba(255,255,255,.45)" : "white", marginRight:8 }}>{s.label}</span>
                      {s.optional && <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.5px", textTransform:"uppercase", color:"rgba(255,255,255,.25)", marginRight:6 }}>Optional</span>}
                      <span style={{ fontSize:12, color:"rgba(255,255,255,.4)" }}>{s.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Prompter below */}
          <div style={{ padding:"20px 28px", flex:1, overflowY:"auto" }}>
            <Prompter />
          </div>
        </div>
      </div>
    </div>
  );



  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <PageHeader
        title={result?.role || "Interview Kit"}
        desc="Review questions by round, export the scoring rubric, or save the kit to start collecting scorecards."
        accentColor="#5C3D99"
        actions={<div style={{ display:"flex", gap:6 }}>{result?.competencies?.map(c=><span key={c} className="tag">{c}</span>)}</div>}
      />
      <div className="split" style={{ flex:1 }}>
        <div className="panel-l" style={{ gap:0, paddingBottom:0, overflowY:"auto" }}>

          {/* ── MASTER PINS ── */}
          <div style={{ background:"#1A1814", borderRadius:12, padding:"18px 16px", marginBottom:16 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"rgba(255,255,255,.3)", marginBottom:14 }}>Kit PINs</div>

            {/* Submit PIN */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,.45)", marginBottom:6 }}>Submit PIN <span style={{ fontWeight:400, fontSize:10, color:"rgba(255,255,255,.25)" }}>— share with each interviewer</span></div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, background:"rgba(92,61,153,.2)", border:"1.5px solid rgba(92,61,153,.4)", borderRadius:8, padding:"10px 14px", fontFamily:"'IBM Plex Mono','Courier New',monospace", fontSize:22, fontWeight:700, letterSpacing:8, color:"#C8B4F8", textAlign:"center" }}>{submitPIN || "----"}</div>
                <button onClick={() => copyToClipboard(submitPIN, "submit")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:11, fontWeight:700, background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.15)", borderRadius:7, padding:"8px 12px", color:"white", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
                  {copied==="submit" ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            {/* View PIN */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,.45)", marginBottom:6 }}>View PIN <span style={{ fontWeight:400, fontSize:10, color:"rgba(255,255,255,.25)" }}>— coordinator only, do not share</span></div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, background:"rgba(45,134,83,.15)", border:"1.5px solid rgba(45,134,83,.35)", borderRadius:8, padding:"10px 14px", fontFamily:"'IBM Plex Mono','Courier New',monospace", fontSize:22, fontWeight:700, letterSpacing:8, color:"#4DB87A", textAlign:"center" }}>{viewPIN || "----"}</div>
                <button onClick={() => copyToClipboard(viewPIN, "view")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:11, fontWeight:700, background:"rgba(255,255,255,.08)", border:"1px solid rgba(255,255,255,.15)", borderRadius:7, padding:"8px 12px", color:"white", cursor:"pointer", whiteSpace:"nowrap", flexShrink:0 }}>
                  {copied==="view" ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            {/* Interviewer slots */}
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,.45)" }}>Interviewer slots</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <button onClick={() => setInterviewerCount(c => Math.max(1, c-1))} style={{ width:22, height:22, border:"1px solid rgba(255,255,255,.2)", borderRadius:5, background:"transparent", color:"white", cursor:"pointer", fontSize:14, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
                  <span style={{ fontSize:13, fontWeight:700, color:"white", minWidth:16, textAlign:"center" }}>{interviewerCount}</span>
                  <button onClick={() => setInterviewerCount(c => Math.min(10, c+1))} style={{ width:22, height:22, border:"1px solid rgba(255,255,255,.2)", borderRadius:5, background:"transparent", color:"white", cursor:"pointer", fontSize:14, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {Array.from({ length: interviewerCount }, (_, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.07)", borderRadius:6 }}>
                    <div style={{ width:20, height:20, borderRadius:"50%", background:"rgba(92,61,153,.3)", border:"1px solid rgba(92,61,153,.5)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:9, fontWeight:800, color:"#C8B4F8" }}>{i+1}</span>
                    </div>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,.35)", flex:1 }}>Interviewer {i+1}</span>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:3, color:"rgba(92,61,153,.8)" }}>{submitPIN}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => copyToClipboard(
                  Array.from({length: interviewerCount}, (_,i) => `Interviewer ${i+1}: ${submitPIN}`).join("\n") + `\nView PIN (coordinator): ${viewPIN}`,
                  "all"
                )}
                style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:11, fontWeight:700, background:"rgba(200,216,50,.15)", border:"1px solid rgba(200,216,50,.3)", borderRadius:7, padding:"7px 14px", color:"#C8D832", cursor:"pointer", width:"100%", marginTop:8 }}
              >{copied==="all" ? "✓ All PINs copied" : "Copy all PINs to clipboard"}</button>
            </div>
          </div>

          {/* ── SAVE KIT ── */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:8, color:"var(--ink)" }}>Save Kit to Scorecards</div>
            {!saved ? (
              <>
                <div className="isub" style={{ marginBottom:10 }}>Saves PINs permanently and enables the score board.</div>
                <div className="ifield"><div className="ilbl">Kit Name</div><input type="text" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. Senior PM — Spring 2025" /></div>
                <div className="ifield"><div className="ilbl">Candidate Name <span style={{ fontWeight:400, color:"var(--ink4)" }}>(optional)</span></div><input type="text" value={candidateName} onChange={e => setCandidateName(e.target.value)} placeholder="e.g. Jordan Rivera" /></div>
                <button className="btn btn-green" onClick={saveKit} disabled={!saveName.trim()} style={{ width:"100%" }}>Save & Lock PINs →</button>
              </>
            ) : (
              <div className="success-bar">✓ Kit saved — PINs are locked in Scorecards</div>
            )}
          </div>

          <hr className="div" style={{ margin:"8px 0" }} />
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setStep("intake")}>← Edit Intake</button>
            <button className="btn btn-ghost btn-sm" onClick={generate}>↺ Regenerate</button>
            <button className="btn btn-ghost btn-sm" onClick={clearGenerate} style={{color:"var(--red)",borderColor:"var(--red-b)"}}>Clear</button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => exportInterviewKit(result, submitPIN, viewPIN, { roleTitle, jd, urgency, rounds, mustHaves, niceToHaves, booleanString, dealBreakers, successIn90, companyAbout, ediChecks, interviewerCount }, savedKitId ? cards.filter(c => c.kitId === savedKitId) : [])} style={{ width:"100%", justifyContent:"center" }}>↓ Download Full Kit</button>

        </div>
        <div className="panel-r">
          <div className="subtabs">
            {[["questions","Questions"],["scoring","Scoring"],["donotask","Do Not Ask"],["debrief","Debrief"]].map(([k,l]) => (
              <button key={k} className={`subtab${view===k?" on":""}`} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>

          {view==="questions" && <>
            {result?.rounds?.map(round => (
              <div key={round.round} style={{ marginBottom:26 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, paddingBottom:10, borderBottom:"1px solid var(--border)" }}>
                  <span className={`rb rb-${Math.min(round.round,3)}`}>Round {round.round}</span>
                  <span style={{ fontSize:14, fontWeight:700 }}>{round.title}</span>
                </div>
                <div style={{ fontSize:12, color:"var(--ink4)", marginBottom:4 }}>Led by: <strong style={{ color:"var(--ink3)" }}>{round.led_by}</strong></div>
                <div style={{ fontSize:13, color:"var(--ink3)", marginBottom:12, lineHeight:1.6 }}>{round.purpose}</div>
                {round.questions?.map((q,i) => (
                  <div key={i} className="q-item">
                    <span className="q-num">{String(i+1).padStart(2,"0")}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ color:"var(--ink2)" }}>{q.question}</div>
                      <div className="q-meta">
                        <span className="tag">{q.type}</span>
                        <span className="tag">{q.competency}</span>
                        {q.type==="cultural_competency" && <span className="pill pill-green" style={{ fontSize:10 }}>EDI</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {result?.fairness_notes?.length>0 && <><hr className="div" /><div className="section-label" style={{ marginBottom:10 }}>Fairness Notes</div>{result.fairness_notes.map((n,i)=><div key={i} className="flag flag-note"><div className="flag-label fl-note">Note</div><div className="flag-body" style={{ marginBottom:0 }}>{n}</div></div>)}</>}
            <hr className="div" />
            <Prompter />
          </>}

          {view==="scoring" && <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:"var(--lime-bg)", border:"1px solid var(--lime-b)", borderRadius:10, marginBottom:16 }}>
              <div><div style={{ fontSize:12, fontWeight:700, color:"var(--ink)" }}>Export Scorecard</div><div style={{ fontSize:11, color:"var(--ink3)", marginTop:2 }}>Structured for Greenhouse · Ashby · Lever · Workday</div></div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-amber btn-sm" onClick={() => exportPDF(result)}>↓ PDF</button>
                <button className="btn btn-ghost btn-sm" onClick={() => exportWord(result)}>↓ Word</button>
              </div>
            </div>
            <p style={{ fontSize:11, color:"var(--ink4)", lineHeight:1.5, marginBottom:16, padding:"8px 12px", border:"1px solid var(--border)", borderRadius:8, background:"var(--egg)", fontStyle:"italic" }}>Rename field keys to match your ATS schema before importing.</p>
            <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:14 }}>
              {[["1","Weak","var(--red)"],["2","Lean Weak","var(--amber)"],["3","Neutral","var(--ink3)"],["4","Lean Strong","var(--lime-text)"],["5","Strong","var(--green)"]].map(([n,l,c]) => (
                <span key={n} style={{ fontSize:11, fontWeight:600, padding:"3px 11px", borderRadius:20, color:c, border:`1.5px solid ${c}44`, background:"var(--white)" }}>{n} — {l}</span>
              ))}
            </div>
            <div className="section-label" style={{ marginBottom:10 }}>Competency Scoring Rubric</div>
            <table className="score-table">
              <thead><tr><th>Competency</th><th>Weight</th><th>1 Weak</th><th>2 Lean Weak</th><th>3 Neutral</th><th>4 Lean Strong</th><th>5 Strong</th></tr></thead>
              <tbody>{result?.scoring_rubric?.map((row,i) => (
                <tr key={i}><td>{row.competency}{row.ats_field_key&&<div style={{ fontSize:10, color:"var(--ink4)", marginTop:2, fontWeight:400 }}>{row.ats_field_key}</div>}</td><td><span className="tag">{row.weight}</span></td><td>{row.score_1}</td><td>{row.score_2}</td><td>{row.score_3}</td><td>{row.score_4}</td></tr>
              ))}</tbody>
            </table>
          </>}

          {view==="donotask" && <><div className="section-label" style={{ marginBottom:12 }}>Do Not Ask</div><p style={{ fontSize:13, color:"var(--ink3)", lineHeight:1.6, marginBottom:16 }}>Share with all interviewers before the process begins.</p>{result?.do_not_ask?.map((q,i)=><div key={i} className="flag flag-bias" style={{ marginBottom:10 }}><div className="flag-label fl-bias">⊘ Do Not Ask</div><div className="flag-body" style={{ marginBottom:0 }}>{q}</div></div>)}</>}

          {view==="debrief" && <><div className="section-label" style={{ marginBottom:12 }}>Debrief Agenda</div><p style={{ fontSize:13, color:"var(--ink3)", lineHeight:1.6, marginBottom:16 }}>Run after all interviewers submit scores independently.</p>{result?.debrief_agenda?.map((s,i)=><div key={i} className="flag flag-note" style={{ marginBottom:10 }}><div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}><span style={{ fontSize:11, fontWeight:800, color:"var(--purple)" }}>Step {i+1}</span><span style={{ fontSize:11, fontWeight:600, color:"var(--ink4)", background:"var(--egg-d)", border:"1px solid var(--border)", borderRadius:20, padding:"2px 9px" }}>{s.duration}</span><span style={{ fontSize:13, fontWeight:700 }}>{s.step}</span></div><div className="flag-body" style={{ marginBottom:0 }}>{s.instructions}</div></div>)}</>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// SCORECARDS TAB
// ══════════════════════════════════════════════════════════════════
function ScorecardsTab() {
  const { kits, cards, addCard } = useApp();
  const [mode, setMode] = useState("list");
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [pinMode, setPinMode] = useState(null);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [rec, setRec] = useState("");
  const [iName, setIName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [kitCards, setKitCards] = useState([]);

  const openKit = (kit, m) => { setSel(kit); setPinMode(m); setPin(""); setPinErr(""); setMode("pin"); setSubmitted(false); setScores({}); setNotes({}); setRec(""); setIName(""); };
  const checkPIN = () => { const p=pinMode==="submit"?sel.submitPIN:sel.viewPIN; if(pin.trim()===p){ setMode(pinMode); setPinErr(""); if(pinMode==="view") setKitCards(cards.filter(c=>c.kitId===sel.id)); } else setPinErr("Incorrect PIN."); };
  const submit = () => { if(!iName.trim()) return; addCard({ id:genId(), kitId:sel.id, kitName:sel.name, candidate:sel.candidate, interviewer:iName.trim(), submittedAt:new Date().toISOString(), scores, notes, recommendation:rec }); setSubmitted(true); };

  const aS = a => ({
    background:Number(a)>=4.5?"var(--green-bg)":Number(a)>=3.5?"var(--lime-bg)":Number(a)>=2.5?"var(--amber-bg)":"var(--red-bg)",
    color:Number(a)>=4.5?"var(--green)":Number(a)>=3.5?"var(--lime-text)":Number(a)>=2.5?"var(--amber)":"var(--red)",
    borderColor:Number(a)>=4.5?"var(--green-b)":Number(a)>=3.5?"var(--lime-b)":Number(a)>=2.5?"var(--amber-b)":"var(--red-b)",
  });

  const ScorecardHeader = ({ title, sub }) => (
    <PageHeader
      title={title}
      desc={sub || "PIN-gated blind scoring. Interviewers score independently before the debrief."}
      accentColor="#2D8653"
      actions={mode !== "list" ? <button className="btn btn-ghost btn-sm" onClick={() => setMode("list")}>← Back to Kits</button> : null}
    />
  );

  const [explainerOpen, setExplainerOpen] = useState(false);

  // Scorecard flow diagram — shown on both empty state and list
  const ScorecardFlow = () => (
    <div style={{ background:"var(--egg)", border:"1px solid var(--border)", borderRadius:14, padding:"20px 24px", marginBottom:24 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"var(--ink4)", marginBottom:16 }}>How Scorecards Work</div>
      <div style={{ display:"flex", alignItems:"center", gap:0, flexWrap:"wrap", rowGap:12 }}>
        {[
          { step:"1", label:"Generate Kit", sub:"Create a kit in the Generate tab", color:"var(--purple)", bg:"var(--purple-bg)", border:"var(--purple-b)" },
          { step:"2", label:"Save Kit", sub:"Save it — you get two PINs", color:"var(--amber)", bg:"var(--amber-bg)", border:"var(--amber-b)" },
          { step:"3", label:"Share Submit PIN", sub:"Send submit PIN to each interviewer", color:"#5C3D99", bg:"var(--purple-bg)", border:"var(--purple-b)" },
          { step:"4", label:"Blind Scoring", sub:"Each interviewer scores independently", color:"var(--green)", bg:"var(--green-bg)", border:"var(--green-b)" },
          { step:"5", label:"View Results", sub:"Use View PIN to see the score board", color:"var(--lime-text)", bg:"var(--lime-bg)", border:"var(--lime-b)" },
        ].map((s, i, arr) => (
          <Fragment key={s.step}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", minWidth:120, flex:1 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:s.bg, border:`1.5px solid ${s.border}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:8 }}>
                <span style={{ fontSize:14, fontWeight:800, color:s.color }}>{s.step}</span>
              </div>
              <div style={{ fontSize:12, fontWeight:700, color:"var(--ink)", textAlign:"center", marginBottom:3 }}>{s.label}</div>
              <div style={{ fontSize:11, color:"var(--ink4)", textAlign:"center", lineHeight:1.4 }}>{s.sub}</div>
            </div>
            {i < arr.length - 1 && (
              <div style={{ fontSize:16, color:"var(--border)", fontWeight:700, flexShrink:0, paddingBottom:20 }}>→</div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );

  // Collapsible explainer
  const ScorecardExplainer = () => (
    <div style={{ border:"1px solid var(--border)", borderRadius:10, marginBottom:20, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 16px", background:"var(--white)", cursor:"pointer" }} onClick={() => setExplainerOpen(o=>!o)}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--ink2)" }}>Why blind scoring?</span>
          <span className="pill pill-green" style={{ fontSize:10 }}>EDI Best Practice</span>
        </div>
        <span style={{ fontSize:12, color:"var(--ink4)", fontWeight:600 }}>{explainerOpen ? "▲ Collapse" : "▼ Read more"}</span>
      </div>
      {explainerOpen && (
        <div style={{ padding:"14px 16px", background:"var(--egg)", borderTop:"1px solid var(--border-l)", fontSize:13, color:"var(--ink2)", lineHeight:1.7 }}>
          <p style={{ marginBottom:10 }}>When interviewers discuss before scoring, the first opinion anchors the room. This is called <strong>anchoring bias</strong> — and it's one of the most consistent sources of inequitable hiring decisions.</p>
          <p style={{ marginBottom:10 }}>J/D Audit's scorecard system enforces <strong>blind, independent scoring</strong> by giving each interviewer a separate PIN. They submit their scores before seeing anyone else's. Only the coordinator — using the View PIN — can see the full board.</p>
          <p>The score board flags <strong>split decisions</strong> (spread of 2+ points on any competency) so the debrief focuses on evidence, not gut feel.</p>
        </div>
      )}
    </div>
  );

  if (kits.length===0) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <ScorecardHeader title="Scorecards" />
      <div className="full-page"><div style={{ maxWidth:660 }}>
      <ScorecardFlow />
      <ScorecardExplainer />
      <div style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.4px", marginBottom:8 }}>No kits saved yet.</div>
      <p style={{ fontSize:14, color:"var(--ink3)", lineHeight:1.7, marginBottom:20 }}>Go to Generate Questions, build a kit, and save it. Your Submit and View PINs will appear here automatically.</p>
    </div></div></div>
  );

  if (mode==="list") return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <ScorecardHeader title="Scorecards" />
      <div className="full-page"><div style={{ maxWidth:680 }}>
      <ScorecardFlow />
      <ScorecardExplainer />
      <div className="section-label" style={{ marginBottom:14 }}>Saved Kits</div>
      {kits.map(kit => {
        const cc = cards.filter(c=>c.kitId===kit.id).length;
        return <div key={kit.id} className="kit-row">
          <div style={{ flex:1 }}><div className="kit-row-name">{kit.name}</div>{kit.candidate&&<div style={{ fontSize:12, color:"var(--ink4)", marginTop:2 }}>Candidate: {kit.candidate}</div>}<div style={{ fontSize:11, color:"var(--ink4)", marginTop:2 }}>{kit.role} · {new Date(kit.createdAt).toLocaleDateString()}</div></div>
          <span style={{ fontSize:12, color:"var(--ink4)", marginRight:6 }}>{cc} card{cc!==1?"s":""}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => openKit(kit,"view")} style={{ marginRight:8 }}>View Scores</button>
          <button className="btn btn-green btn-sm" onClick={() => openKit(kit,"submit")}>Submit Score</button>
        </div>;
      })}
    </div></div></div>
  );

  if (mode==="pin") return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <ScorecardHeader title={pinMode==="submit" ? "Submit Scorecard" : "View Scores"} sub={pinMode==="submit" ? "Enter the PIN your recruiter shared to submit your blind scorecard." : "Enter the view PIN to see all submitted scorecards for this kit."} />
      <div className="full-page"><div style={{ maxWidth:360 }}>
      <div style={{ fontSize:18, fontWeight:800, letterSpacing:"-0.3px", marginBottom:6 }}>{pinMode==="submit"?"Interviewer PIN":"View PIN"}</div>
      {pinMode==="submit" ? (
        <div style={{ background:"var(--purple-bg)", border:"1px solid var(--purple-b)", borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"var(--purple)", marginBottom:4 }}>You are scoring as an interviewer</div>
          <div style={{ fontSize:12, color:"var(--ink2)", lineHeight:1.6 }}>Your recruiter shared a 4-digit PIN with you. Enter it below to access the blind scorecard. <strong>Do not discuss scores</strong> with other interviewers before submitting.</div>
        </div>
      ) : (
        <div style={{ background:"var(--green-bg)", border:"1px solid var(--green-b)", borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"var(--green)", marginBottom:4 }}>You are viewing as the coordinator</div>
          <div style={{ fontSize:12, color:"var(--ink2)", lineHeight:1.6 }}>The View PIN lets you see all submitted scorecards and the full score board. Share the separate Submit PIN with interviewers — never the View PIN.</div>
        </div>
      )}
      <input type="password" value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&checkPIN()} placeholder="4-digit PIN" style={{ marginBottom:10, letterSpacing:8, fontSize:22, textAlign:"center", fontWeight:800 }} />
      {pinErr && <div className="err" style={{ marginBottom:10 }}>{pinErr}</div>}
      <button className="btn btn-primary" onClick={checkPIN} disabled={pin.length<4}>Unlock →</button>
      <div style={{ marginTop:16, fontSize:12, color:"var(--ink4)", lineHeight:1.6 }}>
        {pinMode==="submit" ? "Don't have a PIN? Ask your recruiting coordinator." : "The View PIN is shown in the kit list next to the kit name."}
      </div>
    </div></div></div>
  );

  if (mode==="submit") {
    if (submitted) return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
        <ScorecardHeader title="Scorecard Submitted" sub="Your scores have been recorded. The recruiter will share results after all submissions." />
        <div className="full-page"><div style={{ maxWidth:460 }}>
        <div className="success-bar" style={{ marginBottom:20, padding:"16px 20px", borderRadius:12 }}><div><div style={{ fontWeight:800, fontSize:16 }}>✓ Scorecard submitted</div><div style={{ fontSize:13, opacity:.75, marginTop:2 }}>Recruiter will share results after all submissions.</div></div></div>
        <button className="btn btn-ghost" onClick={() => setMode("list")}>← Back to Kits</button>
      </div></div></div>
    );
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
        <ScorecardHeader title={`Scoring: ${sel.name}`} sub={sel.candidate ? `Candidate: ${sel.candidate} — score each competency independently before any discussion.` : "Score each competency independently before any panel discussion."} />
        <div className="full-page"><div style={{ maxWidth:720 }}>
        <div className="flag flag-warn" style={{ marginBottom:22 }}><div className="flag-label fl-warn">Blind Scoring Active</div><div className="flag-body" style={{ marginBottom:0 }}>Score independently. Do not discuss with other interviewers until all scores are submitted — prevents anchoring bias.</div></div>
        <div className="ifield" style={{ marginBottom:20, maxWidth:340 }}><div className="ilbl">Your Name</div><input type="text" value={iName} onChange={e=>setIName(e.target.value)} placeholder="Enter your name before submitting" /></div>
        <div className="section-label" style={{ marginBottom:14 }}>Score Each Competency</div>
        {sel.scoring_rubric?.map((row,i) => (
          <div key={i} className="card" style={{ marginBottom:12, borderRadius:12 }}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>{row.competency} <span style={{ fontWeight:500, fontSize:12, color:"var(--ink4)" }}>({row.weight})</span></div>
            <div style={{ display:"flex", gap:4, margin:"10px 0", flexWrap:"wrap", alignItems:"center" }}>
              {[1,2,3,4,5].map(n=><button key={n} className={`s-btn${scores[row.competency]===n?` on-${n}`:""}`} onClick={()=>setScores(p=>({...p,[row.competency]:n}))}>{n}</button>)}
              {scores[row.competency]&&<span style={{ fontSize:12, color:"var(--ink3)", paddingLeft:8 }}>{[row.score_1,row.score_2,row.score_3,row.score_4,row.score_5||"Strong"][scores[row.competency]-1]}</span>}
            </div>
            <textarea className="note-area" placeholder="Optional notes..." value={notes[row.competency]||""} onChange={e=>setNotes(p=>({...p,[row.competency]:e.target.value}))} />
          </div>
        ))}
        <hr className="div" />
        <div className="section-label" style={{ marginBottom:12 }}>Overall Recommendation</div>
        <div style={{ display:"flex", flexWrap:"wrap", marginBottom:24 }}>{RECS.map(r=><button key={r.key} className={`r-btn${rec===r.key?` on-${r.key}`:""}`} onClick={()=>setRec(r.key)}>{r.label}</button>)}</div>
        <button className="btn btn-green" onClick={submit} disabled={!iName.trim()||!rec||Object.keys(scores).length===0}>Submit Scorecard →</button>
      </div></div></div>
    );
  }

  if (mode==="view") {
    const AVC=["#C8D832","#2D8653","#5C3D99","#00804C","#1A1814"];
    const comps=sel.scoring_rubric?.map(r=>r.competency)||[];
    const cA=c=>{const v=kitCards.map(x=>x.scores?.[c]).filter(Boolean);return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;};
    const kA=card=>{const v=Object.values(card.scores||{}).filter(Boolean);return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;};
    const ov=()=>{const v=kitCards.flatMap(c=>Object.values(c.scores||{})).filter(Boolean);return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):null;};
    const overall=ov();
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
        <PageHeader
          title={sel.name}
          desc={sel.candidate ? `Candidate: ${sel.candidate} — live score board across all submitted scorecards.` : "Live score board — view all submitted scorecards and panel averages."}
          accentColor="#2D8653"
          actions={
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <div className="pin-box" style={{ marginBottom:0 }}><div className="pin-lbl">Submit PIN</div><div className="pin-num" style={{ color:"var(--purple)", letterSpacing:5 }}>{sel.submitPIN}</div></div>
              <div className="pin-box" style={{ marginBottom:0 }}><div className="pin-lbl">View PIN</div><div className="pin-num" style={{ color:"var(--green)", letterSpacing:5 }}>{sel.viewPIN}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setMode("list")}>← Back</button>
            </div>
          }
        />
        {kitCards.length===0 ? <div className="full-page"><p style={{ fontSize:13, color:"var(--ink3)" }}>No scorecards yet. Share the Submit PIN with your interviewers.</p></div> : (
          <div className="full-page">
            <div className="sum-strip">
              {[["Interviewers",kitCards.length,"var(--ink)"],["Strong Candidate",kitCards.filter(c=>c.recommendation==="sc5").length,"var(--green)"],["Lean+",kitCards.filter(c=>["sc4","sc5"].includes(c.recommendation)).length,"var(--lime-text)"],["Avg Score",overall||"—",Number(overall)>=4?"var(--green)":Number(overall)>=3?"var(--lime-text)":"var(--red)"]].map(([l,v,c])=>(
                <div key={l} className="sum-card"><div className="sum-val" style={{ color:c }}>{v}</div><div className="sum-lbl">{l}</div></div>
              ))}
            </div>
            <div className="section-label" style={{ marginBottom:12 }}>Score Board</div>
            <div className="board-wrap">
              <table className="board">
                <thead><tr><th>Interviewer</th>{comps.map(c=><th key={c} className="sc">{c}</th>)}<th className="sc">Avg</th><th>Rec</th></tr></thead>
                <tbody>
                  {kitCards.map((card,ri)=>{
                    const avg=kA(card);
                    return (<tr key={card.id}><td><div className="b-cand"><div className="b-av" style={{ background:AVC[ri%AVC.length], color:ri===0?"var(--ink)":"white" }}>{card.interviewer.split(" ").map(n=>n[0]).join("").slice(0,2)}</div><div><div className="b-name">{card.interviewer}</div><div className="b-sub">{new Date(card.submittedAt).toLocaleDateString()}</div></div></div></td>
                      {comps.map(comp=>{const s=card.scores?.[comp];const sp=kitCards.length>1&&(()=>{const v=kitCards.map(c=>c.scores?.[comp]).filter(Boolean);return v.length>1&&Math.max(...v)-Math.min(...v)>=2;})();return(<td key={comp} className="sc">{s?<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}><span className={`sc-chip sc${s}`}>{s}</span>{sp&&<span className="split-w">!</span>}</div>:<span style={{color:"var(--border)"}}>—</span>}</td>);})}
                      <td className="sc">{avg&&<span className="avg-chip" style={aS(avg)}>{avg}</span>}</td>
                      <td>{RECS.find(r=>r.key===card.recommendation)&&<span className={`rec-tag rec-${card.recommendation}`}>{RECS.find(r=>r.key===card.recommendation).label}</span>}</td>
                    </tr>);
                  })}
                  <tr style={{ background:"var(--egg)", borderTop:"2px solid var(--border)" }}>
                    <td style={{ fontWeight:700, fontSize:11, color:"var(--ink4)", textTransform:"uppercase", letterSpacing:"0.5px" }}>Team Average</td>
                    {comps.map(c=>{const a=cA(c);return(<td key={c} className="sc">{a&&<span className="avg-chip" style={{...aS(a),fontWeight:800}}>{a}</span>}</td>);})}
                    <td className="sc">{overall&&<span className="avg-chip" style={{...aS(overall),fontWeight:800}}>{overall}</span>}</td>
                    <td/>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// DEBRIEF TAB
// ══════════════════════════════════════════════════════════════════
function DebriefTab() {
  const { kits, cards } = useApp();
  const [openIdx, setOpenIdx] = useState(null);
  const [kitId, setKitId] = useState("");
  const [notes, setNotes] = useState({});
  const selKit = kits.find(k=>k.id===kitId);
  const kitCards = kitId ? cards.filter(c=>c.kitId===kitId) : [];
  const agenda = selKit?.debrief_agenda || DEFAULT_DEBRIEF;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <PageHeader
        title="Debrief Guide"
        desc="A structured 7-step facilitation agenda. Run after all interviewers submit scores independently — coordinator facilitates."
        accentColor="#6B7A0A"
      />
      <div className="full-page"><div style={{ maxWidth:700 }}>
        {/* Kit selector — inline above agenda */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24, padding:"14px 16px", background:"var(--white)", border:"1px solid var(--border)", borderRadius:10 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"var(--ink)" }}>Link to a kit</div>
          <div style={{ fontSize:12, color:"var(--ink4)" }}>Pulls in panel scores for the summary below.</div>
          {kits.length>0 ? (
            <select value={kitId} onChange={e=>setKitId(e.target.value)} style={{ marginLeft:"auto", minWidth:200 }}>
              <option value="">— Select a kit —</option>
              {kits.map(k=><option key={k.id} value={k.id}>{k.name}{k.candidate?` — ${k.candidate}`:""}</option>)}
            </select>
          ) : (
            <span style={{ marginLeft:"auto", fontSize:12, color:"var(--ink4)", fontStyle:"italic" }}>No kits saved yet — generate one first.</span>
          )}
        </div>
        {selKit && kitCards.length>0 && (
          <div style={{ background:"var(--purple-bg)", border:"1px solid var(--purple-b)", borderRadius:12, padding:"14px 18px", marginBottom:22 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.8px", textTransform:"uppercase", color:"var(--purple)", marginBottom:8 }}>Score Summary — {selKit.name}</div>
            <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>{kitCards.map(c=><div key={c.id} style={{ fontSize:13 }}><strong>{c.interviewer}:</strong> <span style={{ color:"var(--ink3)" }}>{RECS.find(r=>r.key===c.recommendation)?.label||"—"}</span></div>)}</div>
          </div>
        )}
        <div className="section-label" style={{ marginBottom:12 }}>Agenda</div>
        {agenda.map((step,i)=>(
          <div key={i} className="deb-step">
            <div className={`deb-hdr${openIdx===i?" open":""}`} onClick={()=>setOpenIdx(openIdx===i?null:i)}>
              <span style={{ fontWeight:800, fontSize:13, color:"var(--lime-text)", minWidth:28 }}>0{i+1}</span>
              <span style={{ fontSize:11, fontWeight:600, color:"var(--ink4)", background:"var(--egg-d)", border:"1px solid var(--border)", borderRadius:20, padding:"2px 9px", flexShrink:0 }}>{step.duration}</span>
              <span style={{ fontSize:14, fontWeight:700, flex:1 }}>{step.step}</span>
              <span style={{ fontSize:12, color:"var(--ink4)" }}>{openIdx===i?"▲":"▼"}</span>
            </div>
            {openIdx===i&&<div className="deb-body"><p style={{ marginBottom:12 }}>{step.instructions}</p><div className="ilbl">Facilitator Notes</div><textarea className="note-area" placeholder="Add notes during the debrief..." value={notes[i]||""} onChange={e=>setNotes(p=>({...p,[i]:e.target.value}))} /></div>}
          </div>
        ))}
        <hr className="div" />
        <div className="flag flag-bias"><div className="flag-label fl-bias">⚠ Bias Watch</div><div className="flag-body" style={{ marginBottom:0 }}>Anchoring on first opinions · halo/horn effects from one moment · affinity bias toward people who resemble the panel · "culture fit" as a proxy for similarity.</div></div>
      </div></div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════
const NAV_ITEMS = [
  { key:"home",       label:"Home",                sub:"Platform overview" },
  { key:"why",        label:"Why This Exists",     sub:"The gap we're closing" },
  { key:"audit",      label:"JD Audit",            sub:"Bias & language scan" },
  { key:"generate",   label:"Generate Questions",  sub:"Build interview kits" },
  { key:"scorecards", label:"Scorecards",           sub:"Blind panel scoring" },
  { key:"debrief",    label:"Debrief Guide",        sub:"Structured facilitation" },
];

// ── Shared SVG shapes — abstract human-process concepts ──────────
// Each shape is a small inline SVG composing circles, arcs, dots into
// ideas: convergence, connection, structure, emergence
const ShapeConverge = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <circle cx="32" cy="32" r="30" stroke="#00804C" strokeWidth="1.5" strokeDasharray="4 3" opacity=".25"/>
    <circle cx="18" cy="22" r="5" fill="#00804C" opacity=".18"/>
    <circle cx="46" cy="22" r="5" fill="#00804C" opacity=".18"/>
    <circle cx="32" cy="44" r="5" fill="#00804C" opacity=".18"/>
    <line x1="18" y1="22" x2="32" y2="32" stroke="#00804C" strokeWidth="1.5" opacity=".4"/>
    <line x1="46" y1="22" x2="32" y2="32" stroke="#00804C" strokeWidth="1.5" opacity=".4"/>
    <line x1="32" y1="44" x2="32" y2="32" stroke="#00804C" strokeWidth="1.5" opacity=".4"/>
    <circle cx="32" cy="32" r="5" fill="#00804C" opacity=".7"/>
  </svg>
);

const ShapeStructure = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <rect x="8" y="8" width="22" height="22" rx="4" stroke="#1A1814" strokeWidth="1.5" opacity=".12"/>
    <rect x="34" y="8" width="22" height="22" rx="4" stroke="#1A1814" strokeWidth="1.5" opacity=".12"/>
    <rect x="8" y="34" width="22" height="22" rx="4" stroke="#00804C" strokeWidth="1.5" opacity=".4"/>
    <rect x="34" y="34" width="22" height="22" rx="4" fill="#00804C" opacity=".12" stroke="#00804C" strokeWidth="1.5" opacity=".4"/>
    <line x1="19" y1="30" x2="19" y2="34" stroke="#1A1814" strokeWidth="1.5" opacity=".2"/>
    <line x1="45" y1="30" x2="45" y2="34" stroke="#1A1814" strokeWidth="1.5" opacity=".2"/>
  </svg>
);

const ShapeBlind = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <circle cx="32" cy="20" r="8" stroke="#1A1814" strokeWidth="1.5" opacity=".15"/>
    <circle cx="14" cy="38" r="6" stroke="#1A1814" strokeWidth="1.5" opacity=".15"/>
    <circle cx="50" cy="38" r="6" stroke="#1A1814" strokeWidth="1.5" opacity=".15"/>
    <path d="M14 38 Q32 28 50 38" stroke="#00804C" strokeWidth="1.5" fill="none" opacity=".5"/>
    <rect x="26" y="48" width="12" height="4" rx="2" fill="#00804C" opacity=".3"/>
    <line x1="32" y1="20" x2="32" y2="48" stroke="#00804C" strokeWidth="1" strokeDasharray="3 2" opacity=".3"/>
  </svg>
);

const ShapeProcess = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
    <circle cx="12" cy="32" r="5" fill="#00804C" opacity=".25"/>
    <circle cx="32" cy="32" r="5" stroke="#00804C" strokeWidth="1.5" opacity=".5"/>
    <circle cx="52" cy="32" r="5" fill="#00804C" opacity=".8"/>
    <line x1="17" y1="32" x2="27" y2="32" stroke="#1A1814" strokeWidth="1.5" opacity=".2"/>
    <line x1="37" y1="32" x2="47" y2="32" stroke="#1A1814" strokeWidth="1.5" opacity=".2"/>
    <path d="M32 14 Q44 14 52 32" stroke="#00804C" strokeWidth="1" fill="none" strokeDasharray="3 2" opacity=".3"/>
    <path d="M12 32 Q20 50 32 50" stroke="#00804C" strokeWidth="1" fill="none" strokeDasharray="3 2" opacity=".3"/>
  </svg>
);

// ── VIDEO EMBED ──────────────────────────────────────────────────
function VideoEmbed() {
  const [html, setHtml] = useState(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    const __vd = '<' + '!DOCTYPE html>';
    const html = __vd + `<html><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&family=IBM+Plex+Mono:wght@400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#1A1814;width:100%;height:100%;overflow:hidden;font-family:'Plus Jakarta Sans',sans-serif}
.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .6s ease;pointer-events:none;padding:32px 48px;flex-direction:column}
.scene.on{opacity:1;pointer-events:auto}
.gem{width:48px;height:48px;background:#C8D832;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.gem-i{width:20px;height:20px;background:#1A1814;border-radius:4px;transform:rotate(45deg)}
#s1{text-align:center;gap:0}
#s1 .eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9C9890;margin-bottom:18px;opacity:0;transform:translateY(8px);transition:all .5s .2s}
#s1 .h1{font-size:42px;font-weight:900;letter-spacing:-2px;color:white;line-height:1.05;margin-bottom:14px;opacity:0;transform:translateY(12px);transition:all .6s .4s}
#s1 .h1 em{color:#C8D832;font-style:normal}
#s1 .sub{font-size:14px;color:rgba(255,255,255,.45);line-height:1.7;max-width:480px;opacity:0;transform:translateY(8px);transition:all .5s .7s}
#s1.on .eyebrow,#s1.on .h1,#s1.on .sub{opacity:1;transform:translateY(0)}
#s2{flex-direction:row;gap:48px;text-align:left;align-items:center}
#s2 .left{flex:1;opacity:0;transform:translateX(-16px);transition:all .5s .2s}
#s2 .right{flex:1;opacity:0;transform:translateX(16px);transition:all .5s .4s}
#s2.on .left,#s2.on .right{opacity:1;transform:translateX(0)}
#s3{text-align:center}
#s3 .card{background:white;border-radius:16px;padding:24px 28px;max-width:440px;width:100%;text-align:left;opacity:0;transform:translateY(20px) scale(.97);transition:all .6s .3s;margin:16px 0}
#s3.on .card{opacity:1;transform:translateY(0) scale(1)}
#s3 .cap{font-size:11px;color:rgba(255,255,255,.35);opacity:0;transition:all .5s .9s}
#s3.on .cap{opacity:1}
#s4{flex-direction:row;gap:40px;align-items:stretch;text-align:left}
#s4 .col{flex:1;opacity:0;transition:all .5s}
#s4 .col:nth-child(1){transform:translateX(-12px);transition-delay:.2s}
#s4 .col:nth-child(2){transform:translateX(12px);transition-delay:.4s}
#s4.on .col{opacity:1;transform:translateX(0)}
.pin-box{background:#3D2B6B;border:2px solid #7C5CBF;border-radius:10px;padding:14px 20px;text-align:center;margin-bottom:10px}
.pin-val{font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:900;letter-spacing:10px;color:#E8D5FF}
.pin-lbl{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:6px}
.vpin-box{background:#1A3D2B;border:2px solid #2D8653;border-radius:10px;padding:14px 20px;text-align:center}
.vpin-val{font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:900;letter-spacing:10px;color:#7BEBA0}
#s5{text-align:center}
.blind-badge{background:rgba(200,216,50,.12);border:1px solid rgba(200,216,50,.25);border-radius:99px;padding:6px 16px;display:inline-flex;align-items:center;gap:8px;margin-bottom:20px;opacity:0;transition:all .4s .2s}
#s5.on .blind-badge{opacity:1}
.scorers{display:flex;gap:14px;margin-top:20px;flex-wrap:wrap;justify-content:center}
.scorer{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px 18px;min-width:120px;opacity:0;transform:translateY(12px)}
.sc-name{font-size:10px;font-weight:700;color:rgba(255,255,255,.45);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
.sc-chips{display:flex;gap:4px;flex-wrap:wrap}
.chip{width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}
#s6{align-items:flex-start;text-align:left}
.board{width:100%;border-collapse:collapse;opacity:0;transform:translateY(10px);transition:all .6s .3s}
#s6.on .board{opacity:1;transform:translateY(0)}
.board th{font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:rgba(255,255,255,.3);padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;white-space:nowrap}
.board td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:rgba(255,255,255,.65)}
.avg-c{display:inline-block;font-size:11px;font-weight:800;padding:2px 7px;border-radius:5px}
.rec-c{display:inline-block;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}
.split-f{display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px;background:rgba(180,83,9,.2);border:1px solid rgba(180,83,9,.4);color:#F59E0B}
#s7{text-align:center}
.dl-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px 28px;max-width:500px;width:100%;display:flex;flex-direction:column;gap:10px;opacity:0;transform:scale(.96);transition:all .6s .3s}
#s7.on .dl-card{opacity:1;transform:scale(1)}
.dl-row{display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px}
.dl-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.dl-name{font-size:12px;font-weight:700;color:rgba(255,255,255,.8)}
.dl-sub{font-size:10px;color:rgba(255,255,255,.33);margin-top:2px}
#s8{text-align:center}
.logo-wrap{display:flex;align-items:center;gap:16px;margin-bottom:28px;opacity:0;transition:all .5s .2s}
#s8.on .logo-wrap{opacity:1}
.tagline{font-size:30px;font-weight:900;letter-spacing:-1.2px;color:white;line-height:1.1;max-width:500px;margin-bottom:14px;opacity:0;transition:all .6s .5s}
.tagline em{color:#C8D832;font-style:normal}
#s8.on .tagline{opacity:1}
.s8cta{font-size:13px;color:rgba(255,255,255,.35);opacity:0;transition:all .5s .9s}
#s8.on .s8cta{opacity:1}
.tool-chips{display:flex;gap:8px;margin-top:22px;flex-wrap:wrap;justify-content:center;opacity:0;transition:all .5s 1.1s}
#s8.on .tool-chips{opacity:1}</style></head><body>
<div class="scene" id="s1">
  <div class="eyebrow">J/D Audit · EDI Platform</div>
  <div class="h1">Your hiring process<br>has a <em>bias problem.</em></div>
  <div class="sub">AI-assisted tools for talent teams building equitable hiring — from the first word of the JD to the final debrief.</div>
</div>
<div class="scene" id="s2">
  <div class="left">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px">JD Audit</div>
    <div style="font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:6px">Inclusivity Score</div>
    <div style="font-size:76px;font-weight:900;letter-spacing:-5px;line-height:1;color:#C0392B;margin-bottom:6px">34</div>
    <div style="font-size:15px;font-weight:800;color:#E87B6E;margin-bottom:10px">Needs Work</div>
    <div style="height:4px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden;margin-bottom:14px"><div style="width:34%;height:100%;background:#C0392B;border-radius:99px"></div></div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:rgba(192,57,43,.2);border:1px solid rgba(192,57,43,.4);color:#E87B6E">3 bias flags</span>
      <span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;background:rgba(0,128,76,.15);border:1px solid rgba(0,128,76,.3);color:#80C2A6">2 missing signals</span>
    </div>
  </div>
  <div class="right">
    <div style="background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.3);border-radius:8px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#E87B6E;margin-bottom:5px">Biased Language</div>
      <div style="font-size:12px;color:rgba(255,255,255,.6);line-height:1.5;font-style:italic">"rockstar who can hit the ground running"</div>
    </div>
    <div style="background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.3);border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#4DB87A;margin-bottom:5px">Suggested Rewrite</div>
      <div style="font-size:12px;color:#4DB87A;line-height:1.5">"Experienced engineer who ramps quickly and collaborates across teams"</div>
    </div>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 14px">
      <div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:5px">Missing Signal</div>
      <div style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.5">No salary range, accommodation statement, or remote policy</div>
    </div>
  </div>
</div>
<div class="scene" id="s3">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:16px">Audit Receipt · EEOC Documentation</div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #1A1814">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:30px;height:30px;background:#C8D832;border-radius:7px;display:flex;align-items:center;justify-content:center"><div style="width:12px;height:12px;background:#1A1814;border-radius:3px;transform:rotate(45deg)"></div></div>
        <div><div style="font-size:13px;font-weight:800;color:#1A1814">J/D Audit</div><div style="font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#00804C">EDI Platform</div></div>
      </div>
      <div style="text-align:right"><div style="font-size:8px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#9C9890">Audit Receipt</div><div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:#1A1814;margin-top:2px">JDA-20250316-K4F2</div></div>
    </div>
    <div style="display:flex;gap:20px;align-items:flex-start;margin-bottom:14px">
      <div><div style="font-size:8px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9C9890;margin-bottom:3px">Score</div><div style="font-size:36px;font-weight:900;letter-spacing:-2px;color:#C0392B;line-height:1">34</div></div>
      <div style="flex:1;padding-top:4px"><div style="font-size:13px;font-weight:800;color:#C0392B;margin-bottom:7px">Needs Work</div><div style="height:4px;background:#D5D8DC;border-radius:99px;overflow:hidden"><div style="width:34%;height:100%;background:#C0392B;border-radius:99px"></div></div></div>
    </div>
    <div style="font-size:11px;color:#6B6760;line-height:1.6;padding:9px 12px;background:#F8F9FA;border-left:3px solid #C8D832;border-radius:0 6px 6px 0;margin-bottom:14px">This JD contains exclusionary language and is missing key inclusive signals required for equitable candidate reach.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div style="border-bottom:1.5px solid #1A1814;padding-bottom:3px"><div style="font-size:11px;font-weight:600;color:#1A1814">Autumn Alaniz-Wiggins</div><div style="font-size:8px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9C9890;margin-top:3px">Reviewed by</div></div>
      <div style="border-bottom:1.5px solid #1A1814;padding-bottom:3px"><div style="font-size:11px;font-weight:600;color:#1A1814">Recruiting Coordinator</div><div style="font-size:8px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#9C9890;margin-top:3px">Title / Role</div></div>
    </div>
  </div>
  <div class="cap">Timestamped. Downloadable. EEOC-ready.</div>
</div>
<div class="scene" id="s4">
  <div class="col">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px">Generate Questions</div>
    <div style="font-size:20px;font-weight:900;letter-spacing:-.6px;color:white;margin-bottom:16px">Structured kit,<br>built in seconds.</div>
    <div style="display:flex;align-items:center;gap:10px;padding:9px 13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:7px"><div style="width:20px;height:20px;border-radius:5px;background:rgba(200,216,50,.2);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#C8D832">1</div><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.65)">Recruiter Screen</span></div><div style="display:flex;align-items:center;gap:10px;padding:9px 13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:7px"><div style="width:20px;height:20px;border-radius:5px;background:rgba(92,61,153,.3);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#C8B4F8">2</div><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.65)">Behavioral Interview</span></div><div style="display:flex;align-items:center;gap:10px;padding:9px 13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:7px"><div style="width:20px;height:20px;border-radius:5px;background:rgba(45,134,83,.2);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#4DB87A">3</div><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.65)">Technical Assessment</span></div>
    <div style="margin-top:12px;display:flex;gap:5px;flex-wrap:wrap"><span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.3);color:#4DB87A;margin:2px">Cross-cultural</span><span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.3);color:#4DB87A;margin:2px">Equity aware</span><span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.3);color:#4DB87A;margin:2px">Anti-bias</span><span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.3);color:#4DB87A;margin:2px">Psych safety</span></div>
  </div>
  <div class="col">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:12px">PINs Generated Instantly</div>
    <div class="pin-box"><div class="pin-lbl">Submit PIN &middot; Share with interviewers</div><div class="pin-val">4829</div></div>
    <div class="vpin-box" style="margin-bottom:14px"><div class="pin-lbl">View PIN &middot; Coordinator only</div><div class="vpin-val">7341</div></div>
    <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:6px;margin-bottom:5px"><div style="width:20px;height:20px;border-radius:50%;background:#3D2B6B;border:1px solid #7C5CBF;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#E8D5FF">1</div><span style="font-size:11px;color:rgba(255,255,255,.35);flex:1">Interviewer 1</span><span style="font-family:monospace;font-size:11px;font-weight:700;letter-spacing:3px;color:#E8D5FF;background:#3D2B6B;padding:2px 8px;border-radius:4px">4829</span></div><div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:6px;margin-bottom:5px"><div style="width:20px;height:20px;border-radius:50%;background:#3D2B6B;border:1px solid #7C5CBF;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#E8D5FF">2</div><span style="font-size:11px;color:rgba(255,255,255,.35);flex:1">Interviewer 2</span><span style="font-family:monospace;font-size:11px;font-weight:700;letter-spacing:3px;color:#E8D5FF;background:#3D2B6B;padding:2px 8px;border-radius:4px">4829</span></div><div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:6px;margin-bottom:5px"><div style="width:20px;height:20px;border-radius:50%;background:#3D2B6B;border:1px solid #7C5CBF;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#E8D5FF">3</div><span style="font-size:11px;color:rgba(255,255,255,.35);flex:1">Interviewer 3</span><span style="font-family:monospace;font-size:11px;font-weight:700;letter-spacing:3px;color:#E8D5FF;background:#3D2B6B;padding:2px 8px;border-radius:4px">4829</span></div>
  </div>
</div>
<div class="scene" id="s5">
  <div class="blind-badge"><div style="width:8px;height:8px;border-radius:50%;background:#C8D832"></div><span style="font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#C8D832">Blind Scoring Active</span></div>
  <div style="font-size:26px;font-weight:900;letter-spacing:-.7px;color:white;margin-bottom:8px">Panels score before they talk.</div>
  <div style="font-size:13px;color:rgba(255,255,255,.4);margin-bottom:12px">Each interviewer submits independently. No anchoring. No groupthink.</div>
  <div style="display:flex;gap:7px;flex-wrap:wrap;justify-content:center;margin-bottom:4px"><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.35);color:#E87B6E">1 Weak</span><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(180,83,9,.15);border:1px solid rgba(180,83,9,.35);color:#F59E0B">2 Lean Weak</span><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(61,58,53,.3);border:1px solid rgba(61,58,53,.5);color:#9C9890">3 Neutral</span><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(107,122,10,.15);border:1px solid rgba(107,122,10,.35);color:#BDD232">4 Lean Strong</span><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(45,134,83,.15);border:1px solid rgba(45,134,83,.35);color:#4DB87A">5 Strong</span></div>
  <div class="scorers"><div class="scorer"><div class="sc-name">Jordan R.</div><div class="sc-chips"><div class="chip" style="background:rgba(192,57,43,.25);color:#BDD232">4</div><div class="chip" style="background:rgba(180,83,9,.2);color:#9C9890">3</div><div class="chip" style="background:rgba(61,58,53,.4);color:#BDD232">4</div><div class="chip" style="background:rgba(107,122,10,.2);color:#4DB87A">5</div></div></div><div class="scorer"><div class="sc-name">Sam K.</div><div class="sc-chips"><div class="chip" style="background:rgba(192,57,43,.25);color:#9C9890">3</div><div class="chip" style="background:rgba(180,83,9,.2);color:#F59E0B">2</div><div class="chip" style="background:rgba(61,58,53,.4);color:#9C9890">3</div><div class="chip" style="background:rgba(107,122,10,.2);color:#BDD232">4</div></div></div><div class="scorer"><div class="sc-name">Alex M.</div><div class="sc-chips"><div class="chip" style="background:rgba(192,57,43,.25);color:#4DB87A">5</div><div class="chip" style="background:rgba(180,83,9,.2);color:#BDD232">4</div><div class="chip" style="background:rgba(61,58,53,.4);color:#4DB87A">5</div><div class="chip" style="background:rgba(107,122,10,.2);color:#4DB87A">5</div></div></div><div class="scorer"><div class="sc-name">Morgan T.</div><div class="sc-chips"><div class="chip" style="background:rgba(192,57,43,.25);color:#BDD232">4</div><div class="chip" style="background:rgba(180,83,9,.2);color:#BDD232">4</div><div class="chip" style="background:rgba(61,58,53,.4);color:#9C9890">3</div><div class="chip" style="background:rgba(107,122,10,.2);color:#BDD232">4</div></div></div></div>
</div>
<div class="scene" id="s6">
  <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:14px">Live Score Board</div>
  <table class="board">
    <thead><tr><th>Interviewer</th><th>Cross-cultural</th><th>Equity aware</th><th>Anti-bias</th><th>Avg</th><th>Recommendation</th></tr></thead>
    <tbody>
      <tr><td>Jordan R.</td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232">4</span></td>
        <td><span class="avg-c" style="background:rgba(45,134,83,.15);color:#4DB87A">5</span><span class="split-f">split</span></td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232">4</span></td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232;font-weight:900">4.3</span></td>
        <td><span class="rec-c" style="background:rgba(107,122,10,.15);border:1px solid rgba(107,122,10,.35);color:#BDD232">Lean Candidate</span></td></tr>
      <tr><td>Sam K.</td>
        <td><span class="avg-c" style="background:rgba(61,58,53,.4);color:#9C9890">3</span></td>
        <td><span class="avg-c" style="background:rgba(192,57,43,.15);color:#E87B6E">2</span></td>
        <td><span class="avg-c" style="background:rgba(61,58,53,.4);color:#9C9890">3</span></td>
        <td><span class="avg-c" style="background:rgba(192,57,43,.15);color:#E87B6E;font-weight:900">2.7</span></td>
        <td><span class="rec-c" style="background:rgba(61,58,53,.3);border:1px solid rgba(61,58,53,.5);color:#9C9890">Neutral</span></td></tr>
      <tr><td>Alex M.</td>
        <td><span class="avg-c" style="background:rgba(45,134,83,.15);color:#4DB87A">5</span></td>
        <td><span class="avg-c" style="background:rgba(45,134,83,.15);color:#4DB87A">5</span></td>
        <td><span class="avg-c" style="background:rgba(45,134,83,.15);color:#4DB87A">5</span></td>
        <td><span class="avg-c" style="background:rgba(45,134,83,.15);color:#4DB87A;font-weight:900">5.0</span></td>
        <td><span class="rec-c" style="background:rgba(45,134,83,.2);border:1px solid rgba(45,134,83,.4);color:#4DB87A">Strong Candidate</span></td></tr>
      <tr style="background:rgba(255,255,255,.04);border-top:2px solid rgba(255,255,255,.1)">
        <td style="font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,.35)">Team Avg</td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232;font-weight:900">4.0</span></td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232;font-weight:900">4.0</span></td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232;font-weight:900">4.0</span></td>
        <td><span class="avg-c" style="background:rgba(107,122,10,.2);color:#BDD232;font-weight:900">4.0</span></td>
        <td></td></tr>
    </tbody>
  </table>
</div>
<div class="scene" id="s7">
  <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:18px">Everything exports. Nothing gets lost.</div>
  <div class="dl-card"><div class="dl-row"><div class="dl-icon" style="background:rgba(0,128,76,.2)">📋</div><div><div class="dl-name">Audit Receipt</div><div class="dl-sub">Score · flags · revised JD · reviewer sign-off</div></div></div><div class="dl-row"><div class="dl-icon" style="background:rgba(92,61,153,.2)">📁</div><div><div class="dl-name">Interview Kit</div><div class="dl-sub">Questions · PINs · interviewer list · do-not-ask</div></div></div><div class="dl-row"><div class="dl-icon" style="background:rgba(45,134,83,.2)">📊</div><div><div class="dl-name">Submitted Scorecards</div><div class="dl-sub">Full board · split flags · team averages</div></div></div><div class="dl-row"><div class="dl-icon" style="background:rgba(200,216,50,.15)">💾</div><div><div class="dl-name">Intake JSON</div><div class="dl-sub">Re-importable — return and edit any time</div></div></div></div>
  <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:18px;opacity:0;transition:all .5s .8s" id="dl-note">State persists across sessions. Clear any time.</div>
</div>
<div class="scene" id="s8">
  <div class="logo-wrap">
    <div class="gem"><div class="gem-i"></div></div>
    <div><div style="font-size:18px;font-weight:900;letter-spacing:-.5px;color:white">J/D Audit</div><div style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#00804C;margin-top:2px">EDI Platform</div></div>
  </div>
  <div class="tagline">"We value diversity"<br>is not a <em>hiring process.</em></div>
  <div class="s8cta">Run your first audit. It takes 30 seconds.</div>
  <div class="tool-chips"><span style="font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;background:#00804C22;border:1px solid #00804C55;color:#00804C">JD Audit</span><span style="font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;background:#5C3D9922;border:1px solid #5C3D9955;color:#5C3D99">Generate Questions</span><span style="font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;background:#2D865322;border:1px solid #2D865355;color:#2D8653">Scorecards</span><span style="font-size:11px;font-weight:700;padding:5px 14px;border-radius:20px;background:#6B7A0A22;border:1px solid #6B7A0A55;color:#6B7A0A">Debrief Guide</span></div>
</div>
<script>
const scenes = [
  {id:'s1',dur:5000},
  {id:'s2',dur:7000},
  {id:'s3',dur:6500},
  {id:'s4',dur:7500},
  {id:'s5',dur:7000},
  {id:'s6',dur:7000},
  {id:'s7',dur:7000},
  {id:'s8',dur:8000},
];
let cur = 0;
function show(i) {
  scenes.forEach((s,j) => {
    const el = document.getElementById(s.id);
    el.classList.toggle('on', j===i);
  });
  if(scenes[i].id==='s5'){
    document.querySelectorAll('.scorer').forEach((el,j) => {
      setTimeout(() => { el.style.opacity='1'; el.style.transform='translateY(0)'; el.style.transition='all .4s ease'; }, 300+j*120);
    });
  }
  if(scenes[i].id==='s7'){
    setTimeout(() => { const n=document.getElementById('dl-note'); if(n)n.style.opacity='1'; }, 800);
  }
}
show(0);
function next() {
  cur = (cur+1) % scenes.length;
  show(cur);
  setTimeout(next, scenes[cur].dur);
}
setTimeout(next, scenes[0].dur);
</script>
</body></html>`;
    setHtml(html);
  }, []);

  return (
    <div style={{ position:"relative", borderRadius:14, overflow:"hidden", border:"1px solid rgba(255,255,255,.08)", boxShadow:"0 24px 80px rgba(0,0,0,.5)" }}>
      <div style={{ position:"relative", paddingTop:"56.25%", background:"#1A1814" }}>
        {html ? (
          <iframe
            ref={iframeRef}
            srcDoc={html}
            style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:"none" }}
            title="J/D Audit — Feature Overview"
            sandbox="allow-scripts"
          />
        ) : (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ width:20, height:20, border:"2px solid rgba(255,255,255,.15)", borderTopColor:"#C8D832", borderRadius:"50%", animation:"spin .8s linear infinite" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── HOME PAGE ────────────────────────────────────────────────────
function HomePage({ onNavigate }) {
  const tools = [
    { key:"audit",      label:"JD Audit",           color:"#00804C", dot:"#00804C",
      desc:"Score any JD for inclusivity. Get bias flags, missing signals, and line-by-line rewrites in under 30 seconds." },
    { key:"generate",   label:"Generate Questions",  color:"#5C3D99", dot:"#5C3D99",
      desc:"AI-suggested skills, configurable rounds, and a complete structured question bank — EDI-reviewed throughout." },
    { key:"scorecards", label:"Scorecards",           color:"#2D8653", dot:"#2D8653",
      desc:"PIN-gated blind scoring. Panels submit independently before the debrief, eliminating anchoring at the source." },
    { key:"debrief",    label:"Debrief Guide",        color:"#6B7A0A", dot:"#C8D832",
      desc:"Seven-step facilitation agenda. Evidence only. Runs bias checks in real time as the panel deliberates." },
  ];

  const steps = [
    { shape:<ShapeStructure/>, num:"01", title:"Audit your JD", body:"Paste any job description. Get a 0–100 inclusivity score, bias flags with rewrites, and a check for missing equity signals like salary and accommodation language." },
    { shape:<ShapeConverge/>,  num:"02", title:"Build your kit",  body:"Enter the role title. AI suggests must-have and nice-to-have skills. Set round types and generate structured, competency-mapped questions." },
    { shape:<ShapeBlind/>,     num:"03", title:"Score blindly",  body:"Share a PIN with each interviewer. They score independently before any discussion — the single most effective way to prevent panel anchoring." },
    { shape:<ShapeProcess/>,   num:"04", title:"Debrief with evidence", body:"Run the structured agenda after scores are in. Surface outliers, align on hire/no-hire, and document the decision — all in one place." },
  ];

  return (
    <div style={{ background:"#F2F3F5", overflowY:"auto", minHeight:"100%" }}>

      {/* ── HERO ── */}
      <div style={{ background:"#1A1814", position:"relative", overflow:"hidden", padding:"72px 64px 64px" }}>
        {/* Abstract background shapes */}
        <svg style={{ position:"absolute", top:0, right:0, width:480, height:"100%", opacity:.06 }} viewBox="0 0 480 360" fill="none">
          <circle cx="380" cy="80" r="180" stroke="white" strokeWidth="1"/>
          <circle cx="420" cy="180" r="100" stroke="white" strokeWidth="1"/>
          <circle cx="300" cy="300" r="60" stroke="#00804C" strokeWidth="1.5" fill="#00804C" fillOpacity=".3"/>
          <line x1="0" y1="180" x2="480" y2="180" stroke="white" strokeWidth=".5" opacity=".4"/>
          <circle cx="120" cy="180" r="4" fill="white" opacity=".4"/>
          <circle cx="200" cy="180" r="4" fill="#00804C" opacity=".8"/>
          <circle cx="280" cy="180" r="4" fill="white" opacity=".4"/>
        </svg>

        {/* Logo lockup */}
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:40 }}>
          <div style={{ width:44, height:44, background:"#C8D832", borderRadius:11, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <div style={{ width:18, height:18, background:"#1A1814", borderRadius:4, transform:"rotate(45deg)" }} />
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:"white", letterSpacing:"0.5px", textTransform:"uppercase", lineHeight:1.1 }}>JD Audit</div>
            <div style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,.45)", letterSpacing:"1px", textTransform:"uppercase", marginTop:2 }}>Talent Acquisition · EDI Platform</div>
          </div>
        </div>

        <div style={{ position:"relative", zIndex:1, maxWidth:680 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:7, background:"rgba(0,128,76,.2)", border:"1px solid rgba(0,128,76,.4)", borderRadius:20, padding:"4px 14px", marginBottom:24 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#00804C" }} />
            <span style={{ fontSize:11, fontWeight:700, color:"#80C2A6", letterSpacing:"0.8px", textTransform:"uppercase" }}>AI-Powered · EDI-Reviewed · Open Access</span>
          </div>
          <h1 style={{ fontSize:52, fontWeight:800, letterSpacing:"-2px", lineHeight:1.05, color:"white", marginBottom:20 }}>
            Fair hiring starts<br />
            <span style={{ color:"#C8D832" }}>before the first conversation.</span>
          </h1>
          <p style={{ fontSize:16, color:"rgba(255,255,255,.6)", lineHeight:1.8, maxWidth:540, marginBottom:36 }}>
            A free, AI-powered toolkit for talent acquisition teams building equitable hiring processes — from job description to final debrief. Every step, audited.
          </p>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
            <button onClick={() => onNavigate("audit")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:700, background:"#C8D832", color:"#1A1814", border:"none", borderRadius:9, padding:"13px 26px", cursor:"pointer", transition:"all .15s" }}
              onMouseEnter={e=>e.target.style.background="#B8C82A"} onMouseLeave={e=>e.target.style.background="#C8D832"}>
              Start with JD Audit →
            </button>
            <button onClick={() => onNavigate("why")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:14, fontWeight:600, background:"transparent", color:"rgba(255,255,255,.7)", border:"1.5px solid rgba(255,255,255,.2)", borderRadius:9, padding:"13px 26px", cursor:"pointer", transition:"all .15s" }}
              onMouseEnter={e=>{e.target.style.borderColor="rgba(255,255,255,.5)";e.target.style.color="white"}} onMouseLeave={e=>{e.target.style.borderColor="rgba(255,255,255,.2)";e.target.style.color="rgba(255,255,255,.7)"}}>
              Why this exists
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display:"flex", gap:0, marginTop:56, borderTop:"1px solid rgba(255,255,255,.08)", paddingTop:32, flexWrap:"wrap" }}>
          {[["4","integrated tools"],["7","EDI competency dimensions"],["0–100","inclusivity score"],["Blind","panel scoring built in"]].map(([v,l], i) => (
            <div key={i} style={{ paddingRight:40, marginRight:40, borderRight: i < 3 ? "1px solid rgba(255,255,255,.08)" : "none" }}>
              <div style={{ fontSize:22, fontWeight:800, color:"#C8D832", letterSpacing:"-0.5px", lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginTop:4, fontWeight:500 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── VIDEO ── */}
      <div style={{ background:"#1A1814", padding:"0 64px 72px", position:"relative" }}>
        {/* Continuation of hero — no border, seamless */}
        <div style={{ borderTop:"1px solid rgba(255,255,255,.07)", paddingTop:56 }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:32, flexWrap:"wrap", gap:16 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"rgba(255,255,255,.3)", marginBottom:8 }}>See it in 40 seconds</div>
              <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.7px", color:"white", lineHeight:1.15, maxWidth:400 }}>
                From biased JD to<br/>
                <span style={{ color:"#C8D832" }}>structured, fair process.</span>
              </h2>
            </div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,.35)", lineHeight:1.7, maxWidth:260, textAlign:"right" }}>
              No voiceover. No feature callouts.<br/>Just the tool running.
            </div>
          </div>

          {/* Video iframe container */}
          <VideoEmbed />
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div style={{ padding:"60px 64px" }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:6 }}>How it works</div>
        <h2 style={{ fontSize:30, fontWeight:800, letterSpacing:"-0.8px", color:"#1A1814", marginBottom:44, lineHeight:1.15, maxWidth:460 }}>
          One workflow. Four checkpoints. Zero guesswork.
        </h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:1, background:"#D5D8DC", border:"1px solid #D5D8DC", borderRadius:16, overflow:"hidden" }}>
          {steps.map((step, i) => (
            <div key={step.num} style={{ background:"white", padding:"28px 24px", position:"relative" }}>
              <div style={{ marginBottom:16 }}>{step.shape}</div>
              <div style={{ fontSize:11, fontWeight:700, color:"#00804C", letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:6 }}>Step {step.num}</div>
              <div style={{ fontSize:15, fontWeight:800, color:"#1A1814", marginBottom:10, letterSpacing:"-0.2px", lineHeight:1.3 }}>{step.title}</div>
              <div style={{ fontSize:13, color:"#6B6760", lineHeight:1.75 }}>{step.body}</div>
              {i < steps.length - 1 && (
                <div style={{ position:"absolute", top:"50%", right:-12, transform:"translateY(-50%)", fontSize:14, color:"#D5D8DC", fontWeight:700, zIndex:2 }}>→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── TOOLS ── */}
      <div style={{ background:"#1A1814", padding:"64px 64px 72px", position:"relative", overflow:"hidden" }}>
        {/* Subtle bg texture */}
        <svg style={{ position:"absolute", bottom:0, left:0, width:"100%", height:"100%", opacity:.03, pointerEvents:"none" }} viewBox="0 0 900 400" fill="none" preserveAspectRatio="xMidYMid slice">
          <circle cx="100" cy="350" r="260" stroke="white" strokeWidth="1"/>
          <circle cx="800" cy="80" r="180" stroke="white" strokeWidth="1"/>
          <line x1="0" y1="200" x2="900" y2="200" stroke="white" strokeWidth=".5"/>
        </svg>

        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:48, flexWrap:"wrap", gap:16 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"rgba(255,255,255,.3)", marginBottom:10 }}>The toolkit</div>
              <h2 style={{ fontSize:34, fontWeight:800, letterSpacing:"-1px", color:"white", lineHeight:1.1, maxWidth:420 }}>
                Four tools. One process.<br/>
                <span style={{ color:"#C8D832" }}>Start anywhere.</span>
              </h2>
            </div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,.4)", lineHeight:1.7, maxWidth:280, textAlign:"right" }}>
              Each tool runs independently — or as a full end-to-end workflow. No setup. No account required.
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            {tools.map((t, i) => {
              const accentRgb = t.key==="audit" ? "0,128,76" : t.key==="generate" ? "92,61,153" : t.key==="scorecards" ? "45,134,83" : "200,216,50";
              const btnBg = t.key==="debrief" ? "#C8D832" : t.dot;
              const btnColor = t.key==="debrief" ? "#1A1814" : "white";
              const stepNum = ["01","02","03","04"][i];
              return (
                <div
                  key={t.key}
                  style={{
                    background:`rgba(${accentRgb},.08)`,
                    border:`1px solid rgba(${accentRgb},.22)`,
                    borderRadius:16,
                    padding:"28px 30px 24px",
                    cursor:"pointer",
                    transition:"all .2s",
                    position:"relative",
                    overflow:"hidden",
                  }}
                  onClick={() => onNavigate(t.key)}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = `rgba(${accentRgb},.16)`;
                    e.currentTarget.style.borderColor = `rgba(${accentRgb},.5)`;
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow = `0 12px 40px rgba(${accentRgb},.2)`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = `rgba(${accentRgb},.08)`;
                    e.currentTarget.style.borderColor = `rgba(${accentRgb},.22)`;
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow = "";
                  }}
                >
                  {/* Step number watermark */}
                  <div style={{ position:"absolute", top:16, right:20, fontSize:52, fontWeight:900, color:`rgba(${accentRgb},.08)`, letterSpacing:"-2px", lineHeight:1, userSelect:"none", pointerEvents:"none" }}>{stepNum}</div>

                  {/* Header */}
                  <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:14 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:t.dot, flexShrink:0, boxShadow:`0 0 8px ${t.dot}88` }} />
                    <div style={{ fontSize:16, fontWeight:800, color:"white", letterSpacing:"-0.3px" }}>{t.label}</div>
                  </div>

                  {/* Desc */}
                  <div style={{ fontSize:13, color:"rgba(255,255,255,.6)", lineHeight:1.75, marginBottom:22, minHeight:54 }}>{t.desc}</div>

                  {/* CTA */}
                  <button
                    onClick={e => { e.stopPropagation(); onNavigate(t.key); }}
                    style={{
                      fontFamily:"'Plus Jakarta Sans',sans-serif",
                      fontSize:13, fontWeight:700,
                      background: btnBg,
                      color: btnColor,
                      border:"none",
                      borderRadius:8,
                      padding:"10px 20px",
                      cursor:"pointer",
                      transition:"all .15s",
                      display:"inline-flex",
                      alignItems:"center",
                      gap:6,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity=".88"; e.currentTarget.style.transform="scale(1.03)"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity="1"; e.currentTarget.style.transform=""; }}
                  >
                    Open {t.label} <span style={{ fontSize:15 }}>→</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── FEATURE LIST ── */}
      <div style={{ background:"white", borderTop:"1px solid #D5D8DC", borderBottom:"1px solid #D5D8DC", padding:"56px 64px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:56 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:8 }}>What's included</div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.5px", color:"#1A1814", marginBottom:24, lineHeight:1.3, maxWidth:320 }}>
              Everything a lean TA team needs to run a fair process.
            </h2>
            <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
              {[
                "JD inclusivity score 0–100 with line-by-line rewrites",
                "AI-suggested must-have and nice-to-have skills by role",
                "Custom round types with type-specific question generation",
                "EDI-reviewed questions across 7 cultural competency dimensions",
                "Boolean string parsing for sourcing alignment",
                "PIN-gated blind scorecards, 4-point scale",
                "Split decision detection on the live score board",
                "Structured debrief agenda with per-step facilitator notes",
                "PDF and Word export structured for Greenhouse, Ashby, Lever",
                "Do Not Ask list auto-generated per role",
              ].map(item => (
                <div key={item} style={{ display:"flex", alignItems:"flex-start", gap:10, fontSize:13, color:"#3D3A35", lineHeight:1.6 }}>
                  <div style={{ width:18, height:18, borderRadius:"50%", background:"#E6F4ED", border:"1px solid #A8D5BC", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                    <span style={{ color:"#00804C", fontSize:10, fontWeight:800 }}>✓</span>
                  </div>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:8 }}>Where bias enters</div>
            <h2 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.5px", color:"#1A1814", marginBottom:24, lineHeight:1.3, maxWidth:340 }}>
              Most hiring bias enters through process gaps, not bad intent.
            </h2>
            <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
              {[
                { icon:<ShapeStructure/>, heading:"Biased JDs filter out qualified candidates before they apply.", body:"Gender-coded language, inflated degree requirements, and missing accommodation statements reduce your applicant pool before the first screen." },
                { icon:<ShapeConverge/>,  heading:"Unstructured interviews produce inconsistent signals.", body:"Without consistent questions per competency, panel feedback reflects who interviewed who — not who is best for the role." },
                { icon:<ShapeBlind/>,     heading:"Debrief without structure amplifies the loudest voice.", body:"When panels discuss before scoring independently, the first opinion anchors the room. Blind scoring closes this gap." },
              ].map(item => (
                <div key={item.heading} style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
                  <div style={{ flexShrink:0, marginTop:-4 }}>{item.icon}</div>
                  <div style={{ paddingLeft:4, borderLeft:"2px solid #E8EAED" }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#1A1814", marginBottom:4 }}>{item.heading}</div>
                    <div style={{ fontSize:13, color:"#6B6760", lineHeight:1.7 }}>{item.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{ background:"#1A1814", padding:"48px 64px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:"white", letterSpacing:"-0.4px", marginBottom:5 }}>Ready to build a fairer process?</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,.45)" }}>Start with your next JD or dive straight into question generation.</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => onNavigate("audit")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, fontWeight:700, background:"#C8D832", color:"#1A1814", border:"none", borderRadius:8, padding:"11px 22px", cursor:"pointer" }}>Audit a JD →</button>
          <button onClick={() => onNavigate("generate")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, fontWeight:600, background:"transparent", color:"rgba(255,255,255,.7)", border:"1.5px solid rgba(255,255,255,.2)", borderRadius:8, padding:"11px 22px", cursor:"pointer" }}>Generate Kit</button>
        </div>
      </div>

    </div>
  );
}

// ── WHY THIS EXISTS PAGE ─────────────────────────────────────────
function WhyPage({ onNavigate }) {
  return (
    <div style={{ background:"#F2F3F5", overflowY:"auto", minHeight:"100%" }}>

      {/* Header */}
      <div style={{ background:"white", borderBottom:"1px solid #D5D8DC", padding:"52px 64px 48px", position:"relative", overflow:"hidden" }}>
        <svg style={{ position:"absolute", right:0, top:0, opacity:.04 }} width="400" height="280" viewBox="0 0 400 280" fill="none">
          <circle cx="320" cy="140" r="200" stroke="#1A1814" strokeWidth="1.5"/>
          <circle cx="320" cy="140" r="120" stroke="#1A1814" strokeWidth="1"/>
          <circle cx="320" cy="140" r="50" fill="#00804C" opacity=".6"/>
        </svg>
        <div style={{ position:"relative", zIndex:1, maxWidth:620 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:7, background:"#E6F5EF", border:"1px solid #80C2A6", borderRadius:20, padding:"4px 14px", marginBottom:20 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:"#00804C" }} />
            <span style={{ fontSize:11, fontWeight:700, color:"#00804C", letterSpacing:"0.8px", textTransform:"uppercase" }}>The Gap We're Closing</span>
          </div>
          <h1 style={{ fontSize:40, fontWeight:800, letterSpacing:"-1.2px", lineHeight:1.1, color:"#1A1814", marginBottom:16 }}>
            AI is moving fast.<br />
            <span style={{ color:"#00804C" }}>EDI hasn't caught up yet.</span>
          </h1>
          <p style={{ fontSize:16, color:"#6B6760", lineHeight:1.8, maxWidth:520 }}>
            Recruiting teams are adopting AI tools at an unprecedented rate — but most of those tools optimize for speed, not equity. JD Audit exists to close that gap.
          </p>
        </div>
      </div>

      {/* The problem section */}
      <div style={{ padding:"56px 64px" }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:6 }}>The market gap</div>
        <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.7px", color:"#1A1814", marginBottom:40, lineHeight:1.2, maxWidth:520 }}>
          Three problems that have existed for decades — and are getting worse with AI.
        </h2>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:48 }}>
          {[
            { shape:<ShapeStructure/>, num:"01", title:"JDs are written without accountability.", body:"Most job descriptions are copy-pasted, filled with jargon, and unchecked for bias. AI writing assistants make this faster — not more equitable. The language that excludes qualified candidates gets generated at scale.", accent:"#00804C" },
            { shape:<ShapeConverge/>,  num:"02", title:"Interviews are structured in theory, chaotic in practice.", body:"Hiring teams know structured interviews produce better results. But building a consistent, competency-mapped question bank for each role takes hours. So it doesn't happen — and the process defaults to conversation.", accent:"#00804C" },
            { shape:<ShapeBlind/>,     num:"03", title:"Debrief bias is invisible until it's a lawsuit.", body:"Anchoring, halo effects, affinity bias — they all peak in the debrief room. No existing ATS or interview tool addresses what happens after scores are submitted. Most teams have no process at all.", accent:"#00804C" },
          ].map(item => (
            <div key={item.num} style={{ background:"white", border:"1px solid #D5D8DC", borderRadius:14, padding:"28px 26px" }}>
              <div style={{ marginBottom:16 }}>{item.shape}</div>
              <div style={{ fontSize:10, fontWeight:700, color:item.accent, letterSpacing:"0.8px", textTransform:"uppercase", marginBottom:8 }}>Problem {item.num}</div>
              <div style={{ fontSize:14, fontWeight:800, color:"#1A1814", marginBottom:10, lineHeight:1.35, letterSpacing:"-0.2px" }}>{item.title}</div>
              <div style={{ fontSize:13, color:"#6B6760", lineHeight:1.75 }}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* The AI + EDI tension */}
      <div style={{ background:"#1A1814", borderTop:"1px solid #2C2926", borderBottom:"1px solid #2C2926", padding:"56px 64px", position:"relative", overflow:"hidden" }}>
        {/* Abstract background shapes matching homepage hero */}
        <svg style={{ position:"absolute", top:0, right:0, width:440, height:"100%", opacity:.05, pointerEvents:"none" }} viewBox="0 0 440 400" fill="none">
          <circle cx="360" cy="100" r="200" stroke="white" strokeWidth="1"/>
          <circle cx="400" cy="200" r="110" stroke="white" strokeWidth="1"/>
          <circle cx="280" cy="340" r="70" stroke="#00804C" strokeWidth="1.5" fill="#00804C" fillOpacity=".3"/>
          <line x1="0" y1="200" x2="440" y2="200" stroke="white" strokeWidth=".5" opacity=".4"/>
          <circle cx="100" cy="200" r="4" fill="white" opacity=".4"/>
          <circle cx="200" cy="200" r="4" fill="#00804C" opacity=".8"/>
          <circle cx="300" cy="200" r="4" fill="white" opacity=".4"/>
        </svg>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:64, alignItems:"start", position:"relative", zIndex:1 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"rgba(255,255,255,.35)", marginBottom:8 }}>The tension</div>
            <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.7px", color:"white", marginBottom:20, lineHeight:1.2 }}>
              AI is being adopted in TA faster than EDI frameworks can adapt.
            </h2>
            <p style={{ fontSize:14, color:"rgba(255,255,255,.55)", lineHeight:1.8, marginBottom:20 }}>
              Tools like ChatGPT, Gemini, and dedicated ATS copilots are now standard equipment in most recruiting teams. They write JDs, screen resumes, and suggest interview questions — in seconds.
            </p>
            <p style={{ fontSize:14, color:"rgba(255,255,255,.55)", lineHeight:1.8, marginBottom:20 }}>
              But these tools are trained on historical data that reflects historical bias. Without an equity layer, AI-assisted hiring doesn't reduce unfairness — it systematizes it.
            </p>
            <p style={{ fontSize:14, color:"rgba(255,255,255,.55)", lineHeight:1.8 }}>
              Most HR teams are 12–24 months behind in understanding how to audit AI-generated content for EDI compliance. JD Audit was built to be that audit layer — accessible, fast, and free.
            </p>
          </div>
          <div>
            {/* Visual tension diagram — dark */}
            <div style={{ background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:14, padding:"28px", marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,.35)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:20 }}>The adoption gap</div>
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {[
                  { label:"AI tool adoption in TA", pct:82, color:"#C8D832" },
                  { label:"EDI auditing in place", pct:23, color:"#4DB87A" },
                  { label:"Structured interview compliance", pct:34, color:"#9B78E8" },
                  { label:"Debrief process documented", pct:18, color:"#6B7A0A" },
                ].map(row => (
                  <div key={row.label}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:12, color:"rgba(255,255,255,.6)", fontWeight:600 }}>{row.label}</span>
                      <span style={{ fontSize:12, color:row.color, fontWeight:800 }}>{row.pct}%</span>
                    </div>
                    <div style={{ height:6, background:"rgba(255,255,255,.08)", borderRadius:99, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${row.pct}%`, background:row.color, borderRadius:99, opacity:.85 }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,.2)", marginTop:16, fontStyle:"italic", lineHeight:1.6 }}>
                Industry estimates, 2024–2025. Sourced from SHRM, Lighthouse Research, and LinkedIn Talent Insights.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* What this tool is — and isn't */}
      <div style={{ padding:"56px 64px" }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:6 }}>Scope & intent</div>
        <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.7px", color:"#1A1814", marginBottom:40, lineHeight:1.2, maxWidth:460 }}>
          What JD Audit is — and what it deliberately is not.
        </h2>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ background:"white", border:"1px solid #A8D5BC", borderRadius:14, padding:"28px" }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#00804C", letterSpacing:"0.5px", textTransform:"uppercase", marginBottom:16 }}>It is</div>
            {[
              "An equity audit layer for AI-generated and human-written JDs",
              "A structured interview kit generator with EDI compliance built in",
              "A blind scoring system that removes pre-debrief contamination",
              "A facilitation tool, not just a data tool — it guides human judgment",
              "Free and open access — equity infrastructure shouldn't have a paywall",
            ].map(item => (
              <div key={item} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10, fontSize:13, color:"#3D3A35", lineHeight:1.6 }}>
                <div style={{ width:16, height:16, borderRadius:"50%", background:"#E6F4ED", border:"1px solid #A8D5BC", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
                  <span style={{ color:"#00804C", fontSize:9, fontWeight:900 }}>✓</span>
                </div>
                {item}
              </div>
            ))}
          </div>
          <div style={{ background:"white", border:"1px solid #D5D8DC", borderRadius:14, padding:"28px" }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#6B6760", letterSpacing:"0.5px", textTransform:"uppercase", marginBottom:16 }}>It is not</div>
            {[
              "A replacement for legal compliance review or HR counsel",
              "An automated hiring decision system — humans decide, always",
              "A diversity quota tracker or demographic reporting tool",
              "A background screening or candidate assessment product",
              "A guarantee of equitable outcomes — only equitable process",
            ].map(item => (
              <div key={item} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10, fontSize:13, color:"#6B6760", lineHeight:1.6 }}>
                <div style={{ width:16, height:16, borderRadius:"50%", background:"#F2F3F5", border:"1px solid #D5D8DC", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
                  <span style={{ color:"#9C9890", fontSize:11, fontWeight:700 }}>–</span>
                </div>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Built for whom */}
      <div style={{ background:"white", borderTop:"1px solid #D5D8DC", padding:"52px 64px" }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"1.2px", textTransform:"uppercase", color:"#9C9890", marginBottom:6 }}>Who it's for</div>
        <h2 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.7px", color:"#1A1814", marginBottom:36, lineHeight:1.2 }}>
          Built for the recruiter managing the whole process, not the executive approving it.
        </h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {[
            { shape:<ShapeProcess/>, role:"Recruiting Coordinators & TA Associates", body:"Coordinating interviews and managing the process — but with no tool to enforce structured, equitable practice across the panel. JD Audit gives you the infrastructure to run a professional process without escalating to leadership for every decision." },
            { shape:<ShapeConverge/>, role:"HR Generalists & People Ops", body:"Responsible for hiring without a dedicated TA team. Building processes from scratch, often without EDI expertise or legal review. JD Audit is the starting framework — not the endpoint." },
            { shape:<ShapeBlind/>, role:"Senior Recruiters & Talent Leads", body:"Running multiple requisitions, under pressure to fill fast. Structured process is the first thing that slips when volume goes up. JD Audit makes equity the default, not the extra step." },
          ].map(p => (
            <div key={p.role} style={{ border:"1px solid #D5D8DC", borderRadius:14, padding:"26px 24px", background:"#F2F3F5" }}>
              <div style={{ marginBottom:14 }}>{p.shape}</div>
              <div style={{ fontSize:13, fontWeight:800, color:"#1A1814", marginBottom:8, lineHeight:1.35 }}>{p.role}</div>
              <div style={{ fontSize:13, color:"#6B6760", lineHeight:1.75 }}>{p.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ background:"#1A1814", padding:"44px 64px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:20 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:"white", letterSpacing:"-0.3px", marginBottom:4 }}>The gap is real. The fix is here.</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,.4)" }}>Start with any tool — the workflow is yours to run at your own pace.</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={() => onNavigate("home")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, fontWeight:600, background:"transparent", color:"rgba(255,255,255,.6)", border:"1.5px solid rgba(255,255,255,.15)", borderRadius:8, padding:"10px 20px", cursor:"pointer" }}>← Back to Home</button>
          <button onClick={() => onNavigate("audit")} style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:13, fontWeight:700, background:"#C8D832", color:"#1A1814", border:"none", borderRadius:8, padding:"10px 22px", cursor:"pointer" }}>Start Auditing →</button>
        </div>
      </div>

    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [kits, setKits] = useState([]);
  const [cards, setCards] = useState([]);
  const addKit = useCallback(kit => setKits(p=>[...p,kit]), []);
  const addCard = useCallback(card => setCards(p=>[...p,card]), []);
  const scrollRef = useRef(null);

  const navigate = useCallback((newTab) => {
    setTab(newTab);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  // Also scroll to top whenever tab changes (catches sidebar clicks)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  return (
    <AppCtx.Provider value={{ kits, cards, addKit, addCard }}>
      <style>{S}</style>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="brand-gem"><div className="brand-gem-inner" /></div>
            <div><div className="brand-name">JD Audit</div><div className="brand-tag">EDI Platform</div></div>
          </div>
          <nav className="nav">
            <div className="nav-section-label" style={{ marginBottom:6 }}>Pages</div>
            {NAV_ITEMS.slice(0,2).map(item => {
              const cfg = TAB_COLORS[item.key] || { bg:"#F2F3F5", active:"#1A1814", border:"#D5D8DC" };
              const isOn = tab === item.key;
              return (
                <button key={item.key} className={`nav-item${isOn?" active":""}`} onClick={() => navigate(item.key)}
                  style={{ background: isOn ? cfg.bg : "transparent", border: `1.5px solid ${isOn ? cfg.border : "transparent"}` }}>
                  <div className="nav-item-bar" style={{ background: isOn ? cfg.active : "transparent" }} />
                  <div className="nav-item-content">
                    <div>
                      <div className="nav-item-label" style={{ color: isOn ? cfg.active : "var(--ink3)" }}>{item.label}</div>
                      <div className="nav-item-sub" style={{ color: isOn ? cfg.active : "var(--ink4)" }}>{item.sub}</div>
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="nav-section-label" style={{ marginTop:16, marginBottom:6 }}>Tools</div>
            {NAV_ITEMS.slice(2).map(item => {
              const cfg = TAB_COLORS[item.key] || { bg:"#F2F3F5", active:"#1A1814", border:"#D5D8DC" };
              const isOn = tab === item.key;
              return (
                <button key={item.key} className={`nav-item${isOn?" active":""}`} onClick={() => navigate(item.key)}
                  style={{ background: isOn ? cfg.bg : "transparent", border: `1.5px solid ${isOn ? cfg.border : "transparent"}` }}>
                  <div className="nav-item-bar" style={{ background: isOn ? cfg.active : "transparent" }} />
                  <div className="nav-item-content">
                    <div>
                      <div className="nav-item-label" style={{ color: isOn ? cfg.active : "var(--ink3)" }}>{item.label}</div>
                      <div className="nav-item-sub" style={{ color: isOn ? cfg.active : "var(--ink4)" }}>{item.sub}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>

        </aside>

        <div className="main">
          <div className="main-scroll" ref={scrollRef}>
            {tab==="home"       && <HomePage onNavigate={navigate} />}
            {tab==="why"        && <WhyPage onNavigate={navigate} />}
            {tab==="audit"      && <AuditTab />}
            {tab==="generate"   && <GenerateTab onKitSaved={() => navigate("scorecards")} />}
            {tab==="scorecards" && <ScorecardsTab />}
            {tab==="debrief"    && <DebriefTab />}
          </div>
        </div>
      </div>
    </AppCtx.Provider>
  );
}
