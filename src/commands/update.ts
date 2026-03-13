import { parseUpdateCommandArgs, runUpdate, UpdateCommandError } from "../update.js";

export async function runUpdateCommand(cwd: string, args: string[]): Promise<void> {
  const options = parseUpdateCommandArgs(args);
  const result = await runUpdate(cwd, options);
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

export { UpdateCommandError };
