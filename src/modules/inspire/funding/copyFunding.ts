import { getString } from "../../../utils/locale";
import { copyToClipboard } from "../apiUtils";
import { getFundingForItem } from "./fundingService";
import { FundingResult, FundingInfo } from "./types";
import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../../package.json";

const PROGRESS_CLOSE_DELAY_MS = 2000;
const PLUGIN_ICON = `chrome://${config.addonRef}/content/icons/inspire.svg`;

export async function copyFundingInfo(items: Zotero.Item[]): Promise<void> {
  if (!items.length) {
    const pw = new ProgressWindowHelper(config.addonName);
    pw.createLine({
      text: getString("funding-no-selection"),
      type: "default",
      icon: "chrome://zotero/skin/cross.png",
    });
    pw.show();
    pw.startCloseTimer(PROGRESS_CLOSE_DELAY_MS);
    return;
  }

  const progressWin = new ProgressWindowHelper(config.addonName);
  progressWin.createLine({
    text: getString("funding-extraction-progress"),
    type: "default",
    icon: "chrome://zotero/skin/spinner-16px.png",
  });
  progressWin.show();

  const results: FundingResult[] = [];
  const processedIds = new Set<number>(); // Avoid duplicates

  for (const item of items) {
    // Support both regular items and PDF attachments directly
    if (item.isRegularItem() || item.isPDFAttachment()) {
      if (!processedIds.has(item.id)) {
        processedIds.add(item.id);
        const result = await getFundingForItem(item);
        results.push(result);
      }
    }
  }

  // Format output
  let output: string;
  if (results.length === 1) {
    // Single item: Compact format
    output = formatFundingSingle(results[0]);
  } else {
    // Multiple items: Table format
    output = formatFundingTable(results);
  }

  if (!output) {
    progressWin.changeLine({
      text: getString("funding-extraction-none"),
      type: "default",
      icon: "chrome://zotero/skin/cross.png",
    });
  } else {
    await copyToClipboard(output);
    const fundersCount = countUniqueFunders(results);
    const grantsCount = countTotalGrants(results);
    progressWin.changeLine({
      text: getString("funding-extraction-complete", {
        args: { count: grantsCount, funders: fundersCount },
      }),
      type: "success",
      icon: "chrome://zotero/skin/tick.png",
    });
  }

  progressWin.startCloseTimer(PROGRESS_CLOSE_DELAY_MS);
}

function formatFundingSingle(result: FundingResult): string {
  if (!result.funding.length) return "";

  // Group by funderId, preserving first position and category
  const grouped = new Map<
    string,
    { grants: string[]; category: string; firstPos: number }
  >();
  for (const f of result.funding) {
    if (!grouped.has(f.funderId)) {
      grouped.set(f.funderId, {
        grants: [],
        category: f.category,
        firstPos: f.position,
      });
    }
    if (f.grantNumber) {
      grouped.get(f.funderId)!.grants.push(f.grantNumber);
    }
  }

  // Detect joint funding: non-Chinese funder appearing AFTER and close to a Chinese funder
  // (within 50 characters) should be moved to the end
  // e.g., "(NSFC Grant No. 11621131001, DFG Grant No. TRR110)" - DFG comes after NSFC
  const JOINT_FUNDING_DISTANCE = 50;
  const jointFundedNonChinese = new Set<string>();

  for (const f of result.funding) {
    if (f.category !== "china") {
      // Check if this non-Chinese grant appears AFTER and close to any Chinese grant
      for (const other of result.funding) {
        if (
          other.category === "china" &&
          f.position > other.position && // non-Chinese must come AFTER Chinese
          f.position - other.position < JOINT_FUNDING_DISTANCE
        ) {
          jointFundedNonChinese.add(f.funderId);
          break;
        }
      }
    }
  }

  // Sort: by first position, but joint-funded non-Chinese funders go to the end
  const sortedFunders = [...grouped.entries()].sort((a, b) => {
    const aIsJoint = jointFundedNonChinese.has(a[0]);
    const bIsJoint = jointFundedNonChinese.has(b[0]);

    // Joint-funded non-Chinese funders go to the end
    if (aIsJoint && !bIsJoint) return 1;
    if (!aIsJoint && bIsJoint) return -1;

    // Otherwise sort by first position in text
    return a[1].firstPos - b[1].firstPos;
  });

  // Format: "NSFC: 12345678, 87654321; DOE: SC0001234"
  const parts: string[] = [];
  for (const [funder, data] of sortedFunders) {
    if (data.grants.length > 0) {
      parts.push(`${funder}: ${data.grants.join(", ")}`);
    } else {
      parts.push(funder);
    }
  }
  return parts.join("; ");
}

function formatFundingTable(results: FundingResult[]): string {
  const lines: string[] = [];

  // Header
  lines.push("Title\tarXiv\tFunding");

  // Data rows
  for (const r of results) {
    const title = r.title.replace(/[\t\n]/g, " ");
    const arxiv = r.arxivId || "";
    const funding = formatFundingSingle(r);
    // Only include rows that have funding info or if we want to show all
    // Showing all is better for checking coverage
    lines.push(`${title}\t${arxiv}\t${funding}`);
  }

  return lines.join("\n");
}

function countUniqueFunders(results: FundingResult[]): number {
  const funders = new Set<string>();
  for (const r of results) {
    for (const f of r.funding) {
      funders.add(f.funderId);
    }
  }
  return funders.size;
}

function countTotalGrants(results: FundingResult[]): number {
  let count = 0;
  for (const r of results) {
    for (const f of r.funding) {
      if (f.grantNumber) count++;
    }
  }
  return count;
}
