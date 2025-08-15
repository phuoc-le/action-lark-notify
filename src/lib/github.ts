import * as core from "@actions/core";
import * as github from "@actions/github";
import type { MergeVariable } from "./merge-utils";

export async function getReleaseUrlByBranch() {
	try {
		const inputs = {
			token: core.getInput("token"),
		};

		const ref = github.context.ref;
		const branch = ref.startsWith("refs/heads/")
			? ref.replace("refs/heads/", "")
			: ref;

		const octokit = github.getOctokit(inputs.token);
		const { owner, repo } = github.context.repo;

		const releases = await octokit.rest.repos.listReleases({
			owner,
			repo,
			per_page: 100,
		});

		let release = releases.data.find(
			(r) => r.target_commitish === branch && !r.draft,
		);

		if (!release) {
			core.debug(`No release found for branch: ${branch}`);
			core.debug("Trying to find release on default branch...");

			const repoInfo = await octokit.rest.repos.get({ owner, repo });
			const defaultBranch = repoInfo.data.default_branch;

			release = releases.data.find(
				(r) => r.target_commitish === defaultBranch && !r.draft,
			);

			if (!release) {
				core.debug(`No release found on default branch: ${defaultBranch}`);
				return;
			}
		}

		core.setOutput("release_tag", release.tag_name);
		process.env.GITHUB_RELEASE_TAG_NAME = release.tag_name;
		core.debug(`Found release tag: ${release.tag_name}`);

		process.env.GITHUB_RELEASE_URL_BY_BRANCH = release.html_url;
		core.debug(`GITHUB_RELEASE_URL_BY_BRANCH: ${release.html_url}`);
	} catch (error) {
		core.warning("Failed to find release URL");
		core.warning(String(error));
	}
}

export async function getReleaseUrlByTag() {
	try {
		const inputs = {
			token: core.getInput("token", { required: true }),
		};

		let tag = process.env.RELEASE_TAG;
		if (!tag) {
			const ref = github.context.ref;
			if (ref?.startsWith("refs/tags/")) {
				tag = ref.replace("refs/tags/", "");
			}
		}

		if (!tag) {
			core.warning(
				"No tag provided (inputs.tag/ref/process.env). Skip finding release by tag.",
			);
			return;
		}

		const octokit = github.getOctokit(inputs.token);
		const { owner, repo } = github.context.repo;

		let release:
			| Awaited<ReturnType<typeof octokit.rest.repos.getReleaseByTag>>["data"]
			| Awaited<
					ReturnType<typeof octokit.rest.repos.listReleases>
			  >["data"][number]
			| undefined;

		try {
			const byTag = await octokit.rest.repos.getReleaseByTag({
				owner,
				repo,
				tag,
			});
			release = byTag.data;

			if (release?.draft) {
				core.debug(
					`Release by tag '${tag}' is draft; try listReleases for non-draft.`,
				);
				const rels = await octokit.rest.repos.listReleases({
					owner,
					repo,
					per_page: 100,
				});
				const found = rels.data.find((r) => r.tag_name === tag && !r.draft);
				if (found) release = found;
			}
		} catch (e: unknown) {
			// @ts-expect-error - octokit error may have status
			if (e?.status === 404) {
				core.debug(
					`getReleaseByTag returned 404 for '${tag}', fallback to listReleases.`,
				);
				const rels = await octokit.rest.repos.listReleases({
					owner,
					repo,
					per_page: 100,
				});
				release = rels.data.find((r) => r.tag_name === tag && !r.draft);
			} else {
				core.debug(`getReleaseByTag error (non-404): ${String(e)}`);
				throw e;
			}
		}

		if (!release) {
			core.debug(`No non-draft release found for tag: ${tag}`);
			return;
		}

		process.env.GITHUB_RELEASE_TAG_NAME_BY_TAG = release.tag_name ?? tag;
		process.env.GITHUB_RELEASE_URL_BY_TAG = release.html_url ?? "";
		core.debug(`Found release by tag: ${release.tag_name}`);
		core.debug(`GITHUB_RELEASE_URL_BY_TAG: ${release.html_url}`);
	} catch (error) {
		core.warning("Failed to find release by tag");
		core.warning(String(error));
	}
}

export function buildCtx(): MergeVariable {
	const envs: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) envs[k] = v ?? "";

	const vars = process.env.VARS_JSON ? JSON.parse(process.env.VARS_JSON) : {};
	const github = process.env.GITHUB_JSON
		? JSON.parse(process.env.GITHUB_JSON)
		: {};
	const matrix = process.env.MATRIX_JSON
		? JSON.parse(process.env.MATRIX_JSON)
		: {};
	const job = process.env.JOB_JSON ? JSON.parse(process.env.JOB_JSON) : {};
	const steps = process.env.STEPS_JSON
		? JSON.parse(process.env.STEPS_JSON)
		: {};
	return { envs, vars, github, matrix, job, steps };
}
