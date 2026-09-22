import http from "k6/http";
import { check, sleep } from "k6";
import { baseUrl, bearer, normalThresholds } from "./config.js";

export const options = { stages: [{ duration: "10s", target: 10 }, { duration: "20s", target: 10 }, { duration: "10s", target: 0 }], thresholds: { ...normalThresholds, http_req_duration: ["p(95)<300", "p(99)<750"] } };

export default function () {
  const response = http.get(`${baseUrl}/payments/requests/${__ENV.PAYMENT_ID}`, bearer(__ENV.MERCHANT_TOKEN));
  check(response, { "payment status loads": (r) => r.status === 200 });
  sleep(0.5);
}
