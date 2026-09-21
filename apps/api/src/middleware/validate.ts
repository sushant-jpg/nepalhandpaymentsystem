import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export const validate = (schema: ZodTypeAny, source: "body" | "query" | "params" = "body"): RequestHandler =>
  (req, _res, next) => {
    const value = schema.parse(req[source]);
    if (source === "body") req.body = value;
    else if (source === "params") req.params = value;
    else Object.assign(req.query, value);
    next();
  };
