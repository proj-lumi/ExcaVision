#!/usr/bin/env python3
"""Network-free credential scan of reachable Git blobs and publishable worktree files.

Reports paths/types only, never matching values. Exit 1 on potential private-key
matches. Heuristics cannot prove absence of every secret or detect personal data
in binary images; review fixtures and presentation assets separately.
"""
import argparse
import base64
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "Supabase secret key": rb"sb_secret_[A-Za-z0-9_-]{15,}",
    "GitHub token": rb"(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})",
    "private key PEM": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "Resend API key": rb"\bre_[A-Za-z0-9_]{25,}",
    "AWS access ID": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
}
JWT = rb"eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}"


def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], cwd=ROOT, **kwargs)


def local_private_values():
    result = []
    for scope in ("apps/admin", "apps/mobile", "apps/landing", "supabase", "scripts", "firmware/node"):
        for target in ("production", "staging"):
            path = ROOT / scope / (".env." + target)
            if not path.is_file():
                continue
            for line in path.read_text().splitlines():
                match = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
                if not match:
                    continue
                name, value = match.groups()
                value = value.strip().strip("\"'")
                if (len(value) >= 12 and re.search(r"SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY", name)
                        and not re.search(r"PUBLIC|PUBLISHABLE|ANON", name)
                        and not re.search(r"REPLACE_ME|CHANGE_ME|PROJECT_REF", value)):
                    result.append((name, value.encode()))
    return result


def classify(data, local):
    private = [name for name, pattern in PATTERNS.items() if re.search(pattern, data)]
    public = []
    for token in re.findall(JWT, data):
        try:
            segment = token.split(b".")[1]
            claims = json.loads(base64.urlsafe_b64decode(segment + b"=" * (-len(segment) % 4)))
            (public if claims.get("role") == "anon" else private).append("JWT (anon/public)" if claims.get("role") == "anon" else "JWT (non-anon; review)")
        except (ValueError, TypeError):
            private.append("JWT-like value; review")
    if re.search(rb"sb_publishable_[A-Za-z0-9_-]{15,}", data):
        public.append("Supabase publishable key")
    private.extend("Exact local private value: " + name for name, value in local if value in data)
    return sorted(set(private)), sorted(set(public))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree-only", action="store_true")
    args = parser.parse_args()
    local = local_private_values()
    findings, public_matches, scanned = [], [], 0

    def inspect(data, location):
        nonlocal scanned
        scanned += 1
        private, public = classify(data, local)
        if private:
            findings.append({"location": location, "types": private})
        if public:
            public_matches.append({"location": location, "types": public})

    if not args.worktree_only:
        objects = git("rev-list", "--objects", "--all").decode().splitlines()
        process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        for entry in objects:
            oid, _, path = entry.partition(" ")
            process.stdin.write((oid + "\n").encode())
            process.stdin.flush()
            header = process.stdout.readline().decode().split()
            if len(header) != 3:
                continue
            size = int(header[2])
            data = process.stdout.read(size)
            process.stdout.read(1)
            if header[1] == "blob":
                inspect(data, "history:" + oid[:12] + ":" + path)
        process.stdin.close()
        process.wait()
        if process.returncode:
            raise RuntimeError("Git blob scan failed")

    paths = set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0"))
    for name in sorted(paths):
        path = ROOT / name
        if name and path.is_file():
            inspect(path.read_bytes(), "worktree:" + name)
    print(json.dumps({"items_scanned": scanned, "potential_private_findings": findings,
                      "public_key_matches": public_matches}, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
