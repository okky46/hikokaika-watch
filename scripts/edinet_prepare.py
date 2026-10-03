"""Prepare reviewable annual financials from the official EDINET API v2.

EDINET_API_KEY stays in this process. No publishing, external AI, or scheduling.
The default scan covers 400 days; cached daily indexes make repeated runs cheap.
"""
import argparse
import concurrent.futures
import datetime as dt
import io
import json
from pathlib import Path
import re
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
from edinet_financials import request, numeric, MAX_BYTES, PUBLIC_URL

NS = {'x': 'http://www.xbrl.org/2003/instance', 'd': 'http://xbrl.org/2006/xbrldi'}
TAGS = {
    'eps': {'BasicEarningsLossPerShareSummaryOfBusinessResults', 'BasicEarningsLossPerShareIFRSSummaryOfBusinessResults'},
    'bps': {'NetAssetsPerShareSummaryOfBusinessResults'},
    'cash': {'CashAndCashEquivalentsSummaryOfBusinessResults', 'CashAndCashEquivalentsIFRSSummaryOfBusinessResults'},
}

def active(doc):
    return doc.get('withdrawalStatus') == '0' and doc.get('disclosureStatus') == '0' and doc.get('legalStatus') in {'1', '2'}

def select_documents(documents, codes, as_of):
    # A recent correction to an old year must never supersede a newer annual period.
    unique = {d['docID']: d for d in documents if d.get('docID')}
    selected, issues = {}, {}
    for code in codes:
        annual = [d for d in unique.values() if d.get('secCode') == code+'0' and d.get('docTypeCode') in {'120','130'}
                  and active(d) and d.get('xbrlFlag') == '1' and d.get('periodEnd') and d['periodEnd'] <= as_of
                  and (d.get('submitDateTime') or '')[:10] <= as_of]
        if not annual:
            issues[code] = '検索期間内に取得可能な有価証券報告書がありません。'; continue
        end = max(d['periodEnd'] for d in annual)
        latest = sorted([d for d in annual if d['periodEnd'] == end], key=lambda d: d.get('submitDateTime',''), reverse=True)
        if len(latest)>1 and latest[0].get('submitDateTime') == latest[1].get('submitDateTime'):
            issues[code] = '同じ対象期・提出時刻の書類が複数あります。'; continue
        chosen = latest[0]
        # Corrections have to refer to a chain available in the scanned metadata.
        cursor, seen = chosen, set()
        while cursor.get('docTypeCode') == '130':
            parent = cursor.get('parentDocID')
            if not parent or parent in seen or parent not in unique or not active(unique[parent]):
                issues[code] = '訂正元の書類を確認できません。検索開始日を早めてください。'; break
            seen.add(parent); cursor = unique[parent]
        else:
            if cursor.get('docTypeCode') == '120' and cursor.get('secCode') == code+'0' and cursor.get('periodEnd') == end:
                selected[code] = chosen
            else: issues[code] = '訂正元と銘柄・対象期が一致しません。'
    return selected, issues

