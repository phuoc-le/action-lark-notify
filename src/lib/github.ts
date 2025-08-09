import * as core from "@actions/core";
import * as github from "@actions/github";

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
    core.info(`Found release tag: ${release.tag_name}`);

    process.env.GITHUB_RELEASE_URL_BY_BRANCH = release.html_url;
    core.info(`GITHUB_RELEASE_URL_BY_BRANCH: ${release.html_url}`);
  } catch (error) {
    core.warning("Failed to find release URL");
    core.warning(String(error));
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
