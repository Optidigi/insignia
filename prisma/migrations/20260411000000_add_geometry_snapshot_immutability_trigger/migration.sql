-- Add immutability trigger for placementGeometrySnapshotByViewId
-- Prevents overwriting a non-null snapshot (geometry is captured once at order creation)

CREATE OR REPLACE FUNCTION prevent_geometry_snapshot_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."placementGeometrySnapshotByViewId" IS DISTINCT FROM NEW."placementGeometrySnapshotByViewId"
     AND OLD."placementGeometrySnapshotByViewId" IS NOT NULL THEN
    RAISE EXCEPTION 'placementGeometrySnapshotByViewId is immutable once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER immutable_geometry_snapshot
BEFORE UPDATE ON "OrderLineCustomization"
FOR EACH ROW EXECUTE FUNCTION prevent_geometry_snapshot_update();
