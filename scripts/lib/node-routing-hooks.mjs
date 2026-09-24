// Lets Node import src/routing/route-service.js by resolving the Vite virtual
// module "virtual:bcsir-routing" to the same generated code Vite serves.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { buildRoutingModule } from "./original-routing.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const code = buildRoutingModule(root);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "virtual:bcsir-routing") {
      return { url: `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`, format: "module", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
