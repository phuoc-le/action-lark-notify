import * as core from "@actions/core";
import { enhanceEnv } from "./enhance-env";
import { buildCtx } from "./lib/github";
import { runEnvScript } from "./lib/script-utils";
import { notify } from "./utils";

export async function run() {
	try {
		await enhanceEnvironment();

		const scriptInline = core.getInput("scriptInline") || "";
		const scriptPath = core.getInput("scriptPath") || "";
		const ctx = buildCtx();

		await runEnvScript({
			scriptInline,
			scriptPath,
			ctx: ctx,
			timeoutMs: 2000,
		});

		await notify(ctx).then(() => {
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
