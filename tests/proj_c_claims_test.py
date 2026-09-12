"""A citation must not bypass the local extractive answer contract."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'projects/proj_c'))
from mini_rag import DOCS, diagnose, validate, generate, retrieve


class EvidenceClaims(unittest.TestCase):
    def test_citation_does_not_allow_changed_facts(self):
        candidate = '[d1] 普通商品支持30天无理由退款，定制商品也能无理由退款。'
        result = diagnose('退款政策是什么', generator=lambda *_: {'text': candidate, 'citations': ['d1']})
        self.assertEqual(result['layer'], 4)
        self.assertFalse(result['validation']['ok'])

    def test_labels_alone_are_not_an_answer(self):
        hits = [{'doc': DOCS[2]}, {'doc': DOCS[3]}]
        self.assertFalse(validate('[d3] [d4]', hits)['ok'])

    def test_supported_quote_plus_fabricated_claim_fails(self):
        text = '[d1] ' + DOCS[0]['text'] + ' 购买本店商品还可获得1000元补贴。'
        self.assertFalse(validate(text, [{'doc': DOCS[0]}])['ok'])

    def test_wrong_citation_binding_fails(self):
        self.assertFalse(validate('[d1] ' + DOCS[1]['text'], [{'doc': DOCS[0]}, {'doc': DOCS[1]}])['ok'])

    def test_exact_source_and_supported_clause_pass(self):
        hits = [{'doc': DOCS[0]}]
        self.assertTrue(validate('[d1] ' + DOCS[0]['text'], hits)['ok'])
        self.assertTrue(validate('根据知识库:[d1] 退款政策:普通商品下单 7 天内可无理由退款。', hits)['ok'])

    def test_new_evidence_works_without_editing_validator(self):
        doc = {'id': 'address-1', 'text': '公司地址:上海市示例路18号。'}
        result = diagnose('公司地址在哪里', docs=[doc])
        self.assertFalse(result['refused'])

    def test_paraphrase_is_explicitly_outside_this_checker(self):
        result = validate('[d1] 一般货品可在一周内退回。', [{'doc': DOCS[0]}])
        self.assertFalse(result['ok'])
        self.assertEqual(result.get('mode'), 'extractive')


if __name__ == '__main__':
    unittest.main()
