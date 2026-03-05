import { useState } from "react";

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: #F5F2EB;
    color: #1A1A1A;
  }

  :root {
    --ink: #1A1A1A;
    --paper: #F5F2EB;
    --cream: #EDE9DF;
    --red: #C0392B;
    --amber: #D4811A;
    --green: #2A7A4F;
    --muted: #7A7468;
    --border: #D4CFC5;
    --accent: #2C5F8A;
  }

  .app {
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .header {
    border-bottom: 2px solid var(--ink);
    padding: 20px 40px;
    display: flex;
    align-items: baseline;
    gap: 16px;
    background: var(--paper);
  }

  .header-title {
    font-family: 'Playfair Display', serif;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }

  .header-tag {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    background: var(--ink);
    color: var(--paper);
    padding: 3px 8px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: calc(100vh - 65px);
  }

  .panel-left {
    padding: 36px 40px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .panel-right {
    padding: 36px 40px;
    background: white;
    overflow-y: auto;
  }

  .panel-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }

  textarea {
    width: 100%;
    flex: 1;
    min-height: 380px;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    line-height: 1.7;
    border: 1px solid var(--border);
    background: white;
    padding: 18px;
    resize: none;
    outline: none;
    color: var(--ink);
    transition: border-color 0.2s;
  }

  textarea:focus { border-color: var(--ink); }
  textarea::placeholder { color: #B5B0A8; }

  .audit-btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.5px;
    background: var(--ink);
    color: var(--paper);
    border: none;
    padding: 14px 28px;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;
    align-self: flex-start;
  }

  .audit-btn:hover { background: #333; }
  .audit-btn:active { transform: scale(0.98); }
  .audit-btn:disabled { background: var(--muted); cursor: not-allowed; }

  .loading {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--muted);
    font-size: 14px;
    padding: 40px 0;
  }

  .spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--ink);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .score-block {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 28px;
  }

  .score-number {
    font-family: 'Playfair Display', serif;
    font-size: 72px;
    font-weight: 700;
    line-height: 1;
  }

  .score-number.high { color: var(--green); }
  .score-number.mid { color: var(--amber); }
  .score-number.low { color: var(--red); }

  .score-meta { padding-bottom: 8px; }
  .score-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 4px;
  }

  .score-verdict {
    font-size: 18px;
    font-weight: 600;
  }

  .score-verdict.high { color: var(--green); }
  .score-verdict.mid { color: var(--amber); }
  .score-verdict.low { color: var(--red); }

  .category-pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 28px;
  }

  .pill {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 0;
    letter-spacing: 0.5px;
  }

  .pill.bias { background: #FDECEA; color: var(--red); border: 1px solid #F5C6C2; }
  .pill.missing { background: #FFF3E0; color: var(--amber); border: 1px solid #FFD9A0; }
  .pill.inflated { background: #E8F4F0; color: #1A6B4A; border: 1px solid #A8D9C5; }
  .pill.ok { background: #E8F4F0; color: var(--green); border: 1px solid #A8D9C5; }

  .section-title {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 14px;
  }

  .flags-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 32px;
  }

  .flag-card {
    border-left: 3px solid;
    padding: 14px 16px;
    background: #FAFAF8;
  }

  .flag-card.bias { border-color: var(--red); }
  .flag-card.missing { border-color: var(--amber); }
  .flag-card.inflated { border-color: var(--green); }

  .flag-type {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }

  .flag-original {
    font-size: 13px;
    font-style: italic;
    color: var(--red);
    margin-bottom: 8px;
    padding: 6px 10px;
    background: #FDF5F5;
    border: 1px solid #F5C6C2;
    font-family: 'DM Mono', monospace;
  }

  .flag-issue {
    font-size: 13px;
    color: var(--ink);
    margin-bottom: 10px;
    line-height: 1.5;
  }

  .flag-rewrite-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--green);
    margin-bottom: 4px;
  }

  .flag-rewrite {
    font-size: 13px;
    color: var(--green);
    padding: 6px 10px;
    background: #F0FAF5;
    border: 1px solid #A8D9C5;
    font-family: 'DM Mono', monospace;
    line-height: 1.5;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    height: 100%;
    gap: 12px;
    padding: 40px 0;
  }

  .empty-headline {
    font-family: 'Playfair Display', serif;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--ink);
    max-width: 320px;
  }

  .empty-sub {
    font-size: 14px;
    color: var(--muted);
    line-height: 1.6;
    max-width: 340px;
  }

  .checklist {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .checklist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }

  .check-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--border);
    flex-shrink: 0;
  }

  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 24px 0;
  }

  .overall-notes {
    font-size: 14px;
    line-height: 1.7;
    color: #3A3A3A;
    white-space: pre-wrap;
  }

  .dual-scores {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: 28px;
  }

  .score-cell {
    background: white;
    padding: 20px;
  }

  .score-cell-label {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
    display: block;
  }

  .score-cell-number {
    font-family: 'Playfair Display', serif;
    font-size: 52px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 4px;
  }

  .score-cell-verdict {
    font-size: 13px;
    font-weight: 600;
  }

  .ai-meter {
    margin-top: 10px;
    height: 4px;
    background: var(--border);
    width: 100%;
  }

  .ai-meter-fill {
    height: 100%;
    transition: width 1s ease;
  }

  .ai-signals {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ai-signal-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  .ai-signal-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    margin-top: 5px;
    flex-shrink: 0;
  }

  .ai-signal-dot.detected { background: #8B5CF6; }
  .ai-signal-dot.clear { background: var(--border); }

  .pill.ai-high { background: #F3EEFF; color: #6D28D9; border: 1px solid #C4B5FD; }
  .pill.ai-mid { background: #EEF2FF; color: #4338CA; border: 1px solid #A5B4FC; }
  .pill.ai-low { background: #F0FAF5; color: var(--green); border: 1px solid #A8D9C5; }

  .disclaimer {
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
    margin-top: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: var(--paper);
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .main { grid-template-columns: 1fr; }
    .panel-left, .panel-right { padding: 24px 20px; }
    .header { padding: 16px 20px; }
  }
`;

const SAMPLE_JD = `Software Engineering Manager

We're looking for a rockstar engineering manager who can hit the ground running. The ideal candidate is a young, energetic leader with 10+ years of experience managing ninja developers.

Requirements:
- Must be a native English speaker
- Bachelor's degree required (MBA preferred)
- 10+ years managing high-performing teams
- Must be able to handle high-pressure environments without complaining
- Strong culture fit with our fast-paced bro culture
- Candidates must be able to work nights and weekends as needed

Responsibilities:
- Lead a team of engineers to crush quarterly goals
- Own the full technical roadmap
- Be the go-to guy for all engineering decisions`;

export default function JDAuditTool() {
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runAudit = async () => {
    if (!jdText.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);

    const inclusivityPrompt = `You are an expert in inclusive hiring practices, DEI language, and accessible job description writing. Audit the following job description for three categories of issues:

1. BIAS - Exclusionary or biased language (gender-coded words like "rockstar/ninja/guru", age bias, race/culture coded phrases, ableist language)
2. MISSING - Missing inclusive signals (no salary range, no accommodation statement, no remote/flex policy noted, no EEO statement)
3. INFLATED - Unrealistic or inflated requirements (degree requirements that aren't needed, excessive years of experience, "unicorn" specs, lifestyle requirements)

Return ONLY a JSON object with this exact shape:
{
  "score": <integer 0-100>,
  "verdict": "<one of: Needs Work | Developing | Inclusive>",
  "summary": "<2-3 sentence overall assessment>",
  "flags": [
    {
      "type": "<bias | missing | inflated>",
      "original": "<the exact phrase or element from the JD, or 'Not present' for missing items>",
      "issue": "<clear explanation of why this is a problem, 1-2 sentences>",
      "rewrite": "<a specific, improved version or suggested addition>"
    }
  ]
}

Score rubric: 0-49 = Needs Work, 50-74 = Developing, 75-100 = Inclusive.
Identify all meaningful issues. Be specific and actionable. Return only valid JSON.

JOB DESCRIPTION:
${jdText}`;

    const aiDetectPrompt = `You are an expert in identifying AI-generated professional writing. Analyze this job description and determine the likelihood it was written or heavily edited by an AI tool (like ChatGPT, Claude, Copilot, etc.).

Look for these AI writing signals:
- Overly structured bullet formatting with parallel phrasing
- Generic, interchangeable corporate language with no company voice
- Boilerplate phrases like "fast-paced environment", "cross-functional collaboration", "we are an equal opportunity employer" used without specificity
- Unnaturally comprehensive coverage of every possible requirement
- Lack of personality, specific cultural detail, or authentic human tone
- Suspiciously balanced and sanitized language
- Cookie-cutter responsibility lists that could apply to any company

Also note signals of human authorship:
- Specific cultural references, team names, or internal terminology
- Uneven or idiosyncratic phrasing
- Opinionated or conversational voice
- Specific and unusual requirements that reflect real team needs

Return ONLY a JSON object:
{
  "ai_score": <integer 0-100, where 100 = almost certainly AI-written>,
  "ai_verdict": "<one of: Likely Human | Possibly AI-Assisted | Likely AI-Generated>",
  "ai_summary": "<2 sentences explaining the assessment>",
  "ai_signals": [
    { "detected": <true|false>, "signal": "<short description of what was found or not found>" }
  ]
}

Return 3-5 signals. Return only valid JSON.

JOB DESCRIPTION:
${jdText}`;

    try {
      const callAPI = async (prompt) => {
        const r = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 1500,
            messages: [{ role: "user", content: prompt }]
          })
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error.message);
        const raw = data.content.map(b => b.text || "").join("");
        const clean = raw.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m =>
          m.replace(/```json\n?|```\n?/g, "")
        ).trim();
        return JSON.parse(clean);
      };

      const [inclusivity, aiDetect] = await Promise.all([
        callAPI(inclusivityPrompt),
        callAPI(aiDetectPrompt)
      ]);

      setResult({ ...inclusivity, ...aiDetect });
    } catch (e) {
      setError(`Audit failed: ${e.message || "Unknown error. Please try again."}`);
    } finally {
      setLoading(false);
    }
  };

  const scoreClass = result
    ? result.score >= 75 ? "high" : result.score >= 50 ? "mid" : "low"
    : "";

  const countByType = (type) => result?.flags?.filter(f => f.type === type).length || 0;

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <header className="header">
          <span className="header-title">JD Audit</span>
          <span className="header-tag">Inclusive Language Tool</span>
        </header>

        <div className="main">
          <div className="panel-left">
            <div>
              <div className="panel-label">Paste Job Description</div>
              <textarea
                value={jdText}
                onChange={e => setJdText(e.target.value)}
                placeholder="Paste your job description here to audit it for biased language, missing inclusive signals, and inflated requirements..."
              />
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="audit-btn" onClick={runAudit} disabled={loading || !jdText.trim()}>
                {loading ? "Auditing..." : "Run Audit →"}
              </button>
              <button
                className="audit-btn"
                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
                onClick={() => setJdText(SAMPLE_JD)}
                disabled={loading}
              >
                Load sample JD
              </button>
            </div>
          </div>

          <div className="panel-right">
            {!result && !loading && (
              <div className="empty-state">
                <div className="empty-headline">Write JDs that invite everyone in.</div>
                <div className="empty-sub">
                  Paste any job description to get an inclusivity score and line-by-line flags with suggested rewrites.
                </div>
                <div className="checklist">
                  {[
                    "Biased & exclusionary language",
                    "Missing salary, flexibility & accommodation info",
                    "Inflated or unnecessary requirements",
                    "AI authorship detection"
                  ].map(item => (
                    <div className="checklist-item" key={item}>
                      <div className="check-dot" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="loading">
                <div className="spinner" />
                Auditing your job description...
              </div>
            )}

            {error && (
              <div style={{ color: "var(--red)", fontSize: 14, padding: "20px 0" }}>{error}</div>
            )}

            {result && (
              <div>
                {/* Dual score block */}
                <div className="dual-scores">
                  <div className="score-cell">
                    <span className="score-cell-label">Inclusivity Score</span>
                    <div className={`score-cell-number ${scoreClass}`}>{result.score}</div>
                    <div className={`score-cell-verdict ${scoreClass}`}>{result.verdict}</div>
                  </div>
                  <div className="score-cell">
                    <span className="score-cell-label">AI Detection</span>
                    <div className="score-cell-number" style={{
                      color: result.ai_score >= 70 ? "#6D28D9" : result.ai_score >= 40 ? "#4338CA" : "var(--green)"
                    }}>{result.ai_score}</div>
                    <div className="score-cell-verdict" style={{
                      color: result.ai_score >= 70 ? "#6D28D9" : result.ai_score >= 40 ? "#4338CA" : "var(--green)"
                    }}>{result.ai_verdict}</div>
                    <div className="ai-meter">
                      <div className="ai-meter-fill" style={{
                        width: `${result.ai_score}%`,
                        background: result.ai_score >= 70 ? "#8B5CF6" : result.ai_score >= 40 ? "#6366F1" : "var(--green)"
                      }} />
                    </div>
                  </div>
                </div>

                <div className="category-pills">
                  {countByType("bias") > 0 && <span className="pill bias">{countByType("bias")} bias flag{countByType("bias") !== 1 ? "s" : ""}</span>}
                  {countByType("missing") > 0 && <span className="pill missing">{countByType("missing")} missing signal{countByType("missing") !== 1 ? "s" : ""}</span>}
                  {countByType("inflated") > 0 && <span className="pill inflated">{countByType("inflated")} inflated req{countByType("inflated") !== 1 ? "s" : ""}</span>}
                  {result.ai_score >= 70
                    ? <span className="pill ai-high">likely AI-generated</span>
                    : result.ai_score >= 40
                    ? <span className="pill ai-mid">possibly AI-assisted</span>
                    : <span className="pill ai-low">likely human-written</span>
                  }
                  {result.flags.length === 0 && <span className="pill ok">✓ No major issues found</span>}
                </div>

                <div className="section-title">Inclusivity Assessment</div>
                <div className="overall-notes">{result.summary}</div>

                <hr className="divider" />

                <div className="section-title">AI Authorship Analysis</div>
                <div className="overall-notes" style={{ marginBottom: 12 }}>{result.ai_summary}</div>

                {result.ai_signals && (
                  <div className="ai-signals">
                    {result.ai_signals.map((s, i) => (
                      <div key={i} className="ai-signal-item">
                        <div className={`ai-signal-dot ${s.detected ? "detected" : "clear"}`} />
                        <span>{s.signal}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="disclaimer">
                  AI detection is probabilistic, not definitive. Use as one signal among many — not as a pass/fail judgment.
                </div>

                {result.flags.length > 0 && (
                  <>
                    <hr className="divider" />
                    <div className="section-title">Flags & Rewrites</div>
                    <div className="flags-list">
                      {result.flags.map((flag, i) => (
                        <div key={i} className={`flag-card ${flag.type}`}>
                          <div className="flag-type">
                            {flag.type === "bias" ? "⚠ Biased Language" : flag.type === "missing" ? "○ Missing Signal" : "↑ Inflated Requirement"}
                          </div>
                          {flag.original && flag.original !== "Not present" && (
                            <div className="flag-original">"{flag.original}"</div>
                          )}
                          <div className="flag-issue">{flag.issue}</div>
                          <div className="flag-rewrite-label">Suggested rewrite</div>
                          <div className="flag-rewrite">{flag.rewrite}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
