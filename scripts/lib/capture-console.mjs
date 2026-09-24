// Preloaded with `node --import` when running the ORIGINAL connection_check.js.
// It records every console.log call as JSON; the script itself is not changed.
import { writeFileSync } from "node:fs";

const calls = [];
const original = console.log.bind(console);
console.log = (...args) => {
  calls.push(args);
  original(...args);
};
process.on("exit", () => writeFileSync(process.env.BCSIR_CAPTURE_FILE, JSON.stringify(calls)));
