import path from "node:path";
import { promises as fs } from "node:fs";
import type {
  ChildWorkflowLink,
  MachineStatePath,
  RoutingStagePlan,
  RunRecord,
  RunStatus,
  StageLineage,
  StageName,
  StageStatus,
  SpecialistExecution,
  VisibleStageRecord,
  WorkflowEvent,
  WorkflowMachineSnapshot,
  WorkflowName,
  WorkflowTransitionRecord
} from "./types.js";

export interface WorkflowMachineDefinition {
  workflow: WorkflowName;
  createInitialSnapshot(options: {
    intent: string;
    stages: RoutingStagePlan[];
    context?: Record<string, unknown> | undefined;
    activeSpecialists?: string[] | undefined;
    specialists?: SpecialistExecution[] | undefined;
  }): WorkflowMachineSnapshot;
  reduce(snapshot: WorkflowMachineSnapshot, event: WorkflowEvent): WorkflowMachineSnapshot;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertNever(_: never): never {
  throw new Error("Unexpected workflow event.");
}

function buildInitialTransition(activePath: MachineStatePath): WorkflowTransitionRecord {
  return {
    at: nowIso(),
    event: "INIT",
    fromPath: [...activePath],
    toPath: [...activePath],
    notes: "Machine initialized."
  };
}

function createInitialSnapshot(options: {
  workflow: WorkflowName;
  intent: string;
  stages: RoutingStagePlan[];
  context?: Record<string, unknown> | undefined;
  activeSpecialists?: string[] | undefined;
  specialists?: SpecialistExecution[] | undefined;
}): WorkflowMachineSnapshot {
  const activePath: MachineStatePath =
    options.stages.length > 0 ? [options.workflow, "stage", options.stages[0]!.name, options.stages[0]!.status] : [options.workflow, "idle"];

  return {
    version: 1,
    workflow: options.workflow,
    intent: options.intent,
    activePath,
    runStatus: "running",
    visibleStages: options.stages.map((stage) => ({
      ...clone(stage),
      statePath: [options.workflow, "stage", stage.name, stage.status]
    })),
    specialists: clone(options.specialists ?? []),
    activeSpecialists: clone(options.activeSpecialists ?? []),
    childWorkflows: [],
    transitions: [buildInitialTransition(activePath)],
    context: clone(options.context ?? {})
  };
}

function stageTransitionAllowed(from: StageStatus, to: StageStatus): boolean {
  if (from === to) {
    return true;
  }
  switch (from) {
    case "planned":
      return true;
    case "running":
      return to !== "planned";
    case "deferred":
      return to === "running" || to === "completed" || to === "failed" || to === "deferred";
    case "completed":
    case "failed":
    case "skipped":
      return false;
    default:
      return false;
  }
}

function appendTransition(snapshot: WorkflowMachineSnapshot, event: WorkflowEvent, nextPath: MachineStatePath, notes?: string): WorkflowMachineSnapshot {
  const next = clone(snapshot);
  next.transitions.push({
    at: nowIso(),
    event: event.type,
    fromPath: [...snapshot.activePath],
    toPath: [...nextPath],
    ...(notes ? { notes } : {})
  });
  return next;
}

function updateStage(snapshot: WorkflowMachineSnapshot, options: {
  stageName: StageName;
  status: StageStatus;
  executed?: boolean;
  notes?: string | undefined;
  stageDir?: string | undefined;
  artifactPath?: string | undefined;
  childRunId?: string | undefined;
  statePath?: MachineStatePath | undefined;
}): WorkflowMachineSnapshot {
  const stageIndex = snapshot.visibleStages.findIndex((stage) => stage.name === options.stageName);
  if (stageIndex < 0) {
    throw new Error(`Stage ${options.stageName} is not part of the ${snapshot.workflow} machine.`);
  }

  const stage = snapshot.visibleStages[stageIndex]!;
  if (!stageTransitionAllowed(stage.status, options.status)) {
    throw new Error(`Illegal stage transition for ${snapshot.workflow}.${options.stageName}: ${stage.status} -> ${options.status}`);
  }

  const next = clone(snapshot);
  next.visibleStages[stageIndex] = {
    ...stage,
    status: options.status,
    ...(typeof options.executed === "boolean" ? { executed: options.executed } : {}),
    ...(options.notes !== undefined ? { notes: options.notes } : {}),
    ...(options.stageDir !== undefined ? { stageDir: options.stageDir } : {}),
    ...(options.artifactPath !== undefined ? { artifactPath: options.artifactPath } : {}),
    ...(options.childRunId !== undefined ? { childRunId: options.childRunId } : {}),
    statePath: options.statePath ?? [snapshot.workflow, "stage", options.stageName, options.status]
  };
  next.activePath = options.statePath ?? [snapshot.workflow, "stage", options.stageName, options.status];
  return next;
}

function upsertSpecialist(snapshot: WorkflowMachineSnapshot, specialist: SpecialistExecution): WorkflowMachineSnapshot {
  const next = clone(snapshot);
  const index = next.specialists.findIndex((entry) => entry.name === specialist.name);
  if (index >= 0) {
    next.specialists[index] = specialist;
  } else {
    next.specialists.push(specialist);
  }
  return next;
}

function updateSpecialist(snapshot: WorkflowMachineSnapshot, name: SpecialistExecution["name"], patch: Partial<SpecialistExecution>): WorkflowMachineSnapshot {
  const next = clone(snapshot);
  const index = next.specialists.findIndex((entry) => entry.name === name);
  if (index < 0) {
    throw new Error(`Specialist ${name} is not registered for ${snapshot.workflow}.`);
  }
  next.specialists[index] = {
    ...next.specialists[index]!,
    ...patch
  };
  return next;
}

function upsertChild(snapshot: WorkflowMachineSnapshot, link: ChildWorkflowLink): WorkflowMachineSnapshot {
  const next = clone(snapshot);
  const index = next.childWorkflows.findIndex((entry) => entry.stageName === link.stageName);
  if (index >= 0) {
    next.childWorkflows[index] = link;
  } else {
    next.childWorkflows.push(link);
  }
  return next;
}

function applyCommonEvent(snapshot: WorkflowMachineSnapshot, event: WorkflowEvent): WorkflowMachineSnapshot | null {
  switch (event.type) {
    case "SET_SPECIALISTS":
      return {
        ...clone(snapshot),
        activeSpecialists: [...event.names]
      };
    case "SET_ACTIVE_SPECIALISTS":
      return {
        ...clone(snapshot),
        activeSpecialists: [...event.names]
      };
    case "UPSERT_SPECIALIST":
      return upsertSpecialist(snapshot, event.specialist);
    case "UPDATE_SPECIALIST":
      return updateSpecialist(snapshot, event.name, event.patch);
    case "LINK_CHILD":
      return upsertChild(snapshot, event.link);
    case "SET_CONTEXT":
      return {
        ...clone(snapshot),
        context: {
          ...snapshot.context,
          ...event.patch
        }
      };
    case "SET_LAST_ACTIVITY":
      return {
        ...clone(snapshot),
        lastActivity: event.message
      };
    case "SET_ERROR":
      return {
        ...clone(snapshot),
        ...(event.error ? { error: event.error } : {})
      };
    case "SET_STAGE_STATUS":
    case "SYNC_CHILD":
    case "REVIEW_FINALIZED":
    case "SHIP_FINALIZED":
    case "DELIVER_FINALIZED":
    case "INTENT_FINALIZED":
      return null;
    default:
      assertNever(event);
  }
}

function withEvent(snapshot: WorkflowMachineSnapshot, event: WorkflowEvent, notes?: string): WorkflowMachineSnapshot {
  return appendTransition(snapshot, event, snapshot.activePath, notes ?? event.note);
}

function setTerminal(snapshot: WorkflowMachineSnapshot, workflow: WorkflowName, status: RunStatus, summary: string, error?: string): WorkflowMachineSnapshot {
  const next = clone(snapshot);
  next.runStatus = status;
  next.activePath = [workflow, status === "completed" ? "completed" : "failed"];
  next.lastActivity = summary;
  if (status === "failed") {
    next.error = error ?? summary;
  } else {
    delete next.error;
  }
  return next;
}

function defaultReduce(snapshot: WorkflowMachineSnapshot, event: WorkflowEvent, allowedStages: StageName[]): WorkflowMachineSnapshot {
  const common = applyCommonEvent(snapshot, event);
  if (common) {
    return withEvent(common, event);
  }

  if (event.type === "SET_STAGE_STATUS") {
    if (!allowedStages.includes(event.stageName)) {
      throw new Error(`Stage ${event.stageName} is not valid for ${snapshot.workflow}.`);
    }
    const stageUpdate = {
      stageName: event.stageName,
      status: event.status,
      ...(typeof event.executed === "boolean" ? { executed: event.executed } : {}),
      ...(event.notes !== undefined ? { notes: event.notes } : {}),
      ...(event.stageDir !== undefined ? { stageDir: event.stageDir } : {}),
      ...(event.artifactPath !== undefined ? { artifactPath: event.artifactPath } : {}),
      ...(event.childRunId !== undefined ? { childRunId: event.childRunId } : {}),
      ...(event.statePath !== undefined ? { statePath: event.statePath } : {})
    };
    return appendTransition(
      updateStage(snapshot, stageUpdate),
      event,
      event.statePath ?? [snapshot.workflow, "stage", event.stageName, event.status],
      event.note
    );
  }

  throw new Error(`Unhandled workflow event ${event.type} for ${snapshot.workflow}.`);
}

function reviewMachineDefinition(): WorkflowMachineDefinition {
  return {
    workflow: "review",
    createInitialSnapshot: ({ intent, stages, context, activeSpecialists, specialists }) =>
      createInitialSnapshot({
        workflow: "review",
        intent,
        stages,
        ...(context !== undefined ? { context } : {}),
        ...(activeSpecialists !== undefined ? { activeSpecialists } : {}),
        ...(specialists !== undefined ? { specialists } : {})
      }),
    reduce(snapshot, event) {
      if (event.type === "REVIEW_FINALIZED") {
        const stageUpdated = updateStage(snapshot, {
          stageName: "review",
          status: event.executionSucceeded ? "completed" : "failed",
          executed: true,
          notes: event.summary
        });
        const next = setTerminal(stageUpdated, "review", event.executionSucceeded ? "completed" : "failed", event.summary, event.summary);
        next.context = {
          ...next.context,
          reviewVerdictStatus: event.verdictStatus
        };
        return appendTransition(next, event, next.activePath, event.note ?? event.summary);
      }

      return defaultReduce(snapshot, event, ["review"]);
    }
  };
}

function shipMachineDefinition(): WorkflowMachineDefinition {
  return {
    workflow: "ship",
    createInitialSnapshot: ({ intent, stages, context, activeSpecialists, specialists }) =>
      createInitialSnapshot({
        workflow: "ship",
        intent,
        stages,
        ...(context !== undefined ? { context } : {}),
        ...(activeSpecialists !== undefined ? { activeSpecialists } : {}),
        ...(specialists !== undefined ? { specialists } : {})
      }),
    reduce(snapshot, event) {
      if (event.type === "SHIP_FINALIZED") {
        const completed =
          event.readiness === "ready" && event.githubDeliveryStatus === "ready" && !event.hasMutationBlockers;
        const stageUpdated = updateStage(snapshot, {
          stageName: "ship",
          status: completed ? "completed" : "failed",
          executed: true,
          notes: event.summary
        });
        const next = setTerminal(stageUpdated, "ship", completed ? "completed" : "failed", event.summary, event.summary);
        next.context = {
          ...next.context,
          shipReadiness: event.readiness,
          githubDeliveryStatus: event.githubDeliveryStatus
        };
        return appendTransition(next, event, next.activePath, event.note ?? event.summary);
      }

      return defaultReduce(snapshot, event, ["ship"]);
    }
  };
}

function deferRemainingDeliverStages(snapshot: WorkflowMachineSnapshot): WorkflowMachineSnapshot {
  let next = clone(snapshot);
  for (const stageName of ["validation", "review", "ship"] as const) {
    const stage = next.visibleStages.find((entry) => entry.name === stageName);
    if (!stage || stage.status !== "planned") {
      continue;
    }
    next = updateStage(next, {
      stageName,
      status: "deferred",
      executed: false,
      ...(stage.notes !== undefined ? { notes: stage.notes } : {})
    });
  }
  return next;
}

function deliverMachineDefinition(): WorkflowMachineDefinition {
  return {
    workflow: "deliver",
    createInitialSnapshot: ({ intent, stages, context, activeSpecialists, specialists }) =>
      createInitialSnapshot({
        workflow: "deliver",
        intent,
        stages,
        ...(context !== undefined ? { context } : {}),
        ...(activeSpecialists !== undefined ? { activeSpecialists } : {}),
        ...(specialists !== undefined ? { specialists } : {})
      }),
    reduce(snapshot, event) {
      if (event.type === "SET_STAGE_STATUS") {
        const stageUpdate = {
          stageName: event.stageName,
          status: event.status,
          ...(typeof event.executed === "boolean" ? { executed: event.executed } : {}),
          ...(event.notes !== undefined ? { notes: event.notes } : {}),
          ...(event.stageDir !== undefined ? { stageDir: event.stageDir } : {}),
          ...(event.artifactPath !== undefined ? { artifactPath: event.artifactPath } : {}),
          ...(event.childRunId !== undefined ? { childRunId: event.childRunId } : {}),
          ...(event.statePath !== undefined ? { statePath: event.statePath } : {})
        };
        let next = updateStage(snapshot, stageUpdate);
        if (event.stageName === "build" && event.status === "failed") {
          next = deferRemainingDeliverStages(next);
        }
        return appendTransition(next, event, next.activePath, event.note);
      }

      if (event.type === "DELIVER_FINALIZED") {
        const completed =
          event.buildSucceeded &&
          event.validationStatus === "ready" &&
          event.reviewStatus === "ready" &&
          event.shipReadiness === "ready" &&
          event.githubDeliveryStatus === "ready";
        const next = setTerminal(snapshot, "deliver", completed ? "completed" : "failed", event.summary, event.summary);
        next.context = {
          ...next.context,
          buildSucceeded: event.buildSucceeded,
          validationStatus: event.validationStatus,
          reviewStatus: event.reviewStatus,
          shipReadiness: event.shipReadiness,
          githubDeliveryStatus: event.githubDeliveryStatus
        };
        return appendTransition(next, event, next.activePath, event.note ?? event.summary);
      }

      return defaultReduce(snapshot, event, ["build", "validation", "review", "ship"]);
    }
  };
}

function mapChildStatus(status: RunStatus): StageStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "running":
    default:
      return "running";
  }
}

