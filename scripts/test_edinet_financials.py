import io
import unittest
import zipfile
from edinet_financials import parse_zip, compose, numeric

class EdinetFinancialsTest(unittest.TestCase):
    def fixture(self, unit='円／株'):
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as archive:
            archive.writestr('XBRL_TO_CSV/example.csv', ('要素ID\t項目名\tコンテキストID\t連結・個別\t単位\t値\n'+f'jpcrp:EPS\tEPS\tCurrentYearDuration\t連結\t{unit}\t120.50\n'+'jpcrp:EPS\tEPS\tPrior1YearDuration\t連結\t円／株\t-10\n'+'jpcrp:BPS\tBPS\tCurrentYearInstant\t連結\t円／株\t－\n').encode('utf-16'))
        return {'document':{'secCode':'130A0','filerName':'架空企業','docID':'S100TEST','docDescription':'訂正有価証券報告書'},'candidates':parse_zip(output.getvalue())}
    def mapping(self):
        return {'industry':'機械','fields':{'eps':{'ids':['1'],'period':'2026年3月期','scope':'consolidated','note':'通期・分割調整済みを確認'}}}
    def test_utf16_context_and_correction_preserved(self):
        data=self.fixture();self.assertEqual(len(data['candidates']),2)
        output=compose(data,self.mapping());self.assertEqual(output['facts']['eps']['value'],120.5)
        self.assertIn('訂正',output['facts']['eps']['sourceName']);self.assertIn('CurrentYearDuration',output['facts']['eps']['note'])
        self.assertNotIn('Subscription-Key',str(output))
    def test_no_inferred_unit_scope_or_zero(self):
        self.assertIsNone(numeric('－'));self.assertIsNone(numeric('NaN'));self.assertEqual(numeric('0'),0)
        with self.assertRaises(ValueError):compose(self.fixture('百万円'),self.mapping())
        with self.assertRaises(ValueError):compose(self.fixture(''),self.mapping())
        mapping=self.mapping();mapping['fields']['eps']['confirmedUnit']='円／株'
        self.assertEqual(compose(self.fixture(''),mapping)['facts']['eps']['value'],120.5)
        mapping['fields']['eps']['scope']='standalone'
        with self.assertRaises(ValueError):compose(self.fixture(),mapping)
    def test_ambiguous_or_duplicate_selection_rejected(self):
        mapping=self.mapping();mapping['fields']['eps']['ids']=['1','2']
        with self.assertRaises(ValueError):compose(self.fixture(),mapping)
        mapping['fields']['eps']['ids']=['1','1']
        with self.assertRaises(ValueError):compose(self.fixture(),mapping)

if __name__=='__main__':unittest.main()
