import contextlib
import importlib
import io
import unittest
from unittest.mock import patch

from common import InboxCandidate, candidate_dedup_key, dedup_key, is_allowed_http_url
from collect import candidate_payload, run_sources, similar_exists
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

    def test_default_date_range_includes_friday_on_monday(self):
        from datetime import date
        from sources.news import default_date_range
        self.assertEqual(default_date_range(date(2026, 7, 20)), (date(2026, 7, 17), date(2026, 7, 20)))
        self.assertEqual(default_date_range(date(2026, 7, 21)), (date(2026, 7, 19), date(2026, 7, 21)))
        self.assertEqual(default_date_range(date(2026, 7, 19)), (date(2026, 7, 17), date(2026, 7, 19)))
    def test_dedup_normalizes_query_and_case(self):
        self.assertEqual(dedup_key('HTTPS://Example.com/Path/?utm=x'), dedup_key('https://example.com/Path'))


    def test_candidate_dedup_uses_edinet_doc_identity_only_when_present(self):
        a = InboxCandidate("edinet", "変更報告書", "https://disclosure2.edinet-fsa.go.jp/", raw={"edinet": {"docID": "S100AAA"}}, dedup_identity="edinet:S100AAA")
        b = InboxCandidate("edinet", "変更報告書", "https://disclosure2.edinet-fsa.go.jp/", raw={"edinet": {"docID": "S100BBB"}}, dedup_identity="edinet:S100BBB")
        a_again = InboxCandidate("edinet", "変更報告書", "https://disclosure2.edinet-fsa.go.jp/", raw={"edinet": {"docID": "S100AAA"}}, dedup_identity="edinet:S100AAA")
        self.assertNotEqual(candidate_payload(a)["dedup_key"], candidate_payload(b)["dedup_key"])
        self.assertEqual(candidate_payload(a)["dedup_key"], candidate_payload(a_again)["dedup_key"])
        self.assertEqual(len(candidate_payload(a)["dedup_key"]), 64)

    def test_tdnet_and_news_keep_url_based_dedup(self):
        tdnet = InboxCandidate("tdnet", "t", "HTTPS://Example.com/Path/?utm=x")
        news = InboxCandidate("news", "t", "https://example.com/Path")
        self.assertEqual(candidate_dedup_key(tdnet), dedup_key(tdnet.url))
        self.assertEqual(candidate_dedup_key(news), dedup_key(news.url))

    def test_edinet_bypasses_similar_title_check(self):
        calls = []
        def fake_get(*args, **kwargs):
            calls.append(args)
        self.assertFalse(similar_exists("https://supabase.example", "key", InboxCandidate("edinet", "変更報告書" * 20, "https://disclosure2.edinet-fsa.go.jp/", security_code="130A", dedup_identity="edinet:S100AAA")))
        self.assertEqual(calls, [])

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
            self.assertEqual(tdnet.tdnet_api_limit(), 300)
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

    def test_tdnet_limit_and_format_are_validated_after_import(self):
        with patch.dict('os.environ', {'TDNET_API_LIMIT': 'abc'}):
            import sources.tdnet as tdnet
            tdnet = importlib.reload(tdnet)
            with self.assertRaises(tdnet.TDnetConfigError):
                tdnet.tdnet_api_limit()
        from sources.tdnet import TDnetConfigError, tdnet_api_format, tdnet_api_limit
        self.assertEqual(tdnet_api_limit(None), 300)
        for raw, expected in [("", 300), ("300", 300), ("1", 1)]:
            self.assertEqual(tdnet_api_limit(raw), expected)
        for raw in ["abc", "0", "-1", "1000000"]:
            with self.assertRaises(TDnetConfigError):
                tdnet_api_limit(raw)
        self.assertEqual(tdnet_api_format(None), "json2")
        self.assertEqual(tdnet_api_format(""), "json2")
        for raw in ["xml", "json3"]:
            with self.assertRaises(TDnetConfigError):
                tdnet_api_format(raw)

    def test_tdnet_limit_config_error_logs_safe_reason_and_continues(self):
        from sources import tdnet
        stderr = io.StringIO()
        with patch.dict('os.environ', {'TDNET_API_LIMIT': 'abc'}), contextlib.redirect_stderr(stderr):
            got = run_sources([('tdnet', tdnet.collect), ('news-like', lambda: [InboxCandidate('news', 'ok', 'https://example.com')])])
        log = stderr.getvalue()
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0].source_kind, 'news')
        self.assertIn('TDnetConfigError', log)
        self.assertIn('TDNET_API_LIMIT', log)
        self.assertNotIn('abc', log)

    def test_tdnet_format_config_error_logs_safe_reason_and_continues(self):
        from sources import tdnet
        stderr = io.StringIO()
        with patch.dict('os.environ', {'TDNET_API_FORMAT': 'xml'}), contextlib.redirect_stderr(stderr):
            got = run_sources([('tdnet', tdnet.collect), ('news-like', lambda: [InboxCandidate('news', 'ok', 'https://example.com')])])
        log = stderr.getvalue()
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0].source_kind, 'news')
        self.assertIn('TDnetConfigError', log)
        self.assertIn('TDNET_API_FORMAT', log)
        self.assertNotIn('xml', log)

    def test_general_source_error_logs_type_without_message_and_continues(self):
        stderr = io.StringIO()
        secret_message = 'secret response body with DISCORD_WEBHOOK_URL'
        with contextlib.redirect_stderr(stderr):
            got = run_sources([('bad', lambda: (_ for _ in ()).throw(RuntimeError(secret_message))), ('news-like', lambda: [InboxCandidate('news', 'ok', 'https://example.com')])])
        log = stderr.getvalue()
        self.assertEqual(len(got), 1)
        self.assertIn('RuntimeError', log)
        self.assertNotIn(secret_message, log)
        self.assertNotIn('DISCORD_WEBHOOK_URL', log)

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
        self.assertEqual(parse_documents({"statusCode": 200, "results": [{"docDescription":"大量保有報告書", "secCode":"130A0"}]}, {"130A"}), [])
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(collect({"130A"}), [])

    def test_edinet_malformed_row_skips_and_keeps_valid_documents(self):
        from sources.edinet import parse_documents
        payload = {"statusCode": 200, "results": [
            {"docID":"S100AAA", "docDescription":"大量保有報告書", "secCode":"130A0", "submitDateTime":"2026-07-21 10:00"},
            {"docDescription":"変更報告書", "secCode":"130A0", "submitDateTime":"2026-07-21 11:00"},
            {"docID":"S100BAD", "docDescription":"変更報告書", "secCode":"not-code"},
            {"docID":"S100BBB", "docDescription":"変更報告書", "secCode":"130A0", "submitDateTime":"2026-07-21 12:00"},
        ]}
        got = parse_documents(payload, {"130A"})
        self.assertEqual([c.raw["metadata_draft"]["doc_id"] for c in got], ["S100AAA", "S100BBB"])
        self.assertNotEqual(candidate_payload(got[0])["dedup_key"], candidate_payload(got[1])["dedup_key"])

