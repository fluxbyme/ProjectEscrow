import type { Config } from "jest";
export default { preset: "ts-jest", testEnvironment: "node", testMatch: ["**/tests/**/*.spec.ts"] } satisfies Config;
