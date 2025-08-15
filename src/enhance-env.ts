import * as process from "node:process";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { context, getCurrentJob } from "./lib/actions.js";
import { sleep } from "./lib/common.js";
import { getReleaseUrlByBranch, getReleaseUrlByTag } from "./lib/github.js";

export const enhanceEnv = async () => {
	const inputs = {
		token: core.getInput("token", { required: true }),
	};

	const octokit = github.getOctokit(inputs.token);

	// --- due to some eventual consistency issues with the GitHub API, we need to take a short break
	await sleep(2000);

	await getReleaseUrlByBranch();
	await getReleaseUrlByTag();

	await getCurrentJob(octokit).then((job: any) => {
		if (core.isDebug()) {
			core.debug(JSON.stringify(job));
		}

		core.setOutput("run_id", job.run_id);
		core.setOutput("run_attempt", job.run_attempt);
		core.setOutput("run_number", context.runNumber);
		core.setOutput("run_url", context.runUrl);
		process.env.GITHUB_RUN_URL = job.runner_id?.toString() ?? undefined;

		core.setOutput("runner_name", context.runnerName);
		core.setOutput("runner_id", job.runner_id ?? "");
		process.env.RUNNER_ID = job.runner_id?.toString() ?? undefined;

		core.setOutput("job_name", job.name);
		process.env.GITHUB_JOB_NAME = job.name ?? "";
		core.setOutput("job_id", job.id);
		process.env.GITHUB_JOB_ID = String(job.id);
		core.setOutput("job_url", job.html_url ?? "");
		process.env.GITHUB_JOB_URL = job.html_url ?? "";
	});
};
