import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import type { EvalContext } from "./merge-utils";

type NormalizedCtx = Required<EvalContext>;

function normalizeCtx(ctx: EvalContext): NormalizedCtx {
	return {
		envs: ctx.envs ?? {},
		vars: ctx.vars ?? {},
		github: ctx.github ?? {},
		matrix: ctx.matrix ?? {},
		job: ctx.job ?? {},
		steps: ctx.steps ?? {},
	};
}

function maskIfSecretLike(k: string, v: string) {
	if (/(TOKEN|SECRET|PASSWORD|KEY)/i.test(k)) {
		try {
			core.setSecret(v);
		} catch {}
	}
}

function setEnv(name: string, value: unknown, envs: Record<string, string>) {
	const s = value == null ? "" : String(value);
	process.env[name] = s;
	envs[name] = s;
	core.exportVariable(name, s);
	maskIfSecretLike(name, s);
}

/**
 * Run inline code or a file at scriptPath. If script returns an object,
 * its keys are merged into env (exported). Use setEnv() inside the script for explicit export.
 */
export async function runEnvScript(options: {
	scriptInline?: string;
	scriptPath?: string;
	ctx: EvalContext;
	timeoutMs?: number;
}): Promise<void> {
	const { scriptInline, scriptPath, timeoutMs = 2000 } = options;
	const full = normalizeCtx(options.ctx);

	let code = (scriptInline ?? "").trim();
	if (!code && scriptPath) {
		const abs = path.resolve(process.cwd(), scriptPath);
		if (!fs.existsSync(abs)) throw new Error(`scriptPath not found: ${abs}`);
		code = fs.readFileSync(abs, "utf8");
	}
	if (!code) return;

	const sandbox: {
		envs: NormalizedCtx["envs"];
		vars: NormalizedCtx["vars"];
		github: NormalizedCtx["github"];
		matrix: NormalizedCtx["matrix"];
		job: NormalizedCtx["job"];
		steps: NormalizedCtx["steps"];
		setEnv: (k: string, v: unknown) => void;
		console: Console;
	} = {
		envs: full.envs,
		vars: full.vars,
		github: full.github,
		matrix: full.matrix,
		job: full.job,
		steps: full.steps,
		setEnv: (k, v) => setEnv(k, v, full.envs),
		console,
	};

	const wrapped = `(async () => { ${code}\n })()`;
	const context = vm.createContext(sandbox, { name: "env-script-sandbox" });
	const script = new vm.Script(wrapped, {
		filename: scriptPath ?? "inline-env-script.js",
	});
	const result: unknown = await script.runInNewContext(context, {
		timeout: timeoutMs,
	});

	if (result && typeof result === "object" && !Array.isArray(result)) {
		for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
			setEnv(k, v, full.envs);
		}
	}
}
