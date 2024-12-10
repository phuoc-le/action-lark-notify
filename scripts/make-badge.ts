import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeBadge } from "badge-maker";
import { version } from "../package.json";

const target = path.resolve(__dirname, "../badge.svg");

const svg = makeBadge({
  label: "Version",
  message: version,
  color: "#2ea44f",
});

writeFileSync(target, svg);
