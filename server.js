import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000,http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function safeJson(text) {
  const cleaned = String(text || "").trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  try { return JSON.parse(cleaned); }
  catch { throw new Error("The AI provider returned an invalid JSON response."); }
}

async function askGemini(prompt) {
  if (!GEMINI_API_KEY) {
    const error = new Error("GEMINI_API_KEY is not configured on the backend.");
    error.status = 503;
    throw error;
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) + ":generateContent?key=" + encodeURIComponent(GEMINI_API_KEY);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Gemini request failed.");
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return safeJson(text);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "kurukshetra-hackthon-backend",
    timestamp: new Date().toISOString(),
    integrations: {
      githubTokenConfigured: Boolean(GITHUB_TOKEN),
      geminiConfigured: Boolean(GEMINI_API_KEY)
    }
  });
});

app.get("/api/github/repos/:owner/:repo", async (req, res, next) => {
  const { owner, repo } = req.params;
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return fail(res, 400, "Invalid GitHub owner or repository name.");
  }
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Kurukshetra-Hackathon-Backend"
    };
    if (GITHUB_TOKEN) headers.Authorization = "Bearer " + GITHUB_TOKEN;
    const upstream = await fetch(
      "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo),
      { headers, signal: AbortSignal.timeout(15000) }
    );
    const data = await upstream.json().catch(() => ({}));
    if (upstream.status === 404) return fail(res, 404, "Repository not found or not accessible.");
    if (!upstream.ok) return fail(res, upstream.status === 403 ? 429 : 502, data?.message || "GitHub API request failed.");
    return res.json({
      id: data.id, name: data.name, fullName: data.full_name,
      owner: data.owner?.login || owner, description: data.description || "",
      private: Boolean(data.private), defaultBranch: data.default_branch || "main",
      language: data.language || null, stars: data.stargazers_count || 0,
      forks: data.forks_count || 0, openIssues: data.open_issues_count || 0,
      createdAt: data.created_at, updatedAt: data.updated_at, htmlUrl: data.html_url
    });
  } catch (error) { next(error); }
});

app.post("/api/ai/evaluate-code", async (req, res, next) => {
  const { skillName, codeSnippet, targetLevel } = req.body || {};
  if (typeof skillName !== "string" || !skillName.trim()) return fail(res, 400, "skillName is required.");
  if (typeof codeSnippet !== "string" || !codeSnippet.trim()) return fail(res, 400, "codeSnippet is required.");
  if (codeSnippet.length > 12000) return fail(res, 413, "codeSnippet must be 12000 characters or fewer.");
  const level = Number(targetLevel);
  if (!Number.isInteger(level) || level < 1 || level > 5) return fail(res, 400, "targetLevel must be an integer from 1 to 5.");

  const prompt = [
    "You are a careful software engineering skills assessor.",
    "Assess only evidence visible in the supplied code. Do not claim to have inspected files or repositories that were not supplied.",
    "Return JSON with demonstratedLevel (integer 1-5), confidence (integer 0-100), rubricSummary (string), strengths (array of 2-3 strings), areasForImprovement (array of 2-3 strings), and suggestedRepoRefactor (string).",
    "Skill: " + skillName.trim(),
    "Target level: " + level,
    "Code snippet:", codeSnippet
  ].join("\n\n");

  try {
    const result = await askGemini(prompt);
    const demonstratedLevel = Number(result.demonstratedLevel);
    const confidence = Number(result.confidence);
    if (!Number.isInteger(demonstratedLevel) || demonstratedLevel < 1 || demonstratedLevel > 5) {
      return fail(res, 502, "AI response did not contain a valid demonstratedLevel.");
    }
    return res.json({
      demonstratedLevel,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 50,
      rubricSummary: String(result.rubricSummary || ""),
      strengths: Array.isArray(result.strengths) ? result.strengths.slice(0, 5).map(String) : [],
      areasForImprovement: Array.isArray(result.areasForImprovement) ? result.areasForImprovement.slice(0, 5).map(String) : [],
      suggestedRepoRefactor: String(result.suggestedRepoRefactor || "")
    });
  } catch (error) { next(error); }
});

app.post("/api/ai/parse-job-description", async (req, res, next) => {
  const { jobText } = req.body || {};
  if (typeof jobText !== "string" || !jobText.trim()) return fail(res, 400, "jobText is required.");
  if (jobText.length > 12000) return fail(res, 413, "jobText must be 12000 characters or fewer.");
  const prompt = [
    "Extract a job role from the supplied job description. Do not invent requirements unsupported by the text.",
    "Return JSON with title, seniority (Junior, Mid, Senior, Staff, Lead, or Principal), companyType, summary, and skills.",
    "Each skill must contain name, category, targetLevel (integer 1-5), description, and isMandatory (boolean).",
    "Allowed categories: Architecture & Systems, Frontend Engineering, Backend & APIs, Cloud & DevOps, Database & Data Modeling, Testing & Reliability, Security & Compliance, AI & Modern Tooling.",
    "Job description:", jobText.trim()
  ].join("\n\n");
  try {
    const result = await askGemini(prompt);
    if (!result || typeof result !== "object") return fail(res, 502, "AI response did not contain a valid job description object.");
    return res.json(result);
  } catch (error) { next(error); }
});

app.use((req, res) => fail(res, 404, "API route not found. See README.md for available endpoints."));
app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("[api-error]", error.message);
  return res.status(status).json({ error: status >= 500 ? "The server could not complete the request." : error.message });
});

app.listen(PORT, () => console.log("Kurukshetra backend listening on port " + PORT));