def parse_xbrl(blob, doc, industry):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        files = [f for f in z.infolist() if '/PublicDoc/' in f.filename and f.filename.endswith('.xbrl')]
        if len(files) != 1 or files[0].file_size > MAX_BYTES:
            raise ValueError('公開XBRLのファイル数・サイズが想定と異なります。')
        xml = z.read(files[0])
    if b'<!DOCTYPE' in xml.upper() or b'<!ENTITY' in xml.upper():
        raise ValueError('外部実体を含むXMLは処理しません。')
    root = ET.fromstring(xml)
    contexts, units = {}, {}
    for c in root.findall('x:context', NS):
        members = c.findall('.//d:explicitMember', NS)
        # Accept only undimensioned consolidated data, or the explicit standalone axis.
        dims = [(m.get('dimension','').split(':')[-1], (m.text or '').split(':')[-1]) for m in members]
        if c.findall('.//d:typedMember', NS) or c.findall('.//x:segment', NS): continue
        if dims and dims != [('ConsolidatedOrNonConsolidatedAxis','NonConsolidatedMember')]: continue
        contexts[c.get('id')] = {'start': c.findtext('x:period/x:startDate', namespaces=NS),
                                'end': c.findtext('x:period/x:endDate', namespaces=NS),
                                'instant': c.findtext('x:period/x:instant', namespaces=NS),
                                'scope': 'standalone' if dims else 'consolidated'}
    for u in root.findall('x:unit', NS):
        single = u.findtext('x:measure', namespaces=NS)
        numerator = u.findtext('x:divide/x:unitNumerator/x:measure', namespaces=NS)
        denominator = u.findtext('x:divide/x:unitDenominator/x:measure', namespaces=NS)
        # The QName prefixes are the standard EDINET unit namespaces, not display labels.
        if single == 'iso4217:JPY': units[u.get('id')] = 'JPY'
        elif numerator == 'iso4217:JPY' and denominator == 'xbrli:shares': units[u.get('id')] = 'JPY/shares'
    candidates = {k: [] for k in TAGS}
    end, start = doc.get('periodEnd'), doc.get('periodStart')
    if not end or not start or not 330 <= (dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days <= 380:
        raise ValueError('通常の通期に該当しません。変則決算は個別に確認してください。')
    for fact in root:
        tag = fact.tag.split('}')[-1]
        namespace = fact.tag.split('}')[0]
        if not re.search(r'/taxonomy/(jpcrp|jpigp)/', namespace): continue
        c = contexts.get(fact.get('contextRef'))
        if not c: continue
        for key, aliases in TAGS.items():
            if tag not in aliases: continue
            if key == 'eps' and (c['start'] != start or c['end'] != end): continue
            if key != 'eps' and c['instant'] != end: continue
            unit = units.get(fact.get('unitRef'))
            if unit != ('JPY/shares' if key in {'eps','bps'} else 'JPY'): continue
            n = numeric(fact.text)
            if n is not None:
                candidates[key].append((c['scope'], n, tag, fact.get('contextRef'), unit))
    facts, evidence, issues = {}, {}, []
    # If consolidated data exists for one field, never silently borrow standalone fields.
    scope = 'consolidated' if any(x[0]=='consolidated' for xs in candidates.values() for x in xs) else 'standalone'
    for key, xs in candidates.items():
        matches = [x for x in xs if x[0] == scope]
        if not matches: issues.append(f'{key}：標準要素・対象期・単位が一致する値がありません。'); continue
        if len({x[1] for x in matches}) != 1:
            issues.append(f'{key}：同じ対象期の値が一致しません。'); continue
        s, value, tag, context, unit = matches[0]
        facts[key] = {'value': value, 'period': f'{start}〜{end}' if key=='eps' else end, 'basis': 'actual', 'scope': s,
                      'sourceName': f"EDINET {doc['docID']} {doc.get('docDescription','有価証券報告書')}", 'sourceUrl': PUBLIC_URL,
                      'note': f'金融庁EDINETのXBRLを加工。{tag} [{context}]。単位 {unit}。書類内の株式分割基準。現在の分割基準との照合が必要。'}
        evidence[key] = {'element': tag, 'context': context, 'unit': unit, 'file': files[0].filename}
    issues.append('EBITDA・有利子負債・EV調整額・自己株式控除後株式数は、定義を確認した取込設定が必要です。未確認の値を0で補いません。')
    if not facts: raise ValueError('自動採用できる財務項目がありません。')
    return {'kind': 'financials', 'code': doc['secCode'][:4], 'name': doc['filerName'], 'industry': industry,
            'checkedOn': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat(),
            'notes': f"金融庁EDINET {doc['docID']} を加工。提出 {doc.get('submitDateTime','')}。通期実績。会社予想は含みません。公開前に訂正・分割・現在の採用期を確認。", 'facts': facts}, evidence, issues

def write_new(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, indent=2)


def read_index(day, cache):
    file = cache/(day.isoformat()+'.json')
    # A withdrawal or correction can change an older day's index. Revalidate daily.
    fresh = file.exists() and time.time()-file.stat().st_mtime < 24*60*60
    if fresh and day < dt.date.today():
        data = json.loads(file.read_text(encoding='utf-8'))
    else:
        data = json.loads(request('documents.json', {'date': day.isoformat(), 'type': 2}))
        if str(data.get('metadata',{}).get('status')) != '200':
            raise ValueError('一覧の応答が正常ではありません。')
        file.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        time.sleep(1)
    return data.get('results', [])

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--targets', default=str(Path(__file__).with_name('edinet_targets.json')), help='銘柄コード・比較業種を持つJSON配列')
    p.add_argument('--from', dest='start'); p.add_argument('--to', dest='end', default=dt.date.today().isoformat())
    p.add_argument('--cache', default='outputs/edinet/index'); p.add_argument('--output', required=True)
    p.add_argument('--listing', action='append', help='取得済み一覧JSON。指定時は日付走査を省略')
    args = p.parse_args()
    try:
        targets = json.loads(Path(args.targets).read_text(encoding='utf-8-sig'))
        if not isinstance(targets, list) or not 1 <= len(targets) <= 100: raise ValueError('対象は1〜100銘柄です。')
        if any(not re.fullmatch(r'[0-9][0-9A-Z]{3}', t['code']) or not isinstance(t['industry'],str) or not t['industry'].strip() for t in targets):
            raise ValueError('銘柄コード・比較業種を指定してください。')
        if len({t['code'] for t in targets}) != len(targets): raise ValueError('銘柄コードが重複しています。')
        end = dt.date.fromisoformat(args.end); start = dt.date.fromisoformat(args.start) if args.start else end-dt.timedelta(days=400)
        if not 0 <= (end-start).days <= 730 or end>dt.date.today(): raise ValueError('検索期間は過去730日以内の範囲にしてください。')
        documents = []
        if args.listing:
            for f in args.listing: documents.extend(json.loads(Path(f).read_text(encoding='utf-8-sig'))['documents'])
        else:
            cache = Path(args.cache); cache.mkdir(parents=True, exist_ok=True)
            days = [end-dt.timedelta(days=i) for i in range((end-start).days+1)]
            # Bound requests to four, and pause each worker after an API response.
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                for i, results in enumerate(pool.map(lambda d: read_index(d, cache), days)):
                    documents.extend(results)
                    if i % 20 == 0:
                        print(f'書類一覧を確認中：{i+1}/{len(days)}日。', flush=True)
        chosen, errors = select_documents(documents, [t['code'] for t in targets], end.isoformat())
        records, reports = [], []
        for number, t in enumerate(targets, 1):
            code=t['code']
            print(f'財務を確認中：{number}/{len(targets)}銘柄（{code}）。', flush=True)
            if code not in chosen: reports.append({'code':code, 'issues':[errors[code]]}); continue
            doc=chosen[code]
            try:
                record, evidence, issues = parse_xbrl(request('documents/'+doc['docID'], {'type':1}), doc, t['industry'])
                records.append(record); reports.append({'code':code,'document':doc,'evidence':evidence,'issues':issues})
            except ValueError as e: reports.append({'code':code,'issues':[str(e)]})
            time.sleep(1)
        write_new(args.output, {'records':records, 'reports':reports, 'asOf':end.isoformat(), 'searchStart':start.isoformat(), 'searchEnd':end.isoformat(), 'partialIndex':bool(args.listing)})
        print(f'財務下書き {len(records)}件／対象 {len(targets)}件。公開前の確認事項はreportsに保存しました。')
        return 0 if len(records)==len(targets) else 2
    except Exception:
        # Do not leak request URLs, credentials, document XML or provider response bodies.
        print('準備に失敗しました。API設定・入力形式・検索期間・保存先を確認してください。', file=sys.stderr); return 1

if __name__ == '__main__': sys.exit(main())
