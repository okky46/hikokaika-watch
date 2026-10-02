"""Manual EDINET financial-data import. No Supabase writes, scheduled jobs or key logging.

list -> fetch numeric candidates -> reviewed mapping -> admin import JSON.
Uses the official API v2 type=5 UTF-16 TSV ZIP. Python standard library only.
"""
import argparse
import csv
import datetime as dt
import decimal
import io
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import zipfile

BASE = 'https://api.edinet-fsa.go.jp/api/v2/'
MAX_BYTES = 32 * 1024 * 1024
PUBLIC_URL = 'https://disclosure2.edinet-fsa.go.jp/'
FIELDS = {'eps', 'bps', 'ebitda', 'debt', 'cash', 'adjustments', 'shares'}

def request(endpoint, params):
    key = os.environ.get('EDINET_API_KEY', '').strip()
    if not key:
        raise ValueError('環境変数EDINET_API_KEYが未設定です。')
    params = {**params, 'Subscription-Key': key}
    # Never print exceptions or this URL: HTTP errors can include the key.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('EDINETの予期しないリダイレクトを停止しました。')
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(BASE + endpoint + '?' + urllib.parse.urlencode(params), timeout=60) as response:
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError()
        return data
    except Exception:
        raise ValueError('EDINETの取得に失敗しました。APIキー・利用可能時間・書類の公開状態を確認してください。') from None

def numeric(value):
    try:
        # EDINET CSV uses unscaled numeric values; no inferred million-yen scale.
        n = decimal.Decimal(value.replace(',', '').strip())
        if not n.is_finite() or abs(n) > decimal.Decimal('1e16'):
            return None
        return int(n) if n == n.to_integral_value() else float(n)
    except (decimal.InvalidOperation, AttributeError):
        return None

def parse_zip(blob):
    result = []
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        files = [f for f in archive.infolist() if f.filename.lower().endswith('.csv')]
        if not files or sum(f.file_size for f in files) > MAX_BYTES or len(files) > 100:
            raise ValueError('CSV ZIPのサイズ・構造を確認してください。')
        for file in files:
            content = archive.read(file).decode('utf-16')
            reader = csv.DictReader(io.StringIO(content), delimiter='\t')
            required = {'要素ID', '項目名', 'コンテキストID', '単位', '値'}
            if not required.issubset(reader.fieldnames or []):
                raise ValueError('EDINET CSVの列名が想定と異なります。')
            for row in reader:
                n = numeric(row['値'])
                if n is None:
                    continue
                result.append({'id': str(len(result) + 1), 'file': file.filename,
                    'element': row['要素ID'], 'label': row['項目名'], 'context': row['コンテキストID'],
                    'periodLabel': row.get('相対年度', ''), 'scopeLabel': row.get('連結・個別', ''),
                    'unit': row['単位'], 'value': n})
    return result

