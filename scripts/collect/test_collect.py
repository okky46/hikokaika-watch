import importlib
import unittest
from unittest.mock import patch

from common import dedup_key, is_allowed_http_url
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

    def test_http_url_allowlist_rejects_unsafe_schemes(self):
        self.assertTrue(is_allowed_http_url('https://example.com/news?q=a&b=c'))
        self.assertTrue(is_allowed_http_url('http://example.com/path'))
        for url in ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '/relative', 'not a url']:
            self.assertFalse(is_allowed_http_url(url))

    def test_empty_api_base_urls_fall_back_to_defaults(self):
        with patch.dict('os.environ', {'TDNET_API_BASE_URL': '', 'EDINET_API_BASE_URL': ''}):
            import sources.tdnet as tdnet
            import sources.edinet as edinet
            tdnet = importlib.reload(tdnet)
            edinet = importlib.reload(edinet)
            self.assertEqual(tdnet.TDNET_API_BASE_URL, 'https://webapi.yanoshin.jp/webapi/tdnet/list')
            self.assertEqual(edinet.EDINET_API_BASE_URL, 'https://api.edinet-fsa.go.jp/api/v2')

if __name__ == '__main__':
    unittest.main()

class ExternalAPIFixtureTests(unittest.TestCase):
    def test_tdnet_json2_flat_extracts_candidate(self):
        from sources.tdnet import parse_payload
        rows = [{"title":"一部報道について", "code":"130A", "document_url":"https://example.com/td.pdf", "date":"2026-07-21 12:00", "body":"決定している事実はありません"}, {"title":"決算短信", "code":"9999", "document_url":"https://example.com/x.pdf"}]
        got = parse_payload(rows)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0].security_code, "130A")
        self.assertEqual(got[0].suggested_comment_tags, ("no_decision",))

    def test_tdnet_wrapped_and_unknown_invalid(self):
        from sources.tdnet import TDnetParseError, parse_payload
        got = parse_payload({"TDnet":{"items":[{"Title":"MBOの実施について", "Code":"7203", "link":"https://example.com/a", "datetime":"2026-07-21"}]}})
        self.assertEqual(got[0].title, "MBOの実施について")
        with self.assertRaises(TDnetParseError):
            parse_payload({"unexpected": {"x": 1}})

    def test_tdnet_rejects_non_json_and_unsafe_url(self):
        from sources.tdnet import parse_payload, response_json, TDnetParseError
        class Resp:
            headers={"content-type":"text/html"}; text="<html>oops</html>"
        with self.assertRaises(TDnetParseError):
            response_json(Resp())
        self.assertEqual(parse_payload([{"title":"MBO", "code":"1234", "url":"javascript:alert(1)"}]), [])

    def test_tdnet_fetch_url_defaults_to_today_json2(self):
        from sources.tdnet import tdnet_fetch_url
        url = tdnet_fetch_url("https://webapi.yanoshin.jp/webapi/tdnet/list")
        self.assertIn(".json2?limit=", url)
        self.assertTrue(url.startswith("https://webapi.yanoshin.jp/webapi/tdnet/list/"))

    def test_edinet_official_payload_filters_and_sanitizes(self):
        from sources.edinet import parse_documents
        payload = {"statusCode": 200, "metadata": {"title": "documents"}, "results": [
            {"docID":"S100TEST", "docDescription":"大量保有報告書", "secCode":"130A0", "submitDateTime":"2026-07-21 10:00", "filerName":"提出者", "Subscription-Key":"SECRET"},
            {"docID":"S100NOPE", "docDescription":"有価証券報告書", "secCode":"130A0"},
            {"docID":"S100OTHER", "docDescription":"変更報告書", "secCode":"99990"},
        ]}
        got = parse_documents(payload, {"130A"})
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0].security_code, "130A")
        self.assertEqual(got[0].url, "https://disclosure2.edinet-fsa.go.jp/")
        self.assertEqual(got[0].raw["metadata_draft"]["doc_id"], "S100TEST")
        self.assertNotIn("Subscription-Key", got[0].raw["edinet"])

    def test_edinet_errors_and_missing_key_skip(self):
        from sources.edinet import EDINETAPIError, collect, parse_documents
        with self.assertRaises(EDINETAPIError):
            parse_documents({"statusCode": 400, "results": []}, {"130A"})
        with self.assertRaises(EDINETAPIError):
            parse_documents({"statusCode": 200, "results": None}, {"130A"})
        with self.assertRaises(EDINETAPIError):
            parse_documents({"statusCode": 200, "results": [{"docDescription":"大量保有報告書", "secCode":"130A0"}]}, {"130A"})
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(collect({"130A"}), [])
