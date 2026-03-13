import path from "node:path";
import { listRuns } from "../run.js";

export async function runRuns(cwd: string): Promise<void> {
  const runs = await listRuns(cwd);
  if (runs.length === 0) {
    process.stdout.write("No cstack runs found.\n");
    return;
  }

  const lines = runs.map((run) =>
    [
      run.id,
      run.workflow,
      run.status,
      run.createdAt,
      path.relative(cwd, run.finalPath)
    ].join("\t")
  );

  process.stdout.write(`run_id\tworkflow\tstatus\tcreated_at\tfinal_path\n${lines.join("\n")}\n`);
}