def compose(candidates, mapping):
    doc = candidates['document']
    code = doc.get('secCode') or ''
    if not re.fullmatch(r'[0-9][0-9A-Z]{3}0', code):
        raise ValueError('書類の証券コードを確認できません。')
    facts = {}
    by_id = {c['id']: c for c in candidates['candidates']}
    for field, selection in mapping['fields'].items():
        if field not in FIELDS:
            raise ValueError('未知の財務項目です。')
        selected = [by_id[str(key)] for key in selection['ids']]
        if not selected or len({c['id'] for c in selected}) != len(selected):
            raise ValueError('項目が未選択、または重複しています。')
        if field in {'eps','bps','shares','cash'} and len(selected) != 1:
            raise ValueError('この項目は単一の値を選択してください。')
        expected = {'円／株','円/株','JPY/shares'} if field in {'eps','bps'} else {'株','shares'} if field=='shares' else {'円','JPY'}
        if any((c['unit'] or selection.get('confirmedUnit','')) not in expected for c in selected):
            raise ValueError('単位が不一致です。原資料を確認し管理画面で登録してください。')
        if len({c['context'] for c in selected}) != 1 or len({c['scopeLabel'] for c in selected}) != 1:
            raise ValueError('異なるコンテキスト・連結範囲の値は合計できません。')
        if selection.get('scope') not in {'consolidated','standalone'} or not selection.get('period') or not selection.get('note'):
            raise ValueError('対象期・連結範囲・採用根拠を指定してください。')
        labels = {c['scopeLabel'] for c in selected}
        if ('連結' in labels and selection['scope'] != 'consolidated') or (labels & {'個別','単体'} and selection['scope'] != 'standalone'):
            raise ValueError('CSVの連結範囲と指定が一致しません。')
        value = sum(decimal.Decimal(str(c['value'])) for c in selected)
        if abs(value)>decimal.Decimal('1e16'):
            raise ValueError('合計が登録可能範囲を超えています。')
        facts[field] = {'value': float(value), 'period': selection['period'], 'scope': selection['scope'],
            'basis': 'actual', 'sourceName': f"EDINET {doc['docID']} {doc.get('docDescription','')}",
            'sourceUrl': PUBLIC_URL,
            'note': selection['note'] + (f" ／ CSV単位空欄。原資料で確認した単位：{selection['confirmedUnit']}" if any(not c['unit'] for c in selected) else '') + ' ／ ' + ' + '.join(f"{c['element']} [{c['context']}]" for c in selected)}
    if not facts:
        raise ValueError('採用する項目がありません。')
    return {'kind':'financials','code':code[:4],'name':doc['filerName'], 'industry':mapping['industry'],
        'checkedOn':dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat(),
        'notes': mapping.get('notes','') + f" ／ EDINET書類ID {doc['docID']}。提出日 {doc.get('submitDateTime','')}。訂正書類の有無を公開前に確認。",
        'facts':facts}

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    p=commands.add_parser('list');p.add_argument('--date',required=True);p.add_argument('--output',required=True)
    p=commands.add_parser('fetch');p.add_argument('--listing',required=True);p.add_argument('--doc-id',required=True);p.add_argument('--output',required=True)
    p=commands.add_parser('compose');p.add_argument('--candidates',required=True);p.add_argument('--mapping',required=True);p.add_argument('--output',required=True)
    args=parser.parse_args()
    try:
        if args.command=='list':
            dt.date.fromisoformat(args.date)
            data=json.loads(request('documents.json',{'date':args.date,'type':2}))
            if str(data.get('metadata',{}).get('status'))!='200':
                raise ValueError('一覧取得の応答が正常ではありません。')
            result={'date':args.date,'documents':[d for d in data.get('results',[]) if d.get('csvFlag')=='1' and d.get('docTypeCode') in {'120','130','140','150','160','170'}]}
        elif args.command=='fetch':
            if not re.fullmatch(r'S[0-9A-Z]{7}',args.doc_id):
                raise ValueError('書類IDが不正です。')
            matches=[d for d in read(args.listing)['documents'] if d['docID']==args.doc_id]
            if len(matches)!=1:
                raise ValueError('一覧に書類IDがありません。')
            doc=matches[0]
            if doc.get('withdrawalStatus')!='0' or doc.get('disclosureStatus')!='0' or doc.get('legalStatus') not in {'1','2'}:
                raise ValueError('取下げ・不開示・取得対象外の書類です。')
            result={'document':doc,'candidates':parse_zip(request('documents/'+args.doc_id,{'type':5}))}
        else:
            result=compose(read(args.candidates),read(args.mapping))
        target=Path(args.output)
        target.parent.mkdir(parents=True,exist_ok=True)
        # Never overwrite prior research accidentally.
        with target.open('x',encoding='utf-8') as out:
            json.dump(result,out,ensure_ascii=False,indent=2)
        print('保存しました。出典・対象期・単位・訂正の有無を確認してください。')
        return 0
    except ValueError as error:
        print(str(error) if type(error) is ValueError else 'データ形式を確認してください。',file=sys.stderr)
    except Exception:
        print('処理に失敗しました。入力ファイル・保存先・CSV形式を確認してください。',file=sys.stderr)
    return 1

if __name__=='__main__':
    sys.exit(main())
