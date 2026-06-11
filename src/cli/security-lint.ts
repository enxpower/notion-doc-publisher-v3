/**
 * Security configuration lint.
 *
 * Pure environment-variable inspection — performs NO Notion reads or writes
 * and touches no files. It exists because several env flags relax privacy
 * boundaries (legacy URL emission, public register, robots exposure), and a
 * single misconfiguration can make private documents enumerable.
 *
 * Exit codes:
 *   0 — configuration is safe (warnings may still be printed)
 *   1 — a dangerous combination was detected (CI should fail)
 *
 * Run standalone:  npm run lint:security
 */

type Finding = { level: "DANGER" | "WARN"; message: string };

export function lintSecurityConfig(env: NodeJS.ProcessEnv = process.env): Finding[] {
  const findings: Finding[] = [];
  const isTrue = (name: string) => env[name] === "true";
  const isFalseDefaultTrue = (name: string) => env[name] === "false";

  if (isTrue("LEGACY_UNLISTED_DOCS_PATH")) {
    findings.push({
      level: "DANGER",
      message:
        "LEGACY_UNLISTED_DOCS_PATH=true emits Unlisted documents at /docs/{DOC_ID}/. " +
        "Sequential DOC_IDs make these URLs guessable; private documents become enumerable."
    });
  }

  if (isTrue("LEGACY_PRIVATE_DOC_ID_URLS")) {
    findings.push({
      level: "DANGER",
      message:
        "LEGACY_PRIVATE_DOC_ID_URLS=true exposes DOC_ID inside private link paths " +
        "(/{ns}/{DOC_ID}-{token}/). DOC_ID must never appear in externally shared private URLs."
    });
  }

  if (isTrue("LEGACY_UNLISTED_DOCS_PATH") && !isTrue("ROBOTS_DISALLOW_DOCS")) {
    findings.push({
      level: "DANGER",
      message:
        "LEGACY_UNLISTED_DOCS_PATH=true without ROBOTS_DISALLOW_DOCS=true: legacy unlisted " +
        "paths under /docs/ are not even robots-disallowed. Crawlers may index private documents."
    });
  }

  if (isFalseDefaultTrue("AUTO_GENERATE_SHARE_TOKEN") && env.ALLOW_MISSING_SHARE_TOKEN === "true") {
    findings.push({
      level: "DANGER",
      message:
        "AUTO_GENERATE_SHARE_TOKEN=false with ALLOW_MISSING_SHARE_TOKEN=true: private-link " +
        "documents may build without any Share Token, producing unprotected paths."
    });
  }

  if (isTrue("DOCUMENT_REGISTER_PUBLIC") && isTrue("ROBOTS_DISALLOW_DOCS")) {
    findings.push({
      level: "WARN",
      message:
        "DOCUMENT_REGISTER_PUBLIC=true while ROBOTS_DISALLOW_DOCS=true: the register is public " +
        "but the documents it links to are robots-disallowed. Verify this asymmetry is intentional."
    });
  }

  return findings;
}

export function reportFindings(findings: Finding[]): boolean {
  if (findings.length === 0) {
    console.log("Security lint: configuration is safe.");
    return true;
  }
  let blocked = false;
  for (const f of findings) {
    const line = `Security lint [${f.level}]: ${f.message}`;
    if (f.level === "DANGER") {
      console.error(line);
      blocked = true;
    } else {
      console.warn(line);
    }
  }
  if (blocked) {
    console.error(
      "Security lint failed. Set SECURITY_LINT_ACKNOWLEDGE=true only if you fully understand " +
        "the exposure and accept it for this build target."
    );
  }
  return !blocked;
}

const isMain = process.argv[1]?.endsWith("security-lint.js");
if (isMain) {
  const findings = lintSecurityConfig();
  const ok = reportFindings(findings);
  if (!ok && process.env.SECURITY_LINT_ACKNOWLEDGE !== "true") {
    process.exitCode = 1;
  }
}
