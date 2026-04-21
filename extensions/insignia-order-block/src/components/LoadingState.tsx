export function LoadingState() {
  return (
    <s-stack direction="block" gap="base" align-items="center">
      <s-spinner accessibility-label="Loading customization data" size="base" />
    </s-stack>
  );
}
