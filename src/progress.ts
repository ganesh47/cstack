import type { RunEvent, RunEventType, WorkflowName } from "./types.js";

const ANSI = {
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  bold: "\u001B[1m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m",
  gray: "\u001B[90m",
  clearToEnd: "\u001B[J",
  hideCursor: "\u001B[?25l",
  showCursor: "\u001B[?25h"
} as const;

interface ProgressStream {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): boolean;
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function summarize(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 160);
}

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

function truncate(input: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const plain = stripAnsi(input);
  if (plain.length <= width) {
    return input;
  }
  return `${plain.slice(0, Math.max(0, width - 3))}...`;
}

function colorize(input: string, color: string, enabled: boolean): string {
  if (!enabled) {
    return input;
  }
  return `${color}${input}${ANSI.reset}`;
}

function eventColor(type: RunEventType): string {
  switch (type) {
    case "completed":
      return ANSI.green;
    case "failed":
      return ANSI.red;
    case "heartbeat":
      return ANSI.yellow;
    case "session":
      return ANSI.cyan;
    case "starting":
      return ANSI.blue;
    case "activity":
    default:
      return ANSI.gray;
  }
}

function streamTag(event: RunEvent): string {
  if (event.type !== "activity") {
    return event.type;
  }
  return event.stream === "stderr" ? "stderr" : "stdout";
}

function findLastEvent(events: RunEvent[], predicate: (event: RunEvent) => boolean): RunEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate && predicate(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function formatProgressMessage(event: RunEvent, workflow: WorkflowName, runId: string): string {
  const prefix = `[cstack ${workflow} ${runId} +${formatElapsed(event.elapsedMs)}]`;
  switch (event.type) {
    case "starting":
      return `${prefix} ${
        workflow === "update" ? "Starting update" : workflow === "intent" ? "Starting intent run" : "Starting Codex run"
      }`;
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

export class ProgressReporter {
  private readonly workflow: WorkflowName;
  private readonly runId: string;
  private readonly stream: ProgressStream;
  private readonly colorsEnabled: boolean;
  private readonly dashboardEnabled: boolean;
  private readonly historyLimit: number;
  private history: RunEvent[] = [];
  private lastRenderedLines = 0;
  private lastEvent: RunEvent | null = null;
  private started = false;
  private closed = false;

  constructor(workflow: WorkflowName, runId: string, stream: ProgressStream = process.stdout) {
    this.workflow = workflow;
    this.runId = runId;
    this.stream = stream;
    this.colorsEnabled = Boolean(stream.isTTY && process.env.NO_COLOR !== "1");
    this.dashboardEnabled = Boolean(stream.isTTY && process.env.TERM && process.env.TERM !== "dumb");
    this.historyLimit = 6;
  }

  emit(event: RunEvent): void {
    this.lastEvent = event;
    this.history = [...this.history, event].slice(-this.historyLimit);

    if (!this.dashboardEnabled) {
      this.stream.write(`${formatProgressMessage(event, this.workflow, this.runId)}\n`);
      return;
    }

    if (!this.started) {
      this.stream.write(ANSI.hideCursor);
      this.started = true;
    }

    this.render();

    if (event.type === "completed" || event.type === "failed") {
      this.close();
    }
  }

  close(): void {
    if (!this.dashboardEnabled || this.closed) {
      return;
    }

    this.closed = true;
    this.stream.write("\n");
    this.stream.write(ANSI.showCursor);
  }

  private render(): void {
    const lines = this.buildDashboardLines();
    const width = Math.max(60, Math.min(this.stream.columns ?? 100, 120));
    const formatted = lines.map((line) => truncate(line, width));

    if (this.lastRenderedLines > 0) {
      this.stream.write(`\u001B[${this.lastRenderedLines}A`);
    }
    this.stream.write(ANSI.clearToEnd);
    this.stream.write(`${formatted.join("\n")}\n`);
    this.lastRenderedLines = formatted.length;
  }

  private buildDashboardLines(): string[] {
    const status = this.lastEvent?.type === "failed" ? "failed" : this.lastEvent?.type === "completed" ? "completed" : "running";
    const elapsed = this.lastEvent ? formatElapsed(this.lastEvent.elapsedMs) : "0:00";
    const session = findLastEvent(this.history, (event) => event.type === "session")?.message ?? "pending";
    const lastActivity = this.lastEvent && this.lastEvent.type !== "activity" ? this.lastEvent.message : undefined;
    const recentObservedActivity =
      findLastEvent(this.history, (event) => event.type === "activity" || event.type === "heartbeat")?.message ??
      "waiting for activity";
    const currentLineMessage = lastActivity ?? recentObservedActivity;
    const header = `${colorize("cstack", ANSI.bold, this.colorsEnabled)} ${colorize(this.workflow, ANSI.cyan, this.colorsEnabled)}  ${colorize(this.runId, ANSI.dim, this.colorsEnabled)}`;
    const statusLine = [
      `status ${colorize(status, eventColor(this.lastEvent?.type ?? "starting"), this.colorsEnabled)}`,
      `elapsed ${colorize(elapsed, ANSI.bold, this.colorsEnabled)}`,
      `session ${colorize(session, ANSI.dim, this.colorsEnabled)}`
    ].join("  |  ");
    const activityLine = `${colorize("current", ANSI.bold, this.colorsEnabled)} ${currentLineMessage}`;
    const activityHeader = colorize("recent activity", ANSI.bold, this.colorsEnabled);
    const activityLines = this.history.slice(-5).map((event) => {
      const label = colorize(`[${streamTag(event)} +${formatElapsed(event.elapsedMs)}]`, eventColor(event.type), this.colorsEnabled);
      return `${label} ${event.message}`;
    });

    return [header, statusLine, activityLine, activityHeader, ...activityLines];
  }
}
