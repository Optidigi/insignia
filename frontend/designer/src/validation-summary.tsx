import type { RefObject } from "preact";
import { useLocale } from "./customer-locale";

export interface ValidationIssue {
  target: string;
  message: string;
  position?: string;
}

interface ValidationSummaryProps {
  issues: ValidationIssue[];
  summaryRef: RefObject<HTMLDivElement>;
  onNavigate: (issue: ValidationIssue) => void;
}

export function ValidationSummary({
  issues,
  summaryRef,
  onNavigate,
}: ValidationSummaryProps) {
  const { t } = useLocale();
  if (!issues.length) return null;
  return (
    <div
      className="validation-summary"
      ref={summaryRef}
      tabIndex={-1}
      aria-labelledby="validation-title"
    >
      <h2 id="validation-title">{t("customer:validation.checkDesign")}</h2>
      <ul>
        {issues.map((issue) => (
          <li key={issue.target}>
            <a
              href={`#${issue.target}`}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(issue);
              }}
            >
              {issue.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
