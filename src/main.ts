import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { enhanceEnv } from "./enhance-env";
import { notify } from "./utils";

export async function run() {
  try {
    if (process.argv[1] === fileURLToPath(import.meta.url)) {
      await enhanceEnv();
    }

    notify().then(() => {
      core.info("Notify succeeded.");
    });
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(`Notify failed. Error message: ${error.message}`);
    }
  }
}
