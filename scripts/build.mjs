import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const docs = path.join(root, "docs");
await rm(docs, { recursive: true, force: true });
await mkdir(docs, { recursive: true });
await cp(path.join(root, "public"), docs, { recursive: true });

const localTsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
const tsc = existsSync(localTsc) ? localTsc : "tsc";
execFileSync(tsc, ["-p", path.join(root, "tsconfig.json")], { cwd: root, stdio: "inherit" });
console.log(`Built GitHub Pages site in ${docs}`);
