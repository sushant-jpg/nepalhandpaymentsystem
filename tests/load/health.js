import http from "k6/http";
import { check } from "k6";
import { baseUrl } from "./config.js";

export const options = {
  scenarios: { health: { executor: "constant-arrival-rate", rate: 20, timeUnit: "1s", duration: "30s", preAllocatedVUs: 5, maxVUs: 20 } },
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<100", "p(99)<250"] },
};

export default function () {
  const response = http.get(`${baseUrl}/health/live`);
  check(response, { "health is 200": (r) => r.status === 200 });
}
