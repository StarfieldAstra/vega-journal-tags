#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Vega · 期刊收录标签 —— 数据集瘦身

输入：完整版 journals.json（含校内专用字段）
输出：vega 版 journals.json（只保留公开收录信息）

为什么需要这一步
----------------
上游那份数据集是为「校内期刊分级」做的，里面带着一批只服务于分级的字段：
    s  校内 A 级期刊目录（A1/A2）
    H  主办单位            —— 只用于 A3「国家级学术刊物」认定
    B  认定依据            —— 同上
    u  关联高校 / U 是否社科类
    R  Review / O  OA 标记 —— 本插件不展示
这些字段既用不上，也不该出现在一份"只讲公开收录"的公开数据集里。

用法
----
    python tools/slim_data.py <源 journals.json> [输出路径]

默认输出：extension/data/journals.json
"""

import json
import os
import sys

# 保留字段（顺序即输出顺序）
KEEP = ['n', 'i', 'j', 'c', 'd', 'b', 'z', 'M', 'T', 'W', 'w', 'y']
DROP = ['s', 'H', 'B', 'u', 'U', 'R', 'O']


def has_signal(rec):
    """该刊是否值得显示标签"""
    return bool(rec.get('c') or rec.get('d') or rec.get('b')
                or rec.get('z') or rec.get('T') or rec.get('w'))


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        src = os.environ.get('VEGA_SRC_JSON', '')
    if not src:
        print('用法：python tools/slim_data.py <源 journals.json> [输出路径]')
        print('或设置环境变量 VEGA_SRC_JSON 指向源数据文件。')
        return 1

    out_path = sys.argv[2] if len(sys.argv) > 2 else \
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'extension', 'data', 'journals.json')

    with open(src, 'r', encoding='utf-8') as f:
        src_data = json.load(f)

    src_j = src_data.get('journals', {})
    src_meta = src_data.get('meta', {})

    journals = {}
    dropped_fields = set()
    for k, rec in src_j.items():
        if not has_signal(rec):
            continue
        out = {}
        for fld in KEEP:
            if fld in rec and rec[fld] not in (None, '', []):
                out[fld] = rec[fld]
        for fld in rec:
            if fld not in KEEP and fld not in DROP:
                dropped_fields.add(fld)
        journals[k] = out

    # 统计
    def cnt(pred):
        return sum(1 for r in journals.values() if pred(r))

    counts = {
        'total': len(journals),
        'cssciSource': cnt(lambda r: r.get('c') == 'source'),
        'cssciExt': cnt(lambda r: r.get('c') == 'ext'),
        'cscdCore': cnt(lambda r: r.get('d') == 'core'),
        'cscdExt': cnt(lambda r: r.get('d') == 'ext'),
        'beike': cnt(lambda r: r.get('b')),
        'cas': cnt(lambda r: r.get('z')),
        'casTop': cnt(lambda r: r.get('T')),
        'warning': cnt(lambda r: r.get('w')),
        'both': cnt(lambda r: r.get('c') == 'source' and r.get('d') == 'core'),
    }

    meta = {
        'name': 'Vega 期刊收录标签',
        'version': '1.0.0',
        'built': src_meta.get('built', ''),
        'sources': {
            'cssci': src_meta.get('sources', {}).get('cssci', 'CSSCI 2025-2026'),
            'cscd': src_meta.get('sources', {}).get('cscd', 'CSCD 2025-2026'),
            'beike': src_meta.get('sources', {}).get('beike', '北大中文核心期刊要目总览'),
            'cas': src_meta.get('sources', {}).get('cas', '中科院分区 2025 终版'),
            'warning': src_meta.get('sources', {}).get('warning', '中科院国际期刊预警名单 2020-2025'),
        },
        'counts': counts,
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'journals': journals}, f,
                  ensure_ascii=False, separators=(',', ':'))

    print('源条目 %d → 输出条目 %d' % (len(src_j), len(journals)))
    print('统计：')
    for k, v in counts.items():
        print('  %-12s %d' % (k, v))
    if dropped_fields:
        print('⚠ 出现了 KEEP/DROP 之外的未知字段（已丢弃）：%s'
              % '、'.join(sorted(dropped_fields)))
    print('输出：%s（%.2f MB）' % (out_path, os.path.getsize(out_path) / 1048576))
    return 0


if __name__ == '__main__':
    sys.exit(main())
