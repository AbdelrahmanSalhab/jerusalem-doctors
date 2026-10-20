// The production smoke test (.github/workflows/smoke.yml) signs in with a
// real admin account and uses the site like a person would. Its requests
// carry the GitHub Actions run they belong to, so the activity log says the
// sign-in was an automated test and its searches stay out of the usage stats.
//
// Anyone can send the header; all it does is label their own sign-in and
// leave their own searches uncounted, so it is validated for shape only.

export const CI_RUN_HEADER = "x-ci-run";

const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/attempts\/\d+)?$/;

/** The run URL a smoke-test request names, or null for everyone else. */
export function ciRunOf(req: Request): string | null {
  const v = req.headers.get(CI_RUN_HEADER)?.trim() ?? "";
  return v.length <= 200 && RUN_URL.test(v) ? v : null;
}
