import { readFile } from "node:fs/promises";

const files = [
  "postman/NepalHandPaymentSystem.postman_collection.json",
  "postman/NepalHandPaymentSystem.local.postman_environment.json",
];

for (const file of files) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error(`${file} does not contain a JSON object.`);
  console.log(`Validated ${file}`);
}
