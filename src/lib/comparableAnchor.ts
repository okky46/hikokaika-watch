import type {Comparable} from './valuation';

export function comparableAnchor(record:Comparable,index=0):string {
  return record.research
    ? `deal-${record.research.dealId}-${record.research.priceBasis}`
    : `legacy-${index}`;
}
