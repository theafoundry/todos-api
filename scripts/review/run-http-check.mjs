import {
  checkChallenge,
  checkDiscovery,
  checkOAuth,
  checkPolicies,
  checkUserInfo,
  checkWidget,
} from "./http-checks.mjs";

const checks = {
  challenge: checkChallenge,
  discovery: checkDiscovery,
  oauth: checkOAuth,
  policies: checkPolicies,
  userinfo: checkUserInfo,
  widget: checkWidget,
};

const name = process.argv[2];
if (!name || !(name in checks)) {
  console.error(`Choose one of: ${Object.keys(checks).join(", ")}`);
  process.exit(2);
}

try {
  await checks[name]();
} catch (error) {
  console.error(`${name}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
