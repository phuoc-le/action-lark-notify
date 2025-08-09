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

  let currentJob:
    | Awaited<ReturnType<typeof listJobsForCurrentWorkflowRun>>[number]
    | null = null;
  // retry to determine current job, because it takes some time until the job is available through the GitHub API
  const retryMaxAttempts = 100;
  const retryDelay = 3000;
  let retryAttempt = 0;
  do {
    retryAttempt++;
    if (retryAttempt > 1) await sleep(retryDelay);
    core.debug(
      `Try to determine current job, attempt ${retryAttempt}/${retryMaxAttempts}`,
    );
    const currentWorkflowRunJobs = await listJobsForCurrentWorkflowRun();
    core.debug(
      `runner_name: ${context.runnerName}\nworkflow_run_jobs:${JSON.stringify(currentWorkflowRunJobs, null, 2)}`,
    );
    const currentJobs = currentWorkflowRunJobs.filter(
      (job) => job.status === "in_progress" || job.status === "queued",
    );

    if (currentJobs.length > 0) {
      core.debug(`currentJobs: ${JSON.stringify(currentJobs, null, 2)}`);
      currentJob = currentJobs[0];
      core.debug(`job:${JSON.stringify(currentJob, null, 2)}`);
    } else {
      core.debug("No matching job found in workflow run.");
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
