import path from "node:path";

export function cstackRoot(cwd: string): string {
  return path.join(cwd, ".cstack");
}

export function runsRoot(cwd: string): string {
  return path.join(cstackRoot(cwd), "runs");
}
