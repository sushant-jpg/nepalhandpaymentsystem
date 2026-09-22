import axios from "axios";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

const palm = axios.create({
  baseURL: config.PALM_SERVICE_URL,
  timeout: 15_000,
  headers: { "x-service-key": config.PALM_SERVICE_KEY },
});

export interface PalmMatch { success: boolean; matched: boolean; userId?: string; similarity?: number; threshold: number; algorithmVersion: string; templateRef?: string; qualityScore?: number; livenessAssessment?: string }

async function call<T>(method: "get" | "post" | "delete", path: string, data?: unknown): Promise<T> {
  try {
    const response = await palm.request<T>({ method, url: path, data });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 422) {
      throw new AppError(422, "PALM_IMAGE_INVALID", "A clear palm could not be extracted from the image.");
    }
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      throw new AppError(409, "DUPLICATE_PALM", "This palm appears to be enrolled to another account.");
    }
    throw new AppError(503, "PALM_SERVICE_UNAVAILABLE", "Palm recognition service is temporarily unavailable.");
  }
}

export const palmClient = {
  health: () => call<{ status: string }>("get", "/health"),
  enroll: (userId: string, handSide: string, samples: string[]) => call<PalmMatch>("post", "/palm/enroll", { userId, handSide, samples }),
  identify: (image: string) => call<PalmMatch>("post", "/palm/identify", { image }),
  verify: (userId: string, image: string) => call<PalmMatch>("post", "/palm/verify", { userId, image }),
  status: (userId: string) => call<{ enrolled: boolean; algorithmVersion?: string; enrolledAt?: string }>("get", `/palm/status/${userId}`),
  remove: (userId: string) => call<{ deleted: boolean }>("delete", `/palm/${userId}`),
};
