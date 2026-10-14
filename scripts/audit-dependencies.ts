type Severity = "low" | "moderate" | "high" | "critical";

interface Advisory {
	severity: Severity;
	title?: string;
	url?: string;
	vulnerableVersions?: string;
}

/**
 * Reviewed advisories that have no fixed release and only reach dev tooling, never an image.
 *
 * Each entry matches the package, the advisory and its CURRENT vulnerable range. When the fix ships,
 * the advisory's range changes, the entry stops matching and the audit fails again, which is the
 * prompt to upgrade and delete the entry. Never add one for a package that reaches runtime code.
 */
const ACCEPTED_ADVISORIES: readonly {
	packageName: string;
	url: string;
	vulnerableVersions: string;
	reason: string;
}[] = [
	{
		packageName: "braces",
		url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
		vulnerableVersions: "<=3.0.3",
		reason:
			"No fixed release exists; only reached through micromatch <- fast-glob <- shadcn and ultracite (build and lint tooling).",
	},
];

function accepted(packageName: string, advisory: Advisory) {
	return ACCEPTED_ADVISORIES.find(
		(entry) =>
			entry.packageName === packageName &&
			entry.url === advisory.url &&
			entry.vulnerableVersions === advisory.vulnerableVersions,
	);
}

const MINIMUM_SEVERITY: Severity = "high";
const SEVERITY_RANK: Record<Severity, number> = {
	low: 0,
	moderate: 1,
	high: 2,
	critical: 3,
};

const audit = spawnSync(process.execPath, ["audit", "--json"]);

try {
	if (audit.error) {
		throw audit.error;
	}
	const report = parseAuditReport(audit.stdout);
	const findings = collectFindings(report);
	const severeFindings = findings.filter(
		({ advisory }) =>
			SEVERITY_RANK[advisory.severity] >= SEVERITY_RANK[MINIMUM_SEVERITY],
	);
	for (const { advisory, packageName } of severeFindings) {
		const entry = accepted(packageName, advisory);
		if (entry) {
			console.log(
				`Accepted ${packageName} ${advisory.url} (${entry.vulnerableVersions}): ${entry.reason}`,
			);
		}
	}
	const blockingFindings = severeFindings.filter(
		({ advisory, packageName }) => !accepted(packageName, advisory),
	);

	if (blockingFindings.length === 0) {
		console.log(
			`No ${MINIMUM_SEVERITY} or critical dependency vulnerabilities found.`,
		);
		process.exit(0);
	}

	for (const { advisory, packageName } of blockingFindings) {
		console.error(
			`${packageName}: ${advisory.severity} - ${advisory.title ?? "Untitled advisory"}`,
		);
		if (advisory.url) {
			console.error(advisory.url);
		}
	}
	process.exit(1);
} catch (error) {
	const stderr = audit.stderr.toString().trim();
	if (stderr) {
		console.error(stderr);
	}
	console.error(
		error instanceof Error
			? `Dependency audit failed: ${error.message}`
			: "Dependency audit failed with an unknown error.",
	);
	process.exit(1);
}

function parseAuditReport(bytes: Uint8Array): unknown {
	if (bytes.length === 0) {
		throw new Error("Bun returned an empty audit response.");
	}

	const decoded =
		bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipAuditResponse(bytes) : bytes;
	const text = new TextDecoder().decode(decoded).trim();

	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new Error("Bun returned an invalid audit response.", { cause });
	}
}

/** How many bytes of trailing newline the payload ends with: none, LF, or CRLF. */
function trailingNewlineLength(bytes: Uint8Array): number {
	if (bytes.at(-1) !== 0x0a) {
		return 0;
	}
	return bytes.at(-2) === 0x0d ? 2 : 1;
}

function gunzipAuditResponse(bytes: Uint8Array): Uint8Array {
	try {
		return gunzipSync(bytes);
	} catch (error) {
		// Bun appends a newline after the complete gzip member. Node's gunzip treats it as
		// the beginning of another member, so retry without only that known trailing delimiter.
		const end = bytes.length - trailingNewlineLength(bytes);
		if (end === bytes.length) {
			throw error;
		}
		return gunzipSync(bytes.subarray(0, end));
	}
}

function collectFindings(
	report: unknown,
): Array<{ advisory: Advisory; packageName: string }> {
	if (!isRecord(report)) {
		throw new Error("Bun returned an unexpected audit report shape.");
	}

	const findings: Array<{ advisory: Advisory; packageName: string }> = [];
	for (const [packageName, advisories] of Object.entries(report)) {
		if (!Array.isArray(advisories)) {
			throw new Error(
				`Bun returned invalid advisories for package "${packageName}".`,
			);
		}

		for (const advisory of advisories) {
			if (!(isRecord(advisory) && isSeverity(advisory.severity))) {
				throw new Error(
					`Bun returned an invalid advisory for package "${packageName}".`,
				);
			}
			if (
				(advisory.title !== undefined && typeof advisory.title !== "string") ||
				(advisory.url !== undefined && typeof advisory.url !== "string") ||
				(advisory.vulnerable_versions !== undefined &&
					typeof advisory.vulnerable_versions !== "string")
			) {
				throw new Error(
					`Bun returned invalid advisory metadata for package "${packageName}".`,
				);
			}
			findings.push({
				advisory: {
					severity: advisory.severity,
					...(advisory.title === undefined ? {} : { title: advisory.title }),
					...(advisory.url === undefined ? {} : { url: advisory.url }),
					...(advisory.vulnerable_versions === undefined
						? {}
						: { vulnerableVersions: advisory.vulnerable_versions }),
				},
				packageName,
			});
		}
	}
	return findings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is Severity {
	return (
		value === "low" ||
		value === "moderate" ||
		value === "high" ||
		value === "critical"
	);
}
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