function syncIntentChild(snapshot: WorkflowMachineSnapshot, event: Extract<WorkflowEvent, { type: "SYNC_CHILD" }>): WorkflowMachineSnapshot {
  let next = upsertChild(snapshot, event.child);
  const targetPath: MachineStatePath = [snapshot.workflow, "child", event.child.currentStage ?? event.stageName, event.child.status];

  if (event.childStageLineage) {
    for (const childStage of event.childStageLineage.stages) {
      const parentStage = next.visibleStages.find((entry) => entry.name === childStage.name);
      if (!parentStage) {
        continue;
      }
      const mirroredStatus = childStage.status === "planned" && parentStage.status === "running" ? "running" : childStage.status;
      if (!stageTransitionAllowed(parentStage.status, mirroredStatus)) {
        continue;
      }
      next = updateStage(next, {
        stageName: childStage.name,
        status: mirroredStatus,
        executed: childStage.executed,
        ...(childStage.notes !== undefined ? { notes: childStage.notes } : {}),
        ...(childStage.stageDir !== undefined ? { stageDir: childStage.stageDir } : {}),
        ...(childStage.artifactPath !== undefined ? { artifactPath: childStage.artifactPath } : {}),
        childRunId: event.child.runId,
        statePath: [snapshot.workflow, "child", childStage.name, mirroredStatus]
      });
    }
  } else {
    next = updateStage(next, {
      stageName: event.stageName,
      status: mapChildStatus(event.child.status),
      executed: event.child.status !== "running",
      ...(event.child.currentStage ? { notes: `Downstream ${event.child.workflow} stage: ${event.child.currentStage}` } : {}),
      childRunId: event.child.runId,
      statePath: targetPath
    });
  }

  next.activePath = targetPath;
  next.activeSpecialists = [...(event.childActiveSpecialists ?? [])];
  return appendTransition(next, event, targetPath, event.note);
}