class GoogleNewsFilterTests(unittest.TestCase):
    def rss(self, items):
        body = ''.join(f"<item><title>{t}</title><link>{u}</link><pubDate>{d}</pubDate><description>{desc}</description></item>" for t,u,d,desc in items)
        return f"<rss><channel>{body}</channel></rss>"

    def test_explicit_security_code_only(self):
        from sources.news import extract_security_code
        self.assertIsNone(extract_security_code('2026年に非公開化を検討'))
        self.assertIsNone(extract_security_code('売上高1234億円'))
        self.assertIsNone(extract_security_code('非公開化を検討（2026）', base_year=2026))
        self.assertEqual(extract_security_code('株式会社テスト（1234）がMBO検討', base_year=2026), '1234')
        self.assertEqual(extract_security_code('株式会社テスト（130A）が非公開化を検討', base_year=2026), '130A')
        self.assertEqual(extract_security_code('証券コード：2026', base_year=2026), '2026')
        self.assertEqual(extract_security_code('銘柄コード 7203', base_year=2026), '7203')
        self.assertIsNone(extract_security_code('MBO検討 9999'))

    def test_google_news_year_only_article_is_not_registered(self):
        from datetime import date
        from sources.news import parse_rss
        xml = self.rss([
            ('非公開化を検討（2026）', 'https://example.com/year', 'Tue, 21 Jul 2026 00:00:00 GMT', 'MBO'),
        ])
        self.assertEqual(parse_rss(xml, '非公開化 報道', date_from=date(2026,7,21), date_to=date(2026,7,21)), [])

    def test_google_news_filters_code_and_keywords(self):
        from datetime import date
        from sources.news import parse_rss
        xml = self.rss([
            ('コードなしの非公開化報道', 'https://example.com/1', 'Tue, 21 Jul 2026 00:00:00 GMT', 'MBO'),
            ('株式会社テスト（1234）が決算発表', 'https://example.com/2', 'Tue, 21 Jul 2026 00:00:00 GMT', '増配'),
            ('株式会社テスト（1234）がMBO検討', 'https://example.com/3', 'Tue, 21 Jul 2026 00:00:00 GMT', ''),
        ])
        got = parse_rss(xml, '非公開化 報道', date_from=date(2026,7,21), date_to=date(2026,7,21))
        self.assertEqual([x.url for x in got], ['https://example.com/3'])

    def test_google_news_date_range_inclusive_and_excludes_unparseable(self):
        from datetime import date
        from sources.news import parse_rss
        xml = self.rss([
            ('前日（1234）MBO', 'https://example.com/0', 'Mon, 20 Jul 2026 14:59:59 GMT', ''),
            ('開始日（1234）MBO', 'https://example.com/1', 'Mon, 20 Jul 2026 15:00:00 GMT', ''),
            ('終了日（1234）MBO', 'https://example.com/2', 'Tue, 21 Jul 2026 15:00:00 GMT', ''),
            ('不正日付（1234）MBO', 'https://example.com/3', 'not a date', ''),
            ('翌日（1234）MBO', 'https://example.com/4', 'Wed, 22 Jul 2026 15:00:00 GMT', ''),
        ])
        got = parse_rss(xml, '非公開化 報道', date_from=date(2026,7,21), date_to=date(2026,7,22))
        self.assertEqual([x.url for x in got], ['https://example.com/1', 'https://example.com/2'])

    def test_google_news_query_dates(self):
        from datetime import date
        from sources.news import format_query
        self.assertEqual(format_query('非公開化 報道', date(2026,7,19), date(2026,7,21)), '非公開化 報道 after:2026-07-19 before:2026-07-22')

    def test_reject_invalid_cli_dates(self):
        import argparse
        from collect import resolve_news_date_range
        with self.assertRaises(argparse.ArgumentTypeError):
            resolve_news_date_range('bad', '2026-07-21')
        with self.assertRaises(argparse.ArgumentTypeError):
            resolve_news_date_range('2026-07-22', '2026-07-21')
        with self.assertRaises(argparse.ArgumentTypeError):
            resolve_news_date_range('2026-07-21', None)
