import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { env } from "./config/env";
import apiRouter from "./routes";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

// Behind a reverse proxy (any real deploy target) req.ip needs the real
// client IP for rate limiting/audit logs to mean anything.
app.set("trust proxy", 1);

app.use(
  helmet({
    // The existing ERP UI (public/index.html + js/app.js) is a legacy
    // single-file prototype that wires ~180 buttons via inline onclick/
    // onchange attributes. Rewriting that to event delegation is a frontend
    // rearchitecture, not part of wiring up the Phase 1 login gate — so
    // script-src-attr is relaxed to keep it working. script-src itself
    // stays locked to 'self': every <script> tag we ship is now an external
    // file (auth.js/login.js/app.js), never inline, so that stays enforced.
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src-attr": ["'unsafe-inline'"],
      },
    },
  })
);
// credentials:true is required for the httpOnly refresh cookie to be sent —
// CORS_ORIGIN must be the exact frontend origin, never "*", with credentials on.
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(
  pinoHttp({
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  })
);

app.use("/api", apiRouter);

// Serves /public (the existing ERP HTML/CSS/JS + login page) so Phase 1
// ships as one deployable unit. Splitting the frontend onto its own static
// host later is just a CORS_ORIGIN change, nothing here has to move.
app.use(express.static(path.join(__dirname, "..", "..", "public")));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use(errorHandler);