function intentMachineDefinition(): WorkflowMachineDefinition {
  return {
    workflow: "intent",
    createInitialSnapshot: ({ intent, stages, context, activeSpecialists, specialists }) =>
      createInitialSnapshot({
        workflow: "intent",
        intent,
        stages,
        ...(context !== undefined ? { context } : {}),
        ...(activeSpecialists !== undefined ? { activeSpecialists } : {}),
        ...(specialists !== undefined ? { specialists } : {})
      }),
    reduce(snapshot, event) {
      if (event.type === "SYNC_CHILD") {
        return syncIntentChild(snapshot, event);
      }

      if (event.type === "INTENT_FINALIZED") {
        const failedStages = snapshot.visibleStages.filter((stage) => stage.status === "failed");
        const status: RunStatus = failedStages.length > 0 ? "failed" : "completed";
        const next = setTerminal(snapshot, "intent", status, event.summary, event.error ?? failedStages.map((stage) => `${stage.name} failed`).join("; "));
        return appendTransition(next, event, next.activePath, event.note ?? event.summary);
      }

      return defaultReduce(snapshot, event, ["discover", "spec", "build", "review", "ship"]);
    }
  };
}

const MACHINE_DEFINITIONS: Record<Extract<WorkflowName, "review" | "ship" | "deliver" | "intent">, WorkflowMachineDefinition> = {
  review: reviewMachineDefinition(),
  ship: shipMachineDefinition(),
  deliver: deliverMachineDefinition(),
  intent: intentMachineDefinition()
};

