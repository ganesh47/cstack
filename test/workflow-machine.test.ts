import { describe, expect, it } from "vitest";
import { currentStageFromSnapshot, getWorkflowMachineDefinition, projectStageLineage, transition } from "../src/workflow-machine.js";
import type { RoutingStagePlan, StageLineage } from "../src/types.js";

function stage(name: RoutingStagePlan["name"]): RoutingStagePlan {
  return {
    name,
    rationale: `${name} rationale`,
    status: "planned",
    executed: false
  };
}

describe("workflow machine", () => {
  it("keeps review runs completed when execution succeeds but verdict is blocked", () => {
    const definition = getWorkflowMachineDefinition("review");
    let snapshot = definition.createInitialSnapshot({
      intent: "Review the current change",
      stages: [stage("review")]
    });

    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "review",
      status: "running"
    });
    snapshot = transition(definition, snapshot, {
      type: "REVIEW_FINALIZED",
      executionSucceeded: true,
      verdictStatus: "blocked",
      summary: "Analysis completed with blockers."
    });

    expect(snapshot.runStatus).toBe("completed");
    expect(snapshot.visibleStages[0]?.status).toBe("completed");
    expect(snapshot.context.reviewVerdictStatus).toBe("blocked");
    expect(currentStageFromSnapshot(snapshot)).toBeUndefined();
  });

  it("fails ship runs when readiness or GitHub delivery is blocked", () => {
    const definition = getWorkflowMachineDefinition("ship");
    let snapshot = definition.createInitialSnapshot({
      intent: "Ship the current change",
      stages: [stage("ship")]
    });

    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "ship",
      status: "running"
    });
    snapshot = transition(definition, snapshot, {
      type: "SHIP_FINALIZED",
      readiness: "blocked",
      githubDeliveryStatus: "blocked",
      hasMutationBlockers: true,
      summary: "Required checks are still blocked."
    });

    expect(snapshot.runStatus).toBe("failed");
    expect(snapshot.visibleStages[0]?.status).toBe("failed");
  });

  it("defers downstream deliver stages after a build failure", () => {
    const definition = getWorkflowMachineDefinition("deliver");
    let snapshot = definition.createInitialSnapshot({
      intent: "Deliver the approved change",
      stages: [stage("build"), stage("validation"), stage("review"), stage("ship")]
    });

    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "build",
      status: "running"
    });
    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "build",
      status: "failed",
      executed: true,
      notes: "Build failed after Codex started work."
    });

    expect(snapshot.visibleStages.find((entry) => entry.name === "build")?.status).toBe("failed");
    expect(snapshot.visibleStages.find((entry) => entry.name === "validation")?.status).toBe("deferred");
    expect(snapshot.visibleStages.find((entry) => entry.name === "review")?.status).toBe("deferred");
    expect(snapshot.visibleStages.find((entry) => entry.name === "ship")?.status).toBe("deferred");
  });

  it("mirrors child workflow lineage into the parent intent machine", () => {
    const definition = getWorkflowMachineDefinition("intent");
    let snapshot = definition.createInitialSnapshot({
      intent: "Implement the approved change",
      stages: [stage("discover"), stage("spec"), stage("build"), stage("review"), stage("ship")]
    });

    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "build",
      status: "running",
      executed: true
    });

    const childStageLineage: StageLineage = {
      intent: "Deliver the approved change",
      stages: [
        {
          ...stage("build"),
          status: "planned",
          executed: false
        },
        {
          ...stage("validation"),
          status: "running",
          executed: false
        },
        {
          ...stage("review"),
          status: "planned",
          executed: false
        },
        {
          ...stage("ship"),
          status: "planned",
          executed: false
        }
      ],
      specialists: []
    };

    snapshot = transition(definition, snapshot, {
      type: "SYNC_CHILD",
      stageName: "build",
      child: {
        stageName: "build",
        runId: "deliver-run-1",
        workflow: "deliver",
        status: "running",
        currentStage: "validation"
      },
      childStageLineage,
      childActiveSpecialists: ["release-pipeline-review"]
    });

    expect(snapshot.visibleStages.find((entry) => entry.name === "build")?.status).toBe("running");
    expect(snapshot.visibleStages.find((entry) => entry.name === "review")?.status).toBe("planned");
    expect(snapshot.activeSpecialists).toEqual(["release-pipeline-review"]);
    expect(projectStageLineage(snapshot).stages.find((entry) => entry.name === "build")?.childRunId).toBe("deliver-run-1");
  });

  it("finalizes intent runs based on failed visible stages", () => {
    const definition = getWorkflowMachineDefinition("intent");
    let snapshot = definition.createInitialSnapshot({
      intent: "Implement the approved change",
      stages: [stage("discover"), stage("spec"), stage("build"), stage("review"), stage("ship")]
    });

    snapshot = transition(definition, snapshot, {
      type: "SET_STAGE_STATUS",
      stageName: "build",
      status: "failed",
      executed: true,
      notes: "Downstream build failed."
    });
    snapshot = transition(definition, snapshot, {
      type: "INTENT_FINALIZED",
      summary: "Intent run finished with downstream workflow failures",
      error: "build failed"
    });

    expect(snapshot.runStatus).toBe("failed");
    expect(snapshot.error).toBe("build failed");
  });
});
