import * as core from "@actions/core";
import { enhanceEnv } from "./enhance-env";
import { notify } from "./utils";

export async function run() {
  try {
    await enhanceEnvironment();
    await notify().then(() => {
      core.info("Notify succeeded.");
    });
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(`Notify failed. Error message: ${error.message}`);
    }
  }
}

const enhanceEnvironment = async () => {
  try {
    await enhanceEnv();
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Enhance failed. Error message: ${error.message}`);
    }
  }
};
