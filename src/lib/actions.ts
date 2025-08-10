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
export async function getCurrentJob(
  octokit: InstanceType<typeof GitHub>,
): Promise<typeof currentJobObject> {
  if (_currentJob) return _currentJob;

  const githubRunnerNameMatch = context.runnerName.match(
    /^GitHub-Actions-(?<id>\d+)$/,
  );
  const runnerNumber = githubRunnerNameMatch?.groups?.id
    ? Number.parseInt(githubRunnerNameMatch.groups.id, 10)
    : null;

  type JobT = Awaited<ReturnType<typeof listJobsForCurrentWorkflowRun>>[number];

  const toMs = (s?: string | null) => {
    if (!s) return Number.NEGATIVE_INFINITY;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  const compareIsoDesc = (a?: string | null, b?: string | null) => {
    const ta = toMs(a),
      tb = toMs(b);
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  };
  const isSameRunner = (job: JobT) => {
    if (job.runner_group_id === 0 && job.runner_name === "GitHub Actions") {
      return runnerNumber != null && job.runner_id === runnerNumber;
    }
    return job.runner_name === context.runnerName;
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

    const sameRunner = jobs.filter(isSameRunner);

    const inProgress = sameRunner
      .filter((j) => j.status === "in_progress")
      .sort((a, b) => compareIsoDesc(a.started_at, b.started_at));
    if (inProgress.length > 0) {
      currentJob = inProgress[0];
    }

    if (!currentJob && sameRunner.length > 0) {
      currentJob = [...sameRunner].sort((a, b) => {
        const cmp = compareIsoDesc(a.started_at, b.started_at);
        return cmp !== 0 ? cmp : (b.id ?? 0) - (a.id ?? 0);
      })[0];
    }

    if (!currentJob) {
      core.debug("No matching job found in workflow run for this runner yet.");
    } else {
      core.debug(`job:${JSON.stringify(currentJob, null, 2)}`);
    }
  } while (!currentJob && retryAttempt < retryMaxAttempts);

  if (!currentJob) {
    throw new Error("Current job could not be determined.");
  }

  const currentJobObject = {
    ...currentJob,
  };
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
