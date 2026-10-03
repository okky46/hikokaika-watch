import io, unittest, zipfile
from edinet_prepare import parse_xbrl, select_documents
DOC={'docID':'S100TEST','secCode':'00010','filerName':'架空会社','docTypeCode':'120','periodStart':'2025-04-01','periodEnd':'2026-03-31','submitDateTime':'2026-06-26 09:00','withdrawalStatus':'0','disclosureStatus':'0','legalStatus':'1','xbrlFlag':'1'}
class PrepareTest(unittest.TestCase):
 def blob(self,extra='',unit='iso4217:JPY',namespace='http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025/jpcrp_cor'):
  xml=f'''<x:xbrl xmlns:x="http://www.xbrl.org/2003/instance" xmlns:p="{namespace}" xmlns:d="http://xbrl.org/2006/xbrldi" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrli="http://www.xbrl.org/2003/instance"><x:context id="annual"><x:entity/><x:period><x:startDate>2025-04-01</x:startDate><x:endDate>2026-03-31</x:endDate></x:period></x:context><x:context id="instant"><x:entity/><x:period><x:instant>2026-03-31</x:instant></x:period></x:context><x:unit id="per"><x:divide><x:unitNumerator><x:measure>{unit}</x:measure></x:unitNumerator><x:unitDenominator><x:measure>xbrli:shares</x:measure></x:unitDenominator></x:divide></x:unit><p:BasicEarningsLossPerShareSummaryOfBusinessResults contextRef="annual" unitRef="per">123.45</p:BasicEarningsLossPerShareSummaryOfBusinessResults><p:NetAssetsPerShareSummaryOfBusinessResults contextRef="instant" unitRef="per">900</p:NetAssetsPerShareSummaryOfBusinessResults>{extra}</x:xbrl>'''
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:z.writestr('XBRL/PublicDoc/report.xbrl',xml)
  return b.getvalue()
 def rewritten(self,change):
  with zipfile.ZipFile(io.BytesIO(self.blob())) as z:xml=z.read('XBRL/PublicDoc/report.xbrl').decode()
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:z.writestr('XBRL/PublicDoc/report.xbrl',change(xml))
  return out.getvalue()
 def test_unit_prefix_aliases_use_namespace_identity(self):
  r,_,_=parse_xbrl(self.rewritten(lambda x:x.replace('iso4217','currency').replace('http://www.xbrl.org/2003/currency','http://www.xbrl.org/2003/iso4217').replace('xbrli:shares','stock:shares').replace('xmlns:xbrli=', 'xmlns:stock=')),DOC,'架空')
  self.assertEqual(r['facts']['eps']['value'],123.45)
  self.assertEqual(r['facts']['bps']['value'],900)
 def test_wrong_or_unbound_unit_namespaces_are_rejected(self):
  for change in [lambda x:x.replace('http://www.xbrl.org/2003/iso4217','https://example.com/currency'),lambda x:x.replace(' xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',''),lambda x:x.replace('xmlns:xbrli="http://www.xbrl.org/2003/instance"','xmlns:xbrli="https://example.com/shares"')]:
   with self.assertRaises(ValueError):parse_xbrl(self.rewritten(change),DOC,'架空')
 def test_unit_local_namespace_override_and_default_namespace(self):
  with self.assertRaises(ValueError):parse_xbrl(self.rewritten(lambda x:x.replace('<x:measure>iso4217:JPY','<x:measure xmlns:iso4217="https://example.com/currency">iso4217:JPY')),DOC,'架空')
  r,_,_=parse_xbrl(self.rewritten(lambda x:x.replace('<x:measure>iso4217:JPY','<x:measure xmlns="http://www.xbrl.org/2003/iso4217">JPY')),DOC,'架空')
  self.assertEqual(r['facts']['eps']['value'],123.45)
 def test_compound_units_do_not_use_only_first_measure(self):
  for change in [lambda x:x.replace('<x:unit id="per">','<x:unit id="per"><x:measure>iso4217:JPY</x:measure>'),lambda x:x.replace('</x:unitNumerator>','<x:measure>iso4217:USD</x:measure></x:unitNumerator>'),lambda x:x.replace('</x:unitDenominator>','<x:measure>xbrli:pure</x:measure></x:unitDenominator>')]:
   with self.assertRaises(ValueError):parse_xbrl(self.rewritten(change),DOC,'架空')
 def test_cash_unit_requires_exact_yen_measure(self):
  for measure,accepted in [('<x:measure xmlns:currency="http://www.xbrl.org/2003/iso4217">currency:JPY</x:measure>',True),('<x:measure xmlns:iso4217="https://example.com/currency">iso4217:JPY</x:measure>',False),('<x:measure>iso4217:USD</x:measure>',False),('<x:measure>iso4217:JPY</x:measure><x:measure>xbrli:shares</x:measure>',False)]:
   extra='<x:unit id="cash">'+measure+'</x:unit><p:CashAndCashEquivalentsSummaryOfBusinessResults contextRef="instant" unitRef="cash">100000</p:CashAndCashEquivalentsSummaryOfBusinessResults>'
   r,_,_=parse_xbrl(self.blob(extra),DOC,'架空')
   self.assertEqual('cash' in r['facts'],accepted)
   if accepted:self.assertEqual(r['facts']['cash']['value'],100000)
 def test_annual_unit_evidence_and_missing_not_zero(self):
  r,e,issues=parse_xbrl(self.blob(),DOC,'架空業種');self.assertEqual(r['facts']['eps']['value'],123.45);self.assertEqual(e['eps']['context'],'annual');self.assertNotIn('cash',r['facts']);self.assertNotIn('ebitda',r['facts']);self.assertTrue(issues)
 def test_ambiguous_values_omitted_and_nonstandard_units_rejected(self):
  extra='<p:BasicEarningsLossPerShareSummaryOfBusinessResults contextRef="annual" unitRef="per">234</p:BasicEarningsLossPerShareSummaryOfBusinessResults>'
  r,_,issues=parse_xbrl(self.blob(extra),DOC,'架空');self.assertNotIn('eps',r['facts']);self.assertEqual(r['facts']['bps']['value'],900)
  for kwargs in ({'unit':'iso4217:USD'},{'namespace':'https://example.com/custom/taxonomy/'}):
   with self.assertRaises(ValueError):parse_xbrl(self.blob(**kwargs),DOC,'架空')
 def test_irregular_fiscal_year_rejected(self):
  with self.assertRaises(ValueError):parse_xbrl(self.blob(),{**DOC,'periodStart':'2026-01-01'},'架空')
 def test_latest_period_before_correction_submission_and_missing_parent(self):
  old={**DOC,'docID':'S100OLD','periodEnd':'2025-03-31','submitDateTime':'2025-06-25'}
  correction={**old,'docID':'S100EDIT','docTypeCode':'130','parentDocID':'S100OLD','submitDateTime':'2026-09-30'}
  chosen,issues=select_documents([DOC,old,correction],['0001'],'2026-10-03');self.assertEqual(chosen['0001']['docID'],'S100TEST')
  correction={**DOC,'docID':'S100EDIT','docTypeCode':'130','parentDocID':'S100TEST','submitDateTime':'2026-09-30'}
  chosen,issues=select_documents([DOC,correction],['0001'],'2026-10-03');self.assertEqual(chosen['0001']['docID'],'S100EDIT')
  chosen,issues=select_documents([correction],['0001'],'2026-10-03');self.assertNotIn('0001',chosen);self.assertIn('0001',issues)
  chosen,issues=select_documents([{**DOC,'withdrawalStatus':'1'}],['0001'],'2026-10-03');self.assertNotIn('0001',chosen)
if __name__=='__main__':unittest.main()
