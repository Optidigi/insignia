"""Contract tests for the operator's pre-submit fulfillment guard."""

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "guard_fulfillment.py"
FIXTURES = ROOT / "gates" / "fulfillment-diagnosis"


def run_guard(name):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--form", str(FIXTURES / name)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result, json.loads(result.stdout)


class FulfillmentGuardTests(unittest.TestCase):
    def test_recorded_one_target_two_summary_state_is_rejected(self):
        result, verdict = run_guard("historical-inconsistent-form.json")
        self.assertEqual(result.returncode, 2)
        self.assertFalse(verdict["allowed"])
        self.assertIn("non-target positive quantity", verdict["reasons"])
        self.assertIn("aggregate quantity mismatch", verdict["reasons"])

    def test_one_target_one_summary_control_is_allowed(self):
        result, verdict = run_guard("coherent-control-form.json")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(verdict["allowed"])
        self.assertEqual(verdict["selected"], [{
            "fulfillmentOrderLineItemId": "gid://shopify/FulfillmentOrderLineItem/101",
            "lineItemId": "gid://shopify/LineItem/201",
            "quantity": 1,
        }])

    def test_unknown_control_state_is_rejected(self):
        form = json.loads((FIXTURES / "coherent-control-form.json").read_text())
        del form["rows"][0]["checked"]
        with self.subTest("missing checked property"):
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--form", "-"],
                input=json.dumps(form), capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("unknown control state", json.loads(result.stdout)["reasons"])

    def test_unmapped_line_identity_is_rejected(self):
        form = json.loads((FIXTURES / "coherent-control-form.json").read_text())
        form["intent"][0]["lineItemId"] = "plain-sku-label"
        form["rows"][0]["lineItemId"] = "plain-sku-label"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--form", "-"],
            input=json.dumps(form), capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("invalid identity format", json.loads(result.stdout)["reasons"])

    def test_two_target_units_are_rejected_for_this_slice(self):
        form = json.loads((FIXTURES / "coherent-control-form.json").read_text())
        form["intent"][0]["quantity"] = 2
        form["rows"][0]["effectiveQuantity"] = 2
        form["rows"][0]["inputValue"] = "2"
        form["aggregateSelectedCount"] = 2
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--form", "-"],
            input=json.dumps(form), capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("exactly one target unit required", json.loads(result.stdout)["reasons"])

    def test_checked_zero_quantity_bystander_is_rejected(self):
        form = json.loads((FIXTURES / "coherent-control-form.json").read_text())
        form["rows"][1]["checked"] = True
        form["rows"][1]["ariaChecked"] = "true"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--form", "-"],
            input=json.dumps(form), capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("checked non-target row", json.loads(result.stdout)["reasons"])


if __name__ == "__main__":
    unittest.main()
