import { customAlphabet } from "nanoid";

const code = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);
export const publicId = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${code()}`;
