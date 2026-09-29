"""Core editorial contracts and executable examples; no model/API or report writes.

These checks protect review coverage and known factual regressions. Passing them
does not certify every sentence: human review notes remain the source of scope.
Run: python -B tests/core-content-test.py
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


BANK = {q["id"]: q for path in (ROOT / "data/questions").glob("*.json")
        for q in json.loads(path.read_text(encoding="utf-8"))}
GUIDES = read("data/interview-guides.json")["guides"]
REVIEW = read("data/content-reviews.json")
GROUPS = {g["id"]: g for s in read("data/resume-profile.json")["sections"]
          for g in s["groups"] if g.get("mustKnow")}
CORE = {qid for g in GROUPS.values() for qid in g["questionIds"]}


class CoreContentTest(unittest.TestCase):
    def test_exact_core_review_coverage_without_extra_inflation(self):
        ids = [r["questionId"] for r in REVIEW["reviews"]]
        self.assertEqual(len(CORE), 133)
        self.assertEqual(len(ids), 133)
        self.assertEqual(set(ids), CORE)
        self.assertEqual(set(REVIEW["scope"]["coreIds"]), CORE)
        self.assertEqual([r["questionId"] for r in REVIEW["extraReviews"]], ["IVL-0001"])

    def test_guides_cover_17_groups_and_keep_topic_question_separate(self):
        self.assertEqual(len(GUIDES), 17)
        self.assertEqual(len({g["id"] for g in GUIDES}), 17)
        self.assertEqual({i for g in GUIDES for i in g["resumeGroupIds"]}, set(GROUPS))
        covered = set()
        for g in GUIDES:
            with self.subTest(guide=g["id"]):
                expected = {i for group in g["resumeGroupIds"] for i in GROUPS[group]["questionIds"]}
                self.assertEqual(set(g["sourceQuestionIds"]), expected)
                self.assertEqual(len(g["sourceQuestionIds"]), len(expected))
                self.assertIn(g["mainQuestionId"], expected)
                self.assertIn(g["mainQuestionId"], BANK)
                self.assertGreater(len(g["mainQuestion"]), 20)
                self.assertGreater(len(g["answer60"]), 90)
                self.assertGreater(len(g["answer180"]), len(g["answer60"]))
                covered.update(expected)
        self.assertEqual(covered, CORE)

    def test_followups_rubric_and_project_claim_boundaries(self):
        all_answers = []
        for g in GUIDES:
            with self.subTest(guide=g["id"]):
                self.assertEqual({f["kind"] for f in g["followups"]},
                                 {"principle", "implementation", "debug", "tradeoff"})
                self.assertEqual(len({f["id"] for f in g["followups"]}), len(g["followups"]))
                for f in g["followups"]:
                    self.assertTrue(f["q"].strip())
                    self.assertGreater(len(f["a"]), 18)
                    all_answers.append(f["a"])
                self.assertEqual(set(g["rubric"]), {"basic", "competent", "deep"})
                self.assertTrue(all(g["rubric"].values()))
                self.assertEqual(g["projectEvidence"]["status"], "unverified")
                self.assertGreaterEqual(len(g["projectEvidence"]["prompts"]), 2)
                self.assertIn("待核实", g["projectEvidence"]["note"])
        self.assertEqual(len(set(all_answers)), len(all_answers), "followups must not be copied boilerplate")

    def test_sources_are_versioned_and_quality_is_not_source_status(self):
        allowed = {"docs.python.org", "fastapi.tiangolo.com", "docs.pydantic.dev",
                   "pydantic.dev", "docs.langchain.com", "reference.langchain.com",
                   "modelcontextprotocol.io", "www.anthropic.com", "anthropic.com",
                   "redis.io", "www.elastic.co", "huggingface.co", "github.com",
                   "qdrant.tech", "arxiv.org", "sbert.net", "platform.claude.com",
                   "agentskills.io", "a2a-protocol.org", "scikit-learn.org"}
        for item in [*GUIDES, *REVIEW["reviews"], *REVIEW["extraReviews"]]:
            self.assertTrue(item["sources"])
            for source in item["sources"]:
                self.assertEqual(urlparse(source["url"]).scheme, "https")
                self.assertIn(urlparse(source["url"]).hostname, allowed)
                self.assertTrue(source["title"] and source["version"] and source["checkedAt"])
        for item in REVIEW["reviews"]:
            self.assertIn(item["qualityStatus"], {"reviewed", "revised", "needs_revision"})
            self.assertIn(item["sourceStatus"], {"primary_checked", "partial", "unverified"})
            self.assertTrue(item["reviewNote"] and item["findings"] and item["reviewedFields"])
            self.assertRegex(item["beforeHash"], r"^[0-9a-f]{64}$")
            if item["sourceStatus"] != "primary_checked":
                self.assertTrue(item["unverifiedClaims"])

    def test_review_hash_binds_to_actual_source_content(self):
        for item in REVIEW["reviews"] + REVIEW["extraReviews"]:
            with self.subTest(question=item["questionId"]):
                actual = hashlib.sha256(json.dumps(BANK[item["questionId"]],
                            ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                self.assertEqual(item["afterHash"], actual)

    def test_every_core_quiz_explains_every_option_and_answers_agree(self):
        quizzes = [BANK[i] for i in CORE if BANK[i].get("format") == "quiz"]
        self.assertEqual(len(quizzes), 75)
        for q in quizzes:
            with self.subTest(question=q["id"]):
                labels = [o["label"] for o in q["options"]]
                explanations = q["optionExplanations"]
                self.assertEqual([x["label"] for x in explanations], labels)
                self.assertTrue(all(x["explanation"].strip() for x in explanations))
                correct = "、".join(o["label"] for o in q["options"] if o["right"])
                self.assertIn(correct, q["answer"].splitlines()[0])
                for x in explanations:
                    self.assertIn(x["explanation"], q["plain"])
                    self.assertIn(x["explanation"], q["answer"])
                    self.assertNotIn("题设A已改", x["explanation"])
                    self.assertNotIn("原干扰项", x["explanation"])

    def test_known_transport_and_embedding_regressions(self):
        mcp = BANK["AGQ-0030"]
        self.assertIn("2025-11-25", mcp["prompt"])
        correct = " ".join(o["text"] for o in mcp["options"] if o["right"])
        self.assertIn("stdio", correct)
        self.assertIn("Streamable HTTP", correct)
        e5 = BANK["RGQ-0026"]
        self.assertIn("intfloat/e5-large-v2", e5["prompt"])
        correct = " ".join(o["text"] for o in e5["options"] if o["right"])
        self.assertIn("query:", correct)
        self.assertIn("passage:", correct)
        self.assertEqual({o["label"] for o in BANK["RGQ-0092"]["options"] if o["right"]}, {"B", "D"})

    def test_local_python_examples_run_from_actual_displayed_source(self):
        # Explicit allow-list of reviewed, stdlib-only examples; never execute the
        # remote-model IVL example or arbitrary future question-bank code.
        for qid in ("PY-006", "PY-022", "PY-029", "PY-032", "PY-037"):
            with self.subTest(question=qid):
                blocks = re.findall(r"```python\n(.*?)```", BANK[qid]["example"], re.S)
                self.assertEqual(len(blocks), 1)
                tree = ast.parse(blocks[0])
                modules = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
                modules |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
                self.assertLessEqual(modules, {"asyncio", "contextlib", "contextvars", "typing", "dataclasses"})
                self.assertTrue(any(isinstance(n, ast.Assert) for n in ast.walk(tree)))
                with tempfile.TemporaryDirectory(prefix="core-content-") as cwd:
                    run = subprocess.run([sys.executable, "-I", "-B", "-"],
                                         input=blocks[0], text=True, capture_output=True,
                                         cwd=cwd, timeout=10, encoding="utf-8")
                self.assertEqual(run.returncode, 0, run.stderr)

    def test_finetune_example_is_static_and_tokenizes_before_trainer(self):
        answer = BANK["IVL-0001"]["answer"]
        self.assertIn("Transformers 4.50.0", answer)
        self.assertIn("未执行训练", answer)
        code = re.findall(r"```python\n(.*?)```", answer, re.S)[0]
        tree = ast.parse(code)  # Intentionally no exec: would download/train/write.
        assignments = {n.targets[0].id: n.value for n in tree.body
                       if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)}
        self.assertIsInstance(assignments["encoded"], ast.Call)
        self.assertEqual(assignments["encoded"].func.attr, "map")
        trainer = assignments["trainer"]
        kwargs = {kw.arg: kw.value for kw in trainer.keywords}
        self.assertEqual(kwargs["train_dataset"].value.id, "encoded")
        self.assertEqual(kwargs["eval_dataset"].value.id, "encoded")
        self.assertIn("data_collator", kwargs)
        self.assertIn("processing_class", kwargs)
        self.assertNotIn("trainer.push_to_hub", code)


if __name__ == "__main__":
    unittest.main(verbosity=2)
