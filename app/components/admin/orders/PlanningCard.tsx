/**
 * PlanningCard — sidebar card for due-date + assigned-to planning fields.
 *
 * All fields are disabled. "Coming soon" badges are shown prominently
 * per the in-scope.html design spec.
 */

export default function PlanningCard() {
  return (
    <s-section heading="Planning">
      <s-stack direction="block" gap="base">
        {/* Due date */}
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">Due date</s-text>
            <s-badge>Coming soon</s-badge>
          </s-stack>
          <s-text-field
            label="Due date"
            labelAccessibilityVisibility="exclusive"
            placeholder="No due date set"
            disabled={true}
          />
        </s-stack>

        {/* Assigned to */}
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">Assigned to</s-text>
            <s-badge>Coming soon</s-badge>
          </s-stack>
          <s-select
            label="Assigned to"
            labelAccessibilityVisibility="exclusive"
            disabled={true}
          >
            <s-option value="">Unassigned</s-option>
          </s-select>
        </s-stack>
      </s-stack>
    </s-section>
  );
}
