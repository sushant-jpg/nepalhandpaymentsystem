import type { Server } from "socket.io";

let io: Server | undefined;
export const setSocketServer = (server: Server) => { io = server; };
export const emitPayment = (paymentId: string, state: string, extra: Record<string, unknown> = {}) => {
  io?.to(`payment:${paymentId}`).emit("payment:update", { paymentId, state, ...extra });
};
