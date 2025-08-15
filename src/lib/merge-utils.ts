export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
	| JsonPrimitive
	| { [k: string]: JsonValue }
	| JsonValue[];

export type MergeVariable = {
	envs?: Record<string, string>;
	vars?: Record<string, JsonValue>;
	github?: Record<string, unknown>;
	matrix?: Record<string, unknown>;
	job?: Record<string, unknown>;
	steps?: Record<string, unknown>;
};

type Tok =
	| { t: "id"; v: string }
	| { t: "str"; v: string }
	| { t: "num"; v: number }
	| { t: "bool"; v: boolean }
	| { t: "null" }
	| { t: "op"; v: string }
	| { t: "lparen" }
	| { t: "rparen" };

const ID_START = /[A-Za-z_]/;
const ID_PART = /[A-Za-z0-9_.\-[\]_]/;
const isWS = (c: string) => /\s/.test(c);
const isNum = (c: string) => /[0-9]/.test(c);

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === "object";

const toNumber = (v: unknown): number => {
	if (typeof v === "number") return v;
	if (typeof v === "string") return Number(v);
	if (typeof v === "boolean") return v ? 1 : 0;
	return Number(v);
};

const stringifyValue = (v: unknown): string =>
	v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

const isNil = (v: unknown): v is null | undefined =>
	v === null || v === undefined;
const isNumericLike = (v: unknown): boolean =>
	typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));

function looseEqual(a: unknown, b: unknown): boolean {
	if (isNil(a) && isNil(b)) return true;
	if (typeof a === "boolean" || typeof b === "boolean") {
		return toNumber(a) === toNumber(b);
	}
	if (isNumericLike(a) && isNumericLike(b)) {
		return Number(a) === Number(b);
	}
	return a === b || String(a) === String(b);
}

function getFromProcessEnv(key: string): string | undefined {
	return (
		process.env[key] ??
		process.env[key.toUpperCase?.()] ??
		process.env[key.toLowerCase?.()]
	);
}

function tokenize(s: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;

	while (i < s.length) {
		const c = s[i];
		if (isWS(c)) {
			i++;
			continue;
		}

		const three = s.slice(i, i + 3);
		if (three === "===" || three === "!==") {
			out.push({ t: "op", v: three });
			i += 3;
			continue;
		}

		const two = s.slice(i, i + 2);
		if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
			out.push({ t: "op", v: two });
			i += 2;
			continue;
		}

		if ("><!+-*/%".includes(c)) {
			out.push({ t: "op", v: c });
			i++;
			continue;
		}

		if (c === "(") {
			out.push({ t: "lparen" });
			i++;
			continue;
		}
		if (c === ")") {
			out.push({ t: "rparen" });
			i++;
			continue;
		}

		if (c === '"' || c === "'") {
			const q = c;
			i++;
			let buf = "";
			while (i < s.length) {
				const ch = s[i];
				if (ch === "\\") {
					buf += s[i + 1] ?? "";
					i += 2;
					continue;
				}
				if (ch === q) {
					i++;
					break;
				}
				buf += ch;
				i++;
			}
			out.push({ t: "str", v: buf });
			continue;
		}

		if (isNum(c) || (c === "." && isNum(s[i + 1] ?? ""))) {
			let j = i;
			while (j < s.length && /[0-9._]/.test(s[j])) j++;
			const n = Number(s.slice(i, j).replace(/_/g, ""));
			out.push({ t: "num", v: n });
			i = j;
			continue;
		}

		if (ID_START.test(c)) {
			let j = i + 1;
			while (j < s.length && ID_PART.test(s[j])) j++;
			const ident = s.slice(i, j);
			if (ident === "true") out.push({ t: "bool", v: true });
			else if (ident === "false") out.push({ t: "bool", v: false });
			else if (ident === "null") out.push({ t: "null" });
			else out.push({ t: "id", v: ident });
			i = j;
			continue;
		}

		throw new Error(`Unexpected character '${c}' at ${i}`);
	}

	return out;
}

class Parser {
	private i = 0;
	constructor(
		private toks: Tok[],
		private ctx: Required<MergeVariable>,
	) {}

	parse(): unknown {
		const v = this.parseOr();
		if (this.i !== this.toks.length)
			throw new Error("Unexpected trailing tokens");
		return v;
	}
	private peek(): Tok | undefined {
		return this.toks[this.i];
	}
	private eat(): Tok {
		return this.toks[this.i++];
	}

	private parseOr(): unknown {
		let left = this.parseAnd();
		let p = this.peek();
		while (p?.t === "op" && p.v === "||") {
			this.eat();
			const right = this.parseAnd();
			left = this.truthy(left) ? left : right;
			p = this.peek();
		}
		return left;
	}

	private parseAnd(): unknown {
		let left = this.parseEquality();
		let p = this.peek();
		while (p?.t === "op" && p.v === "&&") {
			this.eat();
			const right = this.parseEquality();
			left = this.truthy(left) ? right : left;
			p = this.peek();
		}
		return left;
	}

