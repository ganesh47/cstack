import type { RunEvent, RunEventType, WorkflowName } from "./types.js";

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function summarize(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function formatProgressMessage(event: RunEvent, workflow: WorkflowName, runId: string): string {
  const prefix = `[cstack ${workflow} ${runId} +${formatElapsed(event.elapsedMs)}]`;
  switch (event.type) {
    case "starting":
      return `${prefix} Starting Codex run`;
    case "session":
      return `${prefix} Session: ${event.message}`;
    case "heartbeat":
      return `${prefix} Still running. ${event.message}`;
    case "completed":
      return `${prefix} Completed. ${event.message}`;
    case "failed":
      return `${prefix} Failed. ${event.message}`;
    case "activity":
    default: {
      const streamLabel = event.stream === "stderr" ? "stderr" : "stdout";
      return `${prefix} Activity (${streamLabel}): ${summarize(event.message)}`;
    }
  }
}

export function buildEvent(type: RunEventType, elapsedMs: number, message: string, stream?: "stdout" | "stderr"): RunEvent {
  return {
    timestamp: new Date().toISOString(),
    elapsedMs,
    type,
    message: summarize(message),
    ...(stream ? { stream } : {})
  };
}