export function getWorkflowMachineDefinition(workflow: Extract<WorkflowName, "review" | "ship" | "deliver" | "intent">): WorkflowMachineDefinition {
  return MACHINE_DEFINITIONS[workflow];
}

export function transition(definition: WorkflowMachineDefinition, snapshot: WorkflowMachineSnapshot, event: WorkflowEvent): WorkflowMachineSnapshot {
  return definition.reduce(snapshot, event);
}

export function projectStageLineage(snapshot: WorkflowMachineSnapshot): StageLineage {
  return {
    intent: snapshot.intent,
    stages: snapshot.visibleStages.map(({ statePath: _statePath, ...stage }) => clone(stage)),
    specialists: clone(snapshot.specialists)
  };
}

export function currentStageFromSnapshot(snapshot: WorkflowMachineSnapshot): string | undefined {
  if (snapshot.runStatus !== "running") {
    return undefined;
  }

  if (snapshot.activePath[1] === "specialist" && snapshot.activePath[2]) {
    return `specialist:${snapshot.activePath[2]}`;
  }
  if ((snapshot.activePath[1] === "stage" || snapshot.activePath[1] === "child") && snapshot.activePath[2]) {
    return snapshot.activePath[2];
  }

  return snapshot.visibleStages.find((stage) => stage.status === "running")?.name;
}