	private parseEquality(): unknown {
		let left = this.parseAddSub();
		let p = this.peek();
		while (
			p?.t === "op" &&
			["==", "!=", "===", "!==", ">", ">=", "<", "<="].includes(p.v)
		) {
			const op = this.eat() as { t: "op"; v: string };
			const right = this.parseAddSub();
			switch (op.v) {
				case "==":
					left = looseEqual(this.coerce(left), this.coerce(right));
					break;
				case "!=":
					left = !looseEqual(this.coerce(left), this.coerce(right));
					break;
				case "===":
					left = this.coerce(left) === this.coerce(right);
					break;
				case "!==":
					left = this.coerce(left) !== this.coerce(right);
					break;
				case ">":
					left = toNumber(left) > toNumber(right);
					break;
				case ">=":
					left = toNumber(left) >= toNumber(right);
					break;
				case "<":
					left = toNumber(left) < toNumber(right);
					break;
				case "<=":
					left = toNumber(left) <= toNumber(right);
					break;
			}
			p = this.peek();
		}
		return left;
	}

	private parseAddSub(): unknown {
		let left = this.parseMulDiv();
		let p = this.peek();
		while (p?.t === "op" && (p.v === "+" || p.v === "-")) {
			const op = this.eat() as { t: "op"; v: string };
			const right = this.parseMulDiv();
			if (op.v === "+") {
				left =
					isString(left) || isString(right)
						? String(left) + String(right)
						: toNumber(left) + toNumber(right);
			} else {
				left = toNumber(left) - toNumber(right);
			}
			p = this.peek();
		}
		return left;
	}

	private parseMulDiv(): unknown {
		let left = this.parseUnary();
		let p = this.peek();
		while (p?.t === "op" && (p.v === "*" || p.v === "/" || p.v === "%")) {
			const op = this.eat() as { t: "op"; v: string };
			const right = this.parseUnary();
			if (op.v === "*") left = toNumber(left) * toNumber(right);
			else if (op.v === "/") left = toNumber(left) / toNumber(right);
			else left = toNumber(left) % toNumber(right);
			p = this.peek();
		}
		return left;
	}

	private parseUnary(): unknown {
		const pk = this.peek();
		if (pk?.t === "op" && pk.v === "!") {
			this.eat();
			return !this.truthy(this.parseUnary());
		}
		return this.parsePrimary();
	}

	private parsePrimary(): unknown {
		const tok = this.eat();
		if (!tok) throw new Error("Unexpected end of expression");
		switch (tok.t) {
			case "lparen": {
				const v = this.parseOr();
				const rp = this.eat();
				if (!rp || rp.t !== "rparen") throw new Error("Missing )");
				return v;
			}
			case "str":
				return tok.v;
			case "num":
				return tok.v;
			case "bool":
				return tok.v;
			case "null":
				return null;
			case "id":
				return this.resolveIdentifier(tok.v);
			default:
				throw new Error("Unexpected token");
		}
	}

	private resolveIdentifier(path: string): unknown {
		const [root, ...rest] = path.split(".");
		const roots = this.ctx as Record<string, unknown>;

		if (root === "appEnv" || root === "processEnv") {
			if (rest.length === 0) return undefined;
			const key = rest.join(".");
			return getFromProcessEnv(key);
		}

		if (!Object.hasOwn(roots, root)) {
			const fromEnv =
				this.ctx.envs[root] ??
				this.ctx.envs[root.toUpperCase?.()] ??
				this.ctx.envs[root.toLowerCase?.()];
			if (typeof fromEnv !== "undefined")
				return rest.length ? undefined : fromEnv;
		}

		let cur: unknown = roots[root];
		for (const seg of rest) {
			if (cur == null) return undefined;
			if (root === "envs") {
				if (!isRecord(cur)) return undefined;
				const envs = cur as Record<string, unknown>;
				cur =
					envs[seg] ?? envs[seg.toUpperCase?.()] ?? envs[seg.toLowerCase?.()];
			} else {
				if (!isRecord(cur)) return undefined;
				cur = (cur as Record<string, unknown>)[seg];
			}
		}
		return cur;
	}

	private truthy(v: unknown): boolean {
		return !!v;
	}
	private coerce(v: unknown): unknown {
		if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
		return v;
	}
}

export function evaluateExpression(expr: string, ctx: MergeVariable): unknown {
	const tokens = tokenize(expr);
	const parser = new Parser(tokens, normalizeCtx(ctx));
	return parser.parse();
}

export function replaceEnvPlaceholders(
	template: string,
	ctx: MergeVariable,
): string {
	const fullCtx = normalizeCtx(ctx);
	return template.replace(/{{\s*([^}]+)\s*}}/g, (_m, inner) => {
		const v = evaluateExpression(String(inner), fullCtx);
		return stringifyValue(v);
	});
}

export type NormalizedCtx = Required<MergeVariable>;
export function normalizeCtx(ctx: MergeVariable): Required<MergeVariable> {
	return {
		envs: ctx.envs ?? {},
		vars: ctx.vars ?? {},
		github: ctx.github ?? {},
		matrix: ctx.matrix ?? {},
		job: ctx.job ?? {},
		steps: ctx.steps ?? {},
	};
}
