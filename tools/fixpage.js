#!/usr/bin/env node
'use strict';
// Rewrites one Corbellic tool page so it calls the proxy function instead of
// api.anthropic.com with a key in the page.   node fixpage.js path/to/index.html
//
//   var API_KEY = "sk-ant-…";                              -> removed
//   "https://api.anthropic.com/v1/messages"                 -> the proxy URL
//   "x-api-key": API_KEY, "anthropic-version": "…",
//   "anthropic-dangerous-direct-browser-access": "true"     -> removed
//
// Exits 1 (and writes nothing) if a key or a direct Anthropic call would be left.
const fs = require('fs');
const PROXY = 'https://blueprintaitools.netlify.app/.netlify/functions/ai';

function fix(html) {
  let s = String(html);
  // 1. the key line(s), however declared, with any whitespace/semicolon style
  s = s.replace(/^[ \t]*(?:var|let|const)[ \t]+API_KEY[ \t]*=[ \t]*["'`]sk-ant-[^"'`]*["'`][ \t]*;?[ \t]*\r?\n?/gm, '');
  // 2. the endpoint
  s = s.replace(/["'`]https:\/\/api\.anthropic\.com\/v1\/messages["'`]/g, '"' + PROXY + '"');
  // 3. the three browser headers, in any order, with their commas
  s = s.replace(/["']x-api-key["']\s*:\s*API_KEY\s*,?\s*/g, '');
  s = s.replace(/["']anthropic-version["']\s*:\s*["'][^"']*["']\s*,?\s*/g, '');
  s = s.replace(/["']anthropic-dangerous-direct-browser-access["']\s*:\s*["']true["']\s*,?\s*/g, '');
  // a header object that ended with ", }" after the removals
  s = s.replace(/,(\s*})/g, '$1');
  return s;
}

function check(s) {
  const left = [];
  if (/sk-ant-/.test(s)) left.push('an sk-ant- key is still in the page');
  if (/api\.anthropic\.com/.test(s)) left.push('a direct api.anthropic.com call is still in the page');
  if (/x-api-key/.test(s)) left.push('an x-api-key header is still in the page');
  if (/API_KEY/.test(s)) left.push('API_KEY is still referenced — look at it by hand');
  return left;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node fixpage.js index.html'); process.exit(2); }
  const before = fs.readFileSync(file, 'utf8');
  const had = /sk-ant-/.test(before) || /api\.anthropic\.com/.test(before);
  if (!had) { console.log(file + ': no key and no direct call — nothing to do'); process.exit(0); }
  const after = fix(before);
  const left = check(after);
  if (left.length) { console.error(file + ': NOT written — ' + left.join('; ')); process.exit(1); }
  fs.writeFileSync(file, after);
  console.log(file + ': rewritten — calls ' + PROXY + ', no key in page (' + (before.split(PROXY.slice(0, 20)).length - 1) + ' -> ' + (after.split(PROXY).length - 1) + ' call sites)');
}

module.exports = { fix, check, PROXY };
