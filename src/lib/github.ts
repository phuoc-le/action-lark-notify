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
  const context = github.context;
  const inputs = {
    token: core.getInput("token", { required: true }),
  };

  const octokit = github.getOctokit(inputs.token);

  // Get owner and repo from context of payload that triggered the action
  const { owner, repo } = context.repo;

  // Get the tag name from the triggered action
  const tagName = context.ref;

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
}

export type DeploymentStatus =
  | "error"
  | "failure"
  | "inactive"
  | "in_progress"
  | "queued"
  | "pending"
  | "success";
