import type { Role } from "@nepal-hand-pay/shared-types";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; role: Role; email: string };
      requestId?: string;
    }
  }
}

export {};
