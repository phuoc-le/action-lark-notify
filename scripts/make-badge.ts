import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeBadge } from "badge-maker";
import { version } from "../package.json";

const target = resolve(__dirname, "../badge.svg");

const svg = makeBadge({
  label: "Version",
  message: version,
  color: "#2ea44f",
});

writeFileSync(target, svg);
