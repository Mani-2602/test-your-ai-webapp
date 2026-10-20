import { NextRequest, NextResponse } from "next/server";
import { chromium, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";

type Severity = "critical" | "high" | "medium" | "low";

type Finding = {
  title: string;
  severity: Severity;
  category: string;
  description: string;
  evidence: string;
  location?: string;
  fix: string;
};

type AuditCheck = {
  name: string;
  status: "passed" | "failed" | "warning";
  details: string;
};

const MAX_FINDINGS = 100;
const NAVIGATION_TIMEOUT = 15000;

function addFinding(
  findings: Finding[],
  finding: Finding
): void {
  if (findings.length < MAX_FINDINGS) {
    findings.push(finding);
  }
}

function severityFromAxe(
  impact: string | null | undefined
): Severity {
  switch (impact) {
    case "critical":
      return "critical";
    case "serious":
      return "high";
    case "moderate":
      return "medium";
    default:
      return "low";
  }
}

function calculateScore(findings: Finding[]): number {
  const deductions: Record<Severity, number> = {
    critical: 20,
    high: 10,
    medium: 4,
    low: 1,
  };

  const deduction = findings.reduce(
    (total, finding) => total + deductions[finding.severity],
    0
  );

  return Math.max(0, Math.min(100, 100 - deduction));
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  if (host === "::1" || host === "::") {
    return true;
  }

  const parts = host.split(".");

  if (
    parts.length === 4 &&
    parts.every((part) => /^\d+$/.test(part))
  ) {
    const octets = parts.map(Number);

    if (octets.some((part) => part < 0 || part > 255)) {
      return true;
    }

    const [a, b] = octets;

    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    ) {
      return true;
    }
  }

  return false;
}

function validateTarget(rawUrl: unknown): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error("Enter a website URL to audit.");
  }

  if (rawUrl.length > 2048) {
    throw new Error("The URL is too long.");
  }

  let target: URL;

  try {
    target = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      "Enter a valid URL, such as https://example.com."
    );
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (target.username || target.password) {
    throw new Error("URLs containing usernames or passwords are not supported.");
  }

  if (isBlockedHostname(target.hostname)) {
    throw new Error(
      "This hostname is blocked because it may point to a private or local network."
    );
  }

  return target;
}

