import { execSync } from "child_process";

const token = process.env.GITHUB_PUSH_TOKEN;
if (!token) {
  console.error("GITHUB_PUSH_TOKEN is not set");
  process.exit(1);
}

const remote = "subrepl-87hnb1pp";
const repoUrl = `https://${token}@github.com/poyansandnell/vindkollen.git`;
const cleanUrl = "https://github.com/poyansandnell/vindkollen.git";

try {
  execSync(`git remote set-url ${remote} "${repoUrl}"`, { stdio: "inherit" });
  execSync(`git push ${remote} main`, { stdio: "inherit" });
  console.log("Push successful!");
} catch (err) {
  console.error("Push failed:", err);
  process.exit(1);
} finally {
  try {
    execSync(`git remote set-url ${remote} "${cleanUrl}"`, { stdio: "inherit" });
  } catch {}
}
