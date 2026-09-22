import http from "k6/http";
import { check, sleep } from "k6";
import { baseUrl, bearer, normalThresholds } from "./config.js";

export const options = { stages: [{ duration: "10s", target: 10 }, { duration: "20s", target: 10 }, { duration: "10s", target: 0 }], thresholds: { ...normalThresholds, http_req_duration: ["p(95)<300", "p(99)<750"] } };

export default function () {
  const response = http.get(`${baseUrl}/transactions?limit=20`, bearer(__ENV.ACCESS_TOKEN));
  check(response, { "transaction page loads": (r) => r.status === 200 });
  sleep(1);
}
