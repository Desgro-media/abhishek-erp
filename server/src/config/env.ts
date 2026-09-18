import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// Fail fast and loud on bad config instead of limping along with an empty
// JWT secret or a malformed DB URL — see CROSS-CUTTING SECURITY REQUIREMENTS.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters — generate with `openssl rand -hex 32`"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(7),

  CORS_ORIGIN: z.string().default("http://localhost:4000"),
  // Set true once this sits behind HTTPS (any real deploy target) — see README.
  // NOT z.coerce.boolean(): that coerces via JS Boolean(), so the *string*
  // "false" (any non-empty string) would coerce to `true` and silently force
  // Secure cookies on in every env that sets COOKIE_SECURE=false.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