export function deriveRunRecord(baseRun: RunRecord, snapshot: WorkflowMachineSnapshot): RunRecord {
  const next: RunRecord = {
    ...clone(baseRun),
    status: snapshot.runStatus,
    ...(snapshot.activeSpecialists.length > 0 ? { activeSpecialists: [...snapshot.activeSpecialists] } : { activeSpecialists: [] })
  };

  const currentStage = currentStageFromSnapshot(snapshot);
  if (currentStage) {
    next.currentStage = currentStage;
  } else {
    delete next.currentStage;
  }

  if (snapshot.lastActivity) {
    next.lastActivity = snapshot.lastActivity;
  }

  if (snapshot.runStatus === "failed" && snapshot.error) {
    next.error = snapshot.error;
  } else if (snapshot.runStatus !== "failed") {
    delete next.error;
  }

  return next;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface WorkflowControllerOptions {
  definition: WorkflowMachineDefinition;
  runDir: string;
  runRecord: RunRecord;
  intent: string;
  stages: RoutingStagePlan[];
  context?: Record<string, unknown> | undefined;
  activeSpecialists?: string[] | undefined;
  specialists?: SpecialistExecution[] | undefined;
}

type RunRecordPatch = Partial<Omit<RunRecord, "inputs">> & {
  inputs?: Partial<RunRecord["inputs"]> | undefined;
};

export class WorkflowController {
  private readonly definition: WorkflowMachineDefinition;
  private readonly runDir: string;
  private runRecord: RunRecord;
  private snapshot: WorkflowMachineSnapshot;

  private constructor(options: {
    definition: WorkflowMachineDefinition;
    runDir: string;
    runRecord: RunRecord;
    snapshot: WorkflowMachineSnapshot;
  }) {
    this.definition = options.definition;
    this.runDir = options.runDir;
    this.runRecord = clone(options.runRecord);
    this.snapshot = options.snapshot;
  }

  static async create(options: WorkflowControllerOptions): Promise<WorkflowController> {
    const snapshot = options.definition.createInitialSnapshot({
      intent: options.intent,
      stages: options.stages,
      ...(options.context ? { context: options.context } : {}),
      ...(options.activeSpecialists ? { activeSpecialists: options.activeSpecialists } : {}),
      ...(options.specialists ? { specialists: options.specialists } : {})
    });
    const controller = new WorkflowController({
      definition: options.definition,
      runDir: options.runDir,
      runRecord: options.runRecord,
      snapshot
    });
    await controller.persist();
    return controller;
  }

  get machineStatePath(): string {
    return path.join(this.runDir, "machine-state.json");
  }

  get stageLineagePath(): string {
    return path.join(this.runDir, "stage-lineage.json");
  }

  get currentSnapshot(): WorkflowMachineSnapshot {
    return clone(this.snapshot);
  }

  get currentRunRecord(): RunRecord {
    return deriveRunRecord(this.runRecord, this.snapshot);
  }

  get currentStageLineage(): StageLineage {
    return projectStageLineage(this.snapshot);
  }

  async send(event: WorkflowEvent, options: { runPatch?: RunRecordPatch } = {}): Promise<void> {
    this.snapshot = transition(this.definition, this.snapshot, event);
    if (options.runPatch) {
      this.runRecord = {
        ...this.runRecord,
        ...clone(options.runPatch),
        inputs: {
          ...this.runRecord.inputs,
          ...(options.runPatch.inputs ? clone(options.runPatch.inputs) : {})
        }
      };
    }
    await this.persist();
  }

  async patchRun(runPatch: RunRecordPatch): Promise<void> {
    this.runRecord = {
      ...this.runRecord,
      ...clone(runPatch),
      inputs: {
        ...this.runRecord.inputs,
        ...(runPatch.inputs ? clone(runPatch.inputs) : {})
      }
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    const derivedRun = deriveRunRecord(this.runRecord, this.snapshot);
    derivedRun.updatedAt = nowIso();
    this.runRecord = derivedRun;
    await writeJson(this.machineStatePath, this.snapshot);
    await writeJson(this.stageLineagePath, projectStageLineage(this.snapshot));
    await writeJson(path.join(this.runDir, "run.json"), this.runRecord);
  }
}
