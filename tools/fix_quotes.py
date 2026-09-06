# -*- coding: utf-8 -*-
"""一次性修复:题库 JSON 字符串内部的裸 ASCII 引号 -> 中文引号(保留结构引号)。"""
import json, sys, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
BS = chr(92)  # backslash


def fix(text):
    out, i, n = [], 0, len(text)
    in_str = False
    inner_open = False
    replaced = 0
    while i < n:
        c = text[i]
        if not in_str:
            if c == '"':
                in_str = True
                inner_open = False
            out.append(c)
            i += 1
        else:
            if c == BS and i + 1 < n:
                out.append(c)
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                j = i + 1
                while j < n and text[j] in ' \t\r\n':
                    j += 1
                if j < n and text[j] in ',}]:':
                    k = j + 1
                    while k < n and text[k] in ' \t\r\n':
                        k += 1
                    if text[j] in ',:':
                        ok = k < n and (text[k] in '"{[-0123456789tfn')
                    else:
                        ok = True
                    if ok:
                        in_str = False
                        out.append(c)
                        i += 1
                        continue
                out.append('「' if not inner_open else '」')
                inner_open = not inner_open
                replaced += 1
                i += 1
            else:
                out.append(c)
                i += 1
    return ''.join(out), replaced


def main():
    for f in sorted((ROOT / 'data' / 'questions').glob('*.json')):
        raw = f.read_text(encoding='utf-8')
        try:
            json.loads(raw)
            print(f.name, 'OK already')
            continue
        except json.JSONDecodeError:
            pass
        fixed, cnt = fix(raw)
        try:
            json.loads(fixed)
        except json.JSONDecodeError as e:
            print(f.name, f'STILL BROKEN: {e}')
            continue
        f.write_text(fixed, encoding='utf-8')
        print(f.name, f'FIXED, {cnt} quotes replaced, parses OK')


if __name__ == '__main__':
    main()
