// Original data preservation and routing equivalence (wraps the verify scripts).
import "../scripts/lib/node-routing-hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { verifyOriginals } from "../scripts/verify-originals.mjs";
import { verifyRouting } from "../scripts/verify-routing.mjs";

test("all original BCSIR files are byte-identical to the recorded checksums", async () => {
  const results = await verifyOriginals();
  assert.equal(results.length, 16);
  const changed = results.filter((result) => !result.ok);
  assert.deepEqual(changed, [], changed.map((result) => `${result.file}: ${result.detail}`).join("\n"));
});

test("the 3D map routes with the original algorithm and matches connection_check.js", async () => {
  const results = await verifyRouting({ log: () => {} });
  const failed = results.filter((result) => !result.ok);
  assert.deepEqual(failed, [], failed.map((result) => `${result.name}: ${result.detail}`).join("\n"));
});
