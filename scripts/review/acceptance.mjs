import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "review:metadata"]],
  ["npm", ["run", "review:challenge"]],
  ["npm", ["run", "review:discovery"]],
  ["npm", ["run", "review:oauth"]],
  ["npm", ["run", "review:userinfo"]],
  ["npm", ["run", "review:policies"]],
  ["npm", ["run", "review:widget"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("Automated hosted acceptance checks passed.");
console.log(
  "Complete authenticated OAuth, ChatGPT conversation, portal scan, and accessibility evidence manually before merge.",
);
