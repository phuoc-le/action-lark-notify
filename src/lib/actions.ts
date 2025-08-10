import * as core from "@actions/core";
import { Context } from "@actions/github/lib/context.js";
import type { GitHub } from "@actions/github/lib/utils";
import { _throw, sleep } from "./common.js";

// cache of getCurrentJob result
let _currentJob: Awaited<ReturnType<typeof getCurrentJob>>;

class EnhancedContext extends Context {
  get repository() {
    return `${this.repo.owner}/${this.repo.repo}`;
  }

  runAttempt: number = Number.parseInt(
    process.env.GITHUB_RUN_ATTEMPT ??
      _throw(new Error("Missing environment variable: RUNNER_NAME")),
    10,
  );

  get runUrl() {
    return `${this.serverUrl}/${this.repository}/actions/runs/${this.runId}${this.runAttempt ? `/attempts/${this.runAttempt}` : ""}`;
  }

  get runnerName() {
    return (
      process.env.RUNNER_NAME ??
      _throw(new Error("Missing environment variable: RUNNER_NAME"))
    );
  }
}

export const context = new EnhancedContext();

/**
 * Get the current job from the workflow run
 * @returns the current job
 */
/**
 * Get the current job from the workflow run
 * @returns the current job
 */
export async function getCurrentJob(
  octokit: InstanceType<typeof GitHub>,
): Promise<typeof currentJobObject> {
  if (_currentJob) return _currentJob;

  type JobT = Awaited<ReturnType<typeof listJobsForCurrentWorkflowRun>>[number];

  const toMs = (s?: string | null) => {
    if (!s) return Number.POSITIVE_INFINITY;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const firstTime = (j: JobT) =>
    Math.min(toMs(j.started_at), toMs(j.created_at));
  const byFirstAsc = (a: JobT, b: JobT) =>
    firstTime(a) - firstTime(b) || (a.id ?? 0) - (b.id ?? 0);

  const pickFailedOrFirst = (pool: JobT[]): JobT | null => {
    if (!pool.length) return null;
    const failed = pool
      .filter((j) => j.conclusion === "failure")
      .sort(byFirstAsc);
    if (failed.length) return failed[0];
    return [...pool].sort(byFirstAsc)[0] ?? null;
  };

  let currentJob: JobT | null = null;

  const retryMaxAttempts = 100;
  const retryDelay = 3000;
  let retryAttempt = 0;

  do {
    retryAttempt++;
    if (retryAttempt > 1) await sleep(retryDelay);

    core.debug(
      `Try to determine current job, attempt ${retryAttempt}/${retryMaxAttempts}`,
    );

    const jobs = await listJobsForCurrentWorkflowRun();
    core.debug(
      `runner_name: ${context.runnerName}\nworkflow_run_jobs:${JSON.stringify(jobs, null, 2)}`,
    );

    const selfJob =
      jobs.find((j) => j.runner_name === context.runnerName) ?? null;

    let pool: JobT[] = jobs;
    if (selfJob?.name?.includes(" / ")) {
      const prefix = selfJob.name.split(" / ")[0];
      pool = jobs.filter((j) => (j.name ?? "").startsWith(prefix + " / "));
      core.debug(
        `Group prefix: "${prefix}", grouped jobs: ${pool.map((j) => j.name).join(", ")}`,
      );
      if (pool.length === 0) pool = jobs;
    }

    currentJob = pickFailedOrFirst(pool);

    if (currentJob) {
      core.debug(`Picked job: ${JSON.stringify(currentJob, null, 2)}`);
    } else {
      core.debug("No matching job found yet.");
    }
  } while (!currentJob && retryAttempt < retryMaxAttempts);

  if (!currentJob) {
    throw new Error("Current job could not be determined.");
  }

  const currentJobObject = { ...currentJob };
  _currentJob = currentJobObject;
  return _currentJob;

  async function listJobsForCurrentWorkflowRun() {
    return octokit
      .paginate(octokit.rest.actions.listJobsForWorkflowRunAttempt, {
        ...context.repo,
        run_id: context.runId,
        attempt_number: context.runAttempt,
      })
      .catch((error) => {
        if (error.status === 403) {
          throwPermissionError({ scope: "actions", permission: "read" }, error);
        }
        throw error;
      });
  }
}

/**
 * Throw a permission error
 * @param permission - GitHub Job permission
 * @param options - error options
 * @returns void
 */
export function throwPermissionError(
  permission: { scope: string; permission: string },
  options?: ErrorOptions,
): never {
  throw new PermissionError(
    `Ensure that GitHub job has permission: \`${permission.scope}: ${permission.permission}\`. https://docs.github.com/en/actions/security-guides/automatic-token-authentication#modifying-the-permissions-for-the-github_token`,
    permission,
    options,
  );
}

export class PermissionError extends Error {
  scope: string;
  permission: string;

  constructor(
    msg: string,
    permission: { scope: string; permission: string },
    options?: ErrorOptions,
  ) {
    super(msg, options);

    this.scope = permission.scope;
    this.permission = permission.permission;

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}
