import type { AuthUser } from "../auth/auth.js";
declare global { namespace Express { interface Request { authUser?: AuthUser; } } }
export {};
