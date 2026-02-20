#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const progressPath = path.join(root, "rfcs/002-rewrite-in-rust/progress.md");

const progress = fs.readFileSync(progressPath, "utf8");

const movingForwardSectionMatch = progress.match(
	/## Moving Forward([\s\S]*)$/i
);
const movingForwardSection = movingForwardSectionMatch?.[1] ?? "";

function itemBlock(number) {
	const pattern = new RegExp(
		`\\n${number}\\.\\s+\\*\\*[^\\n]+\\*\\*([\\s\\S]*?)(?=\\n\\d+\\.\\s+\\*\\*|$)`,
		"i"
	);
	return movingForwardSection.match(pattern)?.[1] ?? "";
}

function itemIsCompleted(number) {
	const block = itemBlock(number);
	return /\n\s*-\s*Completed\b/i.test(block);
}

const requiredChecks = [
	{
		name: "Rust execution entrypoint wiring complete",
		match: /Status:\s+\*\*Entry-point wired in SDK rust mode\*\*/i,
	},
	{
		name: "Write mutation materialization complete",
		match: /Status:\s+\*\*Completed for state mutation paths \(INSERT\/UPDATE\/DELETE\)\*\*/i,
	},
	{
		name: "Read rewrite parity complete",
		match: { test: () => itemIsCompleted(2) },
	},
	{
		name: "Write mutation parity complete",
		match: { test: () => itemIsCompleted(3) },
	},
	{
		name: "Validation engine complete",
		match: { test: () => itemIsCompleted(4) },
	},
	{
		name: "Plugin change-detection parity complete",
		match: { test: () => itemIsCompleted(5) },
	},
	{
		name: "Parity/integration matrix complete",
		match: { test: () => itemIsCompleted(6) },
	},
	{
		name: "Rollout safeguards complete",
		match: { test: () => itemIsCompleted(7) },
	},
];

const failures = requiredChecks
	.filter((check) => !check.match.test(progress))
	.map((check) => check.name);

if (failures.length > 0) {
	console.error("Rust rollout gates are not green:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log("Rust rollout gates are green.");
