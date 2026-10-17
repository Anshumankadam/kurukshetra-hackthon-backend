# Kurukshetra Hackathon Backend

Express API backend for the SkillGap Buster career-coaching app.

## Requirements
- Node.js 20 or newer
- A Gemini API key for AI endpoints
- Optional GitHub token for higher API limits and private-repository access

## Run locally
1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your own `GEMINI_API_KEY`.
3. Start the API: `npm run dev`

The API defaults to `http://localhost:4000`.

## Endpoints

### `GET /api/health`
Returns service status and whether integrations are configured. It never returns secret values.

### `GET /api/github/repos/:owner/:repo`
Looks up a GitHub repository and returns basic metadata.

Example: `/api/github/repos/Anshumankadam/kurukshetra-hackthon-backend`

### `POST /api/ai/evaluate-code`
Request JSON:
```json
{
  "skillName": "Backend & APIs",
  "codeSnippet": "export function healthCheck() { return true; }",
  "targetLevel": 3
}
```
Returns a demonstrated skill level, confidence, summary, strengths, improvement areas, and a suggested refactor.

### `POST /api/ai/parse-job-description`
Request JSON:
```json
{ "jobText": "Paste the job or internship description here." }
```
Returns structured role and skill requirements extracted by Gemini.

## Frontend connection
Set the frontend API base URL to `http://localhost:4000` for local development, then call the endpoints above from frontend services. The frontend ZIP currently contains client-side/mock service logic; it must be wired to these API routes before the UI uses this backend.

## Security notes
- Keep `.env` private; only `.env.example` is committed.
- Do not place Gemini or GitHub tokens in frontend code or browser storage.
- Use a narrowly scoped GitHub token and rotate it if exposed.
- Configure `CLIENT_ORIGIN` to your deployed frontend origin before deployment.
- This starter does not include a database, user authentication, or persistent assessment storage.
