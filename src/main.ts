import core from "@actions/core";
import { notify } from "./utils";

export async function run() {
  try {
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
