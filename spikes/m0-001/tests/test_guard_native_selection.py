import copy
import json
import unittest
from pathlib import Path

from scripts.guard_native_selection import check


ROOT = Path(__file__).resolve().parents[1] / "evidence" / "m0-003r"
TARGET = "M0-003R-C-20260925-target"


class NativeSelectionGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.form = json.loads((ROOT / "control-C-form.json").read_text())
        cls.order = json.loads((ROOT / "order-C-before-partial.json").read_text())

    def test_observed_control(self):
        result = check(self.form, self.order, TARGET)
        self.assertTrue(result["allowed"], result["errors"])
        self.assertEqual([r["effectiveQuantity"] for r in result["resolved"]], [0, 1])

    def test_historical_two_selected_summary_rejected(self):
        form = copy.deepcopy(self.form)
        form["selectionSummary"]["label"] = "2 items selected"
        self.assertFalse(check(form, self.order, TARGET)["allowed"])

    def test_bystander_positive_rejected(self):
        form = copy.deepcopy(self.form)
        row = form["rows"][0]
        row["checkboxChecked"] = row["shadowInputChecked"] = row["selectedClass"] = True
        row["quantityInput"] = {"value": "1", "min": "1", "max": "1", "valid": True, "ariaInvalid": "false"}
        row["collapsedQuantityDisplay"] = None
        form["selectionSummary"]["label"] = "2 item selected"
        self.assertFalse(check(form, self.order, TARGET)["allowed"])

    def test_missing_api_mapping_rejected(self):
        order = copy.deepcopy(self.order)
        order["order"]["fulfillmentOrders"]["nodes"][0]["lineItems"]["nodes"].pop()
        self.assertFalse(check(self.form, order, TARGET)["allowed"])

    def test_paginated_api_inventory_rejected(self):
        order = copy.deepcopy(self.order)
        order["order"]["lineItems"]["pageInfo"]["hasNextPage"] = True
        self.assertFalse(check(self.form, order, TARGET)["allowed"])

    def test_expanded_candidate_maps_all_physical_children(self):
        form = json.loads((ROOT / "candidate-R-form.json").read_text())
        order = json.loads((ROOT / "order-R-before-partial.json").read_text())
        result = check(form, order, "m0-001:m0-003r-R-S-20260925")
        self.assertTrue(result["allowed"], result["errors"])
        self.assertEqual([r["effectiveQuantity"] for r in result["resolved"]], [0, 1, 0])

    def test_summary_is_units_not_selected_row_count(self):
        form = json.loads((ROOT / "candidate-R-form.json").read_text())
        order = json.loads((ROOT / "order-R-before-partial.json").read_text())
        form["rows"][1]["quantityInput"]["value"] = "2"
        self.assertFalse(check(form, order, "m0-001:m0-003r-R-S-20260925")["allowed"])


if __name__ == "__main__":
    unittest.main()
