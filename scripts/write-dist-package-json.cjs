// Post-build step: the root package.json declares "type": "module" (needed
// for the Vite/renderer toolchain), but src/main and src/preload compile to
// CommonJS on purpose (see the comments in their tsconfig.json files —
// Electron's main entry and preload scripts assume require()/module.exports).
//
// Node resolves a directory's module type by walking up to the nearest
// package.json, so without an override, dist/main/index.js and
// dist/preload/index.js would be parsed as ES modules (matching the root
// package.json) even though tsc emitted CommonJS syntax — this throws
// `ReferenceError: exports is not defined in ES module scope` at launch.
// The same applies to dist/core and dist/shared, which src/main requires
// transitively at runtime (see their tsconfig.json comments).
//
// Writing a small { "type": "commonjs" } package.json into each compiled
// output directory overrides the root setting for that subtree only.
const fs = require("node:fs");
const path = require("node:path");

const targets = [
  path.join(__dirname, "..", "dist", "main"),
  path.join(__dirname, "..", "dist", "preload"),
  path.join(__dirname, "..", "dist", "core"),
  path.join(__dirname, "..", "dist", "shared"),
];

for (const dir of targets) {
  if (!fs.existsSync(dir)) {
    continue;
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
}
