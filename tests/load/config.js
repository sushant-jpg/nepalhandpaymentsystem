export const baseUrl = __ENV.BASE_URL || "http://localhost:4000/api/v1";

export const normalThresholds = {
  http_req_failed: ["rate<0.01"],
  http_req_duration: ["p(95)<500", "p(99)<1000"],
};

export function bearer(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}