async function inspectPage(
  page: Page,
  findings: Finding[],
  checks: AuditCheck[],
  targetUrl: string
): Promise<void> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "Unknown network error";
    failedRequests.push(`${request.url()} — ${failure}`);
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} — ${response.url()}`);
    }
  });

  let responseStatus: number | null = null;

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    responseStatus = response?.status() ?? null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown navigation error";

    addFinding(findings, {
      title: "Page navigation failed",
      severity: "critical",
      category: "Availability",
      description:
        "The browser could not complete navigation to the supplied URL.",
      evidence: message,
      location: targetUrl,
      fix: "Verify that the URL is correct, the website is reachable, and the server accepts browser requests.",
    });

    checks.push({
      name: "Page navigation",
      status: "failed",
      details: message,
    });

    return;
  }

  if (responseStatus !== null && responseStatus >= 400) {
    addFinding(findings, {
      title: "Website returned an HTTP error",
      severity: responseStatus >= 500 ? "high" : "medium",
      category: "Availability",
      description: `The main document returned HTTP ${responseStatus}.`,
      evidence: `GET ${targetUrl} returned status ${responseStatus}.`,
      location: targetUrl,
      fix:
        "Check the server logs, route configuration, deployment status, and access permissions.",
    });

    checks.push({
      name: "Main document response",
      status: "failed",
      details: `HTTP ${responseStatus}`,
    });
  } else {
    checks.push({
      name: "Main document response",
      status: "passed",
      details:
        responseStatus === null
          ? "The browser did not expose a main-document response status."
          : `HTTP ${responseStatus}`,
    });
  }

  // Inspect document metadata and basic layout.
  const pageInfo = await page.evaluate(() => {
    const title = document.title.trim();
    const html = document.documentElement;
    const viewport = document.querySelector('meta[name="viewport"]');
    const description = document.querySelector(
      'meta[name="description"]'
    );
    const headings = Array.from(
      document.querySelectorAll("h1")
    ).map((heading) => heading.textContent?.trim() ?? "");
    const images = Array.from(document.images).map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.getAttribute("alt"),
      loaded: image.complete && image.naturalWidth > 0,
    }));

    return {
      title,
      language: html.getAttribute("lang"),
      viewportExists: Boolean(viewport),
      descriptionExists:
        Boolean(description?.getAttribute("content")?.trim()),
      headings,
      images,
      documentWidth: html.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  if (!pageInfo.title) {
    addFinding(findings, {
      title: "Missing page title",
      severity: "medium",
      category: "SEO",
      description: "The document does not have a meaningful page title.",
      evidence: "document.title is empty.",
      location: targetUrl,
      fix: "Add a descriptive HTML <title> element that identifies the page.",
    });
  } else {
    checks.push({
      name: "Page title",
      status: "passed",
      details: pageInfo.title,
    });
  }

  if (!pageInfo.language) {
    addFinding(findings, {
      title: "Missing document language",
      severity: "medium",
      category: "Accessibility",
      description:
        "The root HTML element does not declare its primary language.",
      evidence: '<html lang="..."> was not found.',
      location: targetUrl,
      fix: 'Set the root element language, for example <html lang="en">.',
    });
  }

  if (!pageInfo.viewportExists) {
    addFinding(findings, {
      title: "Missing viewport configuration",
      severity: "low",
      category: "Mobile usability",
      description:
        "The page does not declare a viewport meta tag.",
      evidence: 'meta[name="viewport"] was not found.',
      location: targetUrl,
      fix:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  }

  if (!pageInfo.descriptionExists) {
    addFinding(findings, {
      title: "Missing meta description",
      severity: "low",
      category: "SEO",
      description:
        "No non-empty meta description was found.",
      evidence: 'meta[name="description"] is missing or empty.',
      location: targetUrl,
      fix:
        "Add a concise, accurate meta description describing the page.",
    });
  }

  if (pageInfo.headings.length === 0) {
    addFinding(findings, {
      title: "Missing main heading",
      severity: "low",
      category: "Content structure",
      description: "No H1 heading was found on the page.",
      evidence: "The document contains zero h1 elements.",
      location: targetUrl,
      fix:
        "Add a clear primary heading that describes the page's main content.",
    });
  } else if (pageInfo.headings.length > 1) {
    addFinding(findings, {
      title: "Multiple H1 headings",
      severity: "low",
      category: "Content structure",
      description:
        `The page contains ${pageInfo.headings.length} H1 headings.`,
      evidence: pageInfo.headings.join(" | "),
      location: targetUrl,
      fix:
        "Review the heading hierarchy and ensure it clearly communicates the page structure. Multiple H1 elements are not automatically invalid.",
    });
  }

  checks.push({
    name: "Document metadata",
    status:
      pageInfo.title &&
      pageInfo.language &&
      pageInfo.viewportExists
        ? "passed"
        : "warning",
    details: "Checked title, language, viewport, description, and H1 headings.",
  });

  const brokenImages = pageInfo.images.filter((image) => !image.loaded);

  if (brokenImages.length > 0) {
    addFinding(findings, {
      title: "Images failed to load",
      severity: "medium",
      category: "Assets",
      description:
        `${brokenImages.length} image(s) did not report a successful load.`,
      evidence: brokenImages
        .slice(0, 10)
        .map((image) => image.src)
        .join("\n"),
      location: targetUrl,
      fix:
        "Verify each image URL, server response, file path, and cross-origin configuration. Lazy-loaded images may need additional scrolling before they can be assessed.",
    });
  } else {
    checks.push({
      name: "Image loading",
      status: "passed",
      details: `Checked ${pageInfo.images.length} image(s) visible in the document.`,
    });
  }

  const imagesWithoutAlt = pageInfo.images.filter(
    (image) => image.alt === null
  );

  if (imagesWithoutAlt.length > 0) {
    addFinding(findings, {
      title: "Images missing alt attributes",
      severity: "medium",
      category: "Accessibility",
      description:
        `${imagesWithoutAlt.length} image(s) do not have an alt attribute.`,
      evidence: imagesWithoutAlt
        .slice(0, 10)
        .map((image) => image.src)
        .join("\n"),
      location: targetUrl,
      fix:
        'Add appropriate alt text to informative images. Use alt="" for images that are purely decorative.',
    });
  }

  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));

  if (overflow.documentWidth > overflow.viewportWidth + 2) {
    addFinding(findings, {
      title: "Potential horizontal overflow",
      severity: "low",
      category: "Responsive design",
      description:
        "The document is wider than the current browser viewport.",
      evidence:
        `Document width: ${overflow.documentWidth}px; viewport width: ${overflow.viewportWidth}px.`,
      location: targetUrl,
      fix:
        "Inspect wide elements, fixed-width containers, tables, and images. Confirm whether the overflow is intentional.",
    });
  }

  if (consoleErrors.length > 0) {
    addFinding(findings, {
      title: "Browser console errors",
      severity: "medium",
      category: "JavaScript",
      description:
        `${consoleErrors.length} console error(s) occurred during initial page loading.`,
      evidence: consoleErrors.slice(0, 10).join("\n"),
      location: targetUrl,
      fix:
        "Inspect each console message and its source. Correct uncaught exceptions, invalid resource references, or application errors.",
    });
  }

  if (pageErrors.length > 0) {
    addFinding(findings, {
      title: "Uncaught JavaScript exceptions",
      severity: "high",
      category: "JavaScript",
      description:
        `${pageErrors.length} uncaught page error(s) were observed.`,
      evidence: pageErrors.slice(0, 10).join("\n"),
      location: targetUrl,
      fix:
        "Reproduce each exception in browser developer tools and correct the responsible code path.",
    });
  }

  if (failedRequests.length > 0) {
    addFinding(findings, {
      title: "Failed network requests",
      severity: "medium",
      category: "Network",
      description:
        `${failedRequests.length} network request(s) failed.`,
      evidence: failedRequests.slice(0, 10).join("\n"),
      location: targetUrl,
      fix:
        "Inspect the failed request URLs and browser errors. Check resource availability, API responses, CORS configuration, and network access.",
    });
  }

  if (badResponses.length > 0) {
    addFinding(findings, {
      title: "HTTP errors from page resources",
      severity: "medium",
      category: "Network",
      description:
        `${badResponses.length} resource response(s) returned HTTP 400 or higher.`,
      evidence: badResponses.slice(0, 10).join("\n"),
      location: targetUrl,
      fix:
        "Check the listed response URLs, server logs, resource paths, and access controls. Some errors may be expected for optional resources.",
    });
  }

  // Automated accessibility checks using axe-core.
  try {
    const axeResults = await new AxeBuilder({ page })
      .withTags([
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "best-practice",
      ])
      .analyze();

    for (const violation of axeResults.violations) {
      const nodes = violation.nodes.slice(0, 5);
      const evidence = nodes
        .map((node) => {
          const selector = node.target.join(", ");
          const summary = node.failureSummary ?? violation.help;
          return `${selector}\n${summary}`;
        })
        .join("\n\n");

      addFinding(findings, {
        title: violation.help,
        severity: severityFromAxe(violation.impact),
        category: "Accessibility",
        description: violation.description,
        evidence:
          evidence || `Rule: ${violation.id}. ${violation.help}`,
        location: targetUrl,
        fix: violation.helpUrl
          ? `Review the recommended guidance for rule "${violation.id}" and fix the affected elements.`
          : violation.help,
      });
    }

    checks.push({
      name: "Accessibility (axe-core)",
      status:
        axeResults.violations.length === 0 ? "passed" : "failed",
      details:
        `${axeResults.violations.length} accessibility rule violation(s) found; ${axeResults.passes.length} rule(s) passed.`,
    });
  } catch (error) {
    checks.push({
      name: "Accessibility (axe-core)",
      status: "warning",
      details:
        error instanceof Error
          ? `Accessibility scan could not complete: ${error.message}`
          : "Accessibility scan could not complete.",
    });
  }

  // Inspect mobile width after initial desktop checks.
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const mobile = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));

    if (mobile.documentWidth > mobile.viewportWidth + 2) {
      addFinding(findings, {
        title: "Horizontal overflow on mobile viewport",
        severity: "medium",
        category: "Responsive design",
        description:
          "The page content is wider than a 390px mobile viewport.",
        evidence:
          `Document width: ${mobile.documentWidth}px; viewport width: ${mobile.viewportWidth}px.`,
        location: targetUrl,
        fix:
          "Inspect fixed-width components, large images, tables, and navigation elements at narrow viewport widths.",
      });
    }

    checks.push({
      name: "Mobile layout",
      status:
        mobile.documentWidth <= mobile.viewportWidth + 2
          ? "passed"
          : "failed",
      details:
        `Checked layout at 390px width; document width was ${mobile.documentWidth}px.`,
    });
  } catch {
    checks.push({
      name: "Mobile layout",
      status: "warning",
      details: "Could not complete the mobile viewport check.",
    });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must contain valid JSON." },
      { status: 400 }
    );
  }

  const rawUrl =
    typeof body === "object" && body !== null && "url" in body
      ? (body as { url?: unknown }).url
      : undefined;

  let target: URL;

  try {
    target = validateTarget(rawUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The supplied URL is invalid.",
      },
      { status: 400 }
    );
  }

  let browser;

  try {
    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(10000);

    const findings: Finding[] = [];
    const checks: AuditCheck[] = [];

    await inspectPage(page, findings, checks, target.toString());

    // Do not treat redirects to another hostname as proof that the
    // original target was tested successfully.
    const finalUrl = page.url();

    let redirectWarning: string | undefined;

    try {
      const finalTarget = new URL(finalUrl);

      if (finalTarget.hostname !== target.hostname) {
        redirectWarning =
          `The site redirected to a different hostname: ${finalTarget.hostname}. Verify that this destination is expected.`;
      }
    } catch {
      // Navigation may have failed before a final URL was established.
    }

    const summary = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    };

    const score = calculateScore(findings);

    const result = {
      url: target.toString(),
      finalUrl,
      status: findings.some(
        (finding) =>
          finding.severity === "critical" ||
          finding.severity === "high"
      )
        ? "issues_found"
        : findings.length > 0
          ? "review_recommended"
          : "passed",
      score,
      findings,
      summary,
      auditedAt: new Date().toISOString(),
      checks,
      limitations: [
        "This is an automated, unauthenticated browser scan of one page.",
        "It does not prove that all buttons, forms, business workflows, or backend behavior work correctly.",
        "Accessibility results are automated checks, not a complete manual accessibility audit.",
        "A score is a heuristic summary, not a guarantee of security, quality, or correctness.",
        "URL filtering alone is not sufficient protection against SSRF. Do not expose this endpoint publicly until network-level restrictions, DNS and redirect validation, rate limits, and resource limits are implemented.",
      ],
      ...(redirectWarning ? { redirectWarning } : {}),
    };

    await context.close();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Audit failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Audit failed: ${error.message}`
            : "The audit could not be completed.",
      },
      { status: 500 }
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}