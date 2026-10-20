"use client";

import { useState } from "react";

type Finding = {
  title: string;
  severity: "high" | "medium" | "low";
  description: string;
  fix: string;
};

type AuditResult = {
  url: string;
  status: string;
  score: number;
  findings: Finding[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  auditedAt: string;
  note?: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    let formattedUrl = url.trim();

    if (!formattedUrl) {
      setMessage("Please enter your website URL.");
      return;
    }

    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
    }

    try {
      const parsedUrl = new URL(formattedUrl);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        setMessage("Please enter a valid HTTP or HTTPS website URL.");
        return;
      }
    } catch {
      setMessage("Please enter a valid website URL.");
      return;
    }

    setLoading(true);
    setMessage("Analyzing your website. This may take a few seconds...");
    setResult(null);

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: formattedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.error || "We couldn't test this website. Please try another URL.",
        );
        return;
      }

      setResult(data as AuditResult);
      setUrl(formattedUrl);
      setMessage("Website audit completed successfully.");
    } catch {
      setMessage(
        "Unable to connect to the testing engine. Make sure your development server is running.",
      );
    } finally {
      setLoading(false);
    }
  }

  function resetAudit() {
    setResult(null);
    setMessage("");
    setUrl("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="min-h-screen bg-white text-neutral-900">
      {/* Navigation */}
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="#" className="text-lg font-semibold tracking-tight">
            Test Your AI Web App<span className="text-neutral-400">.</span>
          </a>

          <a
            href="#how-it-works"
            className="text-sm text-neutral-600 transition hover:text-black"
          >
            How it works
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 text-center sm:pb-24 sm:pt-28">
        <div className="mb-6 inline-flex rounded-full border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-600">
          A simple way to review your web app
        </div>

        <h1 className="mx-auto max-w-4xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Test your AI web app.
          <br />
          <span className="text-neutral-500">Know what needs fixing.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-neutral-600 sm:text-lg">
          Enter your website URL to check selected HTML quality and
          accessibility signals, identify potential issues, and get
          practical suggestions for improvement.
        </p>

        {/* URL Form */}
        <form
          onSubmit={handleSubmit}
          className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-3 sm:flex-row"
        >
          <label htmlFor="website-url" className="sr-only">
            Website URL
          </label>

          <input
            id="website-url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://yourwebsite.com"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500"
            disabled={loading}
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {loading ? "Testing..." : "Test my app"}
          </button>
        </form>

        {message && (
          <p
            role="status"
            aria-live="polite"
            className="mx-auto mt-4 max-w-2xl text-sm text-neutral-600"
          >
            {message}
          </p>
        )}

        {/* Audit Report */}
        {result && (
          <section
            aria-labelledby="report-heading"
            className="mx-auto mt-12 max-w-4xl rounded-2xl border border-neutral-200 p-6 text-left sm:p-8"
          >
            <div className="flex flex-col justify-between gap-4 border-b border-neutral-200 pb-6 sm:flex-row sm:items-start">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  Audit report
                </p>

                <h2
                  id="report-heading"
                  className="mt-2 text-2xl font-semibold tracking-tight"
                >
                  Website review results
                </h2>

                <p className="mt-2 break-all text-sm text-neutral-500">
                  {result.url}
                </p>
              </div>

              <button
                onClick={resetAudit}
                className="w-fit rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100"
              >
                Test another website
              </button>
            </div>

            {/* Summary cards */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <DashboardCard
                label="Audit score"
                value={`${result.score}/100`}
              />

              <DashboardCard
                label="Potential issues"
                value={String(result.summary.total)}
              />

              <DashboardCard
                label="High severity"
                value={String(result.summary.high)}
              />

              <DashboardCard
                label="Audit status"
                value="Completed"
              />
            </div>

            {/* Findings */}
            <div className="mt-10">
              <h3 className="text-lg font-semibold">Findings and suggestions</h3>

              <p className="mt-2 text-sm leading-6 text-neutral-600">
                These findings are based on automated checks of the HTML
                returned by the website. They are potential issues, not
                proof that the entire application is secure or error-free.
              </p>

              {result.findings.length === 0 ? (
                <div className="mt-5 rounded-xl border border-neutral-200 p-5">
                  <p className="font-medium">No issues detected by these checks.</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    This does not guarantee that the website is free of
                    accessibility, security, or functionality problems.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {result.findings.map((finding, index) => (
                    <article
                      key={`${finding.title}-${index}`}
                      className="rounded-xl border border-neutral-200 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="font-semibold">{finding.title}</h4>

                        <SeverityBadge severity={finding.severity} />
                      </div>

                      <p className="mt-3 text-sm leading-6 text-neutral-600">
                        {finding.description}
                      </p>

                      <div className="mt-4 border-t border-neutral-100 pt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                          Suggested improvement
                        </p>

                        <p className="mt-2 text-sm leading-6 text-neutral-800">
                          {finding.fix}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <p className="mt-8 border-t border-neutral-200 pt-5 text-xs leading-5 text-neutral-500">
              Audited at:{" "}
              {result.auditedAt
                ? new Date(result.auditedAt).toLocaleString()
                : "Time not provided"}
            </p>
          </section>
        )}

        {/* Dashboard preview */}
        {!result && (
          <div className="mx-auto mt-16 max-w-4xl rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-left sm:p-8">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium">Audit dashboard</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Your results will appear here
                </p>
              </div>

              <span className="w-fit rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600">
                {loading ? "Analysis in progress" : "Waiting for a URL"}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <DashboardCard label="Audit score" value="--" />
              <DashboardCard label="Potential issues" value="--" />
              <DashboardCard
                label="Audit status"
                value={loading ? "Testing..." : "Not started"}
              />
            </div>

            <div className="mt-5 rounded-xl border border-neutral-200 bg-white p-5">
              <p className="text-sm font-medium">Your audit report</p>
              <div className="mt-4 space-y-3">
                <div className="h-2 w-full rounded-full bg-neutral-100" />
                <div className="h-2 w-4/5 rounded-full bg-neutral-100" />
                <div className="h-2 w-3/5 rounded-full bg-neutral-100" />
              </div>
              <p className="mt-4 text-xs text-neutral-500">
                Enter a publicly accessible website URL to begin.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Features */}
      <section className="border-t border-neutral-200 bg-neutral-50">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-neutral-500">
              WHAT YOU GET
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              A clearer picture of your website.
            </h2>

            <p className="mt-4 leading-7 text-neutral-600">
              Start with practical checks that help you discover common
              problems in the HTML your website serves.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <FeatureCard
              number="01"
              title="Issue detection"
              description="Check for selected HTML problems, missing metadata, and other common implementation gaps."
            />

            <FeatureCard
              number="02"
              title="Accessibility signals"
              description="Identify selected potential accessibility problems, including missing image alternative text."
            />

            <FeatureCard
              number="03"
              title="Suggested fixes"
              description="Get an explanation of each detected issue and a practical suggestion for addressing it."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium text-neutral-500">THE PROCESS</p>

          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Three simple steps.
          </h2>

          <p className="mt-4 leading-7 text-neutral-600">
            Get started without installing anything in the website you want
            to review.
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          <StepCard
            number="01"
            title="Enter your URL"
            description="Provide the public address of the website you want to check."
          />

          <StepCard
            number="02"
            title="Run the audit"
            description="The testing engine retrieves the page HTML and runs its supported checks."
          />

          <StepCard
            number="03"
            title="Review the findings"
            description="See the score, potential issues, severity, and suggested improvements."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-neutral-200">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Ready to check your website?
          </h2>

          <p className="mx-auto mt-4 max-w-xl leading-7 text-neutral-600">
            Start with a URL and discover what the automated checks can find.
          </p>

          <button
            onClick={() => {
              document.getElementById("website-url")?.focus();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="mt-8 rounded-xl bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            Test my app
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-7 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Test Your AI Web App</p>
          <p>Simple checks. Clearer improvements.</p>
        </div>
      </footer>
    </main>
  );
}

function DashboardCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-3 break-words text-2xl font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function FeatureCard({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-7">
      <p className="text-sm font-medium text-neutral-400">{number}</p>
      <h3 className="mt-6 text-lg font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        {description}
      </p>
    </article>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article>
      <p className="text-sm font-medium text-neutral-400">{number}</p>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        {description}
      </p>
    </article>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: Finding["severity"];
}) {
  const styles: Record<Finding["severity"], string> = {
    high: "border-neutral-900 bg-neutral-900 text-white",
    medium: "border-neutral-300 bg-neutral-100 text-neutral-800",
    low: "border-neutral-200 bg-white text-neutral-600",
  };

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${styles[severity]}`}
    >
      {severity} severity
    </span>
  );
}