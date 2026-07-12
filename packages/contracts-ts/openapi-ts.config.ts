import { defineConfig } from "@hey-api/openapi-ts";

// Generate TypeScript contract types from the canonical OpenAPI 3.1 emit (build plan 1.2, ADR-0006).
// Types only — no runtime client — so the generated edge stays dependency-free. Formatting/linting
// are disabled so the committed output is the raw generator output the drift check compares against.
export default defineConfig({
  input: "../../schemas/generated/openapi3/openapi.yaml",
  output: {
    path: "src/gen",
    format: false,
    lint: false,
  },
  plugins: ["@hey-api/typescript"],
});
