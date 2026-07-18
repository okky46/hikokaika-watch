import unittest
from common import dedup_key
from collect import run_sources
from sources.news import extract_security_code

class CollectTests(unittest.TestCase):
    def test_sources_continue_after_exception(self):
        calls = []
        def bad():
            calls.append('bad'); raise RuntimeError('boom')
        def good1():
            calls.append('good1'); return []
        def good2():
            calls.append('good2'); return []
        self.assertEqual(run_sources([('bad', bad), ('good1', good1), ('good2', good2)]), [])
        self.assertEqual(calls, ['bad', 'good1', 'good2'])
    def test_alphanumeric_code_bracket_priority(self):
        self.assertEqual(extract_security_code('株式会社テスト（130A） MBO検討 9999'), '130A')
    def test_dedup_normalizes_query_and_case(self):
        self.assertEqual(dedup_key('HTTPS://Example.com/Path/?utm=x'), dedup_key('https://example.com/Path'))

if __name__ == '__main__':
    unittest.main()
