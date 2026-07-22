import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const localTsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
const tsc = existsSync(localTsc) ? localTsc : "tsc";
execFileSync(tsc, ["-p", path.join(root, "tsconfig.tests.json")], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [path.join(root, "build", "tests.js")], { cwd: root, stdio: "inherit" });
