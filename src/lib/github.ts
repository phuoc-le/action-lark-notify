import * as core from "@actions/core";
import * as github from "@actions/github";
import type { GitHub } from "@actions/github/lib/utils";

/**
 * Parse repository string to owner and repo
 * @param repository - repository string e.g. 'spongebob/sandbox'
 * @return object with owner and repo
 */
export function parseRepository(repository: string) {
  const separatorIndex = repository.indexOf("/");
  if (separatorIndex === -1)
    throw Error(`Invalid repository format '${repository}'`);
  return {
    owner: repository.substring(0, separatorIndex),
    repo: repository.substring(separatorIndex + 1),
  };
}

export async function getLatestDeploymentStatus(
  octokit: InstanceType<typeof GitHub>,
  repository: string,
  deploymentId: number,
) {
  return octokit.rest.repos
    .listDeploymentStatuses({
      ...parseRepository(repository),
      deployment_id: deploymentId,
      per_page: 1,
    })
    .then(({ data }) => {
      if (data.length === 0) return undefined;
      return data[0];
    });
}

export async function getReleaseUrl() {
  try {
    const context = github.context;
    const inputs = {
      token: core.getInput("token", { required: true }),
    };

    const octokit = github.getOctokit(inputs.token);

    // Get owner and repo from context of payload that triggered the action
    const { owner, repo } = context.repo;

    // Get the tag name from the triggered action
    const tagName = context.ref;
    core.info(`TAGNAME: ${tagName}`);

    // This removes the 'refs/tags' portion of the string, i.e. from 'refs/tags/v1.10.15' to 'v1.10.15'
    const tag = tagName.replace("refs/tags/", "");

    // Get a release from the tag name
    // API Documentation: https://developer.github.com/v3/repos/releases/#create-a-release
    // Octokit Documentation: https://octokit.github.io/rest.js/#octokit-routes-repos-create-release
    const getReleaseResponse = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag,
    });

    // Get the outputs for the created release from the response
    const {
      data: {
        id: releaseId,
        html_url: htmlUrl,
        upload_url: uploadUrl,
        name,
        body,
        draft,
        prerelease,
        author,
      },
    } = getReleaseResponse;

    process.env.GITHUB_RELEASE_URL = htmlUrl;

    core.info(`GITHUB_RELEASE_URL: ${process.env.GITHUB_RELEASE_URL}`);
  } catch {
    core.warning("Not found release URL");
  }
}

export async function getReleaseUrlByBranch() {
  try {
    const inputs = {
      token: core.getInput("token", { required: true }),
    };

    const branch = core.getInput("branch", { required: true });
    const octokit = github.getOctokit(inputs.token);
    const { owner, repo } = github.context.repo;

    const releases = await octokit.rest.repos.listReleases({
      owner,
      repo,
      per_page: 100,
    });

    const release = releases.data.find(
      (r) => r.target_commitish === branch && !r.draft,
    );

    if (!release) {
      core.setFailed(`No release found for branch: ${branch}`);
      return;
    }

    core.setOutput("release_tag", release.tag_name);
    core.info(`Latest release on branch "${branch}": ${release.tag_name}`);

    process.env.GITHUB_RELEASE_URL_BY_BRANCH = release.html_url;
    core.info(
      `GITHUB_RELEASE_URL: ${process.env.GITHUB_RELEASE_URL_BY_BRANCH}`,
    );
  } catch {
    core.warning("Not found release URL");
  }
}

export type DeploymentStatus =
  | "error"
  | "failure"
  | "inactive"
  | "in_progress"
  | "queued"
  | "pending"
  | "success";
