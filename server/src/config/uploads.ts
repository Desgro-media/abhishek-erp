import fs from "node:fs";
import path from "node:path";

// Sibling of dist/ and src/ (same relative pattern app.ts already uses for /public), so this
// resolves to server/uploads whether running compiled (dist/config/uploads.js) or under tsx.
// NOT inside /public — resumes are HR-only, never served by express.static.
export const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
export const RESUMES_DIR = path.join(UPLOADS_DIR, "resumes");

fs.mkdirSync(RESUMES_DIR, { recursive: true });

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
