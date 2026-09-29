"""Run the repository's independent checks, preserving per-suite logs and exit codes.

PW/CHROME select an existing Playwright runtime; no dependencies are installed here.
Examples: python tools/validate_all.py --unit; python tools/validate_all.py --browser
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--unit', action='store_true')
    parser.add_argument('--browser', action='store_true')
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    if not args.unit and not args.browser:
        args.unit = args.browser = True
    files = []
    if args.unit:
        files += sorted((ROOT / 'tests').glob('*.js'))
        files += sorted((ROOT / 'tests' / 'baseline2').glob('*-test.js'))
        files += sorted(set((ROOT / 'tests').glob('*test.py')))
    if args.browser:
        files += sorted(p for p in (ROOT / 'tests/browser').glob('*.js') if p.name != 'performance.js')
    out = ROOT / 'output/validation'
    out.mkdir(parents=True, exist_ok=True)

    def run(item):
        index, file = item
        rel = file.relative_to(ROOT).as_posix()
        env = dict(os.environ, PORT=str(9650 + index), PYTHONIOENCODING='utf-8')
        command = [sys.executable if file.suffix == '.py' else 'node', str(file)]
        start = time.monotonic()
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, timeout=240)
            code, log = result.returncode, result.stdout.decode('utf-8', errors='replace')
        except subprocess.TimeoutExpired as error:
            code, log = 124, (error.stdout or b'').decode('utf-8', errors='replace') + '\nTIMEOUT after 240 seconds'
        name = rel.replace('/', '_') + '.log'
        (out / name).write_text(log, encoding='utf-8')
        row = dict(suite=rel, exitCode=code, seconds=round(time.monotonic() - start, 2), log='output/validation/' + name)
        print(('PASS' if code == 0 else 'FAIL') + ' ' + rel + ' (' + str(row['seconds']) + 's)', flush=True)
        if code: print(log[-2200:], flush=True)
        return row

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.jobs, 4))) as pool:
        results = list(pool.map(run, enumerate(files)))
    kind = 'all' if args.unit and args.browser else ('unit' if args.unit else 'browser')
    report = dict(suites=results, passed=sum(r['exitCode'] == 0 for r in results), failed=sum(r['exitCode'] != 0 for r in results))
    (out / (kind + '-results.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{kind}: {report['passed']} suites passed; {report['failed']} failed", flush=True)
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
