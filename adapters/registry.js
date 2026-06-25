import { newApiDefaultAdapter } from './new-api-default.js';
import { anyrouterAdapter } from './anyrouter.js';
import { muyuanAdapter } from './muyuan.js';
import { elysiverAdapter } from './elysiver.js';
import { chybenzunAdapter } from './chybenzun.js';
import { createRuleAdapter, hasRuleAdapter } from './rule-adapter.js';

const adapters = [
  chybenzunAdapter,
  anyrouterAdapter,
  muyuanAdapter,
  elysiverAdapter,
  newApiDefaultAdapter,
];

export function getAdapterForSite(site) {
  if (hasRuleAdapter(site)) {
    return createRuleAdapter(site);
  }
  return adapters.find(a => a.match(site.url)) || null;
}

export function registerAdapter(adapter) {
  adapters.push(adapter);
}

export function getAllAdapters() {
  return adapters;
}
