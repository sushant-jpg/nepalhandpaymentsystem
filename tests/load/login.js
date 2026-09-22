import http from "k6/http";
import { check, sleep } from "k6";
import { baseUrl, normalThresholds } from "./config.js";

export const options = { vus: 2, duration: "20s", thresholds: normalThresholds };

export default function () {
  const response = http.post(`${baseUrl}/auth/login`, JSON.stringify({ email: __ENV.LOGIN_EMAIL, password: __ENV.LOGIN_PASSWORD }), { headers: { "Content-Type": "application/json" } });
  check(response, { "login succeeds or is rate limited": (r) => r.status === 200 || r.status === 429 });
  sleep(2);
}
