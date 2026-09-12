"""Run only the reviewed, standard-library arithmetic examples authored for this batch."""
import json
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
QUESTIONS = {q['id']: q for f in (ROOT / 'data/questions').glob('*.json') for q in json.loads(f.read_text(encoding='utf-8'))}

class ArithmeticExamples(unittest.TestCase):
    def run_example(self, qid):
        code = re.findall(r'```python\n(.*?)```', QUESTIONS[qid]['example'], re.S)
        self.assertEqual(len(code), 1)
        return subprocess.check_output([sys.executable, '-c', code[0]], text=True, timeout=5).strip()

    def test_lora_dimensions(self):
        self.assertEqual(self.run_example('AD-004'), '131072 16777216 0.78125')

    def test_four_bit_weight_payload(self):
        self.assertEqual(self.run_example('AD-005'), '32.5')

    def test_dpo_relative_odds(self):
        self.assertEqual(self.run_example('AD-003'), '0.405465 0.510826')

    def test_grpo_group_signal(self):
        self.assertEqual(self.run_example('AD-008'), '[-1.0, -1.0, 1.0, 1.0]')

    def test_history_cost_accumulation(self):
        self.assertEqual(self.run_example('AG-015'), '15000')

if __name__ == '__main__':
    unittest.main()
