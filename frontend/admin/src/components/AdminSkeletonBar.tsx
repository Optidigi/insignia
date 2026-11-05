type Size = `${number}px` | `${number}%`;

/** The app owns loading geometry before and after the native runtime is available. */
export default function AdminSkeletonBar({
  width = '100%',
  height = '12px',
  part = 'bar',
  hidden = false,
}: {
  width?: Size;
  height?: Size;
  part?: 'bar' | 'label' | 'value' | 'leading';
  hidden?: boolean;
}) {
  return (
    <div class="admin-skeleton-bar" style={{ width, height }} hidden={hidden}>
      <div data-skeleton-part={part} class="admin-skeleton-fill" />
    </div>
  );
}
