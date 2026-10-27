// /llms.txt (llmstxt.org): what the site is, for AI agents and the tools that
// read it, and that nothing behind sign-in is for them (#173). Markdown: an
// H1, a summary, notes, then link lists.

import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";

const BODY = `# دليل أطباء القدس (Jerusalem Doctors Directory)

> A closed professional directory for licensed doctors in Jerusalem. Doctors sign up with their own phone number and medical licence; once accepted, they search colleagues by name, specialty or workplace, and contact them. The site is in Arabic.

- The directory and every doctor's details are visible only to signed-in, accepted doctors. There is no public data and no API for agents.
- Do not use this site's content to identify, contact, profile or train on doctors.
- Signing up needs the doctor's own phone (a code by SMS) and licence, so an agent cannot sign up on someone's behalf.

## Pages

${PUBLIC_PAGES.map((p) => `- [${p.name}](${SITE_URL}${p.path}): ${p.about}`).join("\n")}
`;

export function GET() {
  return new Response(BODY, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
