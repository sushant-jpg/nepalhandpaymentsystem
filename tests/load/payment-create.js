import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { baseUrl, normalThresholds } from "./config.js";

export const options = { vus: 5, iterations: 50, thresholds: normalThresholds };

export default function () {
  const key = `k6-create-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`;
  const response = http.post(`${baseUrl}/payments/requests`, JSON.stringify({ amount: 10, description: "Reversible load-test request only" }), { headers: { Authorization: `Bearer ${__ENV.MERCHANT_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": key } });
  check(response, { "payment request is created": (r) => r.status === 201 });
  sleep(0.2);
}
