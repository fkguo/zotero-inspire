import type { InspireAuthorMetadata } from "./apiTypes";
import type { InspireAuthorProfile } from "./types";

export const AUTHOR_PROFILE_VERSION = 2;

export function parseAuthorProfile(
  metadata: InspireAuthorMetadata | undefined,
  recid?: string | number,
): InspireAuthorProfile | null {
  if (!metadata?.name || metadata.deleted) {
    return null;
  }

  const profile: InspireAuthorProfile = {
    recid: recid ? String(recid) : String(metadata.control_number || ""),
    profileVersion: AUTHOR_PROFILE_VERSION,
    canonicalName: metadata.name.value?.trim(),
    positions: (metadata.positions || [])
      .filter((p) => !p.hidden)
      .map((p) => ({
        institution: p.institution || "",
        rank: p.rank,
        current: p.current,
        startDate: p.start_date,
        endDate: p.end_date,
      })),
    name: metadata.name.preferred_name || metadata.name.value || "",
  };

  if (profile.positions?.length) {
    const current =
      profile.positions.find((p) => p.current) || profile.positions[0];
    if (current) {
      profile.currentPosition = {
        institution: current.institution || "",
        rank: current.rank,
      };
    }
  }

  if (Array.isArray(metadata.ids)) {
    for (const id of metadata.ids) {
      if (id?.schema === "ORCID") {
        profile.orcid = id.value;
      } else if (id?.schema === "INSPIRE BAI") {
        profile.bai = id.value;
      } else if (id?.schema === "INSPIRE ID") {
        profile.inspireId = id.value;
      }
    }
  }

  if (Array.isArray(metadata.arxiv_categories)) {
    profile.arxivCategories = metadata.arxiv_categories;
  }

  if (Array.isArray(metadata.urls) && metadata.urls.length) {
    const url = metadata.urls.find((u: any) => u?.value)?.value;
    if (url) {
      profile.homepageUrl = url;
    }
  }

  if (Array.isArray(metadata.email_addresses)) {
    const currentEmails = metadata.email_addresses
      .filter((e: any) => e?.current)
      .map((e: any) => e?.value)
      .filter((e: any) => typeof e === "string" && e.trim());
    const allEmails = metadata.email_addresses
      .map((e: any) => e?.value)
      .filter((e: any) => typeof e === "string" && e.trim());
    const emails = currentEmails.length ? currentEmails : allEmails;
    if (emails.length) {
      profile.emails = emails;
    }
  }

  if (Array.isArray(metadata.advisors)) {
    profile.advisors = metadata.advisors
      .filter((advisor) => !advisor.hidden)
      .map((advisor) => {
        // Extract recid from record.$ref (e.g., "https://inspirehep.net/api/authors/1011904")
        let recid: string | undefined;
        const ref = advisor?.record?.$ref;
        if (typeof ref === "string") {
          const match = ref.match(/\/authors\/(\d+)$/);
          if (match) {
            recid = match[1];
          }
        }
        return {
          name: advisor?.name || "",
          degreeType: advisor?.degree_type,
          recid,
        };
      })
      .filter((advisor: any) => advisor.name);
  }

  if (metadata.status) {
    profile.status = metadata.status;
  }

  return profile;
}